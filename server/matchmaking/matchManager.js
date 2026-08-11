const { GAME_CONFIG } = require('../core/gameState.js')
const { validateCharacter, getRandomCharacter } = require('../data/characters.js');
const { getRandomMap } = require('../data/maps.js');
const { debugLog } = require("../core/debug.js");

const matches = new Map();
const lockTimeouts = new Map();
const loadingTimeouts = new Map();

// Safety net for the asset-preload handshake below: if a client never sends
// "clientReadyForMatch" (asset genuinely stuck, tab backgrounded, whatever),
// we don't want to strand the *other* player in the loading screen forever -
// force the match to start anyway once this fires. Mirrors the existing
// charSelectTimeout pattern for the same reason.
const LOADING_TIMEOUT_MS = 15000;

//create a new match
const createMatch = (roomId, sockets)=>{
    const selectedMap = getRandomMap();
    const match = {
        roomId,
        phase: "CHARACTER_SELECT",
        mapId: selectedMap.id,
        players: sockets.map((socket, index) => ({
            socketId: socket.id,
            socket,
            playerIndex: index,
            character: null,
            locked: false,
            // true only for the synthetic "player" representing the AI bot
            // (see server/matchmaking/matchMaking.js::createBotMatch) - real
            // players' sockets never have this set.
            isBot: socket.isBot === true
        }))
    };

    matches.set(roomId, match);
    return match;
};

//get existing match
const getMatch = (roomId)=>{
    return matches.get(roomId);
};

//get existing match by socket
const getMatchBySocket = (socket)=>{
    for(const match of matches.values()){
        if(match.players.some(p => p.socketId === socket.id)){
            return match;
        }
    }
    return null;
};

//character selection logic
const selectCharacter = (socket, characterId)=>{
    const match = getMatchBySocket(socket);

    if(!match || match.phase !== "CHARACTER_SELECT"){
        return null;
    }

    if(!validateCharacter(characterId)){
        return null;
    }

    const player = match.players.find(p => p.socketId === socket.id);
    if(!player || player.locked){
        return null;
    }

    // NEW: Check if another player has already selected this character
    const isCharacterTaken = match.players.some(p => 
        p.socketId !== socket.id && p.character === characterId
    );
    
    if(isCharacterTaken){
        debugLog(`[MatchManager] Character ${characterId} already selected by another player`);
        return { error: 'character_taken' };
    }

    player.character = characterId;
    
    return match;
};

//character locking logic
const lockCharacter = (socket)=>{
    const match = getMatchBySocket(socket);

    if(!match || match.phase !== "CHARACTER_SELECT"){
        return null;
    }

    const player = match.players.find(p => p.socketId === socket.id);
    if(!player || !player.character){
        return null;
    }

    // NEW: Double-check character isn't taken before locking
    const isCharacterTaken = match.players.some(p => 
        p.socketId !== socket.id && p.character === player.character
    );
    
    if(isCharacterTaken){
        debugLog(`[MatchManager] Cannot lock - character ${player.character} already selected`);
        return { error: 'character_taken' };
    }

    player.locked = true;

    if(match.players.every(p => p.locked)){
        clearCharacterSelectTimeout(match.roomId);
        return enterLoadingPhase(match);
    }
    return null;
};

//character selection time limit logic
const startCharacterSelectTimeout = (match, startOnTimeout, duration = GAME_CONFIG.charSelectTimeout)=>{
    if(lockTimeouts.has(match.roomId)){
        return;
    }

    const timeoutId = setTimeout(()=>{
        const currentMatch = matches.get(match.roomId);

        if(currentMatch.phase !== "CHARACTER_SELECT" || !currentMatch){ 
            lockTimeouts.delete(match.roomId);
            return;
        }

        // NEW: Assign random characters ensuring no duplicates
        // Seed with whatever's already been picked (locked in or just
        // selected-but-not-locked) BEFORE assigning any randoms - otherwise
        // a player who hasn't picked yet but is earlier in match.players
        // could get randomly assigned the same character their opponent
        // already locked in later in the array, since forEach below only
        // adds a player's character to this set as it reaches them.
        const usedCharacters = new Set(
            currentMatch.players
                .filter(p => p.character)
                .map(p => p.character)
        );
        
        currentMatch.players.forEach((p)=>{
            if(!p.character){
                // Get a random character that hasn't been used
                let randomChar;
                let attempts = 0;
                const maxAttempts = 20; // Prevent infinite loop
                
                do {
                    randomChar = getRandomCharacter();
                    attempts++;
                } while (usedCharacters.has(randomChar) && attempts < maxAttempts);
                
                p.character = randomChar;
                usedCharacters.add(randomChar);
            }
            p.locked = true;
        });

        const fightData = enterLoadingPhase(currentMatch);
        lockTimeouts.delete(currentMatch.roomId);

        if(typeof startOnTimeout === "function"){
            startOnTimeout(fightData);
        }

    }, duration);

    lockTimeouts.set(match.roomId, timeoutId);
};

