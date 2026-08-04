import { debugLog } from "./debug.js";
// ============================================================================
// BOT CONTROLLER - client-side FSM "brain" for the AI opponent
// ============================================================================
// This is the only place bot *decision-making* lives. All match rules -
// physics, hit detection, cooldowns, HP - stay 100% server-authoritative
// (see server/core/gameState.js). This module just:
//   1. looks at the same gameStateUpdate broadcast render.js uses to draw
//      the opponent,
//   2. runs a small finite-state machine to decide what a player holding a
//      controller would probably do next, and
//   3. sends that decision to the server as ordinary input messages, over a
//      separate "botInput" socket event tagged with the bot's virtual
//      socketId (see server/matchmaking/matchMaking.js::createBotMatch and
//      server/networking/socketHandler.js's "botInput" handler).
//
// From the human player's point of view they're just fighting an opponent
// that took a little while to find - nothing here is ever surfaced in the
// UI, and the input schema/cadence matches what a real client sends in
// public/core/socket.js::processInputs() exactly, tick for tick.
// ============================================================================

// ---- DIFFICULTY TUNING ----------------------------------------------------
// Every knob the FSM uses to decide *when*/*how well* to act lives in this
// one object. To add a difficulty selector later, turn this into a lookup
// keyed by a chosen level (e.g. DIFFICULTY_PRESETS.easy / .normal / .hard)
// and swap the reference in initBotForMatch() - nothing else in this file
// needs to change.
//
// Currently set to MAX difficulty: near-instant reactions, near-perfect
// blocking, no hesitation on openings, tight range judgment, and ability
// choices that favor whatever actually does the most damage rather than
// spamming the cheap stuff. It still isn't literally frame-perfect/omniscient
// (small reaction window, a short match-start settling-in beat, occasional
// dash/jump mixups) so it doesn't feel like it's reading inputs directly.
const DIFFICULTY = {
    // How long (ms) the bot "thinks" before re-evaluating the fight. Even at
    // max difficulty this stays non-zero (real net/render latency plus a
    // sliver of "human" reaction time), it's just much tighter than average.
    reactionTimeMs: [40, 90],

    // Grace period (ms) at the very start of a match before the bot will
    // throw its first attack or block. Kept short rather than instant so
    // the very first exchange doesn't feel like it's reading the spawn
    // event - see public/core/socket.js's "matchBegin" handler.
    initialActionDelayMs: [150, 350],

    // Preferred spacing in pixels, roughly matched to the ~60-250px attack
    // ranges in server/core/attackSystem.js. Tightened vs. average play -
    // a skilled player holds closer, more aggressive spacing.
    preferredRange: { min: 60, max: 130 },

    // Chance [0-1] the bot actually swings when it's decided "I could
    // attack right now". Maxed out - it never lets a real opening go by.
    attackFollowThrough: 1.0,

    // Chance [0-1] the bot reacts to a nearby incoming attack by blocking.
    // Near-perfect, not literally 1.0 so it doesn't read as omniscient.
    blockChance: 0.95,

    // Below this health ratio (0-1), the bot starts playing more cautiously.
    // Skilled players actually play defense well when behind, so both the
    // threshold and the follow-through chance are higher than average play.
    retreatHealthRatio: 0.3,
    retreatChance: 0.85,

    // Chance [0-1] of backing off a step instead of attacking when the
    // opponent gets in too close. Low at max difficulty - a skilled player
    // just keeps attacking rather than giving up the space.
    tooCloseBackoffChance: 0.1,

    // Relative weights for which ability to throw out when attacking.
    // Average play leans on cheap/fast attacks and rarely risks the big
    // cooldowns; max difficulty weighs all of them more evenly so cooldown
    // abilities actually get used once they're up, not just the jab.
    abilityWeights: { basic: 3, attack1: 3, attack2: 3, special: 3, ultimate: 2 },

    // How much slack (px) beyond an ability's real range the bot allows
    // when judging whether a swing is worth it. Average play has generous
    // slack (misjudges range); max difficulty judges it almost exactly.
    rangeMisjudgeSlackPx: 4,

    // Small per-decision chance to mix in a jump or dash instead of the
    // "obvious" move. Dash gets used more at max difficulty (closing gaps/
    // repositioning efficiently); jump stays low so it doesn't look erratic.
    jumpMixupChance: 0.06,
    dashMixupChance: 0.18,
};

