const { matches, createMatch, getMatch, startCharacterSelectTimeout, selectCharacter, lockCharacter, startLoadingTimeout } = require("./matchManager.js");
const { initializeGameState, startGameLoop } = require("../core/gameState.js");
const { getRandomCharacter } = require("../data/characterData.js");
const { debugLog, debugError } = require("../core/debug.js");

const ROOM_ID_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const QUEUE_SIZE = 2;
const queue = [];
const customRooms = new Map(); // Store custom rooms waiting for second player
let ioInstance = null;

// ── Bot fallback (see createBotMatch() below) ──────────────────────────
// If nobody else queues up in time, we quietly pair the waiting player
// against an AI opponent instead of leaving them stuck in queue forever.
const BOT_FALLBACK_DELAY_RANGE_MS = [9000, 17000]; // 9-17s, randomized per requirements
const botFallbackTimers = new Map(); // socket.id -> timeoutId

// Plausible-looking usernames for the bot so it doesn't stand out in the
// character-select / in-fight UI (which just displays whatever "username" is
// attached to a player). Purely cosmetic - has no effect on behavior.
const BOT_USERNAMES = [
    "Shadow99", "NovaStrike", "Kairo_", "xBlazex", "RuneWalker", "VexTide",
    "OnyxFang", "GrimEcho", "Ryder.exe", "PhantomV", "Stormbyte", "Kestrel7"
];

const initMatchmaking = (io) => {
    ioInstance = io;
};

//add players to matchmaking queue
const addToQueue = (socket)=>{
    if(queue.find((p)=> p.id === socket.id)){
        return null;
    }

    queue.push(socket);
    debugLog("Queued:", socket.id);

    const match = tryMatch();

    // Only start the bot-fallback clock if this player is still waiting -
    // if tryMatch() above just paired them with a real opponent, there's
    // nothing to fall back from.
    if(!match){
        scheduleBotFallback(socket);
    }

    return match;
};

//remove players from matchmaking queue
const removeFromQueue = (socket)=>{
    clearBotFallback(socket.id);

    const index = queue.findIndex(p => p.id === socket.id);
    if (index !== -1){
        queue.splice(index, 1);
        debugLog("Removed from queue:", socket.id);
    }
    
    // Also check custom rooms
    for (const [roomId, roomData] of customRooms.entries()) {
        if (roomData.creator.id === socket.id) {
            customRooms.delete(roomId);
            debugLog(`Custom room ${roomId} deleted - creator left`);
        }
    }
};

//queue a player for the AI-bot fallback if real matchmaking doesn't find
//them an opponent in time
const scheduleBotFallback = (socket) => {
    clearBotFallback(socket.id);

    const delay = randomBetween(...BOT_FALLBACK_DELAY_RANGE_MS);
    const timeoutId = setTimeout(() => {
        botFallbackTimers.delete(socket.id);

        const index = queue.findIndex(p => p.id === socket.id);
        if(index === -1){
            // already matched with a real player (or disconnected) - nothing to do
            return;
        }

        queue.splice(index, 1);
        createBotMatch(socket);
    }, delay);

    botFallbackTimers.set(socket.id, timeoutId);
};

const clearBotFallback = (socketId) => {
    if(botFallbackTimers.has(socketId)){
        clearTimeout(botFallbackTimers.get(socketId));
        botFallbackTimers.delete(socketId);
    }
};

//create custom room
const createCustomRoom = (socket) => {
    if (!ioInstance) {
        debugError("io instance not initialized");
        return null;
    }

    const roomId = generateRoomCode();
    
    customRooms.set(roomId, {
        roomId,
        creator: socket,
        createdAt: Date.now()
    });

    socket.join(roomId);
    debugLog(`Custom room created: ${roomId} by ${socket.id}`);

    return { roomId };
};

