// server/core/stateMachine.js
//
// Step 0 of the combat refactor (see combat-system-refactor-plan.md, sections 2-3).
//
// This is the single source of truth for "what state is this player in" and
// "what's legal from that state" - replacing the old approach of testing a
// pile of independent booleans (isAttacking, isStunned, isDashing, ...) ad
// hoc all over gameState.js and attackSystem.js.
//
// SCOPE NOTE: this module only builds the state machine + frame-based
// scheduling. It intentionally does NOT yet:
//   - give sprite animation / audio their own hook into combatState directly
//     (sections 4-5 of the plan - still reading the legacy booleans this step)
//   - add the extended per-move attack schema / cancel tables (section 6,
//     item 3/11 of the build order)
//   - produce blockstun, knockdown, or wakeup (no mechanic emits these yet -
//     they're in the enum now so items 8 and 14 can wire into it later
//     without touching this file's shape again)
// Those all land in later, gated build-order items.

const STATES = Object.freeze({
    IDLE: 'idle',
    WALKING: 'walking',
    JUMPING: 'jumping',
    AIRBORNE: 'airborne',
    ATTACK_STARTUP: 'attack_startup',
    ATTACK_ACTIVE: 'attack_active',
    ATTACK_RECOVERY: 'attack_recovery',
    BLOCKSTUN: 'blockstun',
    HITSTUN: 'hitstun',
    KNOCKDOWN: 'knockdown',
    WAKEUP: 'wakeup',
    DASHING: 'dashing',
    DEAD: 'dead'
});

const ATTACK_STATES = new Set([STATES.ATTACK_STARTUP, STATES.ATTACK_ACTIVE, STATES.ATTACK_RECOVERY]);

// states where the player is non-actionable - either taking a hit, downed,
// or dead. None of BLOCKSTUN/KNOCKDOWN/WAKEUP are produced yet (see scope
// note above), but they're locked out here in advance so items 8/14 don't
// have to remember to come back and add them to this set.
const LOCKED_STATES = new Set([
    STATES.BLOCKSTUN,
    STATES.HITSTUN,
    STATES.KNOCKDOWN,
    STATES.WAKEUP,
    STATES.DEAD
]);

function isAttackState(state) {
    return ATTACK_STATES.has(state);
}

function isLocked(state) {
    return LOCKED_STATES.has(state);
}

// ── legal-action gates ───────────────────────────────────────────────
// Each of these mirrors exactly the condition that used to be inlined at
// each call site. Physics/resource gates that AREN'T about combat state
// (isGrounded, cooldown timers, velocity) stay the caller's responsibility -
// this module only answers "is the current combatState allowed to do X".

// mirrors old: !(isStunned || isAttacking)
function canMove(state) {
    return !isAttackState(state) && state !== STATES.HITSTUN && !isLocked(state);
}

// ── generic legality gate ────────────────────────────────────────────
// mirrors the function of the same name required by the input-buffering
// spec (section 1): "checks whether the character is currently in a state
// that allows a new action (not mid-recovery, not locked)". canJump/
// canAttack/canStartBlock below were already identical checks under
// different names, so they're now defined in terms of this one gate; only
// canDash adds anything on top (you can't dash-cancel a dash already in
// progress).
function canPerformAction(state) {
    return !isAttackState(state) && !isLocked(state);
}

// mirrors old: isGrounded && !isJumping && !isStunned && !isAttacking
// (isGrounded/isJumping are still checked by the caller)
function canJump(state) {
    return canPerformAction(state);
}

// mirrors old: !isStunned && !isDead && !isAttacking
function canAttack(state) {
    return canPerformAction(state);
}

// mirrors old: !isBlocking && !isAttacking && !isStunned
// (isBlocking is still checked by the caller - blocking isn't its own
// combatState, same as the spec's state list)
function canStartBlock(state) {
    return canPerformAction(state);
}

