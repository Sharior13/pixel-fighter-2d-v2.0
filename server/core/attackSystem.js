const { STATES, setCombatState, canAttack } = require('./stateMachine.js');

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
// < duration - 100ms) and the old 55%-into-recovery hit-confirm release,
// just expressed in frames now. This is the SAME behavior as before, not a
// balance change - a real per-move startup/active/recovery authoring pass
// is build-order item 11 (section 6 of the plan), not this step.
const STARTUP_WINDOW_MS = 100;
const CANCEL_THRESHOLD = 0.55; // once a hit lands, attacker is freed at 55% into the animation

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
        const cancelReleaseFrame = Math.round(durationFrames * CANCEL_THRESHOLD);

        ATTACK_CONFIG[characterId][moveId] = {
            ...config,
            durationFrames,
            cooldownFrames,
            startupFrames,
            activeEndFrame,
            cancelReleaseFrame
        };
    }
}

// ── Combo system tuning ──────────────────────────────────────────────
const COMBO_WINDOW_MS = 500;     // time after a hit connects to land the next hit and keep the chain alive
const COMBO_WINDOW_FRAMES = msToFrames(COMBO_WINDOW_MS);
const MAX_COMBO_HITS = 8;        // multiplier and stun stop shrinking past this many hits
const DAMAGE_DECAY_PER_HIT = 0.08;  // each hit after the 1st deals 8% less damage
const MIN_DAMAGE_MULTIPLIER = 0.4;  // damage never scales below 40%
const BASE_HITSTUN_MS = 300;
const STUN_DECAY_PER_HIT = 25;   // each hit after the 1st stuns 25ms less
const MIN_HITSTUN_MS = 120;      // hitstun never drops below this, so late-combo hits still connect

function getComboDamageMultiplier(comboCount) {
    const hitsIntoCombo = Math.min(comboCount, MAX_COMBO_HITS) - 1;
    const multiplier = 1 - hitsIntoCombo * DAMAGE_DECAY_PER_HIT;
    return Math.max(multiplier, MIN_DAMAGE_MULTIPLIER);
}

