const { initMatchmaking, addToQueue, removeFromQueue, createCustomRoom, joinCustomRoom } = require('../matchmaking/matchMaking.js');
const { getMatchBySocket, selectCharacter, lockCharacter, deleteMatch } = require('../matchmaking/matchManager.js');
const { initializeGameState, processInput, startGameLoop, getGameState, deleteGameState, GAME_CONFIG } = require('../core/gameState.js');
const { handleRematchRequest, handleRematchDecline, clearRematchRequests } = require('../matchmaking/rematchHandler.js');

const socketHandler = (io)=>{

    //pass io to matchmaking.js
    initMatchmaking(io);
    io.on('connection', (socket)=>{
        console.log("player connected");
        
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
                console.log(`[Socket] Custom room created: ${result.roomId}`);
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
                console.log(`[Socket] Player ${socket.id} joined custom room ${roomId}`);
            }
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
                console.log("All players locked, starting match");
                
                //initialize server-authoritative game state
                try{
                    // Add usernames to player data
                    const playersWithUsernames = fightData.players.map(p => {
                        const playerSocket = io.sockets.sockets.get(p.socketId);
                        const username = playerSocket?.username || "Player";
                        console.log(`[SocketHandler] Player ${p.socketId} username: "${username}"`);
                        return {
                            ...p,
                            username: username
                        };
                    });
                    
                    const gameState = initializeGameState(fightData.roomId, playersWithUsernames, fightData.mapId);
                    
                    //emit startMatch with initial game state
                    io.to(fightData.roomId).emit("startMatch", {
                        roomId: fightData.roomId,
                        players: playersWithUsernames,
                        map: gameState.map,
                        gameState: {
                            players: gameState.players.map(p => ({
                                socketId: p.socketId,
                                playerIndex: p.playerIndex,
                                character: p.character,
                                username: p.username,
                                position: p.position,
                                health: p.health,
                                maxHealth: p.maxHealth
                            }))
                        }
                    });
                    
                    //start the server-side game loop
                    startGameLoop(fightData.roomId, io);
                } catch(error){
                    io.to(fightData.roomId).emit("matchError", {
                        message: "Failed to start match"
                    });
                }
            }
        });

        //handle player input during fight
        socket.on("playerInput", (inputs)=>{
            const match = getMatchBySocket(socket);
            
            if(!match || match.phase !== "FIGHT"){
                return;
            }

            if(!Array.isArray(inputs)){
                console.warn("Invalid input batch");
                return;
            }
            
            //process input through server-side game state
            inputs.forEach(input=>{
                const result = processInput(match.roomId, socket.id, input);
                if(!result){
                    
                }
            });           
        });

        //handle inputs for the AI bot opponent, when one is in this match.
        //The decision-making ("what should the bot do right now") happens
        //entirely client-side in the human's browser (see
        //public/core/botController.js) - this just forwards those decisions
        //through the exact same processInput()/gameTick() pipeline a real
        //player's inputs go through, so the bot is bound by the same
        //cooldowns, hitstun, and physics as anyone else.
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
                console.warn("Invalid bot input batch");
                return;
            }

            inputs.forEach(input=>{
                processInput(match.roomId, botPlayer.socketId, input);
            });
        });

        //rematch logic
        socket.on('rematchRequest', () => {
            console.log(`[Server] Rematch requested by ${socket.id}`);
            handleRematchRequest(socket, io, getMatchBySocket);
        });

        //rematch decline logic
        socket.on('rematchDecline', () => {
            console.log(`[Server] Rematch declined by ${socket.id}`);
            handleRematchDecline(socket, io, getMatchBySocket);
        });

        //main menu button logic
        socket.on('returnToMenu', () => {
            const match = getMatchBySocket(socket);
                
            if (match) {
                console.log(`[Server] ${socket.id} returning to menu from room ${match.roomId}`);
                
                // Clear rematch requests for this room
                clearRematchRequests(match.roomId);
                
                // Notify other players
                io.to(match.roomId).emit("playerReturnedToMenu", socket.id);
                
                socket.leave(match.roomId);
            }
        });

        //remove players on disconnect
        socket.on("disconnect", ()=>{
            console.log("Player disconnected");

            removeFromQueue(socket);
            
            const match = getMatchBySocket(socket);
            if(!match){ 
                return;
            }

            // Clear rematch requests for this room
            clearRematchRequests(match.roomId);

            io.to(match.roomId).emit("playerDisconnected", socket.id);

            if(match.phase === "CHARACTER_SELECT"){
                deleteGameState(match.roomId);
                deleteMatch(match.roomId);
                io.to(match.roomId).emit("matchError", {
                    reason: "opponent_disconnected"
                });
            } 
            else if(match.phase === "FIGHT"){
                //end the game if a player disconnects during fight
                const gameState = getGameState(match.roomId);

                if(gameState){
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