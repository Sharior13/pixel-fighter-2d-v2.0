// ============================================================================
// CAMPAIGN MODE UI — Difficulty Select, Level Select, character picker,
// result screen
// ============================================================================
// Presentation only - all campaign state/logic (progress, difficulty curve,
// fight orchestration) lives in core/campaign.js. See campaign-mode-spec.md
// Sections 8/9/10/11.
// ============================================================================

import { canvas } from "../core/render.js";
import { getCharacterData } from "../core/sim/data/characters.js";
import { ASSET_BASE_URL } from "../core/config.js";
import {
    CAMPAIGN_DIFFICULTIES,
    getRosterCharacterIds,
    getSelectableCharacterIdsForFight,
    getLevelSelectData,
    getDifficultyOverview,
    getHighestUnlockedLap,
    getLastSelectedDifficulty,
    setLastSelectedDifficulty,
    getFightConfig,
    startFight,
    stopFight,
} from "../core/campaign.js";
import { loadingScreenUI } from "./loadingScreen.js";
import { titleScreenUI } from "./titleScreen.js";

const difficultySelectEl = document.getElementById("campaign-difficulty-select");
const levelSelectEl = document.getElementById("campaign-level-select");
const characterPickerEl = document.getElementById("campaign-character-picker");
const resultScreenEl = document.getElementById("campaign-result-screen");

// Level Select's active context - which (difficulty, lap) it's currently
// showing. Set whenever Level Select is (re)opened; the character-picker/
// fight-launch/result functions below are all passed explicit
// difficulty/lap values rather than reading this directly, so this exists
// purely to remember what Level Select itself should reopen to.
let currentDifficulty = "normal";
let currentLap = 1;

// The exact config of whatever fight is currently showing a result screen -
// needed so "Retry" can relaunch the identical fight (same opponent
// personality/skill roll) rather than re-rolling a fresh one.
let lastFightConfig = null;

const thumbnailUrl = (characterId) => {
    const data = getCharacterData(characterId);
    return data ? `${ASSET_BASE_URL}/${data.select.thumbnail}` : "";
};

const characterName = (characterId) => {
    const data = getCharacterData(characterId);
    return data ? data.name : characterId;
};

const starString = (bestStars) => {
    if (!bestStars) return "";
    return "★".repeat(bestStars) + "☆".repeat(3 - bestStars);
};

const difficultyLabel = (difficulty) => difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

const hideAllCampaignScreens = () => {
    difficultySelectEl.classList.add("hidden");
    levelSelectEl.classList.add("hidden");
    characterPickerEl.classList.add("hidden");
    resultScreenEl.classList.add("hidden");
    // Belt-and-suspenders alongside the CSS fix for the .hidden/.campaign-
    // screen specificity collision: a <button> that still has focus when
    // its screen goes away can otherwise catch a later Space/Enter keypress
    // (browsers auto-click a focused button on Space) and re-fire whatever
    // that button used to do - e.g. relaunching a fight mid-match. Explicitly
    // dropping focus here means that can't happen even if some future click
    // handler forgets to navigate away cleanly.
    if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
    }
};

const exitToTitleScreen = () => {
    stopFight();
    hideAllCampaignScreens();
    titleScreenUI.showTitleScreen();
};

// ── Difficulty Select (spec Section 8) ──────────────────────────────────
const openDifficultySelect = () => {
    titleScreenUI.hideTitleScreen();
    hideAllCampaignScreens();
    canvas.style.backgroundImage = "url('../assets/background/title-bg.gif')";
    renderDifficultySelect();
    difficultySelectEl.classList.remove("hidden");
};

const renderDifficultySelect = () => {
    const overview = getDifficultyOverview();
    const lastSelected = getLastSelectedDifficulty();

    const tilesHtml = overview.map(({ difficulty, lap, clearedCount, totalSlots, rivalCleared, rivalBestStars }) => {
        const lapLine = lap > 1 ? `<span class="campaign-difficulty-lap">Lap ${lap}</span>` : "";
        const rivalLine = rivalCleared
            ? `Rival: Cleared ${starString(rivalBestStars)}`
            : "Rival: Not cleared";
        const lastPlayedClass = difficulty === lastSelected ? " last-played" : "";
        return `
            <button class="campaign-difficulty-tile${lastPlayedClass}" data-difficulty="${difficulty}">
                <span class="campaign-difficulty-name">${difficultyLabel(difficulty)}</span>
                ${lapLine}
                <span class="campaign-difficulty-progress">${clearedCount}/${totalSlots} cleared</span>
                <span class="campaign-difficulty-rival">${rivalLine}</span>
            </button>
        `;
    }).join("");

    difficultySelectEl.innerHTML = `
        <div class="campaign-screen-header">
            <h1 class="title">CAMPAIGN</h1>
            <button class="back-btn" id="campaign-difficulty-back">← BACK</button>
        </div>
        <p class="selection-title">Choose your difficulty</p>
        <div class="campaign-difficulty-grid">
            ${tilesHtml}
        </div>
    `;

    document.getElementById("campaign-difficulty-back").addEventListener("click", exitToTitleScreen);

    difficultySelectEl.querySelectorAll(".campaign-difficulty-tile").forEach((tile) => {
        tile.addEventListener("click", () => {
            const difficulty = tile.dataset.difficulty;
            setLastSelectedDifficulty(difficulty);
            openLevelSelect(difficulty);
        });
    });
};