// Approximate ability ranges, mirrored (not shared - the server never trusts
// this) from server/core/attackSystem.js just so the bot can *guess*
// whether an attack is worth throwing out. The server is still the sole
// authority on whether a hit lands or an ability is off cooldown, so an
// inaccurate guess here just means the bot occasionally whiffs or hesitates
// - which, for "play like an average player", is a feature, not a bug.
const ABILITY_RANGE = { basic: 70, attack1: 90, attack2: 95, special: 130, ultimate: 200 };
const ABILITY_IDS = Object.keys(ABILITY_RANGE);

// preferredRange.max above was tuned independently of these per-ability
// ranges and ended up wider than the short moves (basic/attack1/attack2)
// can actually reach. In practice that meant the bot would treat ~125px as
// "in position, stop approaching" - but at that distance only
// special/ultimate are close enough to be legal candidates in pickAbility,
// so it kept reattacking with whichever of those was off cooldown instead
// of its normal fast string, i.e. attacking roughly once per special's
// ~10s cooldown. Clamp the spacing target down to the shortest ability's
// reach (plus the same slack pickAbility itself allows) so every ability
// is always a legal candidate once the bot considers itself "in range" -
// derived from ABILITY_RANGE rather than a second hardcoded number so the
// two can't drift out of sync again.
const MIN_ABILITY_RANGE = Math.min(...Object.values(ABILITY_RANGE));
DIFFICULTY.preferredRange.max = Math.min(DIFFICULTY.preferredRange.max, MIN_ABILITY_RANGE + 10);

// Mirrors server/core/attackSystem.js's CANCEL_TABLE. This is the actual
// combo system: once a hit lands, the server lets you cut recovery short
// by chaining directly into one of these follow-ups instead of riding out
// "attack, wait, attack, wait". The bot needs this list (and the fact that
// it's a *time-critical* window) to ever combo on purpose instead of by luck.
const CANCEL_TABLE = {
    attack1: ["attack2", "basic", "special"],
    attack2: ["basic", "special"],
    basic: ["special"],
    special: ["ultimate"],
    ultimate: [],
};

// The server's cancel window is only open for roughly the last ~100ms of a
// move's animation, and an early input only survives in its action buffer
// for ACTION_BUFFER_WINDOW_FRAMES (5 frames / ~83ms - see gameState.js)
// before being dropped. The normal reactionTimeMs cadence (40-90ms) is too
// coarse and too randomized to reliably land inside a window that small, so
// once a hit is confirmed the bot switches to polling every tick (TICK_MS,
// defined below) instead of waiting for its next scheduled "decision".

// How long to keep chasing a cancel after a hit is confirmed before giving
// up and returning control to the normal FSM. Generous relative to the real
// ~100-200ms window (we don't mirror exact per-character frame data - see
// ABILITY_RANGE's note above), but capped: without this, chasing overrides
// the FSM for the attack's ENTIRE remaining duration (up to ~1200ms for
// heavier moves) even long after the real window has closed, leaving the
// bot unresponsive - no movement, no blocking, no new attacks - for far
// longer than the combo itself could ever need.
const COMBO_CHASE_MAX_MS = 220;

// Set true to log combo-chase attempts to the console - useful for
// confirming cancels are actually being attempted/landing.
const DEBUG_COMBO = false;

// Set true to log which FSM branch decide() takes (throttled to only log
// when the outcome changes) - useful for seeing why the bot isn't
// attacking as much as expected in a given situation.
const DEBUG_FSM = false;

const TICK_MS = 1000 / 60; // match the real client's input cadence (see socket.js)

// ---- FSM states -------------------------------------------------------
const STATE = {
    APPROACH: "APPROACH",
    NEUTRAL: "NEUTRAL",
    ATTACK: "ATTACK",
    RETREAT: "RETREAT",
    BLOCK: "BLOCK",
};

// ---- module state -------------------------------------------------------
let socketRef = null;
let botSocketId = null; // the bot's virtual socketId in gameState.players
let humanId = null;     // the real player's socket.id (the bot's "opponent")
let latestState = null; // most recent gameStateUpdate payload
let tickHandle = null;
let inputSeq = 0;

let fsmState = STATE.NEUTRAL;
let moveDirection = 0;
let blockActive = false;
let nextDecisionAt = 0;
let matchStartAt = 0;      // performance.now() timestamp of initBotForMatch()
let actionDelayMs = 0;     // this match's randomized "settling in" window