//join custom room
const joinCustomRoom = (socket, roomId) => {
    if (!ioInstance) {
        debugError("io instance not initialized");
        return null;
    }

    const room = customRooms.get(roomId);
    
    if (!room) {
        return { error: "Room not found" };
    }

    if (room.creator.id === socket.id) {
        return { error: "Cannot join your own room" };
    }

    // Remove room from waiting list
    customRooms.delete(roomId);

    const players = [room.creator, socket];
    const match = createMatch(roomId, players);

    // Make both players join the match room
    players.forEach((player) => {
        player.join(roomId);
    });

    debugLog(`Custom room ${roomId} matched with 2 players`);

    ioInstance.to(match.roomId).emit("matchFound", {
        roomId: match.roomId,
        players: match.players.map(p => ({
            socketId: p.socketId,
            playerIndex: p.playerIndex
        }))
    });

    // Start the character selection timeout
    startCharacterSelectTimeout(match, beginLoadingForRoom);

    return { success: true, match };
};

//start match phase on full queue
const tryMatch = ()=>{
    if(queue.length < QUEUE_SIZE){
        return null;
    }

    if(!ioInstance){
        debugError("io instance not initialized");
        return null;
    }

    //add players in queue to players variable and reset queue
    const players = queue.splice(0, QUEUE_SIZE);

    // they found a real opponent - no need for the bot-fallback clock anymore
    players.forEach(p => clearBotFallback(p.id));

    const roomId = generateRoomCode();
    const match = createMatch(roomId, players);

    //make each player join the match room
    players.forEach((player)=>{
        player.join(roomId);
    });

    debugLog(`Match created: ${roomId}`);

    ioInstance.to(match.roomId).emit("matchFound", {
        roomId: match.roomId,
        players: match.players.map(p => ({
            socketId: p.socketId,
            username: p.user,
            playerIndex: p.playerIndex
        }))
    });

    // start the character selection timeout
    startCharacterSelectTimeout(match, beginLoadingForRoom);

    return match;
};

//shared "all players locked in, move to the loading screen" logic - used by
//the character-select timeout (real matches) and by the bot's own lock-in
//(see scheduleBotCharacterSelection below). Tells clients which characters/map
//to preload, then waits for everyone to ack "clientReadyForMatch" (or the
//loading timeout below to fire) before the fight actually begins.
const beginLoadingForRoom = (fightData) => {
    const match = getMatch(fightData.roomId);
    if (!match) {
        return;
    }

    ioInstance.to(fightData.roomId).emit("matchLoading", {
        roomId: fightData.roomId,
        players: fightData.players,
        mapId: fightData.mapId
    });

    startLoadingTimeout(match, actuallyBeginFight);
    debugLog(`[matchmaking] Match ${fightData.roomId} entering loading phase`);
};

//everyone's confirmed ready (or the loading timeout forced it) - NOW actually
//initialize server-authoritative game state and start the tick loop. This is
//the single place that happens, whether reached via the ready-handshake or
//the safety-net timeout.
const actuallyBeginFight = (match) => {
    try {
        match.phase = "FIGHT";

        const playersWithUsernames = match.players.map(p => ({
            socketId: p.socketId,
            playerIndex: p.playerIndex,
            character: p.character,
            username: p.username,
            isBot: !!p.isBot
        }));

        const gameState = initializeGameState(match.roomId, playersWithUsernames, match.mapId);

        ioInstance.to(match.roomId).emit("matchBegin", {
            roomId: match.roomId,
            map: gameState.map,
            gameState: {
                players: gameState.players.map(p => ({
                    socketId: p.socketId,
                    playerIndex: p.playerIndex,
                    character: p.character,
                    position: p.position,
                    health: p.health,
                    maxHealth: p.maxHealth
                }))
            }
        });

        startGameLoop(match.roomId, ioInstance);
        debugLog(`[matchmaking] Match ${match.roomId} started successfully`);
    } catch (error) {
        ioInstance.to(match.roomId).emit("matchError", {
            message: "Failed to start match",
            reason: "start_failed"
        });
    }
};