// ── Level Select (spec Section 10) ──────────────────────────────────────
const openLevelSelect = (difficulty) => {
    currentDifficulty = difficulty;
    currentLap = getHighestUnlockedLap(difficulty);

    hideAllCampaignScreens();
    // Same background the title screen/character-select use - restores it
    // in case a previous fight cleared it (see campaign.js's startFight).
    canvas.style.backgroundImage = "url('../assets/background/title-bg.gif')";
    renderLevelSelect();
    levelSelectEl.classList.remove("hidden");
};

const renderLevelSelect = () => {
    const { slots, rival } = getLevelSelectData(currentDifficulty, currentLap);

    const tileHtml = (label, characterId, unlocked, cleared, bestStars, dataAttrs) => {
        const classes = ["campaign-tile"];
        if (!unlocked) classes.push("locked");
        if (cleared) classes.push("cleared");
        const img = characterId
            ? `<img src="${thumbnailUrl(characterId)}" alt="${characterName(characterId)}">`
            : `<span class="campaign-tile-fallback">?</span>`;
        return `
            <button class="${classes.join(" ")}" ${dataAttrs} ${unlocked ? "" : "disabled"}>
                ${unlocked ? img : `<span class="campaign-tile-lock">🔒</span>`}
                <span class="campaign-tile-label">${label}</span>
                ${unlocked ? `<span class="campaign-tile-stars">${starString(bestStars)}</span>` : ""}
            </button>
        `;
    };

    const slotsHtml = slots.map((slot) =>
        tileHtml(
            slot.unlocked ? characterName(slot.characterId) : "???",
            slot.characterId,
            slot.unlocked,
            slot.cleared,
            slot.bestStars,
            `data-kind="slot" data-slot-index="${slot.index}"`
        )
    ).join("");

    const rivalHtml = tileHtml(
        "Rival",
        null,
        rival.unlocked,
        rival.cleared,
        rival.bestStars,
        `data-kind="rival"`
    );

    levelSelectEl.innerHTML = `
        <div class="campaign-screen-header">
            <h1 class="title">${difficultyLabel(currentDifficulty).toUpperCase()} — LAP ${currentLap}</h1>
            <button class="back-btn" id="campaign-level-select-back">← CHANGE DIFFICULTY</button>
        </div>
        <div class="campaign-grid">
            ${slotsHtml}
            <div class="campaign-tile-divider"></div>
            ${rivalHtml}
        </div>
    `;

    document.getElementById("campaign-level-select-back").addEventListener("click", openDifficultySelect);

    levelSelectEl.querySelectorAll(".campaign-tile:not([disabled])").forEach((tile) => {
        tile.addEventListener("click", () => {
            const kind = tile.dataset.kind;
            const slotIndex = kind === "slot" ? Number(tile.dataset.slotIndex) : getRosterCharacterIds().length;
            openCharacterPicker(kind, slotIndex, currentDifficulty, currentLap);
        });
    });
};

// ── Character picker (spec Section 11, step 1) ──────────────────────────
const openCharacterPicker = (kind, slotIndex, difficulty, lap) => {
    hideAllCampaignScreens();
    renderCharacterPicker(kind, slotIndex, difficulty, lap);
    characterPickerEl.classList.remove("hidden");
};