// mirrors old: !isDashing && !isAttacking && !isStunned && !isBlocking
// (cooldown/velocity/isBlocking still checked by the caller)
function canDash(state) {
    return canPerformAction(state) && state !== STATES.DASHING;
}

// ── transitions ──────────────────────────────────────────────────────

// legacy boolean flags are kept on the player object (attackSystem.js and
// the client payload in getClientGameState() both still read them this
// step) but they are now a MIRROR of combatState, written only from here -
// nothing else should assign isAttacking/isStunned/isDashing/isDead
// directly anymore.
function syncLegacyFlags(player) {
    const state = player.combatState;
    player.isAttacking = isAttackState(state);
    player.isStunned = state === STATES.HITSTUN;
    player.isDashing = state === STATES.DASHING;
    player.isDead = state === STATES.DEAD;
}

// the only place combatState is ever assigned. No-ops if already in that
// state so combatStateEnteredFrame doesn't reset on redundant calls.
function setCombatState(player, newState, currentFrame) {
    if (player.combatState === newState) {
        return;
    }
    player.combatState = newState;
    player.combatStateEnteredFrame = currentFrame;
    syncLegacyFlags(player);
}

function framesInState(player, currentFrame) {
    return currentFrame - (player.combatStateEnteredFrame || 0);
}

// Resolves the passive movement-classification states (idle/walking/
// jumping/airborne) for a player who isn't currently inside one of the
// event-driven states (attack_*, hitstun, dashing, dead, ...). Call once per
// tick per player, after physics has updated position/velocity/isGrounded
// for that tick.
function resolveMovementState(player, currentFrame) {
    if (isAttackState(player.combatState) || isLocked(player.combatState) || player.combatState === STATES.DASHING) {
        return; // these states own their own entry/exit transitions elsewhere
    }

    let next;
    if (!player.isGrounded) {
        next = player.velocity.y < 0 ? STATES.JUMPING : STATES.AIRBORNE;
    } else if (Math.abs(player.velocity.x) > 0.5) {
        next = STATES.WALKING;
    } else {
        next = STATES.IDLE;
    }

    setCombatState(player, next, currentFrame);
}

function createInitialCombatState() {
    return {
        combatState: STATES.IDLE,
        combatStateEnteredFrame: 0
    };
}

// ── Hitstop / Impact Freeze (build-order item 2 / spec section 2) ─────
// A short freeze (3-12 frames) applied to the two characters involved in a
// landed hit - no movement, animations paused, so the impact has a beat to
// register before combat resumes. This is deliberately kept SEPARATE from
// combatState above: a frozen player keeps whatever combatState they were
// already in (attack_active, hitstun, ...) - hitstop just pauses that
// state's advancement for a few frames on top of it, rather than being a
// state of its own. That also means it composes for free with everything
// already built: gameState.js's per-tick player loop and attackSystem.js's
// per-attack loop both just skip their own advancement while isFrozen() is
// true, so a frozen attack's internal clock (elapsedFrames) and a frozen
// player's hitstun/cooldown timers naturally pause rather than needing
// separate compensation logic.
function triggerHitstop(player, durationFrames) {
    // max, not add: if something ever triggers overlapping hitstop on the
    // same player in one window, that shouldn't stack freeze time
    player.hitstopFrames = Math.max(player.hitstopFrames || 0, durationFrames);
}

function updateHitstopTimer(player) {
    if (player.hitstopFrames > 0) {
        player.hitstopFrames -= 1;
    }
}

function isFrozen(player) {
    return (player.hitstopFrames || 0) > 0;
}

module.exports = {
    STATES,
    isAttackState,
    isLocked,
    canPerformAction,
    canMove,
    canJump,
    canAttack,
    canStartBlock,
    canDash,
    setCombatState,
    syncLegacyFlags,
    framesInState,
    resolveMovementState,
    createInitialCombatState,
    triggerHitstop,
    updateHitstopTimer,
    isFrozen
};
