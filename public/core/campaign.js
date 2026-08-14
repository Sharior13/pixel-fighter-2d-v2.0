// ============================================================================
// CAMPAIGN MODE — client-only controller
// ============================================================================
// Implements campaign-mode-spec.md. Fully offline: zero server round-trips,
// zero involvement from server/matchmaking/*.js or server/networking/*.js.
// Built entirely on top of the existing local-sim pipeline (startLocalMatch/
// initBotForMatch/render.js/battleUI.js) - none of that is modified here,
// see localMatch.js and botController.js for the actual fight simulation.
//
// Roster-agnostic by construction (spec Section 5): every slot count, band
// boundary, and unlock check below is derived from getAllCharacterIds() at
// call time - nothing here hardcodes a character id or a roster length.
// ============================================================================

import { getAllCharacterIds, getCharacterData } from "./sim/data/characters.js";
import { getRandomMap } from "./sim/data/maps.js";
import { startLocalMatch, stopLocalMatch, submitBotInput } from "./localMatch.js";
import { initBotForMatch, stopBot } from "./botController.js";
import {
    initializeRender,
    stopRender,
    setMap,
    updateGameState,
    triggerKOAnimation,
    setLocalRenderMode,
    canvas,
} from "./render.js";
import { setOfflineIdentity, clearOfflineIdentity } from "./socket.js";
import { battleUI } from "../ui/battleUI.js";
import { preloadMatchAssets } from "./assetPreloader.js";
import { audioManager } from "./audioManager.js";
import { debugLog, debugError } from "./debug.js";

const CAMPAIGN_ROOM_ID = "campaign";
const CAMPAIGN_PLAYER_ID = "campaign-player";
const CAMPAIGN_BOT_ID = "campaign-bot";
const STORAGE_KEY = "campaignProgress";

// ── Roster helpers (spec Section 5, point 1) ────────────────────────────
// Always the real, complete, playable roster - never getCharacterSelectRoster()
// (that one mixes in unplayable ROSTER_PLACEHOLDERS tiles, which have no
// combat data and would break the sim).
const getRosterCharacterIds = () => getAllCharacterIds();

// No per-player character-unlock system exists yet (spec Section 5, point 1 /
// Section 14) - every real character is player-selectable today. The
// character-picker step (campaignUI.js) filters through this function
// specifically so wiring in a real "is X unlocked for this player" check
// later is a one-line change here, not something to untangle from UI logic.
const isCharacterUnlockedForPlayer = (_characterId) => true;

const getSelectablePlayerCharacterIds = () =>
    getRosterCharacterIds().filter(isCharacterUnlockedForPlayer);

// Which characters the player can pick FOR A GIVEN FIGHT. Identical to
// getSelectablePlayerCharacterIds() except a slot fight also excludes that
// slot's own opponent - mirror matchups only make sense for the Rival fight,
// where playing as the opponent's character *is* the point (spec Section 6:
// the Rival always mirrors whatever the player picks).
const getSelectableCharacterIdsForFight = (kind, slotIndex) => {
    const selectable = getSelectablePlayerCharacterIds();
    if (kind === "rival") {
        return selectable;
    }
    const opponentCharacterId = getRosterCharacterIds()[slotIndex];
    const filtered = selectable.filter((id) => id !== opponentCharacterId);
    // Defensive fallback for a degenerate roster (e.g. only one playable
    // character total, and it's also this slot's opponent) - an unusable
    // empty picker would be a worse outcome than allowing the mirror here.
    return filtered.length > 0 ? filtered : selectable;
};

// ── Difficulty curve (spec Section 7) ───────────────────────────────────
// Band boundaries are fractions of normalized roster position, not hand-
// authored per-slot tuples - this is what lets the curve automatically
// re-stretch to fit however many characters exist.
const DIFFICULTY_BANDS = [
    { max: 0.3, skill: "easy", pool: ["turtle", "zoner", "allrounder"] },
    { max: 0.7, skill: "normal", pool: ["allrounder", "trickster", "rushdown"] },
    { max: 1.0, skill: "hard", pool: ["berserker", "counter", "rushdown"] },
];

const getDifficultyBand = (slotIndex, rosterLength) => {
    const normalizedPosition = rosterLength > 1 ? slotIndex / (rosterLength - 1) : 0;
    return DIFFICULTY_BANDS.find((band) => normalizedPosition <= band.max) || DIFFICULTY_BANDS[DIFFICULTY_BANDS.length - 1];
};

