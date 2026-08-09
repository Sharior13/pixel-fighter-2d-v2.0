// ============================================================================
// LOCAL MATCH - client-authoritative simulation for bot matches ONLY
// ============================================================================
// Real (PvP) matches are untouched: server/core/gameState.js stays the
// single authority, clients predict/reconcile against it exactly as before.
//
// Bot matches instead run the fight entirely in the browser, using
// public/core/sim/ - a generated, unmodified-logic copy of the server's own
// gameState.js/attackSystem.js/stateMachine.js/hitboxSystem.js (see
// scripts/build-client-sim.js). Reusing the actual sim code, rather than a
// hand-written second implementation, is the whole point: it means a bot
// match can never drift out of balance/behavior sync with real matches as
// combat gets tuned - one source of truth, this is just where it also runs.
//
// The trick that makes this possible with ZERO changes to the sim code
// itself: gameState.js's gameTick()/endMatch() only ever talk to the network
// through `io.to(roomId).emit(event, payload)`. makeLocalIo() below is a
// tiny shim with that exact same shape, whose "emit" routes straight into
// the same UI handlers socket.js uses for the real server's events - the
// sim genuinely doesn't know (or need to know) it isn't talking to a real
// socket.io server.
// ============================================================================

import {
    GAME_CONFIG,
    initializeGameState,
    startGameLoop,
    stopGameLoop,
    deleteGameState,
    processInput,
    getGameState,
    getClientGameState,
} from "./sim/core/gameState.js";
import { collectFrameInputs } from "./input.js";
import { feedBotGameState } from "./botController.js";

const INPUT_TICK_MS = 1000 / 60; // matches socket.js's networked input cadence

let roomId = null;
let localPlayerId = null;
let botPlayerId = null;
let inputHandle = null;
let inputSeq = 0;
let renderSyncHandle = null;
let onGameStateUpdateRef = null;

// Build the io-shaped shim gameTick()/endMatch() emit through. `handlers` is
// { onGameStateUpdate, onKnockoutAnimation, onMatchEnd } - the exact same
// functions socket.js registers for the equivalent server events, passed in
// from there so there's exactly one implementation of "what a
// gameStateUpdate/matchEnd does to the UI", regardless of which source it
// came from.
const makeLocalIo = (handlers) => ({
    to: () => ({
        emit: (event, payload) => {
            switch (event) {
                case "gameStateUpdate":
                    // NOT calling handlers.onGameStateUpdate here on purpose - it's
                    // driven by the per-animation-frame renderSyncLoop below instead,
                    // at full frame rate straight from the live sim. This throttled
                    // event (gameTick's every-3rd-tick broadcast, meant to save
                    // network bandwidth - irrelevant for a local match) is still the
                    // right cadence for bot decision-making though, so keep feeding it.
                    feedBotGameState(payload);
                    break;
                case "knockoutAnimation":
                    handlers.onKnockoutAnimation(payload);
                    break;
                case "matchEnd":
                    handlers.onMatchEnd(payload);
                    break;
                // gameState.js doesn't emit anything else during a fight -
                // if a future combat feature adds a new emit, it'll land
                // here as a silent no-op client-side until this switch is
                // extended to match, rather than crashing.
            }
        },
    }),
});

// Starts a bot match's local simulation. `players` is the same
// {socketId, playerIndex, character, username, isBot} roster shape the
// server already sends (see matchMaking.js::actuallyBeginFight's bot
// branch). Returns { map, initialGameState, botPlayerId } - initialGameState
// matches the shape battleUI.initialize()/matchBegin already expect from a
// real server-authoritative match, so socket.js's matchBegin handler can
// treat both cases uniformly from here on.
const startLocalMatch = ({ roomId: newRoomId, mapId, players, localPlayerId: newLocalPlayerId, onGameStateUpdate, onKnockoutAnimation, onMatchEnd }) => {
    // defensive: a stale local match (e.g. a rematch reusing the same
    // roomId) must be fully torn down before starting a new one, or
    // initializeGameState() below will just hand back the old state.
    stopLocalMatch();

    roomId = newRoomId;
    localPlayerId = newLocalPlayerId;
    const botPlayer = players.find(p => p.isBot);
    botPlayerId = botPlayer ? botPlayer.socketId : null;

    const gameState = initializeGameState(roomId, players, mapId);

    const localIo = makeLocalIo({ onGameStateUpdate, onKnockoutAnimation, onMatchEnd });
    startGameLoop(roomId, localIo);

    // Rendering reads the live local sim state directly, once per animation
    // frame - not through gameTick's throttled "every 3rd tick" broadcast
    // (see makeLocalIo above), which exists to save network bandwidth that a
    // local match doesn't use. This is what actually fixes the local
    // player's own movement rendering at full frame rate instead of ~20Hz,
    // and (together with isLocalRender in render.js) removes the opponent's
    // otherwise-pointless 180ms network-jitter interpolation delay.
    onGameStateUpdateRef = onGameStateUpdate;
    const renderSyncLoop = () => {
        if (!roomId) {
            return; // match ended/torn down - stop the loop
        }
        const liveState = getGameState(roomId);
        if (liveState) {
            onGameStateUpdateRef(getClientGameState(liveState));
        }
        renderSyncHandle = requestAnimationFrame(renderSyncLoop);
    };
    renderSyncHandle = requestAnimationFrame(renderSyncLoop);

    inputSeq = 0;
    inputHandle = setInterval(() => {
        const inputs = collectFrameInputs();
        if (inputs.length === 0) {
            return;
        }
        inputs.forEach(input => {
            processInput(roomId, localPlayerId, { ...input, seq: inputSeq++ });
        });
    }, INPUT_TICK_MS);

    return {
        map: gameState.map,
        botPlayerId,
        // same shape actuallyBeginFight() sends for a real match's initial
        // "matchBegin" payload - see server/matchmaking/matchMaking.js
        initialGameState: {
            players: gameState.players.map(p => ({
                socketId: p.socketId,
                playerIndex: p.playerIndex,
                character: p.character,
                position: p.position,
                health: p.health,
                maxHealth: p.maxHealth,
            })),
        },
    };
};

// Passed to botController.js's initBotForMatch() as its submitInput
// callback - feeds the bot's decisions straight into the local sim instead
// of emitting them anywhere. Reads roomId/botPlayerId from this module's own
// state (set by startLocalMatch above) rather than being handed them
// directly, since only one local match ever runs at a time - same
// singleton-module pattern botController.js itself already uses.
const submitBotInput = (taggedInputs) => {
    if (!roomId || !botPlayerId) {
        return;
    }
    taggedInputs.forEach(input => {
        processInput(roomId, botPlayerId, input);
    });
};

const stopLocalMatch = () => {
    if (inputHandle) {
        clearInterval(inputHandle);
        inputHandle = null;
    }
    if (renderSyncHandle) {
        cancelAnimationFrame(renderSyncHandle);
        renderSyncHandle = null;
    }
    onGameStateUpdateRef = null;
    if (roomId) {
        stopGameLoop(roomId);
        deleteGameState(roomId);
    }
    roomId = null;
    localPlayerId = null;
    botPlayerId = null;
};

const isLocalMatchActive = () => !!roomId;

export { GAME_CONFIG, startLocalMatch, stopLocalMatch, submitBotInput, isLocalMatchActive };
