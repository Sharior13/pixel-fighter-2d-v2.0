const { STATES, setCombatState, canAttack, triggerHitstop, isFrozen } = require('./stateMachine.js');
const hitboxSystem = require('./hitboxSystem.js');

// ── frame conversion ─────────────────────────────────────────────────
// Step 0 of the refactor plan: every durational value becomes frame-counted
// at 60fps instead of millisecond-based. ATTACK_CONFIG below is still
// AUTHORED in milliseconds (that's the existing per-character balance data -
// re-authoring it directly in frames with real startup/active/recovery
// splits is section 6 / build-order item 11, not this step) but every value
// is converted to frames once at load time, and all scheduling from then on
// is frame-based. Nothing downstream of this file touches Date.now() for
// combat timing anymore.
const TICK_RATE = 60;
const FRAME_MS = 1000 / TICK_RATE;
const msToFrames = (ms) => Math.max(1, Math.round(ms / FRAME_MS));

const ATTACK_CONFIG_MS = {
    luffy: {
        attack1: {
            damage: 42,
            cooldown: 650,
            duration: 560,
            knockback: { x: 8, y: 0 },
            animation: 'attack1',
            range: 60, // Short range punch
            hitboxWidth: 40,
            hitboxHeight: 50
        },
        attack2: {
            damage: 50,
            cooldown: 850,
            duration: 640,
            knockback: { x: 12, y: 0 },
            animation: 'attack2',
            range: 80, // Medium range kick
            hitboxWidth: 50,
            hitboxHeight: 60
        },
        basic: {
            damage: 32,
            cooldown: 1150,
            duration: 300,
            knockback: { x: 10, y: 0 },
            animation: 'attack_basic',
            range: 100, // Extended punch
            hitboxWidth: 60,
            hitboxHeight: 70
        },
        special: {
            damage: 70,
            cooldown: 10000,
            duration: 900,
            knockback: { x: 20, y: 0 },
            animation: 'attack_special',
            range: 150, // Gomu Gomu extended attack
            hitboxWidth: 80,
            hitboxHeight: 80
        },
        ultimate: {
            damage: 150,
            cooldown: 30000,
            duration: 1200,
            knockback: { x: 40, y: 0 },
            animation: 'attack_ultimate',
            dashDistance: 0,
            range: 200, // Gear Fourth range
            hitboxWidth: 100,
            hitboxHeight: 100
        }
    },

    zoro: {
        attack1: {
            damage: 37,
            cooldown: 500,
            duration: 480,
            knockback: { x: 10, y: 0 },
            animation: 'attack1',
            range: 70, // Sword slash
            hitboxWidth: 50,
            hitboxHeight: 60
        },
        attack2: {
            damage: 45,
            cooldown: 650,
            duration: 720,
            knockback: { x: 8, y: 0 },
            animation: 'attack2',
            range: 90, // Wide sword arc
            hitboxWidth: 60,
            hitboxHeight: 70
        },
        basic: {
            damage: 35,
            cooldown: 1100,
            duration: 600,
            knockback: { x: 12, y: 0 },
            animation: 'attack_basic',
            range: 110, // Three sword style
            hitboxWidth: 70,
            hitboxHeight: 80
        },
        special: {
            damage: 87,
            cooldown: 10000,
            duration: 1200,
            knockback: { x: 25, y: 0 },
            animation: 'attack_special',
            range: 160, // Oni Giri
            hitboxWidth: 90,
            hitboxHeight: 90
        },
        ultimate: {
            damage: 195,
            cooldown: 30000,
            duration: 1200,
            knockback: { x: 50, y: 0 },
            animation: 'attack_ultimate',
            dashDistance: 500,
            range: 250, // Asura attack
            hitboxWidth: 120,
            hitboxHeight: 120
        }
    },

    ichigo: {
        attack1: {
            damage: 35,
            cooldown: 430,
            duration: 480,
            knockback: { x: 8, y: 0 },
            animation: 'attack1',
            range: 75, // Zanpakuto slash
            hitboxWidth: 45,
            hitboxHeight: 55
        },
        attack2: {
            damage: 50,
            cooldown: 600,
            duration: 640,
            knockback: { x: 10, y: 0 },
            animation: 'attack2',
            range: 95, // Wide slash
            hitboxWidth: 55,
            hitboxHeight: 65
        },
        basic: {
            damage: 25,
            cooldown: 1150,
            duration: 480,
            knockback: { x: 14, y: 0 },
            animation: 'attack_basic',
            range: 115, // Bankai slash
            hitboxWidth: 65,
            hitboxHeight: 75
        },
        special: {
            damage: 95,
            cooldown: 15000,
            duration: 600,
            knockback: { x: 28, y: 0 },
            animation: 'attack_special',
            range: 150, // Getsuga Tensho
            hitboxWidth: 85,
            hitboxHeight: 85
        },
        ultimate: {
            damage: 200,
            cooldown: 35000,
            duration: 720,
            knockback: { x: 55, y: 0 },
            animation: 'attack_ultimate',
            dashDistance: 400,
            range: 220, // Final Getsuga Tensho
            hitboxWidth: 115,
            hitboxHeight: 115
        }
    },

    rukia: {
        attack1: {
            damage: 38,
            cooldown: 430,
            duration: 480,
            knockback: { x: 8, y: 0 },
            animation: 'attack1',
            range: 58, // Ice sword slash
            hitboxWidth: 38,
            hitboxHeight: 48
        },
        attack2: {
            damage: 42,
            cooldown: 600,
            duration: 640,
            knockback: { x: 10, y: 0 },
            animation: 'attack2',
            range: 68, // Ice thrust
            hitboxWidth: 48,
            hitboxHeight: 58
        },
        basic: {
            damage: 28,
            cooldown: 1150,
            duration: 480,
            knockback: { x: 14, y: 0 },
            animation: 'attack_basic',
            range: 88, // Some no mai
            hitboxWidth: 58,
            hitboxHeight: 68
        },
        special: {
            damage: 90,
            cooldown: 15000,
            duration: 600,
            knockback: { x: 28, y: 0 },
            animation: 'attack_special',
            range: 125, // Ice wave
            hitboxWidth: 72,
            hitboxHeight: 72
        },
        ultimate: {
            damage: 220,
            cooldown: 35000,
            duration: 720,
            knockback: { x: 55, y: 0 },
            animation: 'attack_ultimate',
            dashDistance: 400,
            range: 170, // Hakka no Togame
            hitboxWidth: 98,
            hitboxHeight: 98
        }
    }
};