// returns hitstun in FRAMES (formula itself is still authored/reasoned about
// in ms per the design doc - section 5/6 is about the decay formula, not the
// unit - the result is converted to frames once, here, for scheduling)
function getComboStunFrames(comboCount) {
    const hitsIntoCombo = Math.min(comboCount, MAX_COMBO_HITS) - 1;
    const stunMs = Math.max(BASE_HITSTUN_MS - hitsIntoCombo * STUN_DECAY_PER_HIT, MIN_HITSTUN_MS);
    return msToFrames(stunMs);
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
            dashComplete: false,
            recoveryReleased: false
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

    updateAttacks(gameState) {
        const currentFrame = gameState.tickCount;
        const attacksToRemove = [];

        for (const [attackId, attackData] of this.activeAttacks.entries()) {
            const attacker = gameState.players.find(p => p.socketId === attackData.attackerId);
            if (!attacker) {
                attacksToRemove.push(attackId);
                continue;
            }

            const elapsedFrames = currentFrame - attackData.startFrame;
            const config = attackData.config;

            // sub-phase transitions - only move the attacker's combatState if
            // they still own this attack instance (an early cancel may have
            // already handed combatState to a newer attack) AND haven't
            // already been hit-confirm released below. Without the
            // recoveryReleased guard, this block would re-force ATTACK_ACTIVE
            // back onto an attacker every tick after they'd already been
            // freed early - found while smoke-testing this rewrite (a hit
            // landing and releasing the attacker at ~55% caused their
            // combatState to flicker back to attack_active for the rest of
            // the animation instead of staying at idle).
            if (attacker.currentAttackId === attackId && !attackData.recoveryReleased) {
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

            // Hit-confirm cancel: once this attack has landed and we're far enough into
            // recovery, free the attacker to act again while this instance finishes quietly
            // in the background (dash/cleanup still run their course below).
            if (!attackData.recoveryReleased && attackData.hasHit && elapsedFrames >= config.cancelReleaseFrame) {
                attackData.recoveryReleased = true;
                if (attacker.currentAttackId === attackId) {
                    setCombatState(attacker, STATES.IDLE, currentFrame);
                    releaseAttackFields(attacker);
                }
            }

            // Check if attack is complete
            if (elapsedFrames >= config.durationFrames) {
                attacksToRemove.push(attackId);

                // Only clear the attacker's active-attack fields if they still point at THIS
                // instance - if an early cancel let them start a new attack already, that
                // newer instance owns these fields now and must not be touched here.
                if (attacker.currentAttackId === attackId) {
                    setCombatState(attacker, STATES.IDLE, currentFrame);
                    releaseAttackFields(attacker);
                    attacker.currentAttackId = null;
                }

                // A whiffed attack breaks the combo chain
                if (!attackData.hasHit) {
                    attacker.combo = 0;
                    attacker.comboWindowEndFrame = 0;
                }

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

            // Calculate distance between players
            const distanceX = Math.abs(attacker.position.x - target.position.x);
            const distanceY = Math.abs(attacker.position.y - target.position.y);

            // Check if target is in front of attacker
            const inFrontOfAttacker = (target.position.x - attacker.position.x) * attacker.facing > 0;

            // Use attack-specific range and hitbox
            const attackRange = config.range || 50; // Use attack's range
            const attackHitboxWidth = config.hitboxWidth || 40;
            const attackHitboxHeight = config.hitboxHeight || 50;

            // Calculate effective hit range based on character sizes and attack hitbox
            const horizontalRange = (attacker.size.width / 2) + (target.size.width / 2) + attackRange;
            const verticalRange = Math.max(attackHitboxHeight, target.size.height);

            // Check if target is within attack range and hitbox
            if (inFrontOfAttacker && distanceX <= horizontalRange && distanceY <= verticalRange / 2) {
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

        // Continue the combo if we're still inside the window from the attacker's last hit,
        // otherwise this hit starts a fresh combo at count 1.
        const isComboContinuation = attacker.comboWindowEndFrame && currentFrame <= attacker.comboWindowEndFrame;
        attacker.combo = isComboContinuation ? attacker.combo + 1 : 1;
        attacker.comboWindowEndFrame = currentFrame + COMBO_WINDOW_FRAMES;

        const comboMultiplier = getComboDamageMultiplier(attacker.combo);

        // Apply damage (reduced if blocking, then scaled by combo decay)
        const baseDamage = target.isBlocking ? config.damage * 0.3 : config.damage;
        const damage = baseDamage * comboMultiplier;
        target.health -= damage;
        target.damageReceived += damage;

        // Apply knockback (reduced if blocking)
        if (!target.isBlocking) {
            const knockbackDir = target.position.x > attacker.position.x ? 1 : -1;
            target.velocity.x = config.knockback.x * knockbackDir;

            if (config.knockback.y > 0) {
                target.velocity.y = -Math.abs(config.knockback.y);
                target.isGrounded = false;
            }

            // Apply hitstun, shortened as the combo goes on so long chains eventually let the victim escape
            setCombatState(target, STATES.HITSTUN, currentFrame);
            target.stunEndFrame = currentFrame + getComboStunFrames(attacker.combo);
        }

        // Getting hit ends whatever combo the target was building
        target.combo = 0;
        target.comboWindowEndFrame = 0;

        // Check for death
        if (target.health <= 0) {
            target.health = 0;
            setCombatState(target, STATES.DEAD, currentFrame);
            attacker.killCount++;
            attacker.combo = 0;
            attacker.comboWindowEndFrame = 0;
        }

        // Update attacker stats
        attacker.damage += damage;

        console.log(`[AttackHandler] ${attacker.socketId} hit ${target.socketId} with ${attackData.type} for ${damage.toFixed(1)} damage (combo x${attacker.combo}, ${(comboMultiplier * 100).toFixed(0)}% dmg)`);
    }

    clear() {
        this.activeAttacks.clear();
        this.attackIdCounter = 0;
    }
}

module.exports = { AttackHandler, ATTACK_CONFIG, msToFrames, FRAME_MS, TICK_RATE };
