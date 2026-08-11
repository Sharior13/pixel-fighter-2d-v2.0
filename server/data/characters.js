// ============================================================================
// characters.js — SINGLE SOURCE OF TRUTH for all character-related data.
// ============================================================================
// Replaces the previously-scattered character data that used to live in:
//   - server/data/characterData.js       (stats, ability flavor ids)
//   - server/core/attackSystem.js        (ATTACK_TIER_FRAMES, CHARACTER_SPEED_MOD,
//                                          ATTACK_CONFIG_MS per-move balance data)
//   - public/data/characterSprites.js    (sprite sheets + animation playback config)
//
// Everything about a character - stats, move balance data, frame timing
// modifiers, and sprite/animation config - now lives in ONE place: the
// CHARACTERS object below. Every other file (server combat sim, client
// renderer, matchmaking, etc.) reads from here instead of keeping its own
// copy. This file is plain data + a few pure lookup helpers - no simulation
// logic lives here (attackTiming/ATTACK_CONFIG derivation stays in
// attackSystem.js, which now just *consumes* this file instead of defining
// its own character tables).
//
// This file is mirrored to the browser exactly like the old
// characterData.js was (see scripts/build-client-sim.js's FILES list) -
// public/core/sim/data/characters.js is auto-generated from this file, do
// not hand-edit that copy. public/data/characterSprites.js is now a thin
// derived view over that mirrored copy (see that file for why it still
// exists as a separate module).
//
// ADDING A NEW CHARACTER: add one new entry to CHARACTERS below with all
// five sections (stats, frameModifier, moves, sprite) filled in. Nothing
// else needs to change - attackSystem.js, gameState.js, matchmaking, and
// the client renderer all discover new characters automatically via
// getAllCharacterIds()/CHARACTERS.
// ============================================================================

// ── Move tiers (build-order item 6 of combat-system-refactor-plan.md) ──
// Shared baseline startup/active/recovery frames per MOVE SLOT (attack1,
// attack2, basic, special, ultimate), at 60fps. Every character's actual
// per-move timing is this baseline adjusted by that character's own
// `frameModifier` (below) - see attackTiming() in attackSystem.js for how
// the two combine. Authored as tier + per-character modifier rather than
// by hand per character/move: keeps the actual design decision (how fast
// is this character, how weighty is this move) legible in one place
// instead of buried in 20 hand-typed numbers per character.
const MOVE_TIER_FRAMES = {
    //           startup  active  recovery
    attack1:    { startup: 4,  active: 3, recovery: 8  }, // light poke - fast, safe combo starter
    attack2:    { startup: 6,  active: 4, recovery: 10 }, // medium - second hit in a chain
    basic:      { startup: 8,  active: 5, recovery: 14 }, // heavy normal - usually a chain-ender
    special:    { startup: 10, active: 6, recovery: 18 }, // meter move - big commitment
    ultimate:   { startup: 14, active: 8, recovery: 20 }  // true finisher, not meant to chain further
};

// Move-slot -> sprite animation name. Every character uses this same
// mapping (a character's attack1 always plays that character's 'attack1'
// sheet, etc.) - kept as one shared table rather than repeated per
// character since there's no current case of a character needing a
// different mapping.
const MOVE_ANIMATION_MAP = {
    attack1: 'attack1',
    attack2: 'attack2',
    basic: 'attack_basic',
    special: 'attack_special',
    ultimate: 'attack_ultimate'
};

