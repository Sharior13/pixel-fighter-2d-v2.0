// Single source of truth for the game's logical gameplay resolution. See
// docs/single-coordinate-system-migration.md.
//
// The simulation, camera, renderer, and battle UI all reason about a fixed
// 1280x720 (16:9) logical viewport, regardless of the player's actual device
// resolution. The browser is only responsible for figuring out how large to
// display that fixed rectangle - it never changes what the game itself
// thinks its own dimensions are.
//
// Phase 2 of the migration: just the constants. Nothing else in the project
// imports from this file yet - that's introduced gradually in later phases
// (viewport module responsibilities, canvas migration, camera migration,
// etc.), each verified and approved on its own before moving to the next.
const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;

export { GAME_WIDTH, GAME_HEIGHT };
