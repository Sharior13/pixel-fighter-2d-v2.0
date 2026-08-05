// server/core/hitboxSystem.js
//
// Build-order item 4 (spec section 4): Hurtbox Interpolation & Corner
// Pushing. New file per the refactor plan's file-structure section (section
// 8) - this module also picks up pushbox overlap/separation (build-order
// item 9 / spec section 9) when that item is built; for now it only covers
// section 4.

// intermediate points sampled between a frame's start/end position, in
// addition to both endpoints themselves
const SWEEP_SAMPLES = 4;

// Returns intermediate hurtbox rects for `entity` between previousPosition
// and currentPosition (inclusive of both ends). Without this, an entity
// that moves further in a single tick than its own width - heavy knockback,
// a dash, an ultimate's dash-in - could pass clean through a hitbox it
// never overlapped at either the start-of-tick or end-of-tick position.
// Sampling points along the path closes that gap.
function interpolateHurtbox(entity, previousPosition, currentPosition) {
    const samples = [];
    for (let i = 0; i <= SWEEP_SAMPLES; i++) {
        const t = i / SWEEP_SAMPLES;
        samples.push({
            x: previousPosition.x + (currentPosition.x - previousPosition.x) * t,
            y: previousPosition.y + (currentPosition.y - previousPosition.y) * t,
            width: entity.size.width,
            height: entity.size.height
        });
    }
    return samples;
}

// Axis-aligned overlap test for the center-anchored {x, y, width, height}
// rect shape interpolateHurtbox produces. Shared by the sweep check below.
function boxesOverlap(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return dx <= (a.width + b.width) / 2 && dy <= (a.height + b.height) / 2;
}

// Sweeps `entity` along its last tick's path (previousPosition ->
// currentPosition) and reports whether it overlapped `hitbox` (a static
// {x, y, width, height} rect) at any sampled point along the way - not just
// at the final position.
function hurtboxSweptOverlap(entity, previousPosition, currentPosition, hitbox) {
    return interpolateHurtbox(entity, previousPosition, currentPosition)
        .some(sample => boxesOverlap(sample, hitbox));
}

// Flags whether `entity`'s back is against the stage boundary, per side -
// i.e. there's no more room on that side for a corner pushback to move it
// any further. Returns {left, right} rather than a single bool since which
// side matters depends on which direction a given knockback pushes.
function isAtScreenWall(entity, stageBounds) {
    const halfWidth = entity.size.width / 2;
    return {
        left: entity.position.x - halfWidth <= stageBounds.left,
        right: entity.position.x + halfWidth >= stageBounds.right
    };
}

// Normal split: defender takes the full knockback, attacker gets a smaller
// recoil in the opposite direction (hitting something pushes you back too).
const ATTACKER_RECOIL_FRACTION = 0.25;

// Resolves a landed hit's knockback into velocity for both characters.
// Normally splits it per ATTACKER_RECOIL_FRACTION above. If the defender is
// pinned against the wall on the side this knockback would push them toward
// (defender.isAtWall, refreshed every tick from isAtScreenWall above), none
// of the force can move them any further, so 100% of it redirects into
// pushing the attacker away instead.
function applyCornerPushback(attacker, defender, knockbackForce) {
    const pushDir = knockbackForce.x >= 0 ? 1 : -1;
    const wall = defender.isAtWall || { left: false, right: false };
    const defenderPinned = (pushDir > 0 && wall.right) || (pushDir < 0 && wall.left);

    if (defenderPinned) {
        defender.velocity.x = 0;
        attacker.velocity.x = -pushDir * Math.abs(knockbackForce.x);
    } else {
        defender.velocity.x = knockbackForce.x;
        attacker.velocity.x = -pushDir * Math.abs(knockbackForce.x) * ATTACKER_RECOIL_FRACTION;
    }

    if (knockbackForce.y > 0) {
        defender.velocity.y = -Math.abs(knockbackForce.y);
        defender.isGrounded = false;
    }
}

module.exports = {
    interpolateHurtbox,
    boxesOverlap,
    hurtboxSweptOverlap,
    isAtScreenWall,
    applyCornerPushback
};
