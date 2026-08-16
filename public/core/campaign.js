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
//
// Difficulty-agnostic in the same way (spec Sections 8/9): every fight's
// skill/personality resolves through a shared band+offset mechanism rather
// than per-(difficulty, lap) hand-authored data.
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
import { debugLog, debugError, isDebugMode } from "./debug.js";

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
// Section 16) - every real character is player-selectable today. The
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

// ── Difficulty curve (spec Section 7 — base curve, Normal/lap 1) ────────
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

// ── Campaign Difficulty tiers & New Game+ (spec Sections 8/9) ───────────
// Player-facing tier, distinct from the per-band skill VALUES above even
// though the labels read the same - kept as its own constant on purpose
// (see spec Section 8) so the two concepts never get silently conflated.
const CAMPAIGN_DIFFICULTIES = ["easy", "normal", "hard"];

// Mirrors botController.js's SKILL_LEVELS keys/order (that object isn't
// exported, so this is duplicated here deliberately - same precedent as
// DIFFICULTY_BANDS's pool strings above, see spec Section 15's note to
// check botController.js directly rather than trust this file to stay in
// sync with it).
const SKILL_TIER_ORDER = ["easy", "normal", "hard"];

const DIFFICULTY_OFFSETS = { easy: -1, normal: 0, hard: 1 };

const normalizeDifficulty = (difficulty) =>
    CAMPAIGN_DIFFICULTIES.includes(difficulty) ? difficulty : "normal";

const normalizeLap = (lap) => (Number.isInteger(lap) && lap >= 1 ? lap : 1);

// Shifts a base band's skill tier by (Campaign Difficulty offset + lap
// escalation), clamped to SKILL_TIER_ORDER's bounds. Any offset that would
// have pushed *past* the "hard" ceiling instead narrows the band's own
// personality pool (spec Section 9) rather than inventing a skill tier that
// doesn't exist.
const resolveSkillAndPool = (band, difficulty, lap) => {
    const baseIndex = SKILL_TIER_ORDER.indexOf(band.skill);
    const totalOffset = DIFFICULTY_OFFSETS[normalizeDifficulty(difficulty)] + (normalizeLap(lap) - 1);
    const ceilingIndex = SKILL_TIER_ORDER.length - 1;

    let index = baseIndex + totalOffset;
    let overflow = 0;
    if (index > ceilingIndex) {
        overflow = index - ceilingIndex;
        index = ceilingIndex;
    } else if (index < 0) {
        index = 0;
    }

    const pool = overflow > 0
        ? band.pool.slice(0, Math.max(1, band.pool.length - overflow))
        : band.pool;

    return { skill: SKILL_TIER_ORDER[index], pool };
};

// Full personality list, used for the Rival fight on Easy/Normal (spec
// Section 8). Must match botController.js's PERSONALITIES keys - see the
// SKILL_TIER_ORDER comment above for why this is duplicated rather than
// imported.
const RIVAL_FULL_PERSONALITY_POOL = ["turtle", "zoner", "allrounder", "trickster", "rushdown", "berserker", "counter"];
// Hard Campaign Difficulty narrows the Rival to this aggressive subset from
// lap 1 onward (spec Section 8); further laps narrow it again (Section 9).
const RIVAL_HARD_PERSONALITY_POOL = ["berserker", "counter"];

const getRivalBotConfig = (difficulty, lap) => {
    if (normalizeDifficulty(difficulty) !== "hard") {
        return { skill: "hard", personality: pickFromPool(RIVAL_FULL_PERSONALITY_POOL) };
    }
    const narrowCount = normalizeLap(lap) - 1;
    const pool = RIVAL_HARD_PERSONALITY_POOL.slice(0, Math.max(1, RIVAL_HARD_PERSONALITY_POOL.length - narrowCount));
    return { skill: "hard", personality: pickFromPool(pool) };
};

