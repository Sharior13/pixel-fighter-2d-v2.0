import { openCharacterSelect, showOpponentPreview } from "../ui/characterSelect.js";
import { keys, actionTriggered } from "./input.js";
import { titleScreenUI } from "../ui/titleScreen.js";
import { initializeRender, stopRender, setMap, updateGameState, triggerKOAnimation, predictTick } from "./render.js";
import { matchEndScreen } from "../ui/matchEndScreen.js";
import { battleUI } from "../ui/battleUI.js";
import { audioManager } from "./audioManager.js";
import { SERVER_URL } from "./config.js";

let socket = null;
let inMatch = false;
let inputInterval = null;
let currentCharacterId = null;

// client-side prediction bookkeeping
let inputSequence = 0;
let currentTick = 0; // increments once per processInputs() call, groups same-tick inputs
const pendingInputs = []; // inputs sent to the server but not yet confirmed (see render.js reconcileLocalPlayer)

// backpressure: if we've got this many unacked ticks sitting in pendingInputs, the server
// (or the network) can't keep up - stop flooding the socket with redundant idle "move"
// batches so pings/gameStateUpdates/real actions actually have room to get through.
// Meaningful actions (jump/dash/attack/block) are always sent regardless, since those
// can't be silently superseded the way a stale "move: 0" can.
const MAX_UNACKED_TICKS = 15; // ~250ms of backlog at 60Hz