// ── frame-based scheduling constants ─────────────────────────────────
// mirrors the old magic-number hit-check window (elapsed >= 100ms && elapsed
// < duration - 100ms), just expressed in frames now. This is the SAME
// behavior as before, not a balance change - a real per-move
// startup/active/recovery authoring pass is build-order item 11 (section 6
// of the plan), not this step.
const STARTUP_WINDOW_MS = 100;

// ── Cancel Windows (build-order item 3 / spec section 3) ──────────────
// A cancel lets a player cut a move's RECOVERY short by chaining directly
// into a new attack instead of eating the full "attack, wait, attack, wait"
// loop. This replaces the placeholder mechanic step 0 had here (any hit-
// confirmed attack generically freed the attacker into anything, at a flat
// 55%-into-the-animation mark) - that was never a real cancel system, just
// a stand-in until this item existed. Now: only moves listed in
// CANCEL_TABLE are reachable, and only once the move has actually entered
// its recovery phase (reusing activeEndFrame - the same point
// ATTACK_RECOVERY already begins at - as the cancel window's start, rather
// than a separate arbitrary fraction).
//
// The table is intentionally the SAME for all four characters for now -
// real per-character cancel routes (which specials a given character's
// normals actually chain into) belong to the full per-move schema pass in
// item 11 (section 6 of the plan), not this item. The shape here (light ->
// heavier normals -> special -> ultimate) matches the spec's own example
// ("Light -> Heavy, or Heavy -> Special").
const CANCEL_TABLE = {};
function defineCancelTable(fromMove, allowedIntoMoves) {
    CANCEL_TABLE[fromMove] = allowedIntoMoves;
}
defineCancelTable('attack1', ['attack2', 'basic', 'special']);
defineCancelTable('attack2', ['basic', 'special']);
defineCancelTable('basic', ['special']);
defineCancelTable('special', ['ultimate']);
defineCancelTable('ultimate', []); // nothing to cancel a finisher into