// -- combo-chase tracking --------------------------------------------------
// lastSeenAttack: the ability name we last saw in bot.currentAttack. When
// this changes we know a new attack instance started (fresh swing, or a
// cancel just fired into the next move) - either way, whatever hit-confirm
// we were tracking belongs to a *different* attack now.
let lastSeenAttack = null;
// combo count observed at the moment lastSeenAttack was set - if
// bot.combo has climbed past this while lastSeenAttack is still current,
// the current attack instance landed a hit and is a legal cancel source.
let attackStartCombo = 0;
// performance.now() timestamp when the current chase started, or 0 if
// we're not currently chasing a cancel.
let comboChaseStartedAt = 0;

// Start running the bot for the current match. `socket` is the human's
// live socket.io connection (used only to emit "botInput" - the bot has no
// connection of its own), `opponentSocketId` is the bot's own socketId in
// gameState.players (i.e. NOT the human's).
const initBotForMatch = (socket, opponentSocketId) => {
    stopBot();

    socketRef = socket;
    botSocketId = opponentSocketId;
    humanId = socket.id;
    latestState = null;
    inputSeq = 0;

    fsmState = STATE.NEUTRAL;
    moveDirection = 0;
    blockActive = false;
    nextDecisionAt = 0;
    matchStartAt = performance.now();
    actionDelayMs = randRange(DIFFICULTY.initialActionDelayMs);
    lastSeenAttack = null;
    attackStartCombo = 0;
    comboChaseStartedAt = 0;

    tickHandle = setInterval(tick, TICK_MS);
};

// Stop the bot loop (call on match end / cleanup / rematch).
const stopBot = () => {
    if (tickHandle) {
        clearInterval(tickHandle);
        tickHandle = null;
    }
    socketRef = null;
    botSocketId = null;
    humanId = null;
    latestState = null;
};

// Feed the bot the latest authoritative state (called from socket.js's
// "gameStateUpdate" handler, right alongside updateGameState()).
const feedBotGameState = (state) => {
    latestState = state;
};

// ---- main loop ------------------------------------------------------------
function tick() {
    if (!socketRef || !botSocketId || !latestState) {
        return;
    }

    const bot = latestState.players.find(p => p.socketId === botSocketId);
    const opponent = latestState.players.find(p => p.socketId === humanId);
    if (!bot || !opponent) {
        return;
    }

    const now = performance.now();
    const triggers = []; // one-shot actions (jump/dash/attack/block) decided this tick

    // Track attack-instance identity every tick, independent of the
    // reaction-timer cadence below, so a hit confirm is never missed just
    // because it happened between two scheduled decisions.
    if (bot.currentAttack !== lastSeenAttack) {
        lastSeenAttack = bot.currentAttack;
        attackStartCombo = bot.combo || 0;
        comboChaseStartedAt = 0;
    }
    const hitConfirmedThisAttack =
        bot.isAttacking && bot.currentAttack && (bot.combo || 0) > attackStartCombo;
    const canChase = hitConfirmedThisAttack && (CANCEL_TABLE[bot.currentAttack] || []).length > 0;

    if (bot.isDead || opponent.isDead || bot.state !== "active" || bot.isStunned) {
        // can't or shouldn't act (dead, match over, or mid-hitstun) - just
        // stop moving, same as a real player's held keys being ignored by
        // the server while stunned.
        moveDirection = 0;
    } else if (canChase && now - (comboChaseStartedAt || now) <= COMBO_CHASE_MAX_MS) {
        // COMBO CHASE: our current attack already landed and it has legal
        // cancel targets, and we're still within the bounded chase window.
        // This overrides the normal FSM for this tick - no spacing/retreat/
        // approach re-evaluation, since knockback from the hit we just
        // landed would otherwise immediately read as "opponent left
        // preferred range" and send the bot back into APPROACH instead of
        // finishing the combo. Poll every tick (not the slow reaction
        // timer) since the real cancel window + input buffer together only
        // stay open for a very short, precise moment - see COMBO_CHASE_MAX_MS.
        if (!comboChaseStartedAt) {
            comboChaseStartedAt = now;
            if (DEBUG_COMBO) {
                debugLog(`[bot] combo chase started: confirmed hit with ${bot.currentAttack} (combo x${bot.combo})`);
            }
        }
        const followup = pickCancelFollowup(bot);
        if (followup) {
            if (DEBUG_COMBO) {
                debugLog(`[bot] attempting cancel ${bot.currentAttack} -> ${followup}`);
            }
            triggers.push({ type: "attack", ability: followup });
        }
        // leave nextDecisionAt alone - normal decision cadence resumes
        // on its own the instant this attack instance ends or the chase
        // window below expires
    } else if (bot.isAttacking) {
        // Mid our own attack with nothing left to chase (still in
        // startup/active, landed but the chase window above expired, or
        // nothing cancelable is off cooldown). The server won't act on
        // movement or a fresh attack input anywhere in this window -
        // canMove/canAttack both require a non-attack combatState (see
        // stateMachine.js's canPerformAction, and applyMovement's early
        // return in gameState.js which skips the facing update entirely
        // when canMove is false). Evaluating the FSM here - in particular
        // decide()'s "turn to face" branch - can therefore only fail
        // silently and burn a reaction cycle doing nothing. Skip deciding
        // entirely; nextDecisionAt is left as-is (likely already past due)
        // so the very next tick we're free, decide() runs immediately with
        // fresh position/facing data instead of waiting out a stale timer.
        if (DEBUG_COMBO && comboChaseStartedAt) {
            debugLog(`[bot] combo chase window closed on ${bot.currentAttack}, riding out recovery`);
            comboChaseStartedAt = 0;
        }
        moveDirection = 0;
    } else if (now >= nextDecisionAt) {
        decide(bot, opponent, triggers, now);
        nextDecisionAt = now + randRange(DIFFICULTY.reactionTimeMs);
    }

    // Movement has to be sent every tick to keep going (see the note in
    // socket.js/gameState.js: each "move" input is a one-time position
    // delta, not a held/persistent state), exactly like a real client
    // holding a direction key.
    const batch = [{ type: "move", direction: moveDirection }, ...triggers];
    sendInputs(batch);
}