const initializeSocket = (mode, roomId) => {
    if (socket) {
        return;
    }

    // Passing "" to io() connects to the same origin the page was loaded from.
    // Passing SERVER_URL connects to a separately-deployed backend over WSS.
    socket = io(SERVER_URL, { transports: ["websocket"], upgrade: false, timeout: 60000 });

    socket.on("disconnect", (reason) => console.log("[Socket] disconnected:", reason));
    socket.on("connect_error", (err) => console.log("[Socket] connect_error:", err.message));

    const username = titleScreenUI.getUsername();
    console.log('[Socket] Sending username:', username);
    //start match process
    if(mode === "quickStart"){
        socket.emit("findMatch", mode, roomId, username);
    }
    else if(mode === "createCustomRoom"){
        socket.emit("createCustomRoom", username);
    }
    else if(mode === "joinCustomRoom"){
        socket.emit("joinCustomRoom", roomId, username);
    }

    socket.on("queueJoined", () => {
        if (inMatch) {
            return;
        }

        document.getElementById("queuing").classList.remove("hidden");
        document.getElementById("queuing").innerHTML = `<p>Queue started!</p>`;
    });

    socket.on("customRoomCreated", ({ roomId }) => {
        console.log("Custom room created:", roomId);
        document.getElementById("queuing").classList.remove("hidden");
        document.getElementById("queuing").innerHTML = `
            <div style="text-align: center;">
                <p>Custom Room Created!</p>
                <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">Room ID: ${roomId}</p>
                <p style="font-size: 14px; color: #888;">Waiting for opponent to join...</p>
            </div>
        `;
    });

    socket.on("customRoomError", ({ message }) => {
        alert(message);
        document.getElementById("queuing").classList.add("hidden");
        cleanupSocket();
        stopRender();
        titleScreenUI.showTitleScreen();
    });

    socket.on("matchFound", ({ roomId, playerIndex }) => {
        inMatch = true;
        console.log("Match found!", roomId);
        document.getElementById("queuing").classList.add("hidden");
        openCharacterSelect();
    });

    socket.on("characterPreview", ({ socketId, characterId }) => {
        if (socketId === socket.id) {
            return;
        }

        showOpponentPreview(socketId, characterId);
    });

    socket.on("playerLocked", ({ socketId }) => {
        if (socketId === socket.id) {
            return;
        }

        document.getElementById("statusText").textContent = "Opponent locked in!";
        document.getElementById('p2-label').classList.add('active');
    });

    socket.on("startMatch", (gameState) => {
        // The client has been sending seq/tick-tagged inputs since initializeSocket() was
        // called (queue + character select), but the server ignores all of those (match
        // phase isn't FIGHT yet), so their seq numbers never become lastProcessedSeq. If we
        // don't wipe that backlog here, the first reconciliation of the real match has to
        // work through a pile of stale pre-match inputs against a freshly-initialized
        // server gameState (whose lastProcessedSeq starts back at -1) - same thing happens
        // on every rematch too, since that doesn't go through cleanupSocket().
        inputSequence = 0;
        currentTick = 0;
        pendingInputs.length = 0;

        document.getElementById("character-select").style.display = "none";
        canvas.style.backgroundImage = 'none';

        setMap(gameState.map);
        
        //play map music
        if (gameState.map && gameState.map.id) {
            console.log('[Socket] Playing map music:', gameState.map.id);
            audioManager.stopMusic(true);
            audioManager.playMapMusic(gameState.map.id);
        }
        
        //find local player's character and preload sounds
        const localPlayer = gameState.players.find(p => p.socketId === socket.id);
        if (localPlayer && localPlayer.character) {
            currentCharacterId = localPlayer.character;
            audioManager.preloadCharacterSounds(localPlayer.character);
            console.log('[Socket] Preloaded sounds for:', localPlayer.character);
        }
        
        //preload opponent's sounds too
        const opponent = gameState.players.find(p => p.socketId !== socket.id);
        if (opponent && opponent.character) {
            audioManager.preloadCharacterSounds(opponent.character);
            console.log('[Socket] Preloaded opponent sounds for:', opponent.character);
        }
        
        battleUI.initialize(gameState);
        initializeRender();
    });

    //update game state
    socket.on("gameStateUpdate", (state) => {
        updateGameState(state);
    });

    socket.on('knockoutAnimation', (data) => {
        console.log('[Socket] Knockout animation triggered', data);
        triggerKOAnimation();
    });

    //handle match end
    socket.on("matchEnd", ({ winner, finalStats, reason }) => {
        console.log("Match ended! Winner:", winner);
        console.log("Final stats:", finalStats);
        
        setTimeout(() => {
           //stop game loop
           stopRender();
           
           //hide battle UI
           battleUI.hide();

            const localPlayer = finalStats.find(p => p.socketId === socket.id);
            const opponent = finalStats.find(p => p.socketId !== socket.id);
            
            console.log('[Socket] Local player stats:', localPlayer);
            console.log('[Socket] Opponent stats:', opponent);
            
            matchEndScreen.show({
                winner,
                localPlayer,
                opponent,
                finalStats,
                reason
            });
            
            //clean up character sounds
            if (localPlayer && localPlayer.character) {
                audioManager.unloadCharacterSounds(localPlayer.character);
            }
            if (opponent && opponent.character) {
                audioManager.unloadCharacterSounds(opponent.character);
            }
            
            //stop map music and return to title music after fade out
            audioManager.stopMusic(true);
            setTimeout(() => {
                audioManager.playTitleMusic();
            }, 600);
        }, 50);

        inMatch = false;
        currentCharacterId = null;
    });

    //handle rematch responses
    socket.on("rematchAccepted", ({ roomId }) => {
        console.log("Rematch accepted!");
        matchEndScreen.handleRematchAccepted();
        openCharacterSelect();
    });

    socket.on("rematchDeclined", () => {
        console.log("Rematch declined by opponent");
        matchEndScreen.handleRematchDeclined();
    });

    socket.on("playerReturnedToMenu", (socketId) => {
        console.log("Opponent returned to menu");
        if (matchEndScreen.isWaitingForRematch) {
            matchEndScreen.handleRematchDeclined();
        }
    });

    socket.on("matchError", ({ errMsg }) => {
        console.log("Match error: ", errMsg);
        document.getElementById("character-select").style.display = "none";
        cleanupSocket();
        stopRender();
        titleScreenUI.showTitleScreen();
        battleUI.hide();
    });

    //send input to backend
    inputInterval = setInterval(() => {
        if (socket) {
            processInputs();
        }
    }, 1000 / 60);
};

