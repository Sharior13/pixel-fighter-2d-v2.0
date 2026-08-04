import { openCharacterSelect, showOpponentPreview } from "../ui/characterSelect.js";
import { keys, actionTriggered } from "./input.js";
import { titleScreenUI } from "../ui/titleScreen.js";
import { initializeRender, stopRender, setMap, updateGameState, triggerKOAnimation, predictTick } from "./render.js";
import { matchEndScreen } from "../ui/matchEndScreen.js";
import { battleUI } from "../ui/battleUI.js";
import { audioManager } from "./audioManager.js";
import { getServerUrl } from "./config.js";
import { startPingMonitor, stopPingMonitor } from "../ui/pingDisplay.js";
import { initBotForMatch, stopBot, feedBotGameState } from "./botController.js";
import { loadingScreenUI } from "../ui/loadingScreen.js";
import { showStatusBanner, hideStatusBanner } from "../ui/statusBanner.js";
import { preloadMatchAssets } from "./assetPreloader.js";
import { debugLog, notify } from "./debug.js";

let socket = null;
let inMatch = false;
let inputInterval = null;
let currentCharacterId = null;

// live "how long have I been waiting" timer shown on the queuing/custom-room
// screen (see startQueueTimer/stopQueueTimer below) - covers both quick-play
// queueing and waiting for someone to join a custom room, since both use the
// same #queuing element and both can take a while.
let queueTimerInterval = null;
let queueStartedAt = 0;

// stashed from "matchLoading" (which carries isBot) so "matchBegin" - whose nested
// gameState.players doesn't repeat that flag - still knows whether to spin up the
// client-side bot FSM.
let pendingOpponentIsBot = false;

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

