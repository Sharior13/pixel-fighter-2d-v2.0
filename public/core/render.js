import { socket, pendingInputs } from "./socket.js";
import { spriteManager } from "./spriteAnimator.js";
import { characterSpriteConfigs } from "../data/characterSprites.js";
import { animationStateManager } from "./animationStateManager.js";
import { battleUI } from "../ui/battleUI.js";
import { getPlayerUsername } from "../ui/titleScreen.js";
import { audioManager } from "./audioManager.js";
import { simulateTick } from "./prediction.js";
import { debugLog, debugWarn, isDebugMode } from "./debug.js";
import { GAME_WIDTH, GAME_HEIGHT, updateViewport, clearSizing, onResize, getCurrentRect } from "./viewport.js";

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// The battle HUD overlay - see public/ui/battleUI.js, which holds this same
// reference. Sized/positioned identically to the canvas below, so the two
// share exactly one logical rectangle (doc section 11: "Both Canvas and
// Battle UI must occupy the same logical rectangle. This is extremely
// important.").
const gameContainer = document.querySelector('.game-container');

let isRendering = false;
let currentGameState = null;
let animationFrameId = null;
let currentMap = null;
let bgImg = null;
let lastFrameTime = performance.now();

// Logical/internal resolution - fixed regardless of device, instead of
// tracking window.innerWidth/innerHeight directly (see docs/single-coordinate-
// system-migration.md). Everything downstream in this file that draws to the
// canvas or does camera math (clear/fill rects, the debug crosshair, camera
// follow/bounds, etc.) reads GAME_WIDTH/GAME_HEIGHT directly rather than
// canvas.width/canvas.height, so it's unaffected by however large the canvas
// is actually displayed on screen.
canvas.width = GAME_WIDTH;
canvas.height = GAME_HEIGHT;

// The background <img> (see setMap()) is a real DOM element, not something
// drawn on the canvas, so it doesn't automatically follow the canvas's CSS
// scale - its own size/position have to be multiplied by the same scale
// (and offset by the same letterbox amount) as the canvas, or it drifts out
// of sync with everything actually drawn on the canvas. See migration doc
// "Phase 4a - Convert the DOM Background-Image Element".
const sizeBackgroundImage = () => {
    if (!bgImg || !currentMap) return;
    const { scale } = getCurrentRect();
    bgImg.style.width = (currentMap.width * scale) + 'px';
    bgImg.style.height = (currentMap.height * scale) + 'px';
};

const positionBackgroundImage = () => {
    if (!bgImg || !currentMap) return;
    const { scale, offsetX, offsetY } = getCurrentRect();
    bgImg.style.left = (offsetX - camera.x * scale) + 'px';
    bgImg.style.top = (offsetY - camera.y * scale) + 'px';
};

// CSS/display sizing is a separate concern from the internal resolution
// above (doc section 8) - viewport.js computes how large the logical
// GAME_WIDTH x GAME_HEIGHT rectangle should be drawn (letterboxed/
// pillarboxed to preserve aspect ratio) and applies that as CSS geometry
// only.
//
// This ONLY applies while an actual battle is on screen. Outside of a
// battle - title screen, matchmaking/queuing, character select, loading -
// the canvas is a full-bleed decorative background (see showTitleScreen()
// in titleScreen.js setting canvas.style.backgroundImage), not the gameplay
// viewport, and must stay untouched by this (doc section 14: menus keep
// their existing responsive behavior, they are not forced into the logical
// game coordinate system). document.body's 'in-battle' class is the
// existing signal for "a battle is actually visible right now" - see
// battleUI.js's show()/hide() and touchControls.js's own use of the same
// class - so this reuses it instead of introducing a second, separate
// notion of "are we in gameplay".
let unsubscribeGameplayResize = null;

const enterGameplayViewport = () => {
    if (unsubscribeGameplayResize) return; // already active
    updateViewport([canvas, gameContainer]);
    unsubscribeGameplayResize = onResize([canvas, gameContainer], () => {
        if (bgImg && currentMap) {
            sizeBackgroundImage();
            positionBackgroundImage();
        }
    });
};

const exitGameplayViewport = () => {
    if (unsubscribeGameplayResize) {
        unsubscribeGameplayResize();
        unsubscribeGameplayResize = null;
    }
    clearSizing([canvas, gameContainer]);
};

