import { debugLog } from "./debug.js";
// ============================================================================
// BOT CONTROLLER - client-side FSM "brain" for the AI opponent
// ============================================================================
// This is the only place bot *decision-making* lives. Match rules - physics,
// hit detection, cooldowns, HP - are simulated entirely client-side for bot
// matches too now (see public/core/localMatch.js + public/core/sim/, a
// generated browser copy of the exact same code server/core/gameState.js
// runs for real PvP matches - never hand-edited, see scripts/build-client-sim.js).
// This module just:
//   1. looks at the same gameStateUpdate-shaped snapshots render.js uses to
//      draw the opponent (fed locally now, not from a socket - see
//      feedBotGameState below),
//   2. runs a small finite-state machine to decide what a player holding a
//      controller would probably do next, and
//   3. hands that decision to whatever `submitInput` callback
//      initBotForMatch was given - localMatch.js passes one that feeds it
//      straight into the local sim's processInput(), no network involved.
//
// From the human player's point of view they're just fighting an opponent
// that took a little while to find - nothing here is ever surfaced in the
// UI, and the input schema/cadence matches what a real client sends in
// public/core/input.js::collectFrameInputs() exactly, tick for tick.
// ============================================================================

// ---- DIFFICULTY TUNING ----------------------------------------------------
// Every knob the FSM uses to decide *when*/*how well* to act lives in this
// one object. This is the base preset - see PERSONALITIES below, which
// layers partial overrides on top of this to change *playstyle* (spacing,
// aggression, risk tolerance) independently of skill level.
//
// Currently set to MAX difficulty: near-instant reactions, near-perfect
// blocking, no hesitation on openings, tight range judgment, and ability
// choices that favor whatever actually does the most damage rather than
// spamming the cheap stuff. It still isn't literally frame-perfect/omniscient
// (small reaction window, a short match-start settling-in beat, occasional
// dash/jump mixups) so it doesn't feel like it's reading inputs directly.
const BASE_DIFFICULTY = {
    // How long (ms) the bot "thinks" before re-evaluating the fight. Even at
    // max difficulty this stays non-zero (real net/render latency plus a
    // sliver of "human" reaction time), it's just much tighter than average.
    reactionTimeMs: [40, 90],

    // Grace period (ms) at the very start of a match before the bot will
    // throw its first attack or block. Kept short rather than instant so
    // the very first exchange doesn't feel like it's reading the spawn
    // event - see public/core/socket.js's "matchBegin" handler.
    initialActionDelayMs: [150, 350],

    // Preferred spacing in pixels. Note: preferredRange.max is NOT what
    // stops the bot from approaching (see getReadyAttackRange, which is
    // cooldown-driven) - it's only used for the block-reaction distance
    // and the low-HP retreat trigger distance. preferredRange.min still
    // drives the too-close backoff check.
    preferredRange: { min: 60, max: 130 },

    // Offset (px) added on top of the cooldown-based "ready to stop
    // approaching" range from getReadyAttackRange(). 0 = stand exactly as
    // close as whatever's off cooldown allows. Positive = hang back further
    // than strictly necessary (zoning, poking from max range). Negative =
    // press in tighter than the safe spacing (rushdown, staying in the
    // opponent's face). This is the main spacing lever for personalities,
    // since preferredRange.max no longer gates the approach decision.
    spacingBiasPx: 0,

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

    // Once a retreat read triggers, how long (ms) to commit to backing off
    // before reassessing, instead of re-rolling retreatChance every single
    // reaction cycle. Without this the bot was flipping the retreat coin
    // ~15-20x/sec at low HP - mostly retreating, but with just enough
    // 15%-chance misses mixed in tick to tick that it looked like it
    // couldn't decide between attacking and running. A committed burst
    // reads as a deliberate "back off, then reassess" beat instead.
    retreatCommitMs: [300, 550],

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

// ---- PERSONALITIES ---------------------------------------------------------
// Each entry is a *partial* override merged on top of BASE_DIFFICULTY (see
// resolvePersonality below) - list only the knobs that differ so a
// personality reads as "what's distinctive about this character" rather
// than restating the whole tuning block. preferredRange and abilityWeights
// merge key-by-key too, so e.g. a personality can override just
// preferredRange.min without having to also repeat max.
//
// To add a new one: add an entry here, pick it in initBotForMatch's
// `personality` argument (or wire it up to character-select). Nothing else
// in this file needs to change.
const PERSONALITIES = {
    // BASE_DIFFICULTY as-is: aggressive-but-fair all-rounder, no strong
    // lean either way. Good default / fallback.
    allrounder: {},

    // Presses forward and stays in your face. Trades hits rather than
    // playing safe, leans on the fast cheap stuff, rarely gives up space.
    rushdown: {
        spacingBiasPx: -20,
        tooCloseBackoffChance: 0.03,
        blockChance: 0.55,
        retreatHealthRatio: 0.15,
        retreatChance: 0.4,
        abilityWeights: { basic: 5, attack1: 5, attack2: 4, special: 2, ultimate: 1 },
        dashMixupChance: 0.28,
        jumpMixupChance: 0.04,
    },

    // Keeps range and picks fights on its own terms - hangs back at the
    // edge of what's off cooldown rather than closing all the way in, and
    // leans on the longer-reaching abilities since that's what it'll
    // actually be in range for at that spacing.
    zoner: {
        spacingBiasPx: 35,
        tooCloseBackoffChance: 0.3,
        abilityWeights: { basic: 1, attack1: 2, attack2: 2, special: 5, ultimate: 3 },
        dashMixupChance: 0.1,
        jumpMixupChance: 0.1,
    },

    // Patient and risk-averse: blocks almost everything, hesitates on
    // marginal openings instead of always taking them, and starts playing
    // defense earlier/harder when behind on health.
    turtle: {
        spacingBiasPx: 15,
        attackFollowThrough: 0.6,
        blockChance: 0.97,
        retreatHealthRatio: 0.45,
        retreatChance: 0.9,
        tooCloseBackoffChance: 0.35,
        abilityWeights: { basic: 4, attack1: 3, attack2: 2, special: 2, ultimate: 1 },
    },
};

// Merges a named personality's overrides onto BASE_DIFFICULTY. Falls back
// to "allrounder" (i.e. the unmodified base) for an unknown name rather
// than throwing, since a bad/missing personality shouldn't be able to crash
// bot init. Passing "random" (or omitting personality entirely - see
// initBotForMatch's default below) rolls a random one from PERSONALITIES.
const PERSONALITY_NAMES = Object.keys(PERSONALITIES);

function pickRandomPersonalityName() {
    return PERSONALITY_NAMES[Math.floor(Math.random() * PERSONALITY_NAMES.length)];
}

// Which personality actually got resolved for the current match - kept
// around (rather than just local to resolvePersonality) so it can be
// logged and so other code (e.g. a "fighting: Rushdown Bot" UI label) can
// ask what it got via getBotPersonality() below.
let currentPersonalityName = "allrounder";

function resolvePersonality(name) {
    const resolvedName = (!name || name === "random")
        ? pickRandomPersonalityName()
        : (PERSONALITIES[name] ? name : "allrounder");
    currentPersonalityName = resolvedName;

    const overrides = PERSONALITIES[resolvedName];
    return {
        ...BASE_DIFFICULTY,
        ...overrides,
        preferredRange: { ...BASE_DIFFICULTY.preferredRange, ...(overrides.preferredRange || {}) },
        abilityWeights: { ...BASE_DIFFICULTY.abilityWeights, ...(overrides.abilityWeights || {}) },
    };
}

// ---- SKILL LEVELS -----------------------------------------------------
// Personalities (above) change *what* the bot tries to do - stay in your
// face, keep range, turtle up. Skill levels change *how well* it executes
// that plan, independently: a "hard" rushdown and an "easy" rushdown both
// still press forward and lean on fast attacks, but the easy one reacts
// slower, hesitates on openings more, blocks less reliably, and judges
// range worse. That's why these are multipliers applied on top of
// whichever personality got resolved (see applySkillLevel) instead of a
// second flat-override table like PERSONALITIES - a flat override would
// stomp the personality's own tuning (e.g. rushdown's deliberately-low
// blockChance would just get replaced by "hard" skill's blockChance
// instead of being scaled down further from it), collapsing every
// personality to the same behavior at a given skill level.
const SKILL_LEVELS = {
    easy: {
        // multiplies the [min,max] reactionTimeMs / initialActionDelayMs
        // pair, so both ends scale together and reaction stays a range
        // rather than collapsing to a single number.
        reactionTimeMultiplier: 3.2,
        initialActionDelayMultiplier: 1.6,
        // multiplies attackFollowThrough / blockChance (then clamps to
        // [0,1] - see applySkillLevel), so a personality with an already-low
        // blockChance (rushdown) gets scaled down from that, not reset.
        attackFollowThroughMultiplier: 0.45,
        blockChanceMultiplier: 0.4,
        // flat replacement, not a multiplier - range judgment is closer to
        // "how sloppy is the margin" than "scale the existing number", and
        // a flat px value is easier to reason about than e.g. 4px * 5.
        rangeMisjudgeSlackPx: 26,
    },
    normal: {
        reactionTimeMultiplier: 1.8,
        initialActionDelayMultiplier: 1.25,
        attackFollowThroughMultiplier: 0.8,
        blockChanceMultiplier: 0.75,
        rangeMisjudgeSlackPx: 12,
    },
    hard: {
        // 1x across the board - BASE_DIFFICULTY/PERSONALITIES are already
        // tuned at max skill (see their own comments), so "hard" is a
        // pure passthrough rather than its own separate tuning pass.
        reactionTimeMultiplier: 1,
        initialActionDelayMultiplier: 1,
        attackFollowThroughMultiplier: 1,
        blockChanceMultiplier: 1,
        rangeMisjudgeSlackPx: BASE_DIFFICULTY.rangeMisjudgeSlackPx,
    },
};

const SKILL_NAMES = Object.keys(SKILL_LEVELS);

function pickRandomSkillName() {
    return SKILL_NAMES[Math.floor(Math.random() * SKILL_NAMES.length)];
}

// Which skill level actually got resolved for the current match - same
// pattern as currentPersonalityName, exposed via getBotSkill() below.
let currentSkillName = "hard";

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function applySkillLevel(config, name) {
    const resolvedName = (!name || name === "random") ? pickRandomSkillName() : (SKILL_LEVELS[name] ? name : "hard");
    currentSkillName = resolvedName;
    const skill = SKILL_LEVELS[resolvedName];

    const [reactMin, reactMax] = config.reactionTimeMs;
    const [delayMin, delayMax] = config.initialActionDelayMs;

    return {
        ...config,
        reactionTimeMs: [reactMin * skill.reactionTimeMultiplier, reactMax * skill.reactionTimeMultiplier],
        initialActionDelayMs: [delayMin * skill.initialActionDelayMultiplier, delayMax * skill.initialActionDelayMultiplier],
        attackFollowThrough: clamp01(config.attackFollowThrough * skill.attackFollowThroughMultiplier),
        blockChance: clamp01(config.blockChance * skill.blockChanceMultiplier),
        rangeMisjudgeSlackPx: skill.rangeMisjudgeSlackPx,
    };
}

// Combines both axes: personality first (what it tries to do), then skill
// scaled on top (how well it does it). Order matters - see applySkillLevel.
function resolveDifficulty(personalityName, skillName) {
    const personalityConfig = resolvePersonality(personalityName);
    return applySkillLevel(personalityConfig, skillName);
}

// Resolved per-match in initBotForMatch() below - `let`, not `const`,
// because which personality is active can change match to match.
let DIFFICULTY = BASE_DIFFICULTY;

// Approximate ability ranges, mirrored (not shared - the server never trusts
// this) from server/core/attackSystem.js just so the bot can *guess*
// whether an attack is worth throwing out. The server is still the sole
// authority on whether a hit lands or an ability is off cooldown, so an
// inaccurate guess here just means the bot occasionally whiffs or hesitates
// - which, for "play like an average player", is a feature, not a bug.
const ABILITY_RANGE = { basic: 70, attack1: 90, attack2: 95, special: 130, ultimate: 200 };
const ABILITY_IDS = Object.keys(ABILITY_RANGE);
const MIN_ABILITY_RANGE = Math.min(...Object.values(ABILITY_RANGE));

// How close the bot actually needs to be to stop approaching, computed
// fresh each decision from whichever abilities are off cooldown *right
// now* - not a fixed number. If the fast stuff is on cooldown but special
// is up, this correctly widens so the bot stops and throws special rather
// than closing all the way to basic range; the moment special goes on
// cooldown, this shrinks back down and APPROACH resumes closing the gap
// to whatever's next available. If everything's on cooldown, falls back to
// the shortest move's reach so the bot still holds a reasonable spacing
// instead of walking all the way into the opponent while it waits.
function getReadyAttackRange(bot) {
    const cooldowns = bot.cooldowns || {};
    let widest = 0;
    for (const id of ABILITY_IDS) {
        if ((cooldowns[id] || 0) > 0) continue;
        widest = Math.max(widest, ABILITY_RANGE[id]);
    }
    // rangeMisjudgeSlackPx is skill-driven (see SKILL_LEVELS/applySkillLevel)
    // - a low-skill bot both misjudges its own swing range (pickAbility,
    // below) and misjudges how close it needs to be before it's satisfied
    // it's "in position", so the same knob drives both.
    const baseRange = (widest || MIN_ABILITY_RANGE) + DIFFICULTY.rangeMisjudgeSlackPx;
    // Personality spacing lever - see spacingBiasPx's comment in
    // BASE_DIFFICULTY. Floored well above 0 so an aggressive negative bias
    // can't collapse the range to nothing and make the bot try to stand
    // literally on top of the opponent.
    return Math.max(30, baseRange + (DIFFICULTY.spacingBiasPx || 0));
}

// preferredRange.max above was tuned independently of these per-ability
// ranges and ended up wider than the short moves (basic/attack1/attack2)
// can actually reach, AND independently of the *actual* minimum distance
// two characters can stand apart (hurtbox/pushbox width). Either way it's
// a static number, and a static "stop approaching" distance can't be
// correct for both "opponent is at max melee range" and "opponent is
// point-blank" - it either sits wider than short moves can reach (bot
// camps on ~125px only using long-cooldown specials) or, if clamped down
// to match the shortest move, ends up tighter than the characters can
// physically get without colliding (bot can never satisfy its own "in
// range" check and just walks into the opponent forever, pushing them,
// since APPROACH never releases). See getReadyAttackRange() below, which
// replaces this static number with a per-decision range computed from
// whichever abilities are actually off cooldown right now - it shrinks
// and grows with the bot's real options instead of guessing a fixed spot.

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
let submitInputRef = null; // callback: (taggedInputs) => void, feeds the local sim
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

// -- opponent attack-instance tracking (block commit + punish) -------------
// Mirrors the "did this instance change" pattern above, but for the
// *incoming* attack. Without this, decide()'s block roll was being
// re-rolled every single reaction cycle (~40-90ms) for as long as
// opponent.isAttacking stayed true - and that flag stays true for a move's
// whole animation (startup+active+recovery, up to ~1200ms for heavy moves),
// not just the active hit frames. At blockChance=0.95 that meant several
// independent rolls per swing, so the odds of blocking *at least once*
// (and parking in BLOCK for that whole animation, recovery included)
// approached certainty even though no single roll was. Rolling once per
// incoming attack instance and committing to it fixes that: the bot now
// sometimes blocks the whole swing and sometimes doesn't block at all and
// stays free to counter/punish - a single human-style read instead of a
// biased repeated one.
let lastSeenOpponentAttack = null;
let opponentAttackBlockCommit = false;

// Rising/falling edge on the opponent's isAttacking flag, so we can punish
// the instant their swing ends (whiffed, or we ate/blocked it and they're
// now in recovery) instead of waiting out whatever's left of our own
// reactionTimeMs cadence.
let opponentWasAttacking = false;

// Small deadzone on which side the opponent is considered to be on. At
// true point-blank range (characters overlapping/pushing against each
// other) tiny per-tick position jitter can flip the raw sign of dx back
// and forth, which flips dirToOpponent, which flips whether bot.facing
// "matches" - sending the bot into the TURN branch over and over (which
// itself sets moveDirection = dirToOpponent, i.e. still walks forward).
// That reads exactly like "keeps running into us and pushing, barely
// attacks": the bot is stuck relitigating which way to face instead of
// ever reaching the attack check. Only update the committed direction
// when dx clears a small threshold, so noise at melee range can't flip it.
const DIRECTION_DEADZONE_PX = 8;
let lastDirToOpponent = 1;

// timestamp (performance.now()) until which a triggered low-HP retreat
// stays committed, so it isn't re-rolled away a single reaction cycle
// later (see retreatCommitMs above).
let retreatCommittedUntil = 0;

// Start running the bot for the current match. `localPlayerId` is the
// human's own player id (was previously read off a live socket - bot
// matches run fully client-side now, see public/core/localMatch.js, so
// there's no socket involved at all). `opponentSocketId` is the bot's own
// synthetic id in gameState.players (i.e. NOT the human's). `submitInput`
// is called with each batch of tagged decisions instead of this module
// emitting them anywhere itself - localMatch.js passes a function that
// feeds them straight into the local sim's processInput().
// `personality` is a key into PERSONALITIES (e.g. "rushdown", "zoner",
// "turtle") - what the bot tries to do. Defaults to "random" (a fresh coin
// flip every match); pass "allrounder" explicitly for the plain base.
// `skill` is a key into SKILL_LEVELS ("easy"/"normal"/"hard") - how well it
// executes that plan. Also defaults to "random". Both axes are independent:
// e.g. ("rushdown", "easy") still presses forward and leans on fast
// attacks, just slower and less reliably than ("rushdown", "hard").
const initBotForMatch = (localPlayerId, opponentSocketId, personality = "random", skill = "random", submitInput) => {
    stopBot();

    if (typeof submitInput !== "function") {
        throw new Error("[bot] initBotForMatch requires a submitInput(taggedInputs) callback");
    }

    submitInputRef = submitInput;
    botSocketId = opponentSocketId;
    humanId = localPlayerId;
    latestState = null;
    inputSeq = 0;

    DIFFICULTY = resolveDifficulty(personality, skill);
    debugLog(`[bot] personality: ${currentPersonalityName}, skill: ${currentSkillName}`);

    fsmState = STATE.NEUTRAL;
    moveDirection = 0;
    blockActive = false;
    nextDecisionAt = 0;
    matchStartAt = performance.now();
    actionDelayMs = randRange(DIFFICULTY.initialActionDelayMs);
    lastSeenAttack = null;
    attackStartCombo = 0;
    comboChaseStartedAt = 0;
    lastSeenOpponentAttack = null;
    opponentAttackBlockCommit = false;
    opponentWasAttacking = false;
    lastDirToOpponent = 1;
    retreatCommittedUntil = 0;

    tickHandle = setInterval(tick, TICK_MS);
};

// Stop the bot loop (call on match end / cleanup / rematch).
const stopBot = () => {
    if (tickHandle) {
        clearInterval(tickHandle);
        tickHandle = null;
    }
    submitInputRef = null;
    botSocketId = null;
    humanId = null;
    latestState = null;
};

// Feed the bot the latest authoritative state (called from localMatch.js's
// local "gameStateUpdate" dispatch, right alongside updateGameState()).
const feedBotGameState = (state) => {
    latestState = state;
};

// ---- main loop ------------------------------------------------------------
function tick() {
    if (!submitInputRef || !botSocketId || !latestState) {
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

    // Same identity tracking, but for the opponent's attack: roll the
    // block decision once when a new instance starts (see the module-state
    // comment above), and flag the tick their swing ends so we can punish
    // immediately instead of idling out the rest of our reaction timer.
    if (opponent.currentAttack !== lastSeenOpponentAttack) {
        lastSeenOpponentAttack = opponent.currentAttack;
        opponentAttackBlockCommit = (opponent.isAttacking && opponent.currentAttack)
            ? Math.random() < DIFFICULTY.blockChance
            : false;
    }
    const opponentAttackJustEnded = opponentWasAttacking && !opponent.isAttacking;
    opponentWasAttacking = opponent.isAttacking;

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
    } else if (opponentAttackJustEnded) {
        // Their swing just ended - whiffed, or we blocked/ate it and
        // they're now sitting in recovery. Decide right now instead of
        // waiting out whatever's left of nextDecisionAt, so a real opening
        // actually gets punished instead of closing before we react to it.
        decide(bot, opponent, triggers, now);
        nextDecisionAt = now + randRange(DIFFICULTY.reactionTimeMs);
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
    if (dist >= DIRECTION_DEADZONE_PX) {
        lastDirToOpponent = dx >= 0 ? 1 : -1;
    }
    const dirToOpponent = lastDirToOpponent;

    // still "settling in" at the start of the match - allowed to move/space
    // itself normally below, but not to attack or block yet.
    const settledIn = (now - matchStartAt) >= actionDelayMs;

    // -- BLOCK: opponent is mid-swing and close enough that it might matter
    // (blocking doesn't require facing them - see the note above pickAbility)
    if (settledIn && opponent.isAttacking && dist < DIFFICULTY.preferredRange.max + 40) {
        if (opponentAttackBlockCommit) {
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

    // -- RETREAT: low health and opponent is close - play it safer.
    // Once committed (below), ride out the burst without re-rolling.
    if (now < retreatCommittedUntil) {
        fsmState = STATE.RETREAT;
        moveDirection = -dirToOpponent;
        maybeMixup(bot, triggers);
        logDecision("RETREAT (committed)", bot, dist);
        return;
    }

    const healthRatio = bot.health / (bot.maxHealth || 1);
    if (healthRatio < DIFFICULTY.retreatHealthRatio && dist < DIFFICULTY.preferredRange.max) {
        if (Math.random() < DIFFICULTY.retreatChance) {
            fsmState = STATE.RETREAT;
            moveDirection = -dirToOpponent;
            retreatCommittedUntil = now + randRange(DIFFICULTY.retreatCommitMs);
            maybeMixup(bot, triggers);
            logDecision("RETREAT (low hp)", bot, dist);
            return;
        }
    }

    // -- APPROACH: opponent is out of range of anything we could currently
    // throw (see getReadyAttackRange - this is cooldown-aware, not a fixed
    // spacing target)
    const readyRange = getReadyAttackRange(bot);
    if (dist > readyRange) {
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
        const inRange = dist <= ABILITY_RANGE[ability] + DIFFICULTY.rangeMisjudgeSlackPx; // some slack - players misjudge range too
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
    submitInputRef(tagged);
}

function randRange([min, max]) {
    return min + Math.random() * (max - min);
}

// Which personality the current/most recent bot match resolved to (see
// resolvePersonality) - e.g. for a "fighting: Rushdown Bot" UI label.
const getBotPersonality = () => currentPersonalityName;

// Which skill level the current/most recent bot match resolved to (see
// applySkillLevel).
const getBotSkill = () => currentSkillName;

export { initBotForMatch, stopBot, feedBotGameState, getBotPersonality, getBotSkill };