// Build ATTACK_CONFIG with frame-converted fields, derived once at load time.
// durationFrames/cooldownFrames/startupFrames/activeEndFrame are what the
// rest of this file schedules against; the original ms fields are kept
// alongside for readability/debugging only.
const ATTACK_CONFIG = {};
for (const [characterId, moves] of Object.entries(ATTACK_CONFIG_MS)) {
    ATTACK_CONFIG[characterId] = {};
    for (const [moveId, config] of Object.entries(moves)) {
        const durationFrames = msToFrames(config.duration);
        const cooldownFrames = msToFrames(config.cooldown);
        const startupFrames = Math.min(msToFrames(STARTUP_WINDOW_MS), durationFrames - 1);
        // mirrors "elapsed < duration - 100ms" - the frame after which the
        // hit-check window closes and recovery begins
        const activeEndFrame = Math.max(startupFrames + 1, durationFrames - startupFrames);

        ATTACK_CONFIG[characterId][moveId] = {
            ...config,
            durationFrames,
            cooldownFrames,
            startupFrames,
            activeEndFrame,
            // cancel window = the recovery phase itself: [activeEndFrame, durationFrames)
            cancelWindowStartFrame: activeEndFrame,
            cancelableInto: CANCEL_TABLE[moveId] || [],
            // must hit-confirm to cancel - matches "producing a flowing
            // combo" framing (a reward for landing hits, not a free
            // block-string tool). cancelableOnBlock is wired through end to
            // end but left false everywhere this pass - no current move is
            // designed as a block-string starter yet.
            cancelableOnHit: true,
            cancelableOnBlock: false
        };
    }
}

// ── Combo system tuning ──────────────────────────────────────────────
// build-order item 2: freeze both characters briefly on a landed hit so the
// impact has a beat to register. Spec's stated range is 3-12 frames, but
// that read as too subtle to notice in actual play - bumped to 20 frames
// (~330ms) per playtesting feedback. This is a deliberate feel-over-spec-
// number deviation, not an oversight; worth remembering if a later item
// (16, Camera & Sound Feedback) re-derives per-hit-strength scaling off the
// spec's original range instead of this value.
const HITSTOP_DURATION_FRAMES = 12;

// ── Combo Scaling / Damage Decay (build-order item 5 / spec section 5) ─
// Tracks how many times the DEFENDER has been hit in an unbroken combo -
// the spec's incrementComboCount/resetComboCount both take `defender`, not
// `attacker`: the counter belongs to whoever's being juggled, and it resets
// by watching the DEFENDER's own state (leaving hitstun / dropping to
// neutral - see the resetComboCount call in gameState.js's hitstun-end
// handling), not an attacker-side whiff/window heuristic.
//
// This replaces the old attacker.combo/comboWindowEndFrame pair and
// getComboDamageMultiplier() that lived here before this item: those were
// attacker-scoped, time-window based (a since-removed COMBO_WINDOW_MS),
// and decayed 8% per hit to a 40% floor - none of which matches the spec's
// exact formula (10%-per-hit decay, 10% floor).
//
// Only a hit that actually connects (not blocked) increments the counter -
// blockstun isn't its own tracked state yet (that's item 8, Just Defend/
// Perfect Parry), so scoping combo decay to real hitstun avoids a
// defender's counter accumulating forever across a long block string that
// never drops them to neutral. See applyHit below.
const COMBO_DAMAGE_DECAY_PER_HIT = 0.1;
const COMBO_DAMAGE_FLOOR = 0.1;

function incrementComboCount(defender) {
    defender.comboCount = (defender.comboCount || 0) + 1;
}

function resetComboCount(defender) {
    defender.comboCount = 0;
}

// Actual Damage = Base Damage * Math.max(0.1, 1.0 - (comboCount * 0.1))
function calculateScaledDamage(baseDamage, comboCount) {
    const multiplier = Math.max(COMBO_DAMAGE_FLOOR, 1.0 - (comboCount * COMBO_DAMAGE_DECAY_PER_HIT));
    return baseDamage * multiplier;
}