//create a match pairing a real (human) player against an AI bot. Used when
//nobody else joins the queue in time (see scheduleBotFallback above). The
//bot is represented server-side as a plain data record with a synthetic
//socketId - it flows through the exact same matchManager/gameState code
//paths as a real player (character select, locking, physics, cooldowns),
//just without a real socket behind it. Its actual *decisions* (movement,
//attacks, blocking) are made entirely client-side by the human's browser,
//see public/core/botController.js, and sent back up over the "botInput"
//socket event (server/networking/socketHandler.js) - this function only
//sets up the match shell and automates character select for it.
const createBotMatch = (socket) => {
    if(!ioInstance){
        debugError("io instance not initialized");
        return null;
    }

    const roomId = generateRoomCode();
    const botId = `bot-${roomId}`;
    const botUsername = BOT_USERNAMES[Math.floor(Math.random() * BOT_USERNAMES.length)];

    // a minimal stand-in for a real socket.io socket - only needs an `id`
    // (used everywhere as the player identity key) and a no-op `join`
    // (matchManager/createMatch calls player.join(roomId) on every player).
    // `username` matters too - matchManager's enterLoadingPhase() resolves
    // each player's display name from `p.socket.username`, and without it
    // set here the bot always fell back to the generic "Player" default,
    // even though botUsername below was already being picked correctly.
    const botSocket = { id: botId, isBot: true, username: botUsername, join: () => {} };

    const match = createMatch(roomId, [socket, botSocket]);

    socket.join(roomId);
    debugLog(`Bot match created: ${roomId} (${socket.id} vs bot)`);

    ioInstance.to(match.roomId).emit("matchFound", {
        roomId: match.roomId,
        players: match.players.map(p => ({
            socketId: p.socketId,
            username: p.socketId === socket.id ? socket.username : botUsername,
            playerIndex: p.playerIndex
        }))
    });

    startCharacterSelectTimeout(match, beginLoadingForRoom);
    scheduleBotCharacterSelection(match, botId);

    return match;
};

//simulate the bot "thinking about" and locking in a character, on a
//human-plausible timescale, so the real player sees the same
//characterPreview/playerLocked events they'd see against a real opponent.
//Falls back harmlessly to matchManager's own charSelectTimeout auto-assign
//if either of these timers fire after the match has already moved on.
const scheduleBotCharacterSelection = (match, botId) => {
    const pickDelay = randomBetween(1200, 6000); // "thinking" about a pick
    setTimeout(() => {
        const currentMatch = getMatch(match.roomId);
        if(!currentMatch || currentMatch.phase !== "CHARACTER_SELECT"){
            return;
        }

        const botPlayer = currentMatch.players.find(p => p.socketId === botId);
        if(!botPlayer || botPlayer.locked){
            return;
        }

        const characterId = pickAvailableCharacter(currentMatch, botId);
        const selectResult = selectCharacter({ id: botId }, characterId);

        if(selectResult && !selectResult.error){
            ioInstance.to(currentMatch.roomId).emit("characterPreview", {
                socketId: botId,
                characterId
            });
        }

        const lockDelay = randomBetween(400, 1800); // "confirming" the pick
        setTimeout(() => {
            const m = getMatch(match.roomId);
            if(!m || m.phase !== "CHARACTER_SELECT"){
                return;
            }

            const player = m.players.find(p => p.socketId === botId);
            if(!player || player.locked){
                return;
            }

            const fightData = lockCharacter({ id: botId });

            ioInstance.to(m.roomId).emit("playerLocked", {
                socketId: botId,
                playerIndex: player.playerIndex,
                characterId: player.character
            });

            if(fightData){
                beginLoadingForRoom(fightData);
            }
        }, lockDelay);
    }, pickDelay);
};

//pick a random character not already taken by another player in the match
const pickAvailableCharacter = (match, excludeSocketId) => {
    const taken = new Set(
        match.players
            .filter(p => p.socketId !== excludeSocketId && p.character)
            .map(p => p.character)
    );

    let characterId;
    let attempts = 0;
    const maxAttempts = 20;

    do {
        characterId = getRandomCharacter();
        attempts++;
    } while (taken.has(characterId) && attempts < maxAttempts);

    return characterId;
};

const randomBetween = (min, max) => min + Math.random() * (max - min);

//generate random room id that doesnt already exist
const generateRoomCode = (length = 5)=>{
    let code = "";
    do{
        code = "";
        for (let i = 0; i < length; i++) {
            code += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)];
        }
    } while(matches.has(code) || customRooms.has(code));
    return code;
};

module.exports = { initMatchmaking, addToQueue, removeFromQueue, createCustomRoom, joinCustomRoom, beginLoadingForRoom, actuallyBeginFight };