// ── localStorage persistence (spec Section 13) ──────────────────────────
// Keyed by character ID within each (difficulty, lap) bucket (never array
// index/slot number - spec Section 5 point 3), which is what keeps saved
// progress correctly attached across roster reorders/resizes. Stale
// characterId entries are simply never surfaced by getLevelSelectData()
// below, which only ever iterates the CURRENT roster and looks entries up
// by id - no explicit "delete unknown keys" pass is needed (spec Section 5
// point 5 / Section 14).
const emptyLapBucket = () => ({ clearedSlots: {}, rival: { cleared: false, bestStars: 0 } });

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
    const rawRuns = (cp.runs && typeof cp.runs === "object") ? cp.runs : {};

    // Only ever surface the currently-defined difficulty tiers, each as an
    // object of lap-number-string -> bucket (spec Section 14's guidance on
    // an unrecognized difficulty value - just drop it, don't error).
    const runs = {};
    CAMPAIGN_DIFFICULTIES.forEach((difficulty) => {
        const rawLaps = (rawRuns[difficulty] && typeof rawRuns[difficulty] === "object") ? rawRuns[difficulty] : {};
        const laps = {};
        Object.keys(rawLaps).forEach((lapKey) => {
            const lapEntry = rawLaps[lapKey];
            if (!lapEntry || typeof lapEntry !== "object") return;
            laps[lapKey] = {
                clearedSlots: (lapEntry.clearedSlots && typeof lapEntry.clearedSlots === "object") ? lapEntry.clearedSlots : {},
                rival: (lapEntry.rival && typeof lapEntry.rival === "object") ? lapEntry.rival : { cleared: false, bestStars: 0 },
            };
        });
        runs[difficulty] = laps;
    });

    return {
        lastSelectedDifficulty: normalizeDifficulty(cp.lastSelectedDifficulty),
        runs,
    };
};

const saveProgress = (progress) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ campaignProgress: progress }));
    } catch (error) {
        debugError("[Campaign] Failed to save progress:", error);
    }
};

const getLapBucket = (progress, difficulty, lap) =>
    progress.runs[normalizeDifficulty(difficulty)][String(normalizeLap(lap))] || emptyLapBucket();

const setLastSelectedDifficulty = (difficulty) => {
    const progress = loadProgress();
    progress.lastSelectedDifficulty = normalizeDifficulty(difficulty);
    saveProgress(progress);
};

const getLastSelectedDifficulty = () => loadProgress().lastSelectedDifficulty;

// Which lap is unlocked for a difficulty is derived, never cached (spec
// Section 13): lap 1 is always available; lap K+1 unlocks once lap K's
// Rival is cleared.
const getHighestUnlockedLap = (difficulty) => {
    const progress = loadProgress();
    let lap = 1;
    while (progress.runs[normalizeDifficulty(difficulty)][String(lap)]?.rival?.cleared) {
        lap += 1;
    }
    return lap;
};

// Only ever called on a WIN (spec Section 12 - a loss is always 0 stars and
// is never persisted, since 0 can never be a meaningful "best" once any win
// has happened). Never overwrites a higher previous result within the same
// (difficulty, lap) bucket.
const recordSlotClear = (difficulty, lap, characterId, stars) => {
    const progress = loadProgress();
    const lapKey = String(normalizeLap(lap));
    const normalizedDifficulty = normalizeDifficulty(difficulty);
    const bucket = progress.runs[normalizedDifficulty][lapKey] || emptyLapBucket();
    const existing = bucket.clearedSlots[characterId];
    const bestStars = existing ? Math.max(existing.bestStars, stars) : stars;
    bucket.clearedSlots[characterId] = { cleared: true, bestStars };
    progress.runs[normalizedDifficulty][lapKey] = bucket;
    saveProgress(progress);
};

const recordRivalClear = (difficulty, lap, stars) => {
    const progress = loadProgress();
    const lapKey = String(normalizeLap(lap));
    const normalizedDifficulty = normalizeDifficulty(difficulty);
    const bucket = progress.runs[normalizedDifficulty][lapKey] || emptyLapBucket();
    const bestStars = bucket.rival ? Math.max(bucket.rival.bestStars || 0, stars) : stars;
    bucket.rival = { cleared: true, bestStars };
    progress.runs[normalizedDifficulty][lapKey] = bucket;
    saveProgress(progress);
};