// ── Hitstun Deterioration / Gravity Scaling (build-order item 6 / spec
// section 6) ────────────────────────────────────────────────────────────
// Two complementary decay levers, both keyed off the same defender.
// comboCount item 5 introduced: getScaledHitstun shortens a grounded
// victim's hitstun per hit (this is the old getComboStunFrames placeholder,
// renamed/reshaped to the spec's exact signature - same tuning numbers,
// just now takes its base as a parameter instead of a hardcoded module
// constant); getScaledGravity speeds up an airborne victim's fall per hit.
// Either one, carried far enough, eventually forces a "combo drop" - the
// victim recovers or lands before the attacker can follow up.
//
// checkComboDrop formalizes exactly the timing comparison that surfaced
// item 5's combo-length problem (see the note left in
// combat-system-refactor-plan.md section 6): it's a pure comparison of two
// already-known frame numbers - defender.stunEndFrame (when they recover)
// against attacker.earliestFollowUpFrame (set below in applyHit, from the
// current attack's cancel-window/duration data) - so it needs no extra
// "current frame" argument, matching the spec's 2-arg signature.
//
// NOTE on getScaledGravity: every move in ATTACK_CONFIG_MS currently has
// knockback.y === 0 (see attackSystem.js's ATTACK_CONFIG_MS block) - no
// attack launches anyone airborne yet, so this function is correctly wired
// (gameState.js's applyGravity calls it whenever a HITSTUN'd player isn't
// grounded) but has nothing to scale until some move's per-character data
// gets real vertical knockback. Hitstun-shortening is the lever actually in
// effect against current data.
const HITSTUN_DECAY_PER_HIT_MS = 25; // each hit after the 1st stuns this much less
const MIN_HITSTUN_MS = 120;          // hitstun never drops below this, so late-combo hits still connect
const HITSTUN_DECAY_PER_HIT_FRAMES = msToFrames(HITSTUN_DECAY_PER_HIT_MS);
const MIN_HITSTUN_FRAMES = msToFrames(MIN_HITSTUN_MS);
const BASE_HITSTUN_MS = 300;
const BASE_HITSTUN_FRAMES = msToFrames(BASE_HITSTUN_MS);

const GRAVITY_SCALE_PER_HIT = 0.15; // +15% downward accel per hit into the combo
const MAX_GRAVITY_SCALE = 2.5;      // cap so a very long combo doesn't slam a victim down instantly

function getScaledHitstun(baseHitstunFrames, comboCount) {
    const hitsIntoCombo = Math.max(0, comboCount - 1);
    return Math.max(baseHitstunFrames - hitsIntoCombo * HITSTUN_DECAY_PER_HIT_FRAMES, MIN_HITSTUN_FRAMES);
}

function getScaledGravity(baseGravity, comboCount) {
    const hitsIntoCombo = Math.max(0, comboCount - 1);
    const scale = Math.min(1 + hitsIntoCombo * GRAVITY_SCALE_PER_HIT, MAX_GRAVITY_SCALE);
    return baseGravity * scale;
}

function checkComboDrop(attacker, defender) {
    if (!defender.stunEndFrame || !attacker.earliestFollowUpFrame) {
        return false;
    }
    return attacker.earliestFollowUpFrame > defender.stunEndFrame;
}


// small shared helper so the two "give control back to the player" spots
// below (hit-confirm early release, and natural attack completion) clear the
// same fields the same way
function releaseAttackFields(player) {
    player.currentAttack = null;
}

class AttackHandler {
    constructor() {
        this.activeAttacks = new Map(); // Map<attackId, attackData>
        this.attackIdCounter = 0;
    }