const pickFromPool = (pool) => pool[Math.floor(Math.random() * pool.length)];

// ── localStorage persistence (spec Section 11) ──────────────────────────
// Keyed by character ID (never array index/slot number - see Section 11),
// which is what keeps saved progress correctly attached across roster
// reorders/resizes. Stale entries (a characterId no longer in the current
// roster) are simply never surfaced by getLevelSelectData() below, which
// only ever iterates the CURRENT roster and looks entries up by id - so no
// explicit "delete unknown keys" pass is needed here (spec Section 5, point
// 5 / Section 12).
const loadProgress = () => {
    let parsed = null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
        debugError("[Campaign] Failed to read/parse saved progress, treating as empty:", error);
        parsed = null;
    }

    const cp = (parsed && typeof parsed === "object" && parsed.campaignProgress) || {};
    return {
        clearedSlots: (cp.clearedSlots && typeof cp.clearedSlots === "object") ? cp.clearedSlots : {},
        rival: (cp.rival && typeof cp.rival === "object") ? cp.rival : { cleared: false, bestStars: 0 },
    };
};

const saveProgress = (progress) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ campaignProgress: progress }));
    } catch (error) {
        debugError("[Campaign] Failed to save progress:", error);
    }
};

// Only ever called on a WIN (spec Section 10 - a loss is always 0 stars and
// is never persisted, since 0 can never be a meaningful "best" once any win
// has happened). Never overwrites a higher previous result.
const recordSlotClear = (characterId, stars) => {
    const progress = loadProgress();
    const existing = progress.clearedSlots[characterId];
    const bestStars = existing ? Math.max(existing.bestStars, stars) : stars;
    progress.clearedSlots[characterId] = { cleared: true, bestStars };
    saveProgress(progress);
};

const recordRivalClear = (stars) => {
    const progress = loadProgress();
    const bestStars = progress.rival ? Math.max(progress.rival.bestStars || 0, stars) : stars;
    progress.rival = { cleared: true, bestStars };
    saveProgress(progress);
};

// ── Level Select data (spec Sections 5 point 4, 8, 11) ──────────────────
// Recomputed fresh from current roster + saved progress every call - never
// cached - so it can never go stale if the roster or progress changes
// between calls (spec Section 11's note about the rival's unlock state in
// particular).
const getLevelSelectData = () => {
    const rosterIds = getRosterCharacterIds();
    const progress = loadProgress();

    let previousSlotCleared = true; // first slot is always unlocked
    const slots = rosterIds.map((characterId, index) => {
        const entry = progress.clearedSlots[characterId];
        const cleared = !!(entry && entry.cleared);
        const unlocked = previousSlotCleared;
        previousSlotCleared = cleared;
        return {
            index,
            characterId,
            unlocked,
            cleared,
            bestStars: (entry && entry.bestStars) || 0,
        };
    });

    const allSlotsCleared = rosterIds.length > 0 && rosterIds.every(
        (id) => progress.clearedSlots[id] && progress.clearedSlots[id].cleared
    );

    const rival = {
        unlocked: allSlotsCleared,
        cleared: !!progress.rival.cleared,
        bestStars: progress.rival.bestStars || 0,
    };

    return { slots, rival };
};

// ── Fight configuration (spec Section 6) ────────────────────────────────
// Pure - just resolves "what will this fight be", used both to preview the
// opponent on the character-picker step and to actually start the fight.
const getFightConfig = (kind, slotIndex, playerCharacterId) => {
    const rosterIds = getRosterCharacterIds();

    if (kind === "rival") {
        // Mirror match: opponent is whatever the player just picked. Always
        // hardest skill regardless of the band curve (spec Section 6).
        // Personality left "random" each attempt for replay variety - see
        // spec Section 6's note that this isn't load-bearing either way.
        return {
            kind: "rival",
            slotIndex: rosterIds.length,
            playerCharacterId,
            opponentCharacterId: playerCharacterId,
            personality: "random",
            skill: "hard",
        };
    }

    const opponentCharacterId = rosterIds[slotIndex];
    const band = getDifficultyBand(slotIndex, rosterIds.length);
    return {
        kind: "slot",
        slotIndex,
        playerCharacterId,
        opponentCharacterId,
        personality: pickFromPool(band.pool),
        skill: band.skill,
    };
};

// ── Fight orchestration (spec Sections 4, 9) ────────────────────────────
let currentFightConfig = null;

