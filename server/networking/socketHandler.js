const { initMatchmaking, addToQueue, removeFromQueue, createCustomRoom, joinCustomRoom, beginLoadingForRoom, actuallyBeginFight } = require('../matchmaking/matchMaking.js');
const { getMatchBySocket, selectCharacter, lockCharacter, deleteMatch, markPlayerReady, clearLoadingTimeout } = require('../matchmaking/matchManager.js');
const { processInput, getGameState, deleteGameState, GAME_CONFIG } = require('../core/gameState.js');
const { handleRematchRequest, handleRematchDecline, clearRematchRequests } = require('../matchmaking/rematchHandler.js');
const { debugLog, debugWarn } = require("../core/debug.js");

const socketHandler = (io)=>{

    //pass io to matchmaking.js
    initMatchmaking(io);
    io.on('connection', (socket)=>{
        debugLog("player connected");

        //latency measurement: client emits this periodically with an ack callback
        //and times how long the round trip takes (see startPingMonitor in
        //public/core/socket.js) - all this needs to do is call back immediately.
        socket.on("pingCheck", (callback) => {
            if (typeof callback === "function") {
                callback();
            }
        });
        
        //start match process when player presses quick play or custom room
        socket.on("findMatch", (mode, roomId, username)=>{
            if(mode === "quickStart"){
                // Store username on socket for later use
                socket.username = username || "Player";
                addToQueue(socket);
                socket.emit("queueJoined");
            }
        });

        //create custom room
        socket.on("createCustomRoom", (username) => {
            // Store username on socket for later use
            socket.username = username || "Player";
            const result = createCustomRoom(socket);
            if (result && result.roomId) {
                socket.emit("customRoomCreated", { roomId: result.roomId });
                debugLog(`[Socket] Custom room created: ${result.roomId}`);
            } else {
                socket.emit("customRoomError", { message: "Failed to create room" });
            }
        });

        //join custom room
        socket.on("joinCustomRoom", (roomId, username) => {
            // Store username on socket for later use
            socket.username = username || "Player";
            const result = joinCustomRoom(socket, roomId);
            if (result && result.error) {
                socket.emit("customRoomError", { message: result.error });
            } else if (result && result.success) {
                debugLog(`[Socket] Player ${socket.id} joined custom room ${roomId}`);
            }
        });
        
        //player backed out while waiting in quick-play queue or a custom room
        //they created (see the Cancel button in public/core/socket.js). Reuses
        //the exact same cleanup removeFromQueue() already does on disconnect -
        //pulls them out of the queue array and deletes any custom room they
        //created - just without actually dropping the socket connection.
        socket.on("cancelMatchmaking", ()=>{
            debugLog(`[Socket] ${socket.id} cancelled matchmaking`);
            removeFromQueue(socket);
        });

        //receive player selected character in character selecting phase
        socket.on("selectCharacter", (characterId)=>{
            const match = selectCharacter(socket, characterId);
            if (!match || match.phase !== "CHARACTER_SELECT"){ 
                return;
            }
            
            io.to(match.roomId).emit("characterPreview", {
                socketId: socket.id,
                characterId
            });            
        });

        //handle server-side lock in logic
        socket.on("lockCharacter", ()=>{
            const match = getMatchBySocket(socket);
            
            if(!match){ 
                return;
            }
            
            const player = match.players.find(p => p.socketId === socket.id);
            if(!player){
                return;
            }

            // lock the character and get fight data if all players are locked
            const fightData = lockCharacter(socket);

            io.to(match.roomId).emit("playerLocked", {
                socketId: socket.id,
                playerIndex: player.playerIndex,
                characterId: player.character
            });

            if(fightData){
                debugLog("All players locked, entering loading phase");

                //move to the loading screen - don't touch game state/the tick loop
                //yet, we wait for every client to confirm it's preloaded assets
                //first (see "clientReadyForMatch" below)
                beginLoadingForRoom(fightData);
            }
        });

        //a client has finished preloading character/map assets for the match it
        //was just told about (see "matchLoading" emit above / in matchMaking.js)
        //and is ready for the fight to actually begin.
        socket.on("clientReadyForMatch", ()=>{
            const readyMatch = markPlayerReady(socket);

            //null means we're still waiting on the other player - nothing to do yet
            if(readyMatch){
                actuallyBeginFight(readyMatch);
            }
        });

        //handle player input during fight
        socket.on("playerInput", (inputs)=>{
            const match = getMatchBySocket(socket);
            
            if(!match || match.phase !== "FIGHT"){
                return;
            }

            if(!Array.isArray(inputs)){
                debugWarn("Invalid input batch");
                return;
            }
            
            //process input through server-side game state
            inputs.forEach(input=>{
                const result = processInput(match.roomId, socket.id, input);
                if(!result){
                    
                }
            });           
        });

        //Bot matches now run their entire fight (physics, hit detection,
        //cooldowns - not just decision-making) client-side, see
        //public/core/localMatch.js - the client never emits "botInput" over
        //the socket anymore, it feeds the bot's decisions straight into its
        //own local processInput(). This handler is kept only as a harmless
        //safety net: processInput() below already no-ops on a missing
        //gameState (see getMatch(...)/getGameState(...) in gameState.js), and
        //no bot match ever has a server-side gameState anymore (see
        //matchMaking.js's actuallyBeginFight), so nothing legitimate should
        //ever reach here.
        socket.on("botInput", (inputs)=>{
            const match = getMatchBySocket(socket);

            if(!match || match.phase !== "FIGHT"){
                return;
            }

            const botPlayer = match.players.find(p => p.isBot);
            if(!botPlayer){
                // no bot in this match - a real client has no legitimate
                // reason to send this, ignore it
                return;
            }

            if(!Array.isArray(inputs)){
                debugWarn("Invalid bot input batch");
                return;
            }

            inputs.forEach(input=>{
                processInput(match.roomId, botPlayer.socketId, input);
            });
        });

        //rematch logic
        socket.on('rematchRequest', () => {
            debugLog(`[Server] Rematch requested by ${socket.id}`);
            handleRematchRequest(socket, io, getMatchBySocket);
        });

        //rematch decline logic
        socket.on('rematchDecline', () => {
            debugLog(`[Server] Rematch declined by ${socket.id}`);
            handleRematchDecline(socket, io, getMatchBySocket);
        });

        //main menu button logic
        socket.on('returnToMenu', () => {
            const match = getMatchBySocket(socket);
                
            if (match) {
                debugLog(`[Server] ${socket.id} returning to menu from room ${match.roomId}`);
                
                // Clear rematch requests for this room
                clearRematchRequests(match.roomId);
                
                // Notify other players
                io.to(match.roomId).emit("playerReturnedToMenu", socket.id);
                
                socket.leave(match.roomId);
            }
        });

        //remove players on disconnect
        socket.on("disconnect", ()=>{
            debugLog("Player disconnected");

            removeFromQueue(socket);
            
            const match = getMatchBySocket(socket);
            if(!match){ 
                return;
            }

            // Clear rematch requests for this room
            clearRematchRequests(match.roomId);

            io.to(match.roomId).emit("playerDisconnected", socket.id);

            if(match.phase === "CHARACTER_SELECT" || match.phase === "LOADING"){
                clearLoadingTimeout(match.roomId);
                deleteGameState(match.roomId);
                deleteMatch(match.roomId);
                io.to(match.roomId).emit("matchError", {
                    message: "Opponent disconnected",
                    reason: "opponent_disconnected"
                });
            } 
            else if(match.phase === "FIGHT"){
                //end the game if a player disconnects during fight
                const gameState = getGameState(match.roomId);

                // match.phase (matchManager) doesn't get updated when the fight ends
                // naturally (KO/timeout) - gameState.js deliberately keeps gameState
                // around after that with gameState.phase flipped to "ENDED", so a
                // rematch can reuse it. Without checking gameState.phase here too, a
                // player disconnecting AFTER the match already concluded (e.g. the
                // winner clicking "Main Menu" without requesting a rematch) looks
                // identical to a genuine mid-fight disconnect, and this would emit a
                // bogus forfeit "matchEnd" crowning the loser winner over the real result.
                if(gameState && gameState.phase === "FIGHT"){
                    const remainingPlayer = gameState.players.find(p => p.socketId !== socket.id);
                    if(remainingPlayer){
                        io.to(match.roomId).emit("matchEnd", {
                            winner: remainingPlayer.socketId,
                            finalStats: gameState.players,
                            reason: "opponent_disconnected"
                        });
                    }
                }
                deleteGameState(match.roomId);
                deleteMatch(match.roomId);
            }
        });
    });
};

module.exports = { socketHandler };