const syncGameplayViewportToBattleState = () => {
    if (document.body.classList.contains('in-battle')) {
        enterGameplayViewport();
    } else {
        exitGameplayViewport();
    }
};

new MutationObserver(syncGameplayViewportToBattleState)
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
syncGameplayViewportToBattleState(); // reflect current state immediately


let showKOOverlay = false;
let koAnimationStartTime = 0;
const KO_DISPLAY_DURATION = 2000; //show KO for 2 seconds

//track player health for hit sound detection
let playerHealthTracker = new Map(); //Map<socketId, previousHealth>

//track combo counts to detect new hits and trigger a pop animation
let playerComboTracker = new Map(); //Map<socketId, { count, poppedAt }>
const COMBO_POP_DURATION = 220; //ms - how long the scale-up pop lasts after a new hit
const camera = {
    x: 0,
    y: 0
};

// ---- client-side prediction / reconciliation state ----
// predictedLocalPlayer is a locally-simulated mirror of the local player, advanced
// immediately on input (see predictTick) and snapped back onto server truth + replayed
// on every gameStateUpdate (see reconcileLocalPlayer). Only movement-related fields are
// predicted; health/combat/cooldowns always come straight from the server.
let predictedLocalPlayer = null;

// DEBUG ISOLATION SWITCH: set true to render the local player straight from raw server
// state (same path the opponent already uses), completely bypassing predictedLocalPlayer.
// If the flicker still happens with this on, it's proven to be unrelated to prediction/
// reconciliation - and we should look at animationStateManager/spriteAnimator's frame
// logic or characterSprites.js's animation config instead.
const DEBUG_DISABLE_PREDICTION = false;
const FIXED_DT = 1000 / 60; // matches server GAME_CONFIG.tickInterval

// true for the duration of a bot match. currentGameState is being refreshed
// directly from the live local sim every animation frame in that case (see
// localMatch.js's render-sync loop) rather than arriving as throttled,
// jittery network snapshots - so there's no reason to run it through
// machinery built specifically to hide network jitter (opponent
// interpolation's deliberate INTERP_DELAY lookback). getRenderPlayers()
// below uses this to render straight from currentGameState instead.
// reconcileLocalPlayer/pendingInputs replay is unaffected either way (it
// naturally degrades to "just mirror truth" when there are no pending
// inputs to replay, which is always true for a local match since
// predictTick/pendingInputs are only ever populated by the networked path
// in socket.js's processInputs) - the opponent's interpolation delay is the
// one piece that actively needs bypassing, not just running more often.
let isLocalRender = false;
const setLocalRenderMode = (enabled) => {
    isLocalRender = enabled;
};

// ---- opponent interpolation state ----
// we intentionally render the opponent slightly in the past (INTERP_DELAY) so we always
// have two real server snapshots to smoothly interpolate between, instead of snapping
// on every network update.
//
// Server broadcasts gameStateUpdate at ~20Hz (every 3rd tick, see gameTick() in
// gameState.js), i.e. a snapshot roughly every 50ms *when packets arrive perfectly
// evenly spaced*. A 100ms delay only buffers ~2 snapshots of margin against jitter -
// fine on a low-latency/low-jitter LAN link, but a transoceanic link (e.g. APAC client
// <-> EU server) routinely has 20-80ms+ of jitter on top of a much higher base RTT, so
// that margin gets eaten constantly, tripping the "not enough buffered history" fallback
// in getInterpolatedOpponentSnapshot() below - which snaps straight to the latest known
// position instead of smoothly interpolating. Widening the delay trades a bit more
// visual lag on the *opponent's* rendered position (never on your own input latency,
// which stays governed by prediction/reconciliation instead) for a much bigger jitter
// cushion. 180ms comfortably covers ~3-4 snapshot intervals even with real-world jitter.
const INTERP_DELAY = 180; // ms
let stateBuffer = []; // [{ state, receivedAt }]
const STATE_BUFFER_MAX = 30;