// Tears down whatever local-sim/bot/render/UI state a campaign fight left
// behind. Safe to call whether or not a fight is actually active. Must run
// before navigating away from a fight (back to Level Select/main menu) and
// before starting another one - see spec Section 4's singleton-module
// caution about localMatch.js/botController.js.
const stopFight = () => {
    stopLocalMatch();
    stopBot();
    stopRender();
    battleUI.hide();
    clearOfflineIdentity();
    currentFightConfig = null;
};

// Starts a campaign fight. `onProgress(loaded, total)` mirrors
// preloadMatchAssets' own callback (for a loading-screen UI). `onMatchEnd({
// won, stars, config })` fires once the post-fight teardown/star-rating/
// persistence is complete.
const startFight = async (config, { onProgress, onMatchEnd } = {}) => {
    stopFight(); // defensive: never start a fight on top of a stale one
    currentFightConfig = config;

    const players = [
        { socketId: CAMPAIGN_PLAYER_ID, playerIndex: 0, character: config.playerCharacterId, username: "You", isBot: false },
        { socketId: CAMPAIGN_BOT_ID, playerIndex: 1, character: config.opponentCharacterId, username: "Rival", isBot: true },
    ];
    const mapId = getRandomMap().id;

    await preloadMatchAssets(players, mapId, onProgress || (() => {}));

    // From here on this exact fight config is committed - resolve the
    // socket.id contract render.js/battleUI.js rely on (see socket.js's
    // setOfflineIdentity) before touching either of them.
    setOfflineIdentity(CAMPAIGN_PLAYER_ID);

    // Same thing socket.js's "matchLoading" handler does for a real/Quick
    // Play match: clear the title-screen background gif so the map's own
    // background (drawn by render.js's setMap()/drawBackground()) shows
    // cleanly instead of the title art bleeding through behind the fight.
    canvas.style.backgroundImage = "none";

    const local = startLocalMatch({
        roomId: CAMPAIGN_ROOM_ID,
        mapId,
        players,
        localPlayerId: CAMPAIGN_PLAYER_ID,
        onGameStateUpdate: updateGameState,
        onKnockoutAnimation: triggerKOAnimation,
        onMatchEnd: (payload) => handleMatchEnd(payload, onMatchEnd),
    });

    setMap(local.map);
    if (local.map && local.map.id) {
        audioManager.stopMusic(true);
        audioManager.playMapMusic(local.map.id);
    }

    initBotForMatch(CAMPAIGN_PLAYER_ID, CAMPAIGN_BOT_ID, config.personality, config.skill, submitBotInput);

    battleUI.initialize(local.initialGameState);
    setLocalRenderMode(true);
    initializeRender();
};

// Star rating (spec Section 10). matchEnd's finalStats doesn't carry
// maxHealth - derived here via getCharacterData() instead of touching the
// shared matchEnd payload (which multiplayer also depends on, out of scope
// per spec Section 2).
const computeStars = (localStats) => {
    if (!localStats) {
        return 0;
    }
    const characterData = getCharacterData(localStats.character);
    const maxHealth = characterData?.stats?.maxHealth || 1;
    const healthPercent = localStats.health / maxHealth;
    if (healthPercent >= 0.66) return 3;
    if (healthPercent >= 0.33) return 2;
    return 1;
};

const handleMatchEnd = ({ winner, finalStats }, onMatchEnd) => {
    debugLog("[Campaign] Match ended. Winner:", winner);

    stopLocalMatch();
    stopBot();

    const localStats = finalStats.find((p) => p.socketId === CAMPAIGN_PLAYER_ID);
    const won = winner === CAMPAIGN_PLAYER_ID;
    const stars = won ? computeStars(localStats) : 0; // loss -> always 0, never persisted

    const fightConfig = currentFightConfig;
    if (won && fightConfig) {
        if (fightConfig.kind === "slot") {
            recordSlotClear(fightConfig.opponentCharacterId, stars);
        } else {
            recordRivalClear(stars);
        }
    }

    setTimeout(() => {
        stopRender();
        battleUI.hide();
        clearOfflineIdentity();

        audioManager.stopMusic(true);
        setTimeout(() => audioManager.playTitleMusic(), 600);

        if (onMatchEnd) {
            onMatchEnd({ won, stars, config: fightConfig });
        }
    }, 50);
};

export {
    getRosterCharacterIds,
    getSelectablePlayerCharacterIds,
    getSelectableCharacterIdsForFight,
    isCharacterUnlockedForPlayer,
    getLevelSelectData,
    getFightConfig,
    startFight,
    stopFight,
};
