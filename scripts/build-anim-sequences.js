// ============================================================================
// build-anim-sequences.js
// ============================================================================
// Generates per-(character, move) `frameSequence` tables for 'tick-sequence'
// animations (see animation-engine-refactor-spec.md). This is the piece that
// fixes the animation engine's core bug: instead of hand-authoring one
// frameDelay/frames pair per move and hoping it roughly matches that move's
// combat timing, the sprite's per-tick frame lookup table is DERIVED from
// the same startupFrames/activeFrames/recoveryFrames the combat sim itself
// uses - already computed with that character's CHARACTER_SPEED_MOD applied
// (see attackTiming() in server/core/attackSystem.js) - so it is always
// exactly as long as that move actually runs for that character, never a
// generic/rounded default.
//
// INPUT (authored, compact - lives in server/data/characters.js):
// each sprite.animations[moveId] entry that wants tick-sequence sync sets
// `syncMode: 'tick-sequence'` and an `artFrames` field shaped like:
//   artFrames: { startup: [0, 1], active: [2, 3], recovery: [4, 5, 6] }
// - plain art-frame indices (which frame of the sheet to show), NOT frame
// counts or durations. Each list is spread with IMPLIED EVEN HOLDS across
// that phase's real frame count for that character (see expandPhase below).
// This is the part the spec calls out as the reason this must be generated
// per (character, move), not authored once per move: two characters running
// the same move can have different startupFrames/activeFrames/recoveryFrames
// (confirmed - see the file-header note below), so the same 2-art-frame
// startup list expands to a different number of ticks per character.
//
// OUTPUT (generated - never hand-edit, same convention as public/core/sim/**):
// server/data/generatedAnimSequences.js, ANIM_SEQUENCES[characterId][moveId]
// = the flat per-tick frameSequence array, exactly durationFrames long for
// THAT character. build-client-sim.js mirrors this file to the browser
// alongside the rest of the sim (see its FILES list), and
// public/data/characterSprites.js merges it onto any 'tick-sequence'
// animation entry before handing sprite configs to the renderer.
//
// Run via `npm run build:sim` (chained after build-client-sim.js - see
// package.json), so it always runs on the same schedule and stays in sync
// with the mirrored sim/character data it reads.
// ============================================================================

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// safe to require() directly - both are plain CommonJS with no browser-only
// dependencies (see build-client-sim.js's header comment for the same point
// about these files). This gets us the REAL, already-speed-modified
// startupFrames/activeFrames/recoveryFrames per (character, move), instead
// of recomputing (and risking drifting from) that logic here.
const { ATTACK_CONFIG } = require(path.join(ROOT, "server/core/attackSystem.js"));
const { CHARACTERS } = require(path.join(ROOT, "server/data/characters.js"));

// Spread `artFrameList` (art-frame indices) across `phaseFrameCount` ticks
// with implied even holds, preserving order. Distributes any remainder
// (when phaseFrameCount doesn't divide evenly by artFrameList.length) onto
// the EARLIEST frames in the list, one extra tick each - the same rule
// Array.prototype-style "split into N nearly-equal chunks" helpers commonly
// use, chosen so the behavior is deterministic and doesn't depend on which
// end of the phase happens to read as more "important" for a given move.
//
// Example: expandPhase([0, 1], 4) -> [0, 0, 1, 1]  (splits evenly)
//          expandPhase([2, 3], 3) -> [2, 2, 3]      (remainder on frame 0)
function expandPhase(artFrameList, phaseFrameCount) {
    if (!Array.isArray(artFrameList) || artFrameList.length === 0) {
        throw new Error(`expandPhase: artFrameList must be a non-empty array, got ${JSON.stringify(artFrameList)}`);
    }
    if (!Number.isInteger(phaseFrameCount) || phaseFrameCount < 0) {
        throw new Error(`expandPhase: phaseFrameCount must be a non-negative integer, got ${phaseFrameCount}`);
    }
    // an authored art-frame list longer than the phase itself would mean
    // some art frames are never shown for this character/move pairing -
    // almost certainly a mistake (art authored for a slower character
    // pasted onto a faster one), not a valid "fewer ticks than frames" case.
    if (artFrameList.length > phaseFrameCount) {
        throw new Error(
            `expandPhase: artFrameList has ${artFrameList.length} frames but this phase only runs ` +
            `${phaseFrameCount} ticks for this character - every art frame would need to render, ` +
            `but there aren't enough ticks to show them all. Trim artFrameList or check whether this ` +
            `character's CHARACTER_SPEED_MOD made this phase shorter than expected.`
        );
    }

    const k = artFrameList.length;
    const base = Math.floor(phaseFrameCount / k);
    const remainder = phaseFrameCount % k;

    const out = [];
    for (let i = 0; i < k; i++) {
        const holdCount = base + (i < remainder ? 1 : 0);
        for (let h = 0; h < holdCount; h++) {
            out.push(artFrameList[i]);
        }
    }
    return out;
}