const setMap = (mapData)=>{
    currentMap = mapData;
    if(currentMap){
        if(bgImg){
            bgImg.remove();
            bgImg = null;
        }

        //create a visible <img> that sits behind the canvas
        bgImg = document.createElement('img');
        bgImg.id = 'bgImage';
        bgImg.style.position = 'absolute';
        bgImg.style.zIndex = '-2';
        bgImg.style.pointerEvents = 'none';
        bgImg.style.imageRendering = 'pixelated';
        sizeBackgroundImage();
        positionBackgroundImage();

        bgImg.onload = ()=>{
            debugLog(`[Render] Background image loaded for: ${currentMap.name}`);
        };
        bgImg.onerror = ()=>{
            debugWarn(`[Render] Background image not found for: ${currentMap.id}, using solid color`);
            bgImg = null;
        };
        //insert before the canvas so it renders behind it
        canvas.parentElement.insertBefore(bgImg, canvas);
        bgImg.src = `../assets/background/${currentMap.id}.gif`;
    }
};
// apply a freshly-generated batch of local inputs to the predicted player immediately,
// so movement feels instant instead of waiting for the server round-trip.
// called from socket.js's processInputs(), once per input tick (same 60Hz cadence as
// the server's game loop).
const predictTick = (inputs) => {
    if (!predictedLocalPlayer) {
        return;
    }

    const mapBoundaries = currentMap ? currentMap.boundaries : null;
    const groundY = currentMap ? currentMap.groundY : predictedLocalPlayer.position.y;
    const opponent = currentGameState ? currentGameState.players.find(p => p.socketId !== socket.id) : null;

    simulateTick(predictedLocalPlayer, inputs, mapBoundaries, groundY, FIXED_DT, opponent);
};

// reconcile the predicted local player against a fresh authoritative server state:
// snap the predicted object to server truth, drop confirmed inputs, then replay
// whatever inputs the server hasn't processed yet.
const reconcileLocalPlayer = (state) => {
    const serverPlayer = state.players.find(p => p.socketId === socket.id);
    if (!serverPlayer) {
        return;
    }

    if (!predictedLocalPlayer) {
        predictedLocalPlayer = structuredClone(serverPlayer);
        return;
    }

    // TEMP DEBUG: capture the predicted position BEFORE snapping, i.e. what we locally
    // believed our position was going into this reconciliation. Comparing this to
    // serverPlayer.position is the actual measure of prediction error for the ticks the
    // server just confirmed. (Previously this was captured after the snap+replay below,
    // which instead compared post-replay predicted position - which legitimately includes
    // unconfirmed pending inputs - against the raw un-replayed server snapshot, so it
    // "drifted" on essentially every update whenever any input was in flight.)
    const preSnapX = predictedLocalPlayer.position.x;
    const preSnapY = predictedLocalPlayer.position.y;
    const driftX = Math.abs(preSnapX - serverPlayer.position.x);
    const driftY = Math.abs(preSnapY - serverPlayer.position.y);
    if (driftX > 5 || driftY > 5) {
        debugWarn(`[Reconcile] drift: x=${driftX.toFixed(1)} y=${driftY.toFixed(1)}`);
    }

    //snap authoritative fields onto the predicted mirror
    predictedLocalPlayer.position = { ...serverPlayer.position };
    predictedLocalPlayer.velocity = { ...serverPlayer.velocity };
    predictedLocalPlayer.size = serverPlayer.size;
    predictedLocalPlayer.facing = serverPlayer.facing;
    predictedLocalPlayer.speed = serverPlayer.speed;
    predictedLocalPlayer.jumpForce = serverPlayer.jumpForce;
    predictedLocalPlayer.isGrounded = serverPlayer.isGrounded;
    predictedLocalPlayer.isJumping = serverPlayer.isJumping;
    predictedLocalPlayer.isDashing = serverPlayer.isDashing;
    predictedLocalPlayer.isBlocking = serverPlayer.isBlocking;
    predictedLocalPlayer.isStunned = serverPlayer.isStunned;
    predictedLocalPlayer.isAttacking = serverPlayer.isAttacking;
    predictedLocalPlayer.currentAttack = serverPlayer.currentAttack;
    predictedLocalPlayer.dashCooldownTimer = serverPlayer.dashCooldownTimer ?? predictedLocalPlayer.dashCooldownTimer;
    predictedLocalPlayer.dashTimer = serverPlayer.dashTimer ?? predictedLocalPlayer.dashTimer;

    //drop every input the server has confirmed as processed
    const lastProcessedSeq = serverPlayer.lastProcessedSeq ?? -1;
    while (pendingInputs.length && pendingInputs[0].seq <= lastProcessedSeq) {
        pendingInputs.shift();
    }

    //replay whatever's left on top of the fresh authoritative snapshot.
    //IMPORTANT: group by the tick each input was generated in and advance gravity/timers
    //only ONCE per tick, not once per input - a single tick can carry multiple inputs
    //(a "move" every tick, plus "jump"/"dash"/"attack"/"block" whenever those keys fire in
    //that same tick), and stepping gravity per-input instead of per-tick was the bug that
    //caused the local player to sink through the floor and flicker on every jump/dash/attack.
    const mapBoundaries = currentMap ? currentMap.boundaries : null;
    const groundY = currentMap ? currentMap.groundY : serverPlayer.position.y;

    const inputsByTick = new Map(); // tick id -> inputs[]
    pendingInputs.forEach(input => {
        const tickId = input.tick ?? input.seq; // fallback for any legacy/untagged input
        if (!inputsByTick.has(tickId)) {
            inputsByTick.set(tickId, []);
        }
        inputsByTick.get(tickId).push(input);
    });

    const opponent = state.players.find(p => p.socketId !== socket.id);

    [...inputsByTick.keys()].sort((a, b) => a - b).forEach(tickId => {
        simulateTick(predictedLocalPlayer, inputsByTick.get(tickId), mapBoundaries, groundY, FIXED_DT, opponent);
    });
};