// ---- decision-making (the actual "FSM") -----------------------------------
let lastLoggedReason = null; // throttle: only log when the outcome actually changes

function logDecision(reason, bot, dist) {
    if (!DEBUG_FSM || reason === lastLoggedReason) {
        return;
    }
    lastLoggedReason = reason;
    debugLog(
        `[bot] ${reason} | dist=${dist.toFixed(0)} facing=${bot.facing} hp=${(bot.health / (bot.maxHealth || 1) * 100).toFixed(0)}% ` +
        `cooldowns=${JSON.stringify(bot.cooldowns)}`
    );
}

function decide(bot, opponent, triggers, now) {
    const dx = opponent.position.x - bot.position.x;
    const dist = Math.abs(dx);
    const dirToOpponent = dx >= 0 ? 1 : -1;

    // still "settling in" at the start of the match - allowed to move/space
    // itself normally below, but not to attack or block yet.
    const settledIn = (now - matchStartAt) >= actionDelayMs;

    // -- BLOCK: opponent is mid-swing and close enough that it might matter
    // (blocking doesn't require facing them - see the note above pickAbility)
    if (settledIn && opponent.isAttacking && dist < DIFFICULTY.preferredRange.max + 40) {
        if (Math.random() < DIFFICULTY.blockChance) {
            fsmState = STATE.BLOCK;
            moveDirection = 0;
            if (!blockActive) {
                triggers.push({ type: "block", activate: true });
                blockActive = true;
            }
            logDecision("BLOCK", bot, dist);
            return;
        }
    }

    if (blockActive) {
        triggers.push({ type: "block", activate: false });
        blockActive = false;
    }

    // -- RETREAT: low health and opponent is close - play it safer
    const healthRatio = bot.health / (bot.maxHealth || 1);
    if (healthRatio < DIFFICULTY.retreatHealthRatio && dist < DIFFICULTY.preferredRange.max) {
        if (Math.random() < DIFFICULTY.retreatChance) {
            fsmState = STATE.RETREAT;
            moveDirection = -dirToOpponent;
            maybeMixup(bot, triggers);
            logDecision("RETREAT (low hp)", bot, dist);
            return;
        }
    }

    // -- APPROACH: opponent is out of preferred range
    if (dist > DIFFICULTY.preferredRange.max) {
        fsmState = STATE.APPROACH;
        moveDirection = dirToOpponent;
        maybeMixup(bot, triggers);
        logDecision("APPROACH", bot, dist);
        return;
    }

    // -- too close: occasionally back off a step instead of always attacking
    if (dist < DIFFICULTY.preferredRange.min && Math.random() < 0.3) {
        fsmState = STATE.RETREAT;
        moveDirection = -dirToOpponent;
        logDecision("RETREAT (too close backoff)", bot, dist);
        return;
    }

    // -- FACE OPPONENT: this game has no auto-turn - facing only updates
    // when you actually move that direction (see applyMovement in
    // server/core/gameState.js), and attacks only land on a target that's
    // in front of the attacker's facing (attackSystem.js's
    // inFrontOfAttacker check). So if the opponent circled/dashed/jumped
    // around while we were standing still, turn towards them first - same
    // as a human player would - rather than throwing a hit that can't
    // possibly land.
    if (bot.facing !== dirToOpponent) {
        fsmState = STATE.NEUTRAL;
        moveDirection = dirToOpponent;
        logDecision("TURN (facing mismatch)", bot, dist);
        return; // spend this decision turning to face them, attack next cycle
    }

    // -- ATTACK: in range and facing them, go for it (with some human-like hesitation)
    fsmState = STATE.ATTACK;
    moveDirection = 0;

    if (!settledIn) {
        logDecision("HOLD (not settled in yet)", bot, dist);
        return; // still sizing up the opponent, not ready to commit to a swing yet
    }

    if (Math.random() > DIFFICULTY.attackFollowThrough) {
        logDecision("HOLD (hesitated)", bot, dist);
        return; // hesitated - didn't take the free hit this time
    }

    const ability = pickAbility(bot, dist);
    if (ability) {
        if (DEBUG_FSM) debugLog(`[bot] ATTACK -> ${ability}`);
        lastLoggedReason = null; // always allow the next state change to log, even if it's back to the same reason as before this attack
        triggers.push({ type: "attack", ability });
    } else {
        logDecision("HOLD (no ability off cooldown/in range)", bot, dist);
    }
}