// mm:ss - queues are almost never long enough to need an hours place
const formatElapsed = (ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const updateQueueTimerDisplay = () => {
    const el = document.getElementById('queue-timer');
    if (!el) return;
    el.textContent = formatElapsed(Date.now() - queueStartedAt);
};

// Starts (or restarts) the elapsed-time readout. Safe to call multiple times -
// always clears any previous loop first, same pattern as pingDisplay.js's
// startPingMonitor.
const startQueueTimer = () => {
    stopQueueTimer();
    queueStartedAt = Date.now();
    updateQueueTimerDisplay(); // show 00:00 immediately, don't wait a full second
    queueTimerInterval = setInterval(updateQueueTimerDisplay, 1000);
};

const stopQueueTimer = () => {
    if (queueTimerInterval) {
        clearInterval(queueTimerInterval);
        queueTimerInterval = null;
    }
};

const initializeSocket = async (mode, roomId) => {
    if (socket) {
        return;
    }

    // Resolves instantly for local dev; for a deployed frontend this is the
    // region whose /health check answered fastest (picked in the background
    // back when config.js first loaded - see getServerUrl/pickFastestRegion
    // in ./config.js), so this almost never actually waits here.
    const serverUrl = await getServerUrl();

    // cleanupSocket() (e.g. "Cancel" on the queuing screen) or a second call
    // into startGame() could have run while we were awaiting the line above -
    // re-check so we don't open a socket nobody wants anymore, or clobber one
    // that's already open.
    if (socket) {
        return;
    }

    // Passing "" to io() connects to the same origin the page was loaded from.
    // Passing serverUrl connects to a separately-deployed backend over WSS.
    socket = io(serverUrl, { transports: ["websocket"], upgrade: false, timeout: 60000 });
    startPingMonitor(socket);

    socket.on("disconnect", (reason) => debugLog("[Socket] disconnected:", reason));
    socket.on("connect_error", (err) => debugLog("[Socket] connect_error:", err.message));

    const username = titleScreenUI.getUsername();
    debugLog('[Socket] Sending username:', username);
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
        document.getElementById("queuing").innerHTML = `
            <div style="text-align: center;">
                <p>Queue started!</p>
                <p id="queue-timer" style="font-size: 20px; font-weight: bold; margin: 8px 0; color: #ccc;">00:00</p>
                <button class="btn btn-small" id="cancel-queue-btn">Cancel</button>
            </div>
        `;
        startQueueTimer();
    });

    socket.on("customRoomCreated", ({ roomId }) => {
        debugLog("Custom room created:", roomId);
        document.getElementById("queuing").classList.remove("hidden");
        document.getElementById("queuing").innerHTML = `
            <div style="text-align: center;">
                <p>Custom Room Created!</p>
                <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">Room ID: ${roomId}</p>
                <p style="font-size: 14px; color: #888;">Waiting for opponent to join...</p>
                <p id="queue-timer" style="font-size: 20px; font-weight: bold; margin: 8px 0; color: #ccc;">00:00</p>
                <button class="btn btn-small" id="cancel-queue-btn">Cancel</button>
            </div>
        `;
        startQueueTimer();
    });

    socket.on("customRoomError", ({ message }) => {
        notify(message);
        document.getElementById("queuing").classList.add("hidden");
        stopQueueTimer();
        cleanupSocket();
        stopRender();
        titleScreenUI.showTitleScreen();
    });

    socket.on("matchFound", ({ roomId, playerIndex }) => {
        inMatch = true;
        debugLog("Match found!", roomId);
        stopQueueTimer();
        document.getElementById("queuing").classList.add("hidden");

        showStatusBanner("Match Found!", { duration: 1100, variant: 'success' });
        setTimeout(() => {
            openCharacterSelect();
        }, 1100);
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

    socket.on("matchLoading", ({ roomId, players, mapId }) => {
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

        const localPlayer = players.find(p => p.socketId === socket.id);
        const opponent = players.find(p => p.socketId !== socket.id);

        if (localPlayer && localPlayer.character) {
            currentCharacterId = localPlayer.character;
        }
        pendingOpponentIsBot = !!(opponent && opponent.isBot);

        loadingScreenUI.show(players, socket.id);

        preloadMatchAssets(players, mapId, (loaded, total) => {
            loadingScreenUI.setProgress(loaded, total);
        }).then(() => {
            // The match may have already ended (opponent disconnected, etc.) by the
            // time preloading finishes - cleanupSocket() nulls `socket` in that case,
            // so guard against emitting on a dead/replaced connection.
            if (!socket) {
                return;
            }
            // Done preloading on our end - the fight itself won't start until the
            // server hears this from BOTH players (see "clientReadyForMatch" handling
            // in server/networking/socketHandler.js), so let the person know we're
            // now just waiting on the opponent rather than looking stuck at 100%.
            loadingScreenUI.setWaitingForOpponent();
            socket.emit("clientReadyForMatch");
        });
    });

    //server has confirmed every player finished preloading (or the loading-timeout
    //safety net forced it) - actual server-authoritative game state now exists and
    //the tick loop has started, so it's safe to start rendering.
    socket.on("matchBegin", ({ roomId, map, gameState }) => {
        loadingScreenUI.hide();

        setMap(map);

        //play map music
        if (map && map.id) {
            debugLog('[Socket] Playing map music:', map.id);
            audioManager.stopMusic(true);
            audioManager.playMapMusic(map.id);
        }

        //if matchmaking paired us with an AI opponent (see server/matchmaking/
        //matchMaking.js::createBotMatch), start the client-side bot FSM - this
        //is an internal flag only, never shown in the UI, so the opponent
        //looks like any other player.
        const opponent = gameState.players.find(p => p.socketId !== socket.id);
        if (pendingOpponentIsBot && opponent) {
            initBotForMatch(socket, opponent.socketId);
        } else {
            stopBot();
        }

        battleUI.initialize(gameState);
        initializeRender();
    });

    //update game state
    socket.on("gameStateUpdate", (state) => {
        updateGameState(state);
        feedBotGameState(state);
    });

    socket.on('knockoutAnimation', (data) => {
        debugLog('[Socket] Knockout animation triggered', data);
        triggerKOAnimation();
    });

    //handle match end
    socket.on("matchEnd", ({ winner, finalStats, reason }) => {
        debugLog("Match ended! Winner:", winner);
        debugLog("Final stats:", finalStats);
        
        setTimeout(() => {
           //stop game loop
           stopRender();
           stopBot();
           
           //hide battle UI
           battleUI.hide();

            const localPlayer = finalStats.find(p => p.socketId === socket.id);
            const opponent = finalStats.find(p => p.socketId !== socket.id);
            
            debugLog('[Socket] Local player stats:', localPlayer);
            debugLog('[Socket] Opponent stats:', opponent);
            
            matchEndScreen.show({
                winner,
                localPlayer,
                opponent,
                finalStats,
                reason,
                isBot: pendingOpponentIsBot
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
        debugLog("Rematch accepted!");
        matchEndScreen.handleRematchAccepted();
        openCharacterSelect();
    });

    socket.on("rematchDeclined", () => {
        debugLog("Rematch declined by opponent");
        matchEndScreen.handleRematchDeclined();
    });

    socket.on("playerReturnedToMenu", (socketId) => {
        debugLog("Opponent returned to menu");
        if (matchEndScreen.isWaitingForRematch) {
            matchEndScreen.handleRematchDeclined();
        }
    });

    socket.on("matchError", ({ message, reason }) => {
        debugLog("Match error: ", message, reason);
        document.getElementById("character-select").style.display = "none";
        loadingScreenUI.hide();
        battleUI.hide();

        const displayMessage = message || "Match error - returning to menu";
        const isDisconnect = reason === "opponent_disconnected";

        showStatusBanner(displayMessage, { duration: 2200, variant: isDisconnect ? 'error' : 'info' });

        setTimeout(() => {
            cleanupSocket();
            stopRender();
            titleScreenUI.showTitleScreen();
        }, 2200);
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

// Attached once at module load (not per-match) since #queuing is a static element
// that persists for the whole page lifetime - re-binding this inside
// initializeSocket() would stack up a duplicate listener on every quick-play/custom-room
// attempt. Delegation also means it "just works" for the Cancel button regardless of
// which of the two innerHTML templates above is currently showing.
const queuingDiv = document.getElementById("queuing");
if (queuingDiv) {
    queuingDiv.addEventListener("click", (event) => {
        if (event.target.id === "cancel-queue-btn") {
            cancelMatchmaking();
        }
    });
}

const cancelMatchmaking = () => {
    if (socket) {
        socket.emit("cancelMatchmaking");
    }
    document.getElementById("queuing").classList.add("hidden");
    stopQueueTimer();
    cleanupSocket();
    titleScreenUI.showTitleScreen();
};

//handle player disconnect after game ends
const cleanupSocket = () => {
    if(inputInterval){
        clearInterval(inputInterval);
        inputInterval = null;
    }

    stopBot();
    hideStatusBanner();
    loadingScreenUI.hide();
    stopPingMonitor();
    stopQueueTimer();

    inMatch = false;
    currentCharacterId = null;
    pendingOpponentIsBot = false;

    //reset prediction state for the next match
    inputSequence = 0;
    currentTick = 0;
    pendingInputs.length = 0;

    if(socket){
        socket.off();
        socket.disconnect();
        socket = null;
    }
    
    debugLog('[Socket] Cleaned up socket connection');
};

export { initializeSocket, cleanupSocket, socket, pendingInputs };