// find the two buffered server snapshots that straddle "now minus INTERP_DELAY" and
// linearly interpolate the opponent's position between them. everything other than
// position (health, combo, attack state, etc.) always reflects the latest known value -
// only position benefits from smoothing.
const getInterpolatedOpponentSnapshot = () => {
    if (stateBuffer.length === 0) {
        return null;
    }

    const latest = stateBuffer[stateBuffer.length - 1].state;
    const opponent = latest.players.find(p => p.socketId !== socket.id);
    if (!opponent) {
        return null;
    }

    const renderTime = performance.now() - INTERP_DELAY;

    let older = null;
    let newer = null;
    for (let i = 0; i < stateBuffer.length - 1; i++) {
        if (stateBuffer[i].receivedAt <= renderTime && stateBuffer[i + 1].receivedAt >= renderTime) {
            older = stateBuffer[i];
            newer = stateBuffer[i + 1];
            break;
        }
    }

    //not enough buffered history yet (match just started, or a lag spike) - fall back
    //to whatever the latest known position is rather than freezing/extrapolating.
    if (!older || !newer) {
        return { socketId: opponent.socketId, position: opponent.position };
    }

    const oldOpponent = older.state.players.find(p => p.socketId === opponent.socketId);
    const newOpponent = newer.state.players.find(p => p.socketId === opponent.socketId);
    if (!oldOpponent || !newOpponent) {
        return { socketId: opponent.socketId, position: opponent.position };
    }

    const span = newer.receivedAt - older.receivedAt;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderTime - older.receivedAt) / span)) : 1;

    return {
        socketId: opponent.socketId,
        position: {
            x: oldOpponent.position.x + (newOpponent.position.x - oldOpponent.position.x) * t,
            y: oldOpponent.position.y + (newOpponent.position.y - oldOpponent.position.y) * t
        }
    };
};

// build the per-frame list of players actually used for drawing/camera: local player uses
// the predicted position, opponent uses the interpolated position, everything else
// (health, combo, attack/animation flags) always comes straight from the latest server state.
const getRenderPlayers = () => {
    if (!currentGameState || !currentGameState.players) {
        return [];
    }

    if (isLocalRender) {
        // local match: currentGameState is refreshed straight from the live
        // sim every animation frame (see localMatch.js), so it already IS
        // "now" - the 180ms interpolation delay below exists to smooth over
        // network jitter that simply doesn't exist here, and would only add
        // pointless lag to the bot's rendered position for no benefit.
        return currentGameState.players;
    }

    const interpolatedOpponent = getInterpolatedOpponentSnapshot();

    return currentGameState.players.map(player => {
        if (player.socketId === socket.id && predictedLocalPlayer && !DEBUG_DISABLE_PREDICTION) {
            return {
                ...player,
                position: predictedLocalPlayer.position,
                velocity: predictedLocalPlayer.velocity,
                facing: predictedLocalPlayer.facing,
                isGrounded: predictedLocalPlayer.isGrounded,
                isDashing: predictedLocalPlayer.isDashing,
                isBlocking: predictedLocalPlayer.isBlocking
            };
        }

        if (interpolatedOpponent && interpolatedOpponent.socketId === player.socketId) {
            return { ...player, position: interpolatedOpponent.position };
        }

        return player;
    });
};