// Both players have locked characters, but the fight hasn't actually begun yet -
// move the match into "LOADING" so clients can preload character/map assets and
// confirm readiness before the game loop (and the tick clock/timers inside it)
// starts running. `processInput` and everything else that gates on phase === "FIGHT"
// naturally rejects input during this window, which is exactly what we want - nobody's
// simulation should advance while an opponent might still be pulling down sprite sheets.
const enterLoadingPhase = (match)=>{
    match.phase = "LOADING";

    match.players.forEach(p => {
        // bots have no client to preload/ack anything, so they're trivially "ready"
        p.readyForMatch = !!p.isBot;
        // resolve + cache the username here (single choke point for both the
        // real-lockin path and the char-select-timeout/bot auto-lock path) so
        // actuallyBeginFight() below has one consistent source to read from.
        p.username = (p.socket && p.socket.username) ? p.socket.username : "Player";
    });

    return {
        roomId: match.roomId,
        mapId: match.mapId,
        players: match.players.map(p => ({
            socketId: p.socketId,
            playerIndex: p.playerIndex,
            character: p.character,
            username: p.username,
            // internal-only flag so the client can decide whether to run the
            // bot FSM (see public/core/botController.js) - never rendered in
            // the UI, so the human never sees "bot" anywhere.
            isBot: !!p.isBot
        }))
    };
};

//a client has finished preloading and is signalling it's ready for the fight to
//actually begin. Returns the match once EVERY player (bots auto-count) is ready,
//so the caller knows it's time to initialize game state and start the loop - or
//null if we're still waiting on someone.
const markPlayerReady = (socket)=>{
    const match = getMatchBySocket(socket);

    if(!match || match.phase !== "LOADING"){
        return null;
    }

    const player = match.players.find(p => p.socketId === socket.id);
    if(!player){
        return null;
    }

    player.readyForMatch = true;

    if(match.players.every(p => p.readyForMatch)){
        clearLoadingTimeout(match.roomId);
        return match;
    }
    return null;
};

//safety-net timeout: if not everyone acks readiness in time, force the match to
//begin anyway rather than leaving the other player stuck on a loading screen.
const startLoadingTimeout = (match, onTimeout, duration = LOADING_TIMEOUT_MS)=>{
    if(loadingTimeouts.has(match.roomId)){
        return;
    }

    const timeoutId = setTimeout(()=>{
        loadingTimeouts.delete(match.roomId);

        const currentMatch = matches.get(match.roomId);
        if(!currentMatch || currentMatch.phase !== "LOADING"){
            return;
        }

        currentMatch.players.forEach(p => { p.readyForMatch = true; });

        if(typeof onTimeout === "function"){
            onTimeout(currentMatch);
        }
    }, duration);

    loadingTimeouts.set(match.roomId, timeoutId);
};

//clear timeout once everyone's confirmed ready (or the match ended early)
const clearLoadingTimeout = (roomId)=>{
    if(loadingTimeouts.has(roomId)){
        clearTimeout(loadingTimeouts.get(roomId));
        loadingTimeouts.delete(roomId);
    }
};

//clear timeout on lock in
const clearCharacterSelectTimeout = (roomId)=>{
    if(lockTimeouts.has(roomId)){
        clearTimeout(lockTimeouts.get(roomId));
        lockTimeouts.delete(roomId);
    }
};

//cleanup match data
const deleteMatch = (roomId)=>{
    clearCharacterSelectTimeout(roomId);
    clearLoadingTimeout(roomId);
    matches.delete(roomId);
};

module.exports = { matches, createMatch, getMatch, getMatchBySocket, selectCharacter, lockCharacter, startCharacterSelectTimeout, clearCharacterSelectTimeout, deleteMatch, enterLoadingPhase, markPlayerReady, startLoadingTimeout, clearLoadingTimeout };