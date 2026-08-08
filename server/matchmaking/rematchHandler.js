const { deleteGameState } = require('../core/gameState.js');
const { createMatch, getMatch, startCharacterSelectTimeout, deleteMatch } = require('./matchManager.js');
const { beginLoadingForRoom, randomBetween } = require('./matchMaking.js');
const { debugLog } = require("../core/debug.js");

const rematchRequests = new Map(); // roomId -> Set of socket IDs who want rematch

// roomId -> timeoutId, for the bot's own rematch decision. Also doubles as
// the guard against scheduling a second decision if the human's client fires
// "rematchRequest" more than once for the same room (the button disables
// itself after the first click, but nothing stops a stale/replayed event).
const botRematchTimers = new Map();

// "Thinking it over" before accepting/declining a rematch - same flavor of
// delay as the bot's character-select "picking"/"confirming" delays in
// matchMaking.js (BOT_FALLBACK_DELAY_RANGE_MS's siblings), just for this
// decision instead.
const BOT_REMATCH_DECISION_DELAY_RANGE_MS = [1000, 3000];
const BOT_REMATCH_ACCEPT_CHANCE = 0.5;

// Shared by both the "all humans requested" path and the bot's own accept
// decision below - starting a rematch always means the same thing
// regardless of who/what agreed to it.
const proceedWithRematch = (match, io) => {
    const roomId = match.roomId;
    debugLog(`[Rematch] Starting rematch for room ${roomId}`);

    rematchRequests.delete(roomId);
    botRematchTimers.delete(roomId);

    // CRITICAL: Delete old game state and match before creating new one
    deleteGameState(roomId);
    deleteMatch(roomId);

    // Create new match with same players
    const players = match.players.map(p => p.socket);
    const newMatch = createMatch(roomId, players);

    // Notify all players that rematch is accepted
    io.to(roomId).emit("rematchAccepted", {
        roomId: newMatch.roomId
    });

    // Start character selection timeout - once everyone's locked in, this goes
    // through the same loading-screen/ready-handshake gate as a fresh match
    // (see beginLoadingForRoom/actuallyBeginFight in matchMaking.js) rather than
    // starting the game loop immediately.
    startCharacterSelectTimeout(newMatch, beginLoadingForRoom);
};

// The bot has no real socket/client, so it can never call handleRematchRequest
// itself the way a human's "rematch" button click does - it has to be decided
// on its behalf. After a random "thinking it over" delay, it accepts half the
// time and leaves (declines) the other half, same as a real opponent might.
const scheduleBotRematchDecision = (match, io) => {
    const roomId = match.roomId;

    if (botRematchTimers.has(roomId)) {
        return; // already deciding for this room
    }

    const delay = randomBetween(...BOT_REMATCH_DECISION_DELAY_RANGE_MS);

    const timeoutId = setTimeout(() => {
        botRematchTimers.delete(roomId);

        // the room may have gone away entirely while the bot was "thinking"
        // (human declined themselves, disconnected, hit main menu, etc.)
        const currentMatch = getMatch(roomId);
        if (!currentMatch || currentMatch !== match) {
            return;
        }

        const botAccepts = Math.random() < BOT_REMATCH_ACCEPT_CHANCE;

        if (botAccepts) {
            debugLog(`[Rematch] Bot accepted rematch in ${roomId}`);
            proceedWithRematch(match, io);
        } else {
            debugLog(`[Rematch] Bot left instead of accepting rematch in ${roomId}`);
            rematchRequests.delete(roomId);
            io.to(roomId).emit("rematchDeclined");
        }
    }, delay);

    botRematchTimers.set(roomId, timeoutId);
};

const handleRematchRequest = (socket, io, getMatchBySocket) => {
    const match = getMatchBySocket(socket);
    
    if (!match) {
        debugLog(`[Rematch] No match found for ${socket.id}`);
        return;
    }

    const roomId = match.roomId;
    
    // Initialize rematch requests for this room if not exists
    if (!rematchRequests.has(roomId)) {
        rematchRequests.set(roomId, new Set());
    }

    const requests = rematchRequests.get(roomId);
    requests.add(socket.id);

    debugLog(`[Rematch] ${socket.id} wants rematch in ${roomId}. Total requests: ${requests.size}/${match.players.length}`);

    const isBotMatch = match.players.some(p => p.isBot);

    if (isBotMatch) {
        // The bot never sends its own "rematchRequest" - waiting on
        // requests.size to reach match.players.length would hang forever.
        // Only human agreement is needed to *ask*; the bot's own
        // accept/decline is decided separately, on a delay, below.
        scheduleBotRematchDecision(match, io);
        return;
    }

    // If all (human) players want rematch
    if (requests.size === match.players.length) {
        proceedWithRematch(match, io);
    }
};

const handleRematchDecline = (socket, io, getMatchBySocket) => {
    const match = getMatchBySocket(socket);
    
    if (!match) {
        return;
    }

    const roomId = match.roomId;
    
    clearRematchRequests(roomId);

    // Notify all players that rematch was declined
    io.to(roomId).emit("rematchDeclined");

    debugLog(`[Rematch] ${socket.id} declined rematch in ${roomId}`);
};

const clearRematchRequests = (roomId) => {
    rematchRequests.delete(roomId);

    const botTimer = botRematchTimers.get(roomId);
    if (botTimer) {
        clearTimeout(botTimer);
        botRematchTimers.delete(roomId);
    }
};

module.exports = { handleRematchRequest, handleRematchDecline, clearRematchRequests
};