const updateGameState = (state)=>{
    const isFirstState = !currentGameState;
    const previousState = currentGameState;
    currentGameState = state;
    
    //initialize sprite animators for new players
    if(isFirstState && state.players){
        //set audio manager reference in animationStateManager
        animationStateManager.setAudioManager(audioManager);
        
        state.players.forEach(player => {
            initializePlayerSprites(player);
            //initialize health tracker
            playerHealthTracker.set(player.socketId, player.health);
            //initialize combo tracker
            playerComboTracker.set(player.socketId, { count: player.combo || 0, poppedAt: 0 });
        });

        //seed the predicted local player mirror from the first authoritative snapshot
        const localPlayer = state.players.find(p => p.socketId === socket.id);
        if (localPlayer) {
            predictedLocalPlayer = structuredClone(localPlayer);
        }
    }

    //reconcile local player prediction against this authoritative update - not
    //meaningful for local matches (predictedLocalPlayer is never advanced by
    //predictTick there, since input goes straight into the local sim instead -
    //see isLocalRender/localMatch.js), and getRenderPlayers() already ignores
    //predictedLocalPlayer entirely in that mode, so there's nothing to reconcile
    if (!isLocalRender) {
        reconcileLocalPlayer(state);
    }

    //buffer this snapshot for opponent interpolation (not used for local matches -
    //see isLocalRender in getRenderPlayers - so skip the pointless bookkeeping when
    //this is being called every animation frame from localMatch.js's render-sync loop)
    if (!isLocalRender) {
        stateBuffer.push({ state, receivedAt: performance.now() });
        if (stateBuffer.length > STATE_BUFFER_MAX) {
            stateBuffer.shift();
        }
    }
    
    //check for health changes to play hit sounds
    if(previousState && state.players){
        state.players.forEach(player => {
            const previousHealth = playerHealthTracker.get(player.socketId);
            
            if(previousHealth !== undefined && player.health < previousHealth){
                //player took damage, play hit sound
                audioManager.playHitSound(player.character);
                debugLog(`[Render] ${player.socketId} took damage, playing hit sound`);
            }
            
            //update tracker
            playerHealthTracker.set(player.socketId, player.health);

            //track combo increases to trigger the pop animation
            const comboEntry = playerComboTracker.get(player.socketId);
            const previousCombo = comboEntry ? comboEntry.count : 0;
            if(player.combo > previousCombo){
                playerComboTracker.set(player.socketId, { count: player.combo, poppedAt: performance.now() });
            } else if(player.combo !== previousCombo){
                //combo dropped/reset - update the count but don't re-trigger the pop
                playerComboTracker.set(player.socketId, { count: player.combo, poppedAt: comboEntry ? comboEntry.poppedAt : 0 });
            }
        });
    }
    
    //update battle UI with the raw authoritative state (health/combo/timer should never
    //be predicted or interpolated - always show exactly what the server says)
    battleUI.update(state);
};

const initializePlayerSprites = (player) => {
    const characterId = player.character.toLowerCase();
    const config = characterSpriteConfigs[characterId];
    
    if(!config){
        debugWarn(`[Render] No sprite config found for character: ${characterId}`);
        return;
    }
    
    const animator = spriteManager.createAnimatorForPlayer(player.socketId, characterId, config);
    if(animator){
        //pass character ID to animationStateManager for audio playback
        animationStateManager.registerPlayer(player.socketId, animator, characterId);
        debugLog(`[Render] Initialized sprites for player: ${player.socketId} (${characterId})`);
    }
};

const triggerKOAnimation = ()=>{
    showKOOverlay = true;
    koAnimationStartTime = performance.now();
    debugLog('[Render] KO animation triggered');
};