const CHARACTERS = {
    luffy: {
        id: "luffy",
        name: "Luffy",

        stats: {
            maxHealth: 1150,
            speed: 5.0,
            jumpForce: 15,
            weight: 1.15
        },

        // startup/recovery deltas (frames) applied on top of MOVE_TIER_FRAMES
        // for every move this character has - reflects this character's
        // overall speed/weight archetype (see attackTiming() in
        // attackSystem.js).
        frameModifier: { startup: 0, recovery: 0 },

        // character-select screen tile. Separate from `sprite` above -
        // `select.thumbnail` is a single small preview gif/image, not a
        // combat spritesheet, and is the only piece of data the select
        // screen (public/ui/characterSelect.js) needs. See
        // getCharacterSelectRoster() at the bottom of this file.
        select: {
            thumbnail: 'characters/luffy/luffy.gif'
        },

        moves: {
            attack1: {
                abilityId: "gum_pistol",
                damage: 42,
                cooldown: 650,
                knockback: { x: 8, y: 0 },
                range: 60, // Short range punch
                hitboxWidth: 40,
                hitboxHeight: 50,
                attackLevel: 'high',
                meterCost: 0,
                meterGain: 6
            },
            attack2: {
                abilityId: "gum_whip",
                damage: 50,
                cooldown: 850,
                knockback: { x: 12, y: 0 },
                range: 80, // Medium range kick
                hitboxWidth: 50,
                hitboxHeight: 60,
                attackLevel: 'low',
                meterCost: 0,
                meterGain: 8
            },
            basic: {
                abilityId: "gum_punch",
                damage: 32,
                cooldown: 1150,
                knockback: { x: 10, y: 0 },
                range: 100, // Extended punch
                hitboxWidth: 60,
                hitboxHeight: 70,
                attackLevel: 'mid',
                meterCost: 0,
                meterGain: 10
            },
            special: {
                abilityId: "gum_baloon",
                damage: 70,
                cooldown: 10000,
                knockback: { x: 20, y: 0 },
                range: 150, // Gomu Gomu extended attack
                hitboxWidth: 80,
                hitboxHeight: 80,
                attackLevel: 'mid',
                meterCost: 30,
                meterGain: 5
            },
            ultimate: {
                abilityId: "gum_gatling",
                damage: 150,
                cooldown: 30000,
                knockback: { x: 40, y: 0 },
                dashDistance: 0,
                range: 200, // Gear Fourth range
                hitboxWidth: 100,
                hitboxHeight: 100,
                attackLevel: 'mid',
                meterCost: 100,
                meterGain: 0
            }
        },

        sprite: {
            frameWidth: 96,
            frameHeight: 96,
            layout: 'horizontal',
            scale: 4,

            spriteSheets: {
                main: 'characters/luffy/luffy-idle.png',
                walk: 'characters/luffy/luffy-walk.png',
                jump: 'characters/luffy/luffy-jump.png',
                hit: 'characters/luffy/luffy-hit.png',
                dash: 'characters/luffy/luffy-dash.png',
                block: 'characters/luffy/luffy-block.png',
                defeat: 'characters/luffy/luffy-lose.png',
                victory: 'characters/luffy/luffy-win.png',
                attack1: 'characters/luffy/luffy-attack1.png',
                attack2: 'characters/luffy/luffy-attack2.png',
                attack_basic: 'characters/luffy/luffy-basic.png',
                attack_special: 'characters/luffy/luffy-special.png',
                attack_ultimate: 'characters/luffy/luffy-ultimate.png'
            },

            animations: {
                idle: { sheet: 'main', startFrame: 0, frames: 6, frameDelay: 150, loop: true, row: 0 },
                walk: { sheet: 'walk', startFrame: 0, frames: 8, frameDelay: 80, loop: true, row: 0 },
                dash: { sheet: 'dash', startFrame: 0, frames: 2, frameDelay: 100, loop: true, row: 0 },
                jump: { sheet: 'jump', startFrame: 0, frames: 9, frameDelay: 100, loop: false, row: 0 },
                fall: { sheet: 'jump', startFrame: 4, frames: 5, frameDelay: 100, loop: true, row: 0 },
                attack1: { sheet: 'attack1', startFrame: 0, frames: 7, frameDelay: 80, loop: false, row: 0 },
                attack2: { sheet: 'attack2', startFrame: 0, frames: 8, frameDelay: 80, loop: false, row: 0 },
                attack_basic: { sheet: 'attack_basic', startFrame: 0, frames: 3, frameDelay: 100, loop: false, row: 0 },
                attack_special: { sheet: 'attack_special', startFrame: 0, frames: 9, frameDelay: 100, loop: false, row: 0 },
                attack_ultimate: { sheet: 'attack_ultimate', startFrame: 0, frames: 10, frameDelay: 120, loop: false, row: 0 },
                hit: { sheet: 'hit', startFrame: 0, frames: 4, frameDelay: 80, loop: false, row: 0 },
                block: { sheet: 'block', startFrame: 0, frames: 2, frameDelay: 100, loop: false, row: 0 },
                victory: { sheet: 'victory', startFrame: 0, frames: 4, frameDelay: 150, loop: true, row: 0 },
                defeat: { sheet: 'defeat', startFrame: 0, frames: 4, frameDelay: 150, loop: false, row: 0 }
            }
        }
    },

    zoro: {
        id: "zoro",
        name: "Zoro",

        stats: {
            maxHealth: 1000,
            speed: 5.5,
            jumpForce: 15,
            weight: 1.1
        },

        // heavier, more committed swings
        frameModifier: { startup: 1, recovery: 2 },

        select: {
            thumbnail: 'characters/zoro/zoro.gif'
        },

        moves: {
            attack1: {
                abilityId: "rolling_slash",
                damage: 37,
                cooldown: 500,
                knockback: { x: 10, y: 0 },
                range: 70, // Sword slash
                hitboxWidth: 50,
                hitboxHeight: 60,
                attackLevel: 'high',
                meterCost: 0,
                meterGain: 6
            },
            attack2: {
                abilityId: "sword_slash",
                damage: 45,
                cooldown: 650,
                knockback: { x: 8, y: 0 },
                range: 90, // Wide sword arc
                hitboxWidth: 60,
                hitboxHeight: 70,
                attackLevel: 'low',
                meterCost: 0,
                meterGain: 8
            },
            basic: {
                abilityId: "zoro_slash",
                damage: 35,
                cooldown: 1100,
                knockback: { x: 12, y: 0 },
                range: 110, // Three sword style
                hitboxWidth: 70,
                hitboxHeight: 80,
                attackLevel: 'mid',
                meterCost: 0,
                meterGain: 10
            },
            special: {
                abilityId: "santoriu",
                damage: 87,
                cooldown: 10000,
                knockback: { x: 25, y: 0 },
                range: 160, // Oni Giri
                hitboxWidth: 90,
                hitboxHeight: 90,
                attackLevel: 'mid',
                meterCost: 30,
                meterGain: 5
            },
            ultimate: {
                abilityId: "whirlwind",
                damage: 195,
                cooldown: 30000,
                knockback: { x: 50, y: 0 },
                dashDistance: 500,
                range: 250, // Asura attack
                hitboxWidth: 120,
                hitboxHeight: 120,
                attackLevel: 'mid',
                meterCost: 100,
                meterGain: 0
            }
        },

        sprite: {
            frameWidth: 96,
            frameHeight: 96,
            layout: 'horizontal',
            scale: 3.5,

            spriteSheets: {
                main: 'characters/zoro/zoro-idle.png',
                walk: 'characters/zoro/zoro-walk.png',
                jump: 'characters/zoro/zoro-jump.png',
                hit: 'characters/zoro/zoro-hit.png',
                dash: 'characters/zoro/zoro-dash.png',
                block: 'characters/zoro/zoro-block.png',
                defeat: 'characters/zoro/zoro-lose.png',
                victory: 'characters/zoro/zoro-win.png',
                attack1: 'characters/zoro/zoro-attack1.png',
                attack2: 'characters/zoro/zoro-attack2.png',
                attack_basic: 'characters/zoro/zoro-basic.png',
                attack_special: 'characters/zoro/zoro-special.png',
                attack_ultimate: 'characters/zoro/zoro-ultimate.png'
            },

            animations: {
                idle: { sheet: 'main', startFrame: 0, frames: 4, frameDelay: 150, loop: true, row: 0 },
                walk: { sheet: 'walk', startFrame: 0, frames: 8, frameDelay: 80, loop: true, row: 0 },
                dash: { sheet: 'dash', startFrame: 0, frames: 2, frameDelay: 100, loop: true, row: 0 },
                jump: { sheet: 'jump', startFrame: 0, frames: 6, frameDelay: 100, loop: false, row: 0 },
                fall: { sheet: 'jump', startFrame: 3, frames: 3, frameDelay: 100, loop: true, row: 0 },
                attack1: { sheet: 'attack1', startFrame: 0, frames: 6, frameDelay: 80, loop: false, row: 0 },
                attack2: { sheet: 'attack2', startFrame: 0, frames: 9, frameDelay: 80, loop: false, row: 0 },
                attack_basic: { sheet: 'attack_basic', startFrame: 0, frames: 6, frameDelay: 100, loop: false, row: 0 },
                attack_special: { sheet: 'attack_special', startFrame: 0, frames: 15, frameDelay: 80, loop: false, row: 0 },
                attack_ultimate: { sheet: 'attack_ultimate', startFrame: 0, frames: 15, frameDelay: 80, loop: false, row: 0 },
                hit: { sheet: 'hit', startFrame: 0, frames: 4, frameDelay: 80, loop: false, row: 0 },
                block: { sheet: 'block', startFrame: 0, frames: 2, frameDelay: 100, loop: false, row: 0 },
                victory: { sheet: 'victory', startFrame: 0, frames: 6, frameDelay: 150, loop: false, row: 0 },
                defeat: { sheet: 'defeat', startFrame: 0, frames: 5, frameDelay: 150, loop: false, row: 0 }
            }
        }
    },

    ichigo: {
        id: "ichigo",
        name: "Ichigo",

        stats: {
            maxHealth: 950,
            speed: 7.0,
            jumpForce: 15,
            weight: 1.0
        },

        // fast zanpakuto slashes
        frameModifier: { startup: -1, recovery: -2 },

        select: {
            thumbnail: 'characters/ichigo/ichigo.gif'
        },

        moves: {
            attack1: {
                abilityId: "shikai",
                damage: 35,
                cooldown: 430,
                knockback: { x: 8, y: 0 },
                range: 75, // Zanpakuto slash
                hitboxWidth: 45,
                hitboxHeight: 55,
                attackLevel: 'high',
                meterCost: 0,
                meterGain: 6
            },
            attack2: {
                abilityId: "sword_slash",
                damage: 50,
                cooldown: 600,
                knockback: { x: 10, y: 0 },
                range: 95, // Wide slash
                hitboxWidth: 55,
                hitboxHeight: 65,
                attackLevel: 'low',
                meterCost: 0,
                meterGain: 8
            },
            basic: {
                abilityId: "ichigo_slash",
                damage: 25,
                cooldown: 1150,
                knockback: { x: 14, y: 0 },
                range: 115, // Bankai slash
                hitboxWidth: 65,
                hitboxHeight: 75,
                attackLevel: 'mid',
                meterCost: 0,
                meterGain: 10
            },
            special: {
                abilityId: "12_folds",
                damage: 95,
                cooldown: 15000,
                knockback: { x: 28, y: 0 },
                range: 150, // Getsuga Tensho
                hitboxWidth: 85,
                hitboxHeight: 85,
                attackLevel: 'mid',
                meterCost: 30,
                meterGain: 5
            },
            ultimate: {
                abilityId: "ichigo_bankai",
                damage: 200,
                cooldown: 35000,
                knockback: { x: 55, y: 0 },
                dashDistance: 400,
                range: 220, // Final Getsuga Tensho
                hitboxWidth: 115,
                hitboxHeight: 115,
                attackLevel: 'mid',
                meterCost: 100,
                meterGain: 0
            }
        },

        sprite: {
            frameWidth: 96,
            frameHeight: 96,
            layout: 'horizontal',
            scale: 3.5,

            spriteSheets: {
                main: 'characters/ichigo/ichigo-idle.png',
                walk: 'characters/ichigo/ichigo-walk.png',
                jump: 'characters/ichigo/ichigo-jump.png',
                hit: 'characters/ichigo/ichigo-hit.png',
                dash: 'characters/ichigo/ichigo-dash.png',
                block: 'characters/ichigo/ichigo-block.png',
                defeat: 'characters/ichigo/ichigo-lose.png',
                victory: 'characters/ichigo/ichigo-win.png',
                attack1: 'characters/ichigo/ichigo-attack1.png',
                attack2: 'characters/ichigo/ichigo-attack2.png',
                attack_basic: 'characters/ichigo/ichigo-basic.png',
                attack_special: 'characters/ichigo/ichigo-special.png',
                attack_ultimate: 'characters/ichigo/ichigo-ultimate.png'
            },

            animations: {
                idle: { sheet: 'main', startFrame: 0, frames: 4, frameDelay: 150, loop: true, row: 0 },
                walk: { sheet: 'walk', startFrame: 0, frames: 8, frameDelay: 80, loop: true, row: 0 },
                dash: { sheet: 'dash', startFrame: 0, frames: 2, frameDelay: 100, loop: true, row: 0 },
                jump: { sheet: 'jump', startFrame: 0, frames: 9, frameDelay: 100, loop: false, row: 0 },
                fall: { sheet: 'jump', startFrame: 3, frames: 3, frameDelay: 100, loop: true, row: 0 },
                attack1: { sheet: 'attack1', startFrame: 0, frames: 6, frameDelay: 80, loop: false, row: 0 },
                attack2: { sheet: 'attack2', startFrame: 0, frames: 8, frameDelay: 80, loop: false, row: 0 },
                attack_basic: { sheet: 'attack_basic', startFrame: 0, frames: 4, frameDelay: 80, loop: false, row: 0 },
                attack_special: { sheet: 'attack_special', startFrame: 0, frames: 8, frameDelay: 100, loop: false, row: 0 },
                attack_ultimate: { sheet: 'attack_ultimate', startFrame: 0, frames: 12, frameDelay: 120, loop: false, row: 0 },
                hit: { sheet: 'hit', startFrame: 0, frames: 4, frameDelay: 80, loop: false, row: 0 },
                block: { sheet: 'block', startFrame: 0, frames: 2, frameDelay: 100, loop: false, row: 0 },
                victory: { sheet: 'victory', startFrame: 0, frames: 7, frameDelay: 150, loop: true, row: 0 },
                defeat: { sheet: 'defeat', startFrame: 0, frames: 5, frameDelay: 150, loop: false, row: 0 }
            }
        }
    },

    rukia: {
        id: "rukia",
        name: "Rukia",

        stats: {
            maxHealth: 850,
            speed: 6.5,
            jumpForce: 15,
            weight: 0.7
        },

        // precise, swift ice strikes - same tempo as Ichigo
        frameModifier: { startup: -1, recovery: -2 },

        select: {
            thumbnail: 'characters/rukia/rukia.gif'
        },

        moves: {
            attack1: {
                abilityId: "rukia_punch",
                damage: 38,
                cooldown: 430,
                knockback: { x: 8, y: 0 },
                range: 58, // Ice sword slash
                hitboxWidth: 38,
                hitboxHeight: 48,
                attackLevel: 'high',
                meterCost: 0,
                meterGain: 6
            },
            attack2: {
                abilityId: "rukia_kick",
                damage: 42,
                cooldown: 600,
                knockback: { x: 10, y: 0 },
                range: 68, // Ice thrust
                hitboxWidth: 48,
                hitboxHeight: 58,
                attackLevel: 'low',
                meterCost: 0,
                meterGain: 8
            },
            basic: {
                abilityId: "rukia_low_kick",
                damage: 28,
                cooldown: 1150,
                knockback: { x: 14, y: 0 },
                range: 88, // Some no mai
                hitboxWidth: 58,
                hitboxHeight: 68,
                attackLevel: 'mid',
                meterCost: 0,
                meterGain: 10
            },
            special: {
                abilityId: "hado",
                damage: 90,
                cooldown: 15000,
                knockback: { x: 28, y: 0 },
                range: 125, // Ice wave
                hitboxWidth: 72,
                hitboxHeight: 72,
                attackLevel: 'mid',
                meterCost: 30,
                meterGain: 5
            },
            ultimate: {
                abilityId: "rukia_bankai",
                damage: 220,
                cooldown: 35000,
                knockback: { x: 55, y: 0 },
                dashDistance: 400,
                range: 170, // Hakka no Togame
                hitboxWidth: 98,
                hitboxHeight: 98,
                attackLevel: 'mid',
                meterCost: 100,
                meterGain: 0
            }
        },

        sprite: {
            frameWidth: 96,
            frameHeight: 96,
            layout: 'horizontal',
            scale: 3.5,

            spriteSheets: {
                main: 'characters/rukia/rukia-idle.png',
                walk: 'characters/rukia/rukia-walk.png',
                jump: 'characters/rukia/rukia-jump.png',
                hit: 'characters/rukia/rukia-hit.png',
                dash: 'characters/rukia/rukia-dash.png',
                block: 'characters/rukia/rukia-block.png',
                defeat: 'characters/rukia/rukia-lose.png',
                victory: 'characters/rukia/rukia-win.png',
                attack1: 'characters/rukia/rukia-attack1.png',
                attack2: 'characters/rukia/rukia-attack2.png',
                attack_basic: 'characters/rukia/rukia-basic.png',
                attack_special: 'characters/rukia/rukia-special.png',
                attack_ultimate: 'characters/rukia/rukia-ultimate.png'
            },

            animations: {
                idle: { sheet: 'main', startFrame: 0, frames: 4, frameDelay: 150, loop: true, row: 0 },
                walk: { sheet: 'walk', startFrame: 0, frames: 6, frameDelay: 80, loop: true, row: 0 },
                dash: { sheet: 'dash', startFrame: 0, frames: 2, frameDelay: 100, loop: true, row: 0 },
                jump: { sheet: 'jump', startFrame: 0, frames: 8, frameDelay: 100, loop: false, row: 0 },
                fall: { sheet: 'jump', startFrame: 3, frames: 3, frameDelay: 100, loop: true, row: 0 },
                attack1: { sheet: 'attack1', startFrame: 0, frames: 6, frameDelay: 80, loop: false, row: 0 },
                attack2: { sheet: 'attack2', startFrame: 0, frames: 8, frameDelay: 80, loop: false, row: 0 },
                attack_basic: { sheet: 'attack_basic', startFrame: 0, frames: 5, frameDelay: 80, loop: false, row: 0 },
                attack_special: { sheet: 'attack_special', startFrame: 0, frames: 12, frameDelay: 100, loop: false, row: 0 },
                attack_ultimate: { sheet: 'attack_ultimate', startFrame: 0, frames: 10, frameDelay: 150, loop: false, row: 0 },
                hit: { sheet: 'hit', startFrame: 0, frames: 4, frameDelay: 80, loop: false, row: 0 },
                block: { sheet: 'block', startFrame: 0, frames: 2, frameDelay: 100, loop: false, row: 0 },
                victory: { sheet: 'victory', startFrame: 0, frames: 4, frameDelay: 150, loop: true, row: 0 },
                defeat: { sheet: 'defeat', startFrame: 0, frames: 6, frameDelay: 150, loop: false, row: 0 }
            }
        }
    }
};