    initiateAttack(gameState, player, attackType) {
        const characterAttacks = ATTACK_CONFIG[player.character];
        if (!characterAttacks) {
            return { success: false, reason: 'invalid_character' };
        }

        const attackConfig = characterAttacks[attackType];
        if (!attackConfig) {
            return { success: false, reason: 'invalid_attack' };
        }

        // Check cooldown (frame count now, not ms)
        if (player.cooldowns[attackType] > 0) {
            return { success: false, reason: 'cooldown' };
        }

        // Check if player can attack - delegated to the state machine instead
        // of inlining !isStunned/!isDead/!isAttacking here
        if (player.isDead || !canAttack(player.combatState)) {
            return { success: false, reason: 'disabled' };
        }

        const currentFrame = gameState.tickCount;

        // Set player state
        setCombatState(player, STATES.ATTACK_STARTUP, currentFrame);
        player.currentAttack = attackType;
        player.attackStartFrame = currentFrame;
        player.cooldowns[attackType] = attackConfig.cooldownFrames;

        // Create attack instance
        const attackId = `attack_${this.attackIdCounter++}`;
        player.currentAttackId = attackId;

        const attackData = {
            id: attackId,
            attackerId: player.socketId,
            type: attackType,
            config: attackConfig,
            startFrame: currentFrame,
            hasHit: false, // Single hit only
            wasBlocked: false,
            dashComplete: false
        };

        this.activeAttacks.set(attackId, attackData);

        console.log(`[AttackHandler] ${player.socketId} initiated ${attackType}`);

        return {
            success: true,
            attackId,
            duration: attackConfig.duration,
            animation: attackConfig.animation
        };
    }

    // ── Cancel Windows (build-order item 3) ────────────────────────────
    // checks whether attacker's CURRENT attack (attackData) is inside its
    // designated cancel window and whether requestedMove is one it's
    // legal to cancel into. Does not mutate anything - see executeCancel
    // for the actual interrupt.
    canCancel(attackData, requestedMove, currentFrame) {
        const config = attackData.config;

        if (!config.cancelableInto.includes(requestedMove)) {
            return false;
        }

        const elapsedFrames = currentFrame - attackData.startFrame;
        const inCancelWindow = elapsedFrames >= config.cancelWindowStartFrame && elapsedFrames < config.durationFrames;
        if (!inCancelWindow) {
            return false;
        }

        // must be confirmed by a hit or (if the move is ever configured for
        // it) a block - a whiffed move with cancelableOnBlock still false
        // for every move this pass gives no legal cancel at all
        const confirmedByHit = config.cancelableOnHit && attackData.hasHit;
        const confirmedByBlock = config.cancelableOnBlock && attackData.wasBlocked;
        return confirmedByHit || confirmedByBlock;
    }

    // interrupts the attacker's current move (attackData) and starts
    // requestedMove immediately, in place of riding out the rest of
    // recovery. The old instance is deleted outright rather than left to
    // finish quietly in the background - it's being CUT SHORT, not merely
    // "released from" - so there's nothing left over for updateAttacks to
    // process on a later tick.
    executeCancel(gameState, attacker, attackData, requestedMove) {
        this.activeAttacks.delete(attackData.id);
        if (attacker.currentAttackId === attackData.id) {
            attacker.currentAttackId = null;
        }

        // initiateAttack normally refuses while combatState is still an
        // attack_* state (that's exactly what stops a fresh, non-canceled
        // attack from interrupting another) - a cancel is the deliberate
        // exception to that rule, so clear combatState to IDLE first. The
        // cooldown check inside initiateAttack still applies normally: you
        // can't cancel into a move that's on cooldown.
        setCombatState(attacker, STATES.IDLE, gameState.tickCount);

        console.log(`[AttackHandler] ${attacker.socketId} canceled ${attackData.type} into ${requestedMove}`);
        return this.initiateAttack(gameState, attacker, requestedMove);
    }