// ── Level Select data (spec Sections 5 point 4, 10, 13) ─────────────────
// Recomputed fresh from current roster + saved progress every call - never
// cached - so it can never go stale if the roster or progress changes
// between calls.
const getLevelSelectData = (difficulty, lap) => {
    const rosterIds = getRosterCharacterIds();
    const progress = loadProgress();
    const bucket = getLapBucket(progress, difficulty, lap);

    let previousSlotCleared = true; // first slot is always unlocked
    const slots = rosterIds.map((characterId, index) => {
        const entry = bucket.clearedSlots[characterId];
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
        (id) => bucket.clearedSlots[id] && bucket.clearedSlots[id].cleared
    );

    const rival = {
        unlocked: allSlotsCleared,
        cleared: !!bucket.rival.cleared,
        bestStars: bucket.rival.bestStars || 0,
    };

    return { slots, rival };
};

// Per-tier summary for the Difficulty Select screen (spec Section 8's "e.g.
// Normal — 6/10 cleared, Rival: not cleared"). Reports each tier's current
// frontier (its highest-unlocked lap), since that's the most meaningful
// single snapshot of "how far has the player gotten on this difficulty."
const getDifficultyOverview = () =>
    CAMPAIGN_DIFFICULTIES.map((difficulty) => {
        const lap = getHighestUnlockedLap(difficulty);
        const { slots, rival } = getLevelSelectData(difficulty, lap);
        return {
            difficulty,
            lap,
            clearedCount: slots.filter((s) => s.cleared).length,
            totalSlots: slots.length,
            rivalCleared: rival.cleared,
            rivalBestStars: rival.bestStars,
        };
    });

// ── Fight configuration (spec Sections 6, 8, 9) ─────────────────────────
// Pure - just resolves "what will this fight be", used both to preview the
// opponent on the character-picker step and to actually start the fight.
const getFightConfig = (kind, slotIndex, playerCharacterId, difficulty, lap) => {
    const rosterIds = getRosterCharacterIds();
    const normalizedDifficulty = normalizeDifficulty(difficulty);
    const normalizedLap = normalizeLap(lap);

    if (kind === "rival") {
        // Mirror match: opponent is whatever the player just picked. Always
        // hardest skill regardless of the band curve (spec Section 6).
        const { skill, personality } = getRivalBotConfig(normalizedDifficulty, normalizedLap);
        return {
            kind: "rival",
            slotIndex: rosterIds.length,
            difficulty: normalizedDifficulty,
            lap: normalizedLap,
            playerCharacterId,
            opponentCharacterId: playerCharacterId,
            personality,
            skill,
        };
    }

    const opponentCharacterId = rosterIds[slotIndex];
    const band = getDifficultyBand(slotIndex, rosterIds.length);
    const { skill, pool } = resolveSkillAndPool(band, normalizedDifficulty, normalizedLap);
    return {
        kind: "slot",
        slotIndex,
        difficulty: normalizedDifficulty,
        lap: normalizedLap,
        playerCharacterId,
        opponentCharacterId,
        personality: pickFromPool(pool),
        skill,
    };
};

// ── Fight orchestration (spec Sections 4, 11) ───────────────────────────
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
        {
            socketId: CAMPAIGN_BOT_ID,
            playerIndex: 1,
            character: config.opponentCharacterId,
            // render.js draws this above the opponent's head during the fight
            // (see its displayName logic) - show the character's actual name
            // rather than a generic "Rival" label, even for the Rival fight
            // itself (where the opponent character IS whatever the player
            // picked, so this still reads correctly).
            username: getCharacterData(config.opponentCharacterId)?.name || config.opponentCharacterId,
            isBot: true,
        },
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

// Star rating (spec Section 12). matchEnd's finalStats doesn't carry
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
    const opponentStats = finalStats.find((p) => p.socketId === CAMPAIGN_BOT_ID);
    const won = winner === CAMPAIGN_PLAYER_ID;
    const stars = won ? computeStars(localStats) : 0; // loss -> always 0, never persisted

    const fightConfig = currentFightConfig;
    if (won && fightConfig) {
        if (fightConfig.kind === "slot") {
            recordSlotClear(fightConfig.difficulty, fightConfig.lap, fightConfig.opponentCharacterId, stars);
        } else {
            recordRivalClear(fightConfig.difficulty, fightConfig.lap, stars);
        }
    }

    setTimeout(() => {
        stopRender();
        battleUI.hide();
        clearOfflineIdentity();

        audioManager.stopMusic(true);
        setTimeout(() => audioManager.playTitleMusic(), 600);

        if (onMatchEnd) {
            // playerStats/opponentStats: same finalStats shape multiplayer's
            // matchEnd payload uses (server/core/gameState.js - socketId,
            // character, health, damage, damageReceived, combo, killCount),
            // passed through as-is so campaignUI.js can render the exact same
            // combat-report fields matchEndScreen.js does after Quick Play.
            onMatchEnd({ won, stars, config: fightConfig, playerStats: localStats, opponentStats });
        }
    }, 50);
};