// ── Pure lookup helpers (unchanged signatures from the old characterData.js
// so every existing call site keeps working without modification) ────────
const getCharacterData = (characterId) => {
    return CHARACTERS[characterId] || null;
};

const getAllCharacterIds = () => {
    return Object.keys(CHARACTERS);
};

const validateCharacter = (characterId) => {
    return CHARACTERS.hasOwnProperty(characterId);
};

const getRandomCharacter = () => {
    const ids = getAllCharacterIds();
    return ids[Math.floor(Math.random() * ids.length)];
};

// ── Character-select roster placeholders ────────────────────────────────
// Locked/"coming soon" tiles shown on the select screen that aren't real
// playable characters yet - no stats/moves/sprite data exists for them,
// so they can't live in CHARACTERS above (that object assumes every entry
// is a complete, playable character - see the loops in attackSystem.js and
// validateCharacter()). Kept as a separate small list instead, merged with
// the real roster only for display purposes by getCharacterSelectRoster()
// below. When one of these becomes a real character, move its id/name
// here into a full CHARACTERS entry (with a matching `select.thumbnail`)
// and delete the placeholder row.
const ROSTER_PLACEHOLDERS = [
    { id: 'naruto', name: 'Naruto', thumbnail: 'characters/naruto/naruto.gif' },
    { id: 'sasuke', name: 'Sasuke', thumbnail: 'characters/sasuke/sasuke.gif' },
    { id: 'kakashi', name: 'Kakashi', thumbnail: 'characters/kakashi/kakashi.gif' },
    { id: 's1', name: 's1', thumbnail: 'characters/others/s1.gif' },
    { id: 's2', name: 's2', thumbnail: 'characters/others/s2.gif' },
    { id: 's3', name: 's3', thumbnail: 'characters/others/s3.gif' },
    { id: 's4', name: 's4', thumbnail: 'characters/others/s4.gif' }
];

// Single source the character-select screen (public/ui/characterSelect.js)
// builds its grid from - real playable characters (in CHARACTERS insertion
// order, i.e. the order they're authored above) followed by locked
// placeholder tiles. Each entry is already in the exact flat shape the
// select screen's grid renderer needs: { id, name, thumbnail, unavailable }.
const getCharacterSelectRoster = () => {
    const playable = getAllCharacterIds().map((id) => {
        const character = CHARACTERS[id];
        return {
            id: character.id,
            name: character.name,
            thumbnail: character.select.thumbnail,
            unavailable: false
        };
    });

    const placeholders = ROSTER_PLACEHOLDERS.map((entry) => ({
        ...entry,
        unavailable: true
    }));

    return [...playable, ...placeholders];
};

module.exports = {
    CHARACTERS,
    MOVE_TIER_FRAMES,
    MOVE_ANIMATION_MAP,
    ROSTER_PLACEHOLDERS,
    getCharacterData,
    getAllCharacterIds,
    validateCharacter,
    getRandomCharacter,
    getCharacterSelectRoster
};