    updateAttacks(gameState) {
        const currentFrame = gameState.tickCount;
        const attacksToRemove = [];

        for (const [attackId, attackData] of this.activeAttacks.entries()) {
            const attacker = gameState.players.find(p => p.socketId === attackData.attackerId);
            if (!attacker) {
                attacksToRemove.push(attackId);
                continue;
            }

            // hitstop: this attack's clock doesn't advance while its owner
            // is frozen - elapsedFrames is currentFrame-relative, so simply
            // not evaluating it this tick is all pausing requires
            if (isFrozen(attacker)) {
                continue;
            }

            const elapsedFrames = currentFrame - attackData.startFrame;
            const config = attackData.config;

            // sub-phase transitions - only move the attacker's combatState
            // if they still own this attack instance (a cancel hands
            // combatState to the new attack and deletes this instance
            // outright, so this guard is really just "have we already been
            // superseded by executeCancel this tick")
            if (attacker.currentAttackId === attackId) {
                if (elapsedFrames < config.startupFrames) {
                    setCombatState(attacker, STATES.ATTACK_STARTUP, attackData.startFrame);
                } else if (elapsedFrames < config.activeEndFrame) {
                    setCombatState(attacker, STATES.ATTACK_ACTIVE, attackData.startFrame + config.startupFrames);
                } else {
                    setCombatState(attacker, STATES.ATTACK_RECOVERY, attackData.startFrame + config.activeEndFrame);
                }
            }

            // Check for hit (only once per attack, during the active window)
            if (!attackData.hasHit && elapsedFrames >= config.startupFrames && elapsedFrames < config.activeEndFrame) {
                this.checkHit(gameState, attacker, attackData);
            }

            // Handle ultimate dash
            if (config.dashDistance && !attackData.dashComplete && elapsedFrames < config.durationFrames * 0.5) {
                this.handleUltimateDash(attacker, attackData, gameState);
            }

            // Check if attack is complete
            if (elapsedFrames >= config.durationFrames) {
                attacksToRemove.push(attackId);

                // Only clear the attacker's active-attack fields if they still point at THIS
                // instance - if a cancel already let them start a new attack, that newer
                // instance owns these fields now and must not be touched here.
                if (attacker.currentAttackId === attackId) {
                    setCombatState(attacker, STATES.IDLE, currentFrame);
                    releaseAttackFields(attacker);
                    attacker.currentAttackId = null;
                }

                // A whiffed attack no longer needs to touch any combo state
                // here (build-order item 5) - comboCount now lives on the
                // defender and resets when THEY leave hitstun/drop to
                // neutral (see gameState.js), not when the attacker's swing
                // happens to miss. The old attacker.combo reset that used to
                // live here is retired along with that field.

                console.log(`[AttackHandler] Attack ${attackId} completed`);
            }
        }

        // Clean up completed attacks
        attacksToRemove.forEach(id => this.activeAttacks.delete(id));
    }

    handleUltimateDash(attacker, attackData, gameState) {
        const dashDistance = attackData.config.dashDistance;
        const dashSpeed = 20; // Fixed dash speed (already per-tick displacement)
        const movement = dashSpeed * attacker.facing;

        const newX = attacker.position.x + movement;
        if (newX >= gameState.map.boundaries.left && newX <= gameState.map.boundaries.right) {
            attacker.position.x = newX;
        }

        // Mark dash as complete after moving the required distance
        const totalMoved = Math.abs(attacker.position.x - (attackData.startPos || attacker.position.x));
        if (!attackData.startPos) {
            attackData.startPos = attacker.position.x;
        } else if (totalMoved >= dashDistance) {
            attackData.dashComplete = true;
        }
    }

    checkHit(gameState, attacker, attackData) {
        const config = attackData.config;

        // Range-based and hitbox-based hit detection
        for (const target of gameState.players) {
            // Skip self and dead players
            if (target.socketId === attacker.socketId || target.isDead) continue;

            // Use attack-specific range and hitbox
            const attackRange = config.range || 50; // Use attack's range
            const attackHitboxWidth = config.hitboxWidth || 40;
            const attackHitboxHeight = config.hitboxHeight || 50;

            // Calculate effective hit range based on character sizes and attack hitbox
            const horizontalRange = (attacker.size.width / 2) + (target.size.width / 2) + attackRange;
            const verticalRange = Math.max(attackHitboxHeight, target.size.height);

            // Hurtbox interpolation (build-order item 4 / spec section 4):
            // sample the target along its path this tick (previousPosition
            // -> current position), not just where it landed, so a target
            // moving fast enough in one tick - chiefly the knockback/corner
            // -pushback this same item adds, but also dashes - can't skip
            // clean through an active hitbox it only briefly passed through
            // mid-tick. The t=1 sample is exactly the old static check, so
            // this is additive, not a behavior change for the normal case.
            const previousPosition = target.previousPosition || target.position;
            const samples = hitboxSystem.interpolateHurtbox(target, previousPosition, target.position);

            const hit = samples.some(sample => {
                const distanceX = Math.abs(attacker.position.x - sample.x);
                const distanceY = Math.abs(attacker.position.y - sample.y);
                const inFrontOfAttacker = (sample.x - attacker.position.x) * attacker.facing > 0;
                return inFrontOfAttacker && distanceX <= horizontalRange && distanceY <= verticalRange / 2;
            });

            if (hit) {
                this.applyHit(gameState, attacker, target, attackData);
                attackData.hasHit = true; // Mark as hit (single hit only)
                console.log(`[AttackHandler] Hit detected - Range: ${attackRange}, Hitbox: ${attackHitboxWidth}x${attackHitboxHeight}`);
                break; // Only hit one target
            }
        }
    }