export {
    CAMPAIGN_DIFFICULTIES,
    getRosterCharacterIds,
    getSelectablePlayerCharacterIds,
    getSelectableCharacterIdsForFight,
    isCharacterUnlockedForPlayer,
    getLevelSelectData,
    getDifficultyOverview,
    getHighestUnlockedLap,
    getLastSelectedDifficulty,
    setLastSelectedDifficulty,
    getFightConfig,
    startFight,
    stopFight,
};

// ── Testing-only console helpers ────────────────────────────────────────
// Not part of the spec - purely for manually testing progression (e.g.
// reaching the Rival on Hard, or a specific New Game+ lap) without playing
// every fight to get there. Gated behind this codebase's existing debug-mode
// convention (public/core/debug.js: add ?debug=1 to the URL, or run
// toggleDebugMode() in devtools) rather than always being live, and only
// ever writes through the same recordSlotClear()/recordRivalClear() paths a
// real win would use, so it can't produce a save shape a real playthrough
// couldn't also produce. Safe to delete this whole block later; nothing
// else in the file depends on it.
if (typeof window !== "undefined") {
    window.campaignDebug = {
        // Mark every roster slot cleared for one (difficulty, lap) - the
        // fast path to reaching the Rival fight.
        clearAllSlots: (stars = 3, difficulty = getLastSelectedDifficulty(), lap = getHighestUnlockedLap(difficulty)) => {
            if (!isDebugMode()) {
                debugError("[campaignDebug] Ignored - enable debug mode first (add ?debug=1 to the URL).");
                return;
            }
            getRosterCharacterIds().forEach((characterId) => recordSlotClear(difficulty, lap, characterId, stars));
            debugLog(`[campaignDebug] Cleared all ${getRosterCharacterIds().length} slots on ${difficulty} lap ${lap} at ${stars} stars.`);
        },

        // Mark the Rival cleared for one (difficulty, lap) - this is what
        // actually unlocks the next lap (see getHighestUnlockedLap()), so
        // pair with clearAllSlots() first if the slots aren't cleared yet.
        clearRival: (stars = 3, difficulty = getLastSelectedDifficulty(), lap = getHighestUnlockedLap(difficulty)) => {
            if (!isDebugMode()) {
                debugError("[campaignDebug] Ignored - enable debug mode first (add ?debug=1 to the URL).");
                return;
            }
            recordRivalClear(difficulty, lap, stars);
            debugLog(`[campaignDebug] Cleared Rival on ${difficulty} lap ${lap} at ${stars} stars.`);
        },

        // Both of the above in one call - clears a whole (difficulty, lap)
        // and leaves the next lap unlocked and ready to test.
        clearLap: (stars = 3, difficulty = getLastSelectedDifficulty(), lap = getHighestUnlockedLap(difficulty)) => {
            if (!isDebugMode()) {
                debugError("[campaignDebug] Ignored - enable debug mode first (add ?debug=1 to the URL).");
                return;
            }
            window.campaignDebug.clearAllSlots(stars, difficulty, lap);
            window.campaignDebug.clearRival(stars, difficulty, lap);
        },

        // Repeatedly clears full laps to jump straight to a target lap
        // number on one difficulty, without playing through the earlier
        // ones - e.g. campaignDebug.jumpToLap(3, "hard").
        jumpToLap: (targetLap, difficulty = getLastSelectedDifficulty(), stars = 3) => {
            if (!isDebugMode()) {
                debugError("[campaignDebug] Ignored - enable debug mode first (add ?debug=1 to the URL).");
                return;
            }
            let lap = getHighestUnlockedLap(difficulty);
            while (lap < targetLap) {
                window.campaignDebug.clearLap(stars, difficulty, lap);
                lap = getHighestUnlockedLap(difficulty);
            }
            debugLog(`[campaignDebug] ${difficulty} is now at lap ${lap}.`);
        },

        // Wipes all campaign progress (every difficulty, every lap) back to
        // a fresh save.
        resetProgress: () => {
            if (!isDebugMode()) {
                debugError("[campaignDebug] Ignored - enable debug mode first (add ?debug=1 to the URL).");
                return;
            }
            try {
                localStorage.removeItem(STORAGE_KEY);
                debugLog("[campaignDebug] Campaign progress reset.");
            } catch (error) {
                debugError("[campaignDebug] Failed to reset progress:", error);
            }
        },

        // Prints the raw parsed save data for inspection.
        dump: () => {
            debugLog("[campaignDebug] Current progress:", loadProgress());
        },
    };
}