const renderCharacterPicker = (kind, slotIndex, difficulty, lap) => {
    const selectableIds = getSelectableCharacterIdsForFight(kind, slotIndex);
    const opponentPreviewId = kind === "rival" ? null : getRosterCharacterIds()[slotIndex];

    const opponentLabel = kind === "rival"
        ? "Rival will mirror whoever you pick"
        : `Opponent: ${characterName(opponentPreviewId)}`;

    const gridHtml = selectableIds.map((characterId) => `
        <button class="character-slot" data-character-id="${characterId}">
            <img src="${thumbnailUrl(characterId)}" alt="${characterName(characterId)}">
        </button>
    `).join("");

    characterPickerEl.innerHTML = `
        <div class="campaign-screen-header">
            <h1 class="title">CHOOSE YOUR FIGHTER</h1>
            <button class="back-btn" id="campaign-picker-back">← BACK</button>
        </div>
        <p class="selection-title">${opponentLabel}</p>
        <div class="character-grid campaign-picker-grid">
            ${gridHtml}
        </div>
    `;

    document.getElementById("campaign-picker-back").addEventListener("click", () => openLevelSelect(difficulty));

    characterPickerEl.querySelectorAll(".character-slot").forEach((slot) => {
        slot.addEventListener("click", () => {
            const playerCharacterId = slot.dataset.characterId;
            const config = getFightConfig(kind, slotIndex, playerCharacterId, difficulty, lap);
            launchFight(config);
        });
    });
};

// ── Fight launch + result (spec Section 11) ─────────────────────────────
const launchFight = async (config) => {
    hideAllCampaignScreens();
    lastFightConfig = config;

    loadingScreenUI.show(
        [
            { socketId: "campaign-preview-you", character: config.playerCharacterId },
            { socketId: "campaign-preview-opp", character: config.opponentCharacterId },
        ],
        "campaign-preview-you"
    );

    await startFight(config, {
        onProgress: (loaded, total) => loadingScreenUI.setProgress(loaded, total),
        onMatchEnd: (result) => showResultScreen(result),
    });

    loadingScreenUI.hide();
};

// What fight comes after `prevConfig`, given it was just WON. Returns null
// if there's nothing to advance to (a Rival win that didn't unlock a new
// lap - shouldn't normally happen given how unlocks work, but guards
// against e.g. a future lap cap).
const getNextFightTarget = (prevConfig) => {
    if (prevConfig.kind !== "slot") {
        const newLap = getHighestUnlockedLap(prevConfig.difficulty);
        if (newLap > prevConfig.lap) {
            return { kind: "slot", slotIndex: 0, difficulty: prevConfig.difficulty, lap: newLap };
        }
        return null;
    }
    const rosterIds = getRosterCharacterIds();
    const nextIndex = prevConfig.slotIndex + 1;
    if (nextIndex < rosterIds.length) {
        return { kind: "slot", slotIndex: nextIndex, difficulty: prevConfig.difficulty, lap: prevConfig.lap };
    }
    return { kind: "rival", slotIndex: rosterIds.length, difficulty: prevConfig.difficulty, lap: prevConfig.lap };
};

const showResultScreen = ({ won, stars, config }) => {
    hideAllCampaignScreens();

    const title = won ? "VICTORY!" : "DEFEAT";
    const starsHtml = won ? `<div class="campaign-result-stars">${starString(stars)}</div>` : "";
    const nextTarget = won ? getNextFightTarget(config) : null;

    // Rival win that unlocked a new lap - call it out explicitly (spec
    // Section 11, step 6).
    const lapUpHtml = (won && config.kind === "rival" && nextTarget && nextTarget.lap > config.lap)
        ? `<p class="campaign-result-lapup">Lap ${config.lap} Complete — Lap ${nextTarget.lap} Unlocked!</p>`
        : "";

    resultScreenEl.innerHTML = `
        <div class="campaign-result-box">
            <h1 class="title ${won ? "campaign-result-win" : "campaign-result-loss"}">${title}</h1>
            ${starsHtml}
            ${lapUpHtml}
            <div class="campaign-result-buttons">
                ${nextTarget ? `<button class="btn btn-small" id="campaign-result-continue">CONTINUE</button>` : ""}
                <button class="btn btn-small" id="campaign-result-retry">RETRY</button>
                <button class="btn btn-small" id="campaign-result-exit">EXIT</button>
            </div>
        </div>
    `;
    resultScreenEl.classList.remove("hidden");

    if (nextTarget) {
        document.getElementById("campaign-result-continue").addEventListener("click", () => {
            currentDifficulty = nextTarget.difficulty;
            currentLap = nextTarget.lap;
            openCharacterPicker(nextTarget.kind, nextTarget.slotIndex, nextTarget.difficulty, nextTarget.lap);
        });
    }

    document.getElementById("campaign-result-retry").addEventListener("click", () => {
        launchFight(lastFightConfig);
    });

    document.getElementById("campaign-result-exit").addEventListener("click", () => {
        openLevelSelect(config.difficulty);
    });
};

export { openDifficultySelect };