    applyHit(gameState, attacker, target, attackData) {
        const config = attackData.config;
        const currentFrame = gameState.tickCount;

        // Damage + combo scaling (build-order item 5): a blocked hit deals
        // reduced flat damage and does NOT touch the combo counter (see the
        // comment above incrementComboCount for why); an unblocked hit
        // increments the defender's counter first, then scales off the
        // resulting count, so the first landed hit is comboCount=1.
        let damage;
        if (target.isBlocking) {
            damage = config.damage * 0.3;
        } else {
            incrementComboCount(target);
            damage = calculateScaledDamage(config.damage, target.comboCount);
        }
        target.health -= damage;
        target.damageReceived += damage;
        attackData.wasBlocked = target.isBlocking;

        // Impact freeze - both characters pause briefly so the hit has a
        // beat to register (build-order item 2). Applies whether or not the
        // target blocked; a lighter/shorter freeze specifically for blocked
        // hits is part of the parry/block work in item 8, not this one.
        triggerHitstop(attacker, HITSTOP_DURATION_FRAMES);
        triggerHitstop(target, HITSTOP_DURATION_FRAMES);

        // Apply knockback (reduced if blocking) - build-order item 4:
        // resolved through hitboxSystem.applyCornerPushback rather than a
        // flat velocity assignment, so a defender pinned against the wall
        // redirects the force onto the attacker instead of just stopping
        // dead (see hitboxSystem.js for the split/redirect logic).
        if (!target.isBlocking) {
            const knockbackDir = target.position.x > attacker.position.x ? 1 : -1;
            hitboxSystem.applyCornerPushback(attacker, target, {
                x: config.knockback.x * knockbackDir,
                y: config.knockback.y
            });

            // Apply hitstun, shortened as the combo goes on (build-order
            // item 6) so long chains eventually let the victim escape.
            setCombatState(target, STATES.HITSTUN, currentFrame);
            target.stunEndFrame = currentFrame + getScaledHitstun(BASE_HITSTUN_FRAMES, target.comboCount);

            // Earliest frame the attacker could realistically act again:
            // the cancel-window frame if this attack is cancelable on hit,
            // otherwise its natural completion. Feeds checkComboDrop, and
            // is also what item 5's combo-length investigation computed by
            // hand before this function existed (see the note in
            // combat-system-refactor-plan.md section 6).
            attacker.earliestFollowUpFrame = attacker.attackStartFrame +
                (config.cancelableOnHit ? config.cancelWindowStartFrame : config.durationFrames);

            if (checkComboDrop(attacker, target)) {
                console.log(`[AttackHandler] combo dropped - ${target.socketId} recovers at frame ${target.stunEndFrame}, ${attacker.socketId} can't follow up until frame ${attacker.earliestFollowUpFrame}`);
            }
        }

        // Check for death
        if (target.health <= 0) {
            target.health = 0;
            setCombatState(target, STATES.DEAD, currentFrame);
            attacker.killCount++;
        }

        // Update attacker stats
        attacker.damage += damage;

        const comboNote = target.isBlocking ? '(blocked)' : `(combo x${target.comboCount})`;
        console.log(`[AttackHandler] ${attacker.socketId} hit ${target.socketId} with ${attackData.type} for ${damage.toFixed(1)} damage ${comboNote}`);
    }

    clear() {
        this.activeAttacks.clear();
        this.attackIdCounter = 0;
    }
}

module.exports = { AttackHandler, ATTACK_CONFIG, msToFrames, FRAME_MS, TICK_RATE, incrementComboCount, resetComboCount, calculateScaledDamage, getScaledHitstun, getScaledGravity, checkComboDrop };