// Expand a full { startup, active, recovery } artFrames spec against this
// character's real frame counts (from ATTACK_CONFIG) into one flat per-tick
// frameSequence array. Asserts the result is exactly durationFrames long -
// the whole point of generating this instead of hand-authoring it.
function generateFrameSequence(artFrames, frameCounts) {
    const { startupFrames, activeFrames, recoveryFrames, durationFrames } = frameCounts;

    const sequence = [
        ...expandPhase(artFrames.startup, startupFrames),
        ...expandPhase(artFrames.active, activeFrames),
        ...expandPhase(artFrames.recovery, recoveryFrames),
    ];

    if (sequence.length !== durationFrames) {
        // should be unreachable given expandPhase's own per-phase guarantees,
        // but a hard assert here is cheap insurance against a future edit to
        // this file (or to attackTiming()) silently producing a mis-sized
        // table - which would otherwise only surface as a subtle visual bug
        // (see spec: the entire class of bug this refactor exists to remove).
        throw new Error(
            `generateFrameSequence: expected ${durationFrames} ticks total, got ${sequence.length} - ` +
            `this indicates a bug in expandPhase or a mismatch between artFrames' phase keys and frameCounts.`
        );
    }

    return sequence;
}

// Walk every character's authored sprite.animations, generating a
// frameSequence for each entry that opts into tick-sequence sync (has both
// syncMode: 'tick-sequence' and an artFrames spec). Animations without
// artFrames are left alone here - characterSprites.js's merge step (see its
// own comment) simply won't find a generated entry for them, which is a
// hard error there rather than a silent fallback, so an animation can't
// accidentally ship as tick-sequence with no real per-tick data behind it.
function buildAnimSequences() {
    const sequences = {};

    for (const [characterId, character] of Object.entries(CHARACTERS)) {
        const animations = character.sprite && character.sprite.animations;
        if (!animations) continue;

        for (const [moveId, animConfig] of Object.entries(animations)) {
            if (animConfig.syncMode !== "tick-sequence") continue;
            if (!animConfig.artFrames) {
                throw new Error(
                    `[build-anim-sequences] ${characterId}.${moveId}: syncMode is 'tick-sequence' but no ` +
                    `artFrames spec was authored - add { startup: [...], active: [...], recovery: [...] } ` +
                    `to server/data/characters.js's sprite.animations.${moveId}, or remove syncMode until it's ready.`
                );
            }

            const frameCounts = ATTACK_CONFIG[characterId] && ATTACK_CONFIG[characterId][moveId];
            if (!frameCounts) {
                throw new Error(
                    `[build-anim-sequences] ${characterId}.${moveId}: has an artFrames spec but no matching ` +
                    `entry in ATTACK_CONFIG - tick-sequence animations must correspond to a real attack move ` +
                    `(this mode reads its per-tick timing straight from combat data, it has nothing else to go on).`
                );
            }

            if (!sequences[characterId]) sequences[characterId] = {};
            sequences[characterId][moveId] = generateFrameSequence(animConfig.artFrames, frameCounts);
        }
    }

    return sequences;
}

const OUTPUT_PATH = path.join(ROOT, "server/data/generatedAnimSequences.js");

const AUTOGEN_BANNER = `// ============================================================================
// AUTO-GENERATED - DO NOT EDIT
// Generated by scripts/build-anim-sequences.js from server/data/characters.js's
// sprite.animations[*].artFrames + server/core/attackSystem.js's ATTACK_CONFIG.
// Edit those source files and run \`npm run build:sim\` to regenerate.
// ============================================================================

`;

function build() {
    const ANIM_SEQUENCES = buildAnimSequences();

    const characterCount = Object.keys(ANIM_SEQUENCES).length;
    const moveCount = Object.values(ANIM_SEQUENCES).reduce((sum, moves) => sum + Object.keys(moves).length, 0);

    const out = AUTOGEN_BANNER + `const ANIM_SEQUENCES = ${JSON.stringify(ANIM_SEQUENCES, null, 4)};\n\nmodule.exports = { ANIM_SEQUENCES };\n`;

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, out, "utf8");

    console.log(`[build-anim-sequences] generated ${moveCount} frameSequence(s) across ${characterCount} character(s) -> server/data/generatedAnimSequences.js`);
}

// Only run the build as a side effect when this file is executed directly
// (`node scripts/build-anim-sequences.js`, or via `npm run build:sim`) -
// not when required elsewhere (e.g. a test harness importing expandPhase/
// generateFrameSequence in isolation), so requiring this module never has
// the surprising side effect of writing generatedAnimSequences.js.
if (require.main === module) {
    build();
}

module.exports = { expandPhase, generateFrameSequence, buildAnimSequences };
