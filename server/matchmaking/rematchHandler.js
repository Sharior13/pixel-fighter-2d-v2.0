const { deleteGameState } = require('../core/gameState.js');
const { createMatch, startCharacterSelectTimeout, deleteMatch } = require('./matchManager.js');
const { beginLoadingForRoom } = require('./matchMaking.js');
const { debugLog } = require("../core/debug.js");

const rematchRequests = new Map(); // roomId -> Set of socket IDs who want rematch

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

    // If all players want rematch
    if (requests.size === match.players.length) {
        debugLog(`[Rematch] All players agreed! Starting rematch for room ${roomId}`);
        
        // Clear rematch requests
        rematchRequests.delete(roomId);

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
    }
};

const handleRematchDecline = (socket, io, getMatchBySocket) => {
    const match = getMatchBySocket(socket);
    
    if (!match) {
        return;
    }

    const roomId = match.roomId;
    
    // Clear rematch requests for this room
    rematchRequests.delete(roomId);

    // Notify all players that rematch was declined
    io.to(roomId).emit("rematchDeclined");

    debugLog(`[Rematch] ${socket.id} declined rematch in ${roomId}`);
};

const clearRematchRequests = (roomId) => {
    rematchRequests.delete(roomId);
};

module.exports = { handleRematchRequest, handleRematchDecline, clearRematchRequests
};