// occasionally mix in a jump or dash instead of plain walking, so movement
// reads as a player rather than a script
function maybeMixup(bot, triggers) {
    if (bot.isGrounded && Math.random() < DIFFICULTY.jumpMixupChance) {
        triggers.push({ type: "jump" });
    } else if ((bot.dashCooldownTimer || 0) <= 0 && Math.random() < DIFFICULTY.dashMixupChance) {
        triggers.push({ type: "dash" });
    }
}

// weighted-random pick among whichever abilities are off cooldown and
// roughly in range
function pickAbility(bot, dist) {
    const cooldowns = bot.cooldowns || {};
    const candidates = ABILITY_IDS.filter(ability => {
        const onCooldown = (cooldowns[ability] || 0) > 0;
        const inRange = dist <= ABILITY_RANGE[ability] + 15; // some slack - players misjudge range too
        return !onCooldown && inRange;
    });

    if (candidates.length === 0) {
        return null;
    }

    const totalWeight = candidates.reduce((sum, id) => sum + DIFFICULTY.abilityWeights[id], 0);
    let roll = Math.random() * totalWeight;

    for (const ability of candidates) {
        roll -= DIFFICULTY.abilityWeights[ability];
        if (roll <= 0) {
            return ability;
        }
    }

    return candidates[candidates.length - 1];
}

// picks the strongest off-cooldown legal cancel target for the attack
// currently in progress. Unlike pickAbility (used for opening a neutral
// exchange), this doesn't weight-roll or hesitate - once a hit is
// confirmed there's no reason to hold back on the follow-up, same "go for
// max value" spirit the rest of this difficulty preset uses elsewhere.
function pickCancelFollowup(bot) {
    const cooldowns = bot.cooldowns || {};
    const options = CANCEL_TABLE[bot.currentAttack] || [];
    const candidates = options.filter(ability => (cooldowns[ability] || 0) <= 0);

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => DIFFICULTY.abilityWeights[b] - DIFFICULTY.abilityWeights[a]);
    return candidates[0];
}

function sendInputs(inputs) {
    const tagged = inputs.map(input => ({ ...input, seq: inputSeq, tick: inputSeq }));
    inputSeq++;
    socketRef.emit("botInput", tagged);
}

function randRange([min, max]) {
    return min + Math.random() * (max - min);
}

export { initBotForMatch, stopBot, feedBotGameState };