const stopRender = ()=>{
    if(animationFrameId){
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    isRendering = false;
    currentGameState = null;
    currentMap = null;
    
    showKOOverlay = false;
    koAnimationStartTime = 0;
    
    //clear health tracker
    playerHealthTracker.clear();

    //clear combo tracker
    playerComboTracker.clear();

    //reset prediction/interpolation state for the next match
    predictedLocalPlayer = null;
    stateBuffer = [];
    isLocalRender = false;

    if(bgImg){
        bgImg.remove();
        bgImg = null;
    }
    
    //clear animation state manager
    animationStateManager.clear();
    spriteManager.clear();
    
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    debugLog("Render stopped");
};

const initializeRender = ()=>{
    if(isRendering){
        return;
    }
    isRendering = true;
    lastFrameTime = performance.now();
    debugLog("render: ",isRendering);
    
    const drawBackground = ()=>{
        if(currentMap && bgImg){
            //move the <img> element opposite to camera (scaled to match the
            //canvas's current display size) so it scrolls with the world
            positionBackgroundImage();
        } else if(currentMap){
            //fill with solid color if no image
            ctx.fillStyle = currentMap.backgroundColor || "#1a1a2e";
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }
    };
    
    const drawGround = ()=>{
        if(!currentMap){
            return;
        }
        
        //draw ground line
        ctx.strokeStyle = "#4a4a4a";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(currentMap.boundaries.left, currentMap.groundY);
        ctx.lineTo(currentMap.boundaries.right, currentMap.groundY);
        ctx.stroke();
        
        //draw ground fill
        ctx.fillStyle = "rgba(74, 74, 74, 0.3)";
        ctx.fillRect(currentMap.boundaries.left, currentMap.groundY, currentMap.width, currentMap.height - currentMap.groundY);
    };
    
    const drawMapBoundaries = ()=>{
        if(!currentMap){
            return;
        }
        
        ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        
        //left boundary
        const leftX = currentMap.boundaries.left - camera.x;
        ctx.beginPath();
        ctx.moveTo(leftX, 0);
        ctx.lineTo(leftX, GAME_HEIGHT);
        ctx.stroke();
        
        //right boundary
        const rightX = currentMap.boundaries.right - camera.x;
        ctx.beginPath();
        ctx.moveTo(rightX, 0);
        ctx.lineTo(rightX, GAME_HEIGHT);
        ctx.stroke();
        
        ctx.setLineDash([]);
    };

    //update current player's viewport
    const updateCamera = (renderPlayers)=>{
        
        const localPlayer = renderPlayers.find(p => p.socketId === socket.id);
        const opponent = renderPlayers.find(p => p.socketId !== socket.id);

        if(!localPlayer || !opponent){
            return;
        }

        //check if opponent is within viewport
        const opponentVisible = (
            opponent.position.x >= camera.x && 
            opponent.position.x <= camera.x + GAME_WIDTH && 
            opponent.position.y >= camera.y && 
            opponent.position.y <= camera.y + GAME_HEIGHT
        );

        let targetX, targetY;
        if(opponentVisible){
            //center on midpoint if both visible
            targetX = (localPlayer.position.x + opponent.position.x) / 2 - GAME_WIDTH / 2;
            targetY = (localPlayer.position.y + opponent.position.y) / 2 - GAME_HEIGHT / 2;
        } else {
            //follow local player if no opponent
            targetX = localPlayer.position.x - GAME_WIDTH / 2;
            targetY = localPlayer.position.y - GAME_HEIGHT / 2;
        }

        //smooth follow
        camera.x += (targetX - camera.x) * 0.1;
        camera.y += (targetY - camera.y) * 0.1;

        //clamp to map boundary
        camera.x = Math.max(0, Math.min(camera.x, currentMap.width - GAME_WIDTH));
        camera.y = Math.max(0, Math.min(camera.y, currentMap.height - GAME_HEIGHT));

        //reduce camera blur
        camera.x = Math.round(camera.x);
        camera.y = Math.round(camera.y);
    };
    
    const drawGridLines = ()=>{
        ctx.beginPath();
        ctx.strokeStyle = "red";
        
        ctx.moveTo(GAME_WIDTH/2, 0);
        ctx.lineTo(GAME_WIDTH/2, GAME_HEIGHT);
        ctx.stroke();
        
        ctx.moveTo(0, GAME_HEIGHT/2);
        ctx.lineTo(GAME_WIDTH, GAME_HEIGHT/2);
        ctx.stroke();
        
        ctx.closePath();
    };
    
    //debug-only visualization of the player's collision box (same box used
    //server-side for hit detection - see player.position/size in
    //server/core/gameState.js). Local player is cyan, opponent is orange, so
    //they're distinguishable at a glance and don't collide visually with the
    //existing blue/red used for the no-sprite fallback rect.
    const drawHitboxOutline = (player) => {
        ctx.save();
        ctx.strokeStyle = player.socketId === socket.id ? "#00ffff" : "#ff9900";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(
            player.position.x - player.size.width / 2,
            player.position.y - player.size.height,
            player.size.width,
            player.size.height
        );
        ctx.restore();
    };

    const drawPlayer = (player, deltaTime)=>{
        //defensive check for player data
        if (!player || !player.position || !player.size) {
            debugWarn('[Render] Invalid player data, skipping draw');
            return;
        }
        
        //update and draw sprite animation
        const animator = animationStateManager.getPlayerAnimator(player.socketId);
        
        if(animator){
            //update animation state based on player state
            animationStateManager.updatePlayerAnimation(player, deltaTime);
            
            //get character config for scale
            const characterId = player.character?.toLowerCase();
            const config = characterSpriteConfigs[characterId];
            const scale = config?.scale || 2.5;
            
            //draw the animated sprite
            animator.draw(
                ctx,
                player.position.x,
                player.position.y,
                player.facing,
                scale
            );
        }
        else{
            //fallback: draw colored rectangle if sprite not available
            ctx.fillStyle = player.socketId === socket.id ? "blue" : "red";
            ctx.fillRect(
                player.position.x - player.size.width/2, 
                player.position.y - player.size.height, 
                player.size.width, 
                player.size.height
            );
        }

        //hitbox outline - only in debug mode (see public/core/debug.js). Drawn
        //on top of either the sprite or the fallback rect above, so it works
        //the same way regardless of which one was just drawn.
        if (isDebugMode()) {
            drawHitboxOutline(player);
        }

        //display player username above character
        const displayName = player.socketId === socket.id ? getPlayerUsername() : (player.username || player.character?.charAt(0).toUpperCase() + player.character?.slice(1) || 'Player');
        
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 3;
        ctx.strokeText(
            displayName, 
            player.position.x, 
            player.position.y - player.size.height + 5
        );
        ctx.fillText(
            displayName, 
            player.position.x, 
            player.position.y - player.size.height + 5
        );

        //draw combo counter above the username, visible for both players
        drawComboCounter(player);
    };

    const drawComboCounter = (player) => {
        if(!player.combo || player.combo < 2){
            return;
        }

        const comboEntry = playerComboTracker.get(player.socketId);
        const poppedAt = comboEntry ? comboEntry.poppedAt : 0;
        const timeSincePop = performance.now() - poppedAt;

        //brief scale-up pop right after a new hit lands, settles back to normal size
        const popProgress = Math.min(timeSincePop / COMBO_POP_DURATION, 1);
        const scale = timeSincePop < COMBO_POP_DURATION ? 1.6 - (0.6 * popProgress) : 1;

        //color escalates with combo size
        let color = '#ffd700'; //gold
        if(player.combo >= 6){
            color = '#ff3333'; //red for big combos
        } else if(player.combo >= 4){
            color = '#ff8c00'; //orange
        }

        const x = player.position.x;
        const y = player.position.y - player.size.height - 18;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);

        ctx.textAlign = 'center';
        ctx.font = 'bold 20px Arial';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 4;
        ctx.strokeText(`${player.combo} HIT COMBO`, 0, 0);
        ctx.fillStyle = color;
        ctx.fillText(`${player.combo} HIT COMBO`, 0, 0);

        ctx.restore();
    };
    
    const drawCooldowns = (player) => {
        if(player.socketId !== socket.id){ 
            return;
        }
        
        const cooldowns = ['basic', 'special', 'ultimate'];
        const colors = {
            basic: '#4A90E2',
            special: '#9B59B6',
            ultimate: '#E74C3C'
        };
        
        cooldowns.forEach((ability, i)=>{
            const cd = player.cooldowns[ability];
            const x = 20;
            const y = 100 + i * 50;
            const width = 120;
            const height = 35;
            
            //background
            ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
            ctx.fillRect(x - 2, y - 2, width + 4, height + 4);
            
            //ability box
            ctx.fillStyle = cd > 0 ? "rgba(128, 128, 128, 0.5)" : colors[ability];
            ctx.fillRect(x, y, width, height);
            
            //cooldown overlay
            if(cd > 0){
                const cdPercent = cd / player.cooldowns[ability];
                ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
                ctx.fillRect(x, y, width * (cd / 10000), height);
            }
            
            //border
            ctx.strokeStyle = "white";
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, width, height);
            
            //text
            ctx.fillStyle = "white";
            ctx.font = "bold 12px Arial";
            ctx.textAlign = "left";
            const text = cd > 0 ? `${(cd / 1000).toFixed(1)}s` : "Ready";
            ctx.fillText(ability.toUpperCase(), x + 5, y + 15);
            ctx.font = "10px Arial";
            ctx.fillText(text, x + 5, y + 28);
        });
    };
    
    //ddd KO overlay drawing function
    const drawKOOverlay = (currentTime) => {
        if (!showKOOverlay) return;
        
        const elapsed = currentTime - koAnimationStartTime;
        
        //hide KO after duration
        if (elapsed > KO_DISPLAY_DURATION) {
            showKOOverlay = false;
            return;
        }
        
        //animation progress (0 to 1)
        const progress = Math.min(elapsed / KO_DISPLAY_DURATION, 1);
        
        //darken background
        ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * (1 - progress * 0.5)})`;
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        
        //calculate scale and opacity for KO text
        const scalePhase1 = Math.min(elapsed / 300, 1); //scale in over 300ms
        const fadePhase = Math.max(0, (elapsed - 1500) / 500); //fade out last 500ms
        
        const scale = 1 + scalePhase1 * 0.5;
        const opacity = 1 - fadePhase;
        
        //draw "KO" text
        ctx.save();
        ctx.translate(GAME_WIDTH / 2, GAME_HEIGHT / 2);
        ctx.scale(scale, scale);
        
        //outer glow
        ctx.shadowColor = '#FF0000';
        ctx.shadowBlur = 30;
        
        //main text
        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.strokeStyle = `rgba(255, 0, 0, ${opacity})`;
        ctx.lineWidth = 8;
        ctx.font = 'bold 120px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.strokeText('K.O.', 0, 0);
        ctx.fillText('K.O.', 0, 0);
        
        ctx.restore();
    };
    
    const animate = (currentTime) => {
        if(!isRendering){
            return;
        }
        animationFrameId = requestAnimationFrame(animate);

        //calculate delta time in milliseconds
        const deltaTime = currentTime - lastFrameTime;
        lastFrameTime = currentTime;

        ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        
        if(!currentGameState || !currentGameState.players){
            return;
        }

        //predicted local position + interpolated opponent position, used for both
        //camera framing and drawing so they never disagree with each other
        const renderPlayers = getRenderPlayers();
        
        //dont update camera if game has ended
        const gameEnded = showKOOverlay || (currentGameState.players && currentGameState.players.some(p => p.state === 'victory' || p.state === 'defeated'));
        
        if(!gameEnded){
            updateCamera(renderPlayers);
        }

        drawBackground();
        
        //apply camera transform
        ctx.save();
        ctx.translate(-camera.x, -camera.y);
        
        //render players
        renderPlayers.forEach(player=>{
            //draw player sprite with animation
            drawPlayer(player, deltaTime);
        });
        
        ctx.restore();
        
        drawKOOverlay(currentTime);
        
        // renderPlayers.forEach(player=>{
        //     //draw cooldown indicators
        //     drawCooldowns(player);
        // });
        
        //for debug
        // drawGround();
        // drawGridLines();
        // drawMapBoundaries();
    };
    animate(lastFrameTime);
};

export { initializeRender, stopRender, setMap, updateGameState, triggerKOAnimation, canvas, predictTick, setLocalRenderMode };