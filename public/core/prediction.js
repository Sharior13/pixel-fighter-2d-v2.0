const GAME_CONFIG_CLIENT = {
    gravity: 0.5,
    dash: {
        speed: 6,
        duration: 200,
        cooldown: 1000
    }
};

// mirrors the player-vs-player collision block inside applyMovement() in gameState.js.
// Only pushes the predicted local player - the opponent's true post-collision position
// is authoritative and arrives via the server snapshot / interpolation, so we don't (and
// can't) predict it ourselves.
function resolvePlayerCollision(player, opponent, mapBoundaries) {
    if (!opponent || !opponent.position || !opponent.size) {
        return;
    }

    const dx = player.position.x - opponent.position.x;
    const combinedHalfWidth = (player.size.width + opponent.size.width) / 2;

    if (Math.abs(dx) >= combinedHalfWidth) {
        return;
    }

    const dy = player.position.y - opponent.position.y;
    const combinedHalfHeight = (player.size.height + opponent.size.height) / 2;

    if (Math.abs(dy) >= combinedHalfHeight) {
        return;
    }

    const overlapX = combinedHalfWidth - Math.abs(dx);
    if (dx > 0) {
        player.position.x += overlapX / 2;
    } else {
        player.position.x -= overlapX / 2;
    }

    if (mapBoundaries) {
        const leftBound = mapBoundaries.left + player.size.width / 2;
        const rightBound = mapBoundaries.right - player.size.width / 2;
        player.position.x = Math.max(leftBound, Math.min(rightBound, player.position.x));
    }
}

// apply a single input to a predicted player object, mutating it in place.
function applyInputToPredictedPlayer(player, input, mapBoundaries = null, opponent = null) {
    switch (input.type) {
        case 'move': {
            if (player.isStunned || player.isAttacking) {
                player.velocity.x = 0;
                break;
            }

            if (input.direction !== 0) {
                player.facing = input.direction;
            }
            player.currentDirection = input.direction;

            let speed = player.speed;
            if (player.isDashing) {
                speed = player.speed * GAME_CONFIG_CLIENT.dash.speed;
            } else if (player.isBlocking) {
                speed = 0;
            }

            player.velocity.x = input.direction * speed;
            player.position.x += player.velocity.x;

            resolvePlayerCollision(player, opponent, mapBoundaries);

            if (mapBoundaries) {
                const leftBound = mapBoundaries.left + player.size.width / 2;
                const rightBound = mapBoundaries.right - player.size.width / 2;
                player.position.x = Math.max(leftBound, Math.min(rightBound, player.position.x));
            }
            break;
        }

        case 'jump': {
            if (player.isGrounded && !player.isJumping && !player.isStunned && !player.isAttacking) {
                player.velocity.y = -player.jumpForce;
                player.isGrounded = false;
                player.isJumping = true;
            }
            break;
        }

        case 'dash': {
            const cannotDash = player.isDashing || player.isAttacking || player.isStunned ||
                player.dashCooldownTimer > 0 || player.isBlocking || player.velocity.x === 0;
            if (!cannotDash) {
                player.isDashing = true;
                player.dashTimer = GAME_CONFIG_CLIENT.dash.duration;
                player.dashCooldownTimer = GAME_CONFIG_CLIENT.dash.cooldown;
            }
            break;
        }

        case 'block': {
            if (input.activate) {
                if (!player.isBlocking && !player.isAttacking && !player.isStunned) {
                    player.isBlocking = true;
                }
            } else {
                player.isBlocking = false;
            }
            break;
        }

        case 'attack': {
            // predicted visual start only - damage/cooldowns/hit outcome are
            // never decided here, only by the server.
            if (!player.isAttacking && !player.isStunned) {
                player.isAttacking = true;
                player.currentAttack = input.ability;
            }
            break;
        }
    }
}

// mirrors applyGravity() in gameState.js
function applyGravityPredicted(player, groundY) {
    if (!player.isGrounded) {
        player.velocity.y += GAME_CONFIG_CLIENT.gravity;
        player.position.y += player.velocity.y;

        if (player.position.y >= groundY) {
            player.position.y = groundY;
            player.velocity.y = 0;
            player.isGrounded = true;
            player.isJumping = false;
        }
    }
}

// mirrors the dashTimer/dashCooldownTimer countdown block inside gameTick() in gameState.js.
// call once per predicted "tick" (fixed dt, matching the server's tickInterval) so dash
// state expires at the same predicted rate the server would expire it.
function tickTimers(player, deltaTime) {
    if (player.dashTimer > 0) {
        player.dashTimer -= deltaTime;
        if (player.dashTimer <= 0) {
            player.dashTimer = 0;
            player.isDashing = false;
        }
    }
    if (player.dashCooldownTimer > 0) {
        player.dashCooldownTimer -= deltaTime;
        if (player.dashCooldownTimer <= 0) {
            player.dashCooldownTimer = 0;
        }
    }
}

// Apply every input that belongs to ONE real tick, then advance gravity/timers exactly
// once. A single tick can carry multiple inputs (the client always sends a "move" input
// every tick, plus a "jump"/"dash"/"attack"/"block" input whenever those keys fire in that
// same tick) - gravity and timers must NOT be stepped once per input, only once per tick,
// or a jump/dash/attack/block tick ends up simulating double gravity for that timestep.
function simulateTick(player, inputs, mapBoundaries, groundY, deltaTime = 1000 / 60, opponent = null) {
    inputs.forEach(input => applyInputToPredictedPlayer(player, input, mapBoundaries, opponent));
    tickTimers(player, deltaTime);
    applyGravityPredicted(player, groundY);
}

export { GAME_CONFIG_CLIENT, applyInputToPredictedPlayer, applyGravityPredicted, tickTimers, simulateTick };