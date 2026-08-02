const ATTACK_CONFIG = {
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
    },
};

// ── Combo system tuning ──────────────────────────────────────────────
const COMBO_WINDOW_MS = 500;     // time after a hit connects to land the next hit and keep the chain alive
const MAX_COMBO_HITS = 8;        // multiplier and stun stop shrinking past this many hits
const DAMAGE_DECAY_PER_HIT = 0.08;  // each hit after the 1st deals 8% less damage
const MIN_DAMAGE_MULTIPLIER = 0.4;  // damage never scales below 40%
const BASE_HITSTUN_MS = 300;
const STUN_DECAY_PER_HIT = 25;   // each hit after the 1st stuns 25ms less
const MIN_HITSTUN_MS = 120;      // hitstun never drops below this, so late-combo hits still connect
const CANCEL_THRESHOLD = 0.55;   // once a hit lands, the attacker is freed at 55% into the animation instead of waiting for the full duration

function getComboDamageMultiplier(comboCount) {
    const hitsIntoCombo = Math.min(comboCount, MAX_COMBO_HITS) - 1;
    const multiplier = 1 - hitsIntoCombo * DAMAGE_DECAY_PER_HIT;
    return Math.max(multiplier, MIN_DAMAGE_MULTIPLIER);
}

function getComboStunDuration(comboCount) {
    const hitsIntoCombo = Math.min(comboCount, MAX_COMBO_HITS) - 1;
    const stun = BASE_HITSTUN_MS - hitsIntoCombo * STUN_DECAY_PER_HIT;
    return Math.max(stun, MIN_HITSTUN_MS);
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
        
        // Check cooldown
        if (player.cooldowns[attackType] > 0) {
            return { success: false, reason: 'cooldown' };
        }
        
        // Check if player can attack
        if (player.isStunned || player.isDead || player.isAttacking) {
            return { success: false, reason: 'disabled' };
        }
        
        // Set player state
        player.isAttacking = true;
        player.currentAttack = attackType;
        player.attackStartTime = Date.now();
        player.cooldowns[attackType] = attackConfig.cooldown;
        
        // Create attack instance
        const attackId = `attack_${this.attackIdCounter++}`;
        player.currentAttackId = attackId;

        const attackData = {
            id: attackId,
            attackerId: player.socketId,
            type: attackType,
            config: attackConfig,
            startTime: Date.now(),
            hasHit: false, // Single hit only
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
    
    updateAttacks(gameState, deltaTime) {
        const attacksToRemove = [];
        
        for (const [attackId, attackData] of this.activeAttacks.entries()) {
            const attacker = gameState.players.find(p => p.socketId === attackData.attackerId);
            if (!attacker) {
                attacksToRemove.push(attackId);
                continue;
            }
            
            const elapsed = Date.now() - attackData.startTime;
            
            // Check for hit (only once per attack)
            if (!attackData.hasHit && elapsed >= 100 && elapsed < attackData.config.duration - 100) {
                this.checkHit(gameState, attacker, attackData);
            }

            // Handle ultimate dash
            if (attackData.config.dashDistance && !attackData.dashComplete && elapsed < attackData.config.duration * 0.5) {
                this.handleUltimateDash(attacker, attackData, deltaTime, gameState);
            }

            // Hit-confirm cancel: once this attack has landed and we're far enough into
            // recovery, free the attacker to act again while this instance finishes quietly
            // in the background (dash/cleanup still run their course below).
            if (!attackData.recoveryReleased && attackData.hasHit &&
                elapsed >= attackData.config.duration * CANCEL_THRESHOLD) {
                attackData.recoveryReleased = true;
                if (attacker.currentAttackId === attackId) {
                    attacker.isAttacking = false;
                    attacker.currentAttack = null;
                }
            }
            
            // Check if attack is complete
            if (elapsed >= attackData.config.duration) {
                attacksToRemove.push(attackId);

                // Only clear the attacker's active-attack fields if they still point at THIS
                // instance — if an early cancel let them start a new attack already, that
                // newer instance owns these fields now and must not be touched here.
                if (attacker.currentAttackId === attackId) {
                    attacker.isAttacking = false;
                    attacker.currentAttack = null;
                    attacker.currentAttackId = null;
                }

                // A whiffed attack breaks the combo chain
                if (!attackData.hasHit) {
                    attacker.combo = 0;
                    attacker.comboWindowEnd = 0;
                }

                console.log(`[AttackHandler] Attack ${attackId} completed`);
            }
        }
        
        // Clean up completed attacks
        attacksToRemove.forEach(id => this.activeAttacks.delete(id));
    }
    
    handleUltimateDash(attacker, attackData, deltaTime, gameState) {
        const dashDistance = attackData.config.dashDistance;
        const dashSpeed = 20; // Fixed dash speed
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
        const now = Date.now();

        // Continue the combo if we're still inside the window from the attacker's last hit,
        // otherwise this hit starts a fresh combo at count 1.
        const isComboContinuation = attacker.comboWindowEnd && now <= attacker.comboWindowEnd;
        attacker.combo = isComboContinuation ? attacker.combo + 1 : 1;
        attacker.comboWindowEnd = now + COMBO_WINDOW_MS;

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
            target.isStunned = true;
            target.stunEndTime = now + getComboStunDuration(attacker.combo);
        }

        // Getting hit ends whatever combo the target was building
        target.combo = 0;
        target.comboWindowEnd = 0;
        
        // Check for death
        if (target.health <= 0) {
            target.health = 0;
            target.isDead = true;
            attacker.killCount++;
            attacker.combo = 0;
            attacker.comboWindowEnd = 0;
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

module.exports = { AttackHandler, ATTACK_CONFIG };