const processInputs = () => {
    const inputs = [];

    let direction = 0;
    if (keys.a) direction = -1;
    if (keys.d) direction = 1;

    inputs.push({ type: "move", direction });

    //jump
    if((keys.w || keys[' ']) && !actionTriggered.jump){
        inputs.push({ type: "jump" });
        actionTriggered.jump = true;
    }

    //dash
    if(keys.Shift && !actionTriggered.dash){
        inputs.push({ type: "dash" });
        actionTriggered.dash = true;
    }

    //attacks
    if(keys.ArrowLeft && !actionTriggered.attack1){
        inputs.push({ type: "attack", ability: "attack1" });
        actionTriggered.attack1 = true;
    }
    if(keys.ArrowRight && !actionTriggered.attack2){
        inputs.push({ type: "attack", ability: "attack2" });
        actionTriggered.attack2 = true;
    }
    if(keys.ArrowUp && !actionTriggered.basic){
        inputs.push({ type: "attack", ability: "basic" });
        actionTriggered.basic = true;
    }
    if(keys.ArrowDown && !actionTriggered.special){
        inputs.push({ type: "attack", ability: "special" });
        actionTriggered.special = true;
    }
    if(keys.v && !actionTriggered.ultimate){
        inputs.push({ type: "attack", ability: "ultimate" });
        actionTriggered.ultimate = true;
    }

    //block
    if(keys.s){
        if (!actionTriggered.block) {
            inputs.push({ type: "block", activate: true });
            actionTriggered.block = true;
        }
    }
    else{
        if(actionTriggered.block){
            inputs.push({ type: "block", activate: false });
            actionTriggered.block = false;
        }
    }

    //send all inputs at once
    if(inputs.length > 0){
        //tag with a monotonic seq (per input, for server lastProcessedSeq acknowledgement)
        //AND a tick id (shared by every input generated in this single call) so the client
        //can replay gravity/timers exactly once per real tick during reconciliation, even
        //when a tick produced multiple inputs (e.g. "move" + "jump" together).
        const tickId = currentTick++;
        const seqInputs = inputs.map(input => ({ ...input, seq: inputSequence++, tick: tickId }));

        //keep a copy so render.js can replay whatever the server hasn't confirmed yet
        seqInputs.forEach(input => pendingInputs.push(input));

        //apply immediately client-side for zero-latency movement feedback - this always
        //runs regardless of network conditions, so the local player stays responsive
        //even while we're throttling what we actually send below.
        predictTick(seqInputs);

        //backpressure: on a bad connection, pendingInputs can grow much faster than the
        //server can ack it. Flooding the socket with more messages in that state only
        //makes things worse - it starves ping/pong and gameStateUpdate of bandwidth,
        //which is what was causing "ping timeout" disconnects under 3G throttling.
        //Redundant IDLE "move" batches (direction === 0) are safe to skip sending, since
        //a later idle tick supersedes an earlier one. An ACTIVE move tick (direction !== 0)
        //is NOT safe to skip: each move tick is a one-time position delta applied on the
        //server (see prediction.js/gameState.js), not a persistent state the server free-runs
        //with - dropping an active move tick permanently loses that tick's displacement
        //server-side rather than just delaying it, causing real desync (not just a slower
        //ack) that only surfaces once reconciliation catches up. Only genuinely idle ticks
        //are droppable; real actions (jump/dash/attack/block) and active movement always
        //get sent immediately since they can't be silently superseded.
        const isIdleOnly = inputs.length === 1 && inputs[0].type === "move" && inputs[0].direction === 0;
        const isBackedUp = pendingInputs.length > MAX_UNACKED_TICKS;

        if(!isIdleOnly || !isBackedUp){
            socket.emit("playerInput", seqInputs);
        }
    }
};

//handle player disconnect after game ends
const cleanupSocket = () => {
    if(inputInterval){
        clearInterval(inputInterval);
        inputInterval = null;
    }

    inMatch = false;
    currentCharacterId = null;

    //reset prediction state for the next match
    inputSequence = 0;
    currentTick = 0;
    pendingInputs.length = 0;

    if(socket){
        socket.off();
        socket.disconnect();
        socket = null;
    }
    
    console.log('[Socket] Cleaned up socket connection');
};

export { initializeSocket, cleanupSocket, socket, pendingInputs };