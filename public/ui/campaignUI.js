// ============================================================================
// CAMPAIGN MODE UI — Level Select, character picker, result screen
// ============================================================================
// Presentation only - all campaign state/logic (progress, difficulty curve,
// fight orchestration) lives in core/campaign.js. See campaign-mode-spec.md
// Sections 8/9.
// ============================================================================

import { canvas } from "../core/render.js";
import { getCharacterData } from "../core/sim/data/characters.js";
import { ASSET_BASE_URL } from "../core/config.js";
import {
    getRosterCharacterIds,
    getSelectableCharacterIdsForFight,
    getLevelSelectData,
    getFightConfig,
    startFight,
    stopFight,
} from "../core/campaign.js";
import { loadingScreenUI } from "./loadingScreen.js";
import { titleScreenUI } from "./titleScreen.js";

const levelSelectEl = document.getElementById("campaign-level-select");
const characterPickerEl = document.getElementById("campaign-character-picker");
const resultScreenEl = document.getElementById("campaign-result-screen");

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
}

const hideAllCampaignScreens = () => {
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

// ── Level Select (spec Section 8) ───────────────────────────────────────
const openLevelSelect = () => {
    titleScreenUI.hideTitleScreen();
    hideAllCampaignScreens();
    // Same background the title screen/character-select use - restores it
    // in case a previous fight cleared it (see campaign.js's startFight).
    canvas.style.backgroundImage = "url('../assets/background/title-bg.gif')";
    renderLevelSelect();
    levelSelectEl.classList.remove("hidden");
};

const exitToTitleScreen = () => {
    stopFight();
    hideAllCampaignScreens();
    titleScreenUI.showTitleScreen();
};

const renderLevelSelect = () => {
    const { slots, rival } = getLevelSelectData();

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
            <h1 class="title">CAMPAIGN</h1>
            <button class="back-btn" id="campaign-level-select-back">← BACK</button>
        </div>
        <div class="campaign-grid">
            ${slotsHtml}
            <div class="campaign-tile-divider"></div>
            ${rivalHtml}
        </div>
    `;

    document.getElementById("campaign-level-select-back").addEventListener("click", exitToTitleScreen);

    levelSelectEl.querySelectorAll(".campaign-tile:not([disabled])").forEach((tile) => {
        tile.addEventListener("click", () => {
            const kind = tile.dataset.kind;
            const slotIndex = kind === "slot" ? Number(tile.dataset.slotIndex) : getRosterCharacterIds().length;
            openCharacterPicker(kind, slotIndex);
        });
    });
};

// ── Character picker (spec Section 9, step 1) ───────────────────────────
const openCharacterPicker = (kind, slotIndex) => {
    hideAllCampaignScreens();
    renderCharacterPicker(kind, slotIndex);
    characterPickerEl.classList.remove("hidden");
};

const renderCharacterPicker = (kind, slotIndex) => {
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

    document.getElementById("campaign-picker-back").addEventListener("click", openLevelSelect);

    characterPickerEl.querySelectorAll(".character-slot").forEach((slot) => {
        slot.addEventListener("click", () => {
            const playerCharacterId = slot.dataset.characterId;
            const config = getFightConfig(kind, slotIndex, playerCharacterId);
            launchFight(config);
        });
    });
};

// ── Fight launch + result (spec Section 9) ──────────────────────────────
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

const getNextFightTarget = (prevConfig) => {
    if (prevConfig.kind !== "slot") {
        return null; // no "next" after clearing the Rival
    }
    const rosterIds = getRosterCharacterIds();
    const nextIndex = prevConfig.slotIndex + 1;
    if (nextIndex < rosterIds.length) {
        return { kind: "slot", slotIndex: nextIndex };
    }
    return { kind: "rival", slotIndex: rosterIds.length }; // last slot just cleared -> Rival now unlocked
};

const showResultScreen = ({ won, stars, config }) => {
    hideAllCampaignScreens();

    const title = won ? "VICTORY!" : "DEFEAT";
    const starsHtml = won ? `<div class="campaign-result-stars">${starString(stars)}</div>` : "";
    const nextTarget = won ? getNextFightTarget(config) : null;

    resultScreenEl.innerHTML = `
        <div class="campaign-result-box">
            <h1 class="title ${won ? "campaign-result-win" : "campaign-result-loss"}">${title}</h1>
            ${starsHtml}
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
            openCharacterPicker(nextTarget.kind, nextTarget.slotIndex);
        });
    }

    document.getElementById("campaign-result-retry").addEventListener("click", () => {
        launchFight(lastFightConfig);
    });

    document.getElementById("campaign-result-exit").addEventListener("click", () => {
        openLevelSelect();
    });
};

export { openLevelSelect };
