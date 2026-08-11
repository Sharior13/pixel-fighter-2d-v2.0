// ============================================================================
// characterSprites.js — DERIVED VIEW, not a data source.
// ============================================================================
// Character sprite/animation config used to be authored directly in this
// file, duplicating data that also lived in server/data/characterData.js
// and server/core/attackSystem.js. It now all lives in ONE place -
// server/data/characters.js - as the single source of truth (see that
// file's header comment). This module just reshapes that data into the
// flat { [characterId]: { frameWidth, frameHeight, layout, scale,
// spriteSheets, animations } } shape the renderer (render.js) and
// assetPreloader.js already expect, so neither of those files needed to
// change.
//
// Imports from public/core/sim/data/characters.js, the browser-safe mirror
// of server/data/characters.js that scripts/build-client-sim.js generates -
// same mechanism this project already uses to share the combat sim itself
// between server and client (see public/core/sim/core/*.js). Do not author
// sprite data here; edit server/data/characters.js and run `npm run
// build:sim`.
// ============================================================================
import { CHARACTERS } from "../core/sim/data/characters.js";

const characterSpriteConfigs = Object.fromEntries(
    Object.entries(CHARACTERS).map(([characterId, character]) => [
        characterId,
        {
            name: character.name,
            ...character.sprite
        }
    ])
);

export { characterSpriteConfigs };
