import { spriteManager } from "./spriteAnimator.js";
import { characterSpriteConfigs } from "../data/characterSprites.js";
import { audioManager } from "./audioManager.js";

// Preloads everything the upcoming match needs to render/sound cleanly on the very
// first frame: both players' sprite sheets, both players' SFX, and the map background
// image - instead of letting them pop in mid-fight the way they used to (sprite sheets
// only started downloading once "startMatch"/render.js's initializePlayerSprites() ran,
// and the bg <img> only started loading once setMap() ran, both of which used to happen
// right as the fight began).
//
// `players` is the array from the "matchLoading" socket event: [{socketId, character,
// playerIndex, isBot}, ...]. Never rejects - every individual task resolves on load OR
// error (see spriteAnimator.js/audioManager.js), so one bad/missing asset can't hang
// the loading screen forever. `onProgress(loaded, total)` fires after every task settles.
const preloadMatchAssets = (players, mapId, onProgress = () => {}) => {
    const tasks = [];

    players.forEach(player => {
        const characterId = (player.character || '').toLowerCase();
        const config = characterSpriteConfigs[characterId];

        if (config) {
            tasks.push(() => spriteManager.preloadCharacterSheets(characterId, config));
        }
        tasks.push(() => audioManager.preloadCharacterSoundsAsync(characterId));
    });

    if (mapId) {
        tasks.push(() => preloadImage(`../assets/background/${mapId}.gif`));
    }

    const total = tasks.length;
    let loaded = 0;

    onProgress(0, total);

    return Promise.all(tasks.map(task =>
        task().then(() => {
            loaded++;
            onProgress(loaded, total);
        })
    ));
};

const preloadImage = (src) => {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = src;
    });
};

export { preloadMatchAssets };
