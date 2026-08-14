const { STATES, setCombatState, canAttack, triggerHitstop, isFrozen } = require('./stateMachine.js');
const hitboxSystem = require('./hitboxSystem.js');
// NOTE for scripts/build-client-sim.js: this specifier gets rewritten when
// generating the browser copy (see IMPORT_PATH_OVERRIDES there) to point at
// the client's own debug.js instead of a copy of this one - see that file's
// comment for why.
const { debugLog } = require('./debug.js');
// Single source of truth for all character data (stats, move balance
// numbers, frame-timing modifiers, sprite config) - see server/data/characters.js.
// This file used to define its own ATTACK_TIER_FRAMES/CHARACTER_SPEED_MOD/
// ATTACK_CONFIG_MS tables; those are now authored data that lives there
// instead, and this file only consumes them to build the runtime
// ATTACK_CONFIG below.
const { CHARACTERS, MOVE_TIER_FRAMES, MOVE_ANIMATION_MAP } = require('../data/characters.js');

// ── frame conversion ─────────────────────────────────────────────────
// Step 0 of the refactor plan: every durational value becomes frame-counted
// at 60fps instead of millisecond-based. Nothing downstream of this file
// touches Date.now() for combat timing anymore.
const TICK_RATE = 60;
const FRAME_MS = 1000 / TICK_RATE;
const msToFrames = (ms) => Math.max(1, Math.round(ms / FRAME_MS));

// ── Per-move frame-data authoring (refactor-plan.md section 6, "Character
// Attack Refactor" - done here, out of the normal build order, ahead of
// item 7 because the generic placeholder window this replaces made combos
// nearly impossible to test; see the note that was in that section before
// this pass and is now resolved here) ──────────────────────────────────
//
// Replaces the old single `duration` + generic "elapsed >= 100ms &&
// elapsed < duration - 100ms" hit-check window with real authored
// startupFrames/activeFrames/recoveryFrames per move. durationFrames and
// activeEndFrame are now DERIVED from these three, not the other way
// around (see the ATTACK_CONFIG build loop below).
//
// Authored as tier (MOVE_TIER_FRAMES) + per-character speed modifier
// (CHARACTERS[id].frameModifier) rather than 60 hand-typed numbers - both
// tables now live in server/data/characters.js as the single source of
// truth; this function just combines them. Keeping the actual design
// decision (how fast is this character, how weighty is this move) legible
// in one data file instead of buried in arithmetic here also eliminates
// the risk of a typo silently reopening the item-5/6 combo-margin problem
// in one specific move.
//
// Combo-margin check (the thing that was broken before this pass): with
// BASE_HITSTUN_FRAMES = 18 on a first hit, and hitstun only shrinking from
// there, every tier's activeFrames below (3-8) is well under that even at
// high comboCount - so the worst case (a hit landing the instant active
// frames open) still leaves the attacker cancel-eligible several frames
// before the defender recovers, for every move, not just a lucky late hit.
function attackTiming(moveId, characterId) {
    const tier = MOVE_TIER_FRAMES[moveId];
    const mod = CHARACTERS[characterId].frameModifier;
    return {
        startupFrames: Math.max(2, tier.startup + mod.startup),
        activeFrames: tier.active, // kept uniform across characters - this is the number the combo-margin check above depends on, not a place for per-character flavor
        recoveryFrames: Math.max(tier.startup + mod.startup, tier.recovery + mod.recovery)
    };
}

// ── Per-move balance data (damage/cooldown/knockback/range/hitbox/etc.) ──
// This USED to be a large hand-maintained table duplicated here, one block
// per character. It now lives in server/data/characters.js
// (CHARACTERS[id].moves) as part of the single source of truth, and is
// assembled into the same {characterId: {moveId: {...ms fields}}} shape
// this file has always built ATTACK_CONFIG from - so everything below this
// point is unchanged. `animation` (previously hand-typed per move) is now
// derived from the shared MOVE_ANIMATION_MAP, since every character maps
// move slots to sheet names identically.
const ATTACK_CONFIG_MS = {};
for (const [characterId, character] of Object.entries(CHARACTERS)) {
    ATTACK_CONFIG_MS[characterId] = {};
    for (const [moveId, moveData] of Object.entries(character.moves)) {
        ATTACK_CONFIG_MS[characterId][moveId] = {
            ...moveData,
            animation: MOVE_ANIMATION_MAP[moveId]
        };
    }
}

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
// normals actually chain into) are a further design pass beyond what this
// refactor covers; the shape here (light -> heavier normals -> special ->
// ultimate) matches the spec's own example ("Light -> Heavy, or Heavy ->
// Special").
const CANCEL_TABLE = {};
function defineCancelTable(fromMove, allowedIntoMoves) {
    CANCEL_TABLE[fromMove] = allowedIntoMoves;
}
defineCancelTable('attack1', ['attack2', 'basic', 'special']);
defineCancelTable('attack2', ['basic', 'special']);
defineCancelTable('basic', ['special']);
defineCancelTable('special', ['ultimate']);
defineCancelTable('ultimate', []); // nothing to cancel a finisher into

// ── Cooldown policy (found via combat-log analysis, not part of the
// original per-move authoring pass above) ─────────────────────────────
// Every move's authored `cooldown` (ms, in ATTACK_CONFIG_MS) predates this
// refactor and was never revisited despite items 1-7 all assuming light/
// medium normals are freely reusable combo pieces. In practice: attack1/
// attack2/basic each carry a cooldown ~2.6x longer than their own
// animation, and special/ultimate carry 10-35 SECOND cooldowns (up to 50x
// their duration). A real fighting-game normal doesn't have a separate
// cooldown at all - it's reusable the instant its own recovery frames end,
// gated only by the move's own timing, not an extra timer. Confirmed via a
// real combat log: after any 2-3 move chain (which DOES work - "canceled
// attack1 into attack2" etc. fire correctly), every move just used locks
// out simultaneously, frequently for multiple seconds, leaving nothing to
// press - "Buffered attack X failed: cooldown" dominates the log.
//
// attack1/attack2/basic: cooldown removed entirely (cooldownFrames =
// durationFrames - reusable the moment the move's own animation ends, no
// additional wait, matching genre convention for normals).
// special/ultimate: keep a real cooldown (that's the point of a meter-tier
// move) but the authored 10-35s values are capped down to something
// usable more than once or twice a round.
//
// This is an interim tuning fix, not a permanent design - item 13
// (Resource/Meter Economy) is where cooldown-vs-resource pacing for
// special/ultimate really belongs long-term, replacing a flat timer with
// actual spend/regen.
const NORMAL_MOVE_IDS = ['attack1', 'attack2', 'basic'];
const SPECIAL_COOLDOWN_CAP_MS = 3000;
const ULTIMATE_COOLDOWN_CAP_MS = 10000;

function resolveCooldownFrames(moveId, authoredCooldownMs, durationFrames) {
    if (NORMAL_MOVE_IDS.includes(moveId)) {
        return durationFrames;
    }
    const capMs = moveId === 'ultimate' ? ULTIMATE_COOLDOWN_CAP_MS : SPECIAL_COOLDOWN_CAP_MS;
    return Math.min(msToFrames(authoredCooldownMs), msToFrames(capMs));
}

// Build ATTACK_CONFIG with frame-converted fields, derived once at load time.
// durationFrames/cooldownFrames/startupFrames/activeEndFrame are what the
// rest of this file schedules against; the original ms fields (damage,
// cooldown, knockback, etc.) are kept alongside for readability/debugging
// only. startupFrames/activeFrames/recoveryFrames come from attackTiming()
// (the real per-move authoring, see the comment above ATTACK_TIER_FRAMES) -
// durationFrames and activeEndFrame are DERIVED from those three, not
// separately authored.
const ATTACK_CONFIG = {};
for (const [characterId, moves] of Object.entries(ATTACK_CONFIG_MS)) {
    ATTACK_CONFIG[characterId] = {};
    for (const [moveId, config] of Object.entries(moves)) {
        const { startupFrames, activeFrames, recoveryFrames } = attackTiming(moveId, characterId);
        const activeEndFrame = startupFrames + activeFrames;
        const durationFrames = activeEndFrame + recoveryFrames;
        const cooldownFrames = resolveCooldownFrames(moveId, config.cooldown, durationFrames);

        // cancel window = the recovery phase itself, same point per spec
        // section 3, expressed per-target now (spec section 6: "an explicit
        // list of moves this attack can cancel into, AND AT WHAT FRAME of
        // recovery") - every target from a given source move opens at the
        // same point (this move's own activeEndFrame) rather than each
        // being hand-tuned separately, since there's no design reason yet
        // for e.g. attack1->basic to unlock later than attack1->attack2.
        const cancelableInto = (CANCEL_TABLE[moveId] || []).map(move => ({ move, atFrame: activeEndFrame }));

        ATTACK_CONFIG[characterId][moveId] = {
            ...config,
            startupFrames,
            activeFrames,
            recoveryFrames,
            activeEndFrame,
            durationFrames,
            cooldownFrames,
            // earliest ANY cancel route opens - since every route currently
            // shares activeEndFrame (see cancelableInto above) this is just
            // that value, but kept as its own field/name since applyHit and
            // checkComboDrop read it as "the earliest this attacker could
            // possibly follow up," independent of which specific move they
            // end up canceling into.
            cancelWindowStartFrame: activeEndFrame,
            cancelableInto,
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
// impact has a beat to register. Spec's stated range is 3-12 frames; this
// was originally tuned to 12 (the top of that range) per playtesting
// feedback that anything lower read as too subtle to notice.
//
// Brought down to 8 as part of resolving the "third issue" in
// combat-system-refactor-plan.md section 6: at 12 frames, hitstop alone
// was consuming most of a first hit's hitstun budget (18 frames) before a
// cancel-into-follow-up's own startup was even counted, so a real 2-hit
// chain landed just after the defender had already recovered. 8 keeps
// hitstop closer to the middle of the spec's range (still clearly felt,
// per the same playtesting logic that ruled out anything near the bottom)
// while leaving enough of the hitstun window for an actual chain to land.
// Combined with the cancel-window fix below (hit-confirmed cancels open at
// the hit-confirm frame, not this move's activeEndFrame), light-into-light
// chains now have real margin instead of none.
const HITSTOP_DURATION_FRAMES = 8;

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

// ── Knockback Scaling (extends the item 5/6 combo-decay pattern) ──────
// Same rationale as damage/hitstun decay above: knockback needs to shrink
// as a combo goes on too, or accumulated push-back drifts the defender out
// of range for a later, longer-reaching move before a real chain ever gets
// the chance to land - the exact spacing failure found finishing the
// item-11 pass (see combat-system-refactor-plan.md section 6, "new,
// separate finding"). The first hit in a combo keeps its full, per-move-
// authored knockback; only hits after that shrink.
//
// Steepened per explicit feedback ("combo chaining is still kinda hard,
// maybe cuz of the knockback") - the original curve (30%/hit, floor 30%)
// still let a 3rd+ hit drift far enough to matter for tighter-range moves.
// Now decays faster and floors much lower, so by the 3rd hit onward
// knockback is reduced to a small fraction of the move's base - keeping a
// combo's later hits landing close to where they started instead of
// pushing the defender steadily further away with every hit.
const KNOCKBACK_DECAY_PER_HIT = 0.45; // each hit after the 1st pushes 45% less far
const KNOCKBACK_FLOOR = 0.1;          // knockback never drops below 10% of the move's base

function getScaledKnockback(baseKnockback, comboCount) {
    const hitsIntoCombo = Math.max(0, comboCount - 1);
    const multiplier = Math.max(KNOCKBACK_FLOOR, 1 - hitsIntoCombo * KNOCKBACK_DECAY_PER_HIT);
    return baseKnockback * multiplier;
}

// ── Combo Breakers / Bursts (build-order item 7 / spec section 7) ─────
// No dedicated file named for this item in the plan's file-structure
// section (section 8 only calls out comboSystem.js for sections 5/6/15,
// which haven't been extracted out of this file yet either) - kept here
// alongside the other combo-related functions for now, same bucket as
// getScaledHitstun/calculateScaledDamage pending that future extraction.
//
// DEVIATION FROM SPEC (deliberate, see combat-system-refactor-plan.md's
// build-order section for the full note): spec's triggerComboBreaker
// checks a fixed button combination entered once. This implements a timed
// precision-bar challenge instead - same purpose (a skill gate on an
// escape option, not a free button press) via a different mechanic
// (execution-under-pressure instead of memorization).
//
// Wire-protocol choice: rather than adding a new input type (would need a
// client-side control that doesn't exist), this repurposes the existing
// 'jump' input as the CONFIRM press - jumping while stunned is already
// illegal (canPerformAction rejects it), so intercepting it specifically
// while a challenge is pending doesn't collide with jump's normal use. See
// handleBurstInput and its call site in gameState.js's
// consumeOldestValidInput.
//
// REVISED after real-play feedback: this originally required a separate
// manual "start" press (a 'jump' input while stunned) before the confirm
// window opened, sized to fit inside what was left of hitstun after
// hitstop+buffer delay ate into it. That worked in synchronous, zero-
// latency local testing but was never actually reachable in real play -
// every test this whole session validated SERVER-side window consistency
// via processInput() calls timed exactly against server tick counts, which
// never modeled real round-trip network latency (40-100ms+) or human
// input timing on top of it. A two-round-trip sequence (start, then
// confirm) each squeezed into a handful of frames doesn't survive that.
// The challenge now auto-arms the instant hitstun begins (applyHit below),
// cutting the requirement to a single input and a single round trip, with
// a window sized to actually be humanly landable.
const BURST_METER_MAX = 100;
const BURST_METER_PER_DAMAGE = 0.5; // how much burst meter each point of damage taken fills
// "way more generous" per explicit request - the previous window (8 frames
// after the arm) was landing on top of the frozen-frame bug above, so it
// was effectively unusable regardless of tuning; now that the underlying
// clock actually pauses correctly during hitstop, this is a genuine,
// substantial widening on top of the corrected baseline, not just working
// around the bug. ~5.75x wider than before (8 frames -> 46 frames).
const BURST_TARGET_START_FRAME = 2;  // sweet-spot window opens almost immediately after the hit that armed the challenge (~33ms)
const BURST_TARGET_END_FRAME = 48;   // ...and stays open until ~800ms - a wide, forgiving confirm window
const BURST_CHALLENGE_DURATION_FRAMES = 54; // if no confirm arrives by this many frames after arming, the challenge lapses (see gameState.js's per-tick timeout check) - a small buffer past the target window on purpose, since a confirm can still resolve (just fail) after the window closes rather than needing to land exactly inside it to even register
const BURST_INVINCIBILITY_FRAMES = 30; // ~500ms of safety after a successful burst
const BURST_SEPARATION_DISTANCE = 150; // how far apart both characters land on a successful burst

// adds to the secondary resource, typically from taking damage (spec
// wording) - called from applyHit below for every point of damage a
// defender actually takes, blocked or not. Kept around per spec
// compliance and for potential future use, but as of the redesign below
// it no longer gates anything by itself - see isBurstAvailable.
function fillBurstMeter(character, amount) {
    character.burstMeter = Math.min(BURST_METER_MAX, (character.burstMeter || 0) + Math.max(0, amount) * BURST_METER_PER_DAMAGE);
}

// Availability gate, corrected after real-play feedback: an earlier
// version gated this on a cumulative "10 SEPARATE completed combos over
// the whole match" counter (combosSurvived) - a misreading of "the meter
// should only appear after 10 successful combos." What was actually meant
// was much simpler and matches the comboCount the player already sees
// live ("combo x10"): burst becomes available once the CURRENT combo has
// reached BURST_COMBO_COUNT_THRESHOLD hits - a comeback option that turns
// on specifically when you're in real danger (deep in an ongoing combo),
// not a persistent unlock earned by grinding through many separate
// combos first. That's also why it "didn't show up at all" before - 10
// separate full combos each recovering in between is a vastly higher bar
// to clear than 10 hits in one string, especially given how hard sustained
// chaining already was this session.
const BURST_COMBO_COUNT_THRESHOLD = 10;

function isBurstAvailable(character) {
    return (character.comboCount || 0) >= BURST_COMBO_COUNT_THRESHOLD;
}

// Handles a 'jump' input arriving while a burst challenge is pending -
// this is always a confirm attempt now (see the design note above; the
// challenge arms itself, there's no separate "start" input anymore).
// Returns true if this input was consumed as a burst attempt (whether or
// not the burst itself succeeded), false if there was no pending challenge
// at all - the caller falls through to normal jump handling in that case.
function handleBurstInput(gameState, player, currentFrame) {
    if (!player.burstChallenge) {
        return false;
    }
    triggerComboBreaker(gameState, player, currentFrame);
    return true;
}

// Resolves an in-progress precision-bar challenge. Success requires the
// confirm press (this call) to land inside [BURST_TARGET_START_FRAME,
// BURST_TARGET_END_FRAME] frames after the challenge started - outside
// that window, the burst fails. The meter is spent either way (see the
// design note in combat-system-refactor-plan.md - a whiffed timing attempt
// still costs the resource, or the challenge could be spammed for free
// retries every time hitstun allows another 'jump' input).
function triggerComboBreaker(gameState, character, currentFrame) {
    const challenge = character.burstChallenge;
    character.burstChallenge = null;
    character.burstMeter = 0;

    if (!challenge) {
        return false;
    }

    // frozenFrames-adjusted - see the note above isFrozen's early-return in
    // gameState.js for why: this player was frozen (hitstop) for several
    // frames right after the hit that armed this challenge, and a raw
    // currentFrame-startFrame subtraction would count that frozen time
    // against the window, which is what made the challenge unusable before
    // this fix (elapsed was already ~HITSTOP_DURATION_FRAMES by the time
    // the player could physically react).
    const elapsed = (currentFrame - challenge.startFrame) - (challenge.frozenFrames || 0);
    const success = elapsed >= BURST_TARGET_START_FRAME && elapsed <= BURST_TARGET_END_FRAME;
    if (!success) {
        return false;
    }

    // cancels all pending hitstun/damage, resets this character to neutral
    character.stunEndFrame = 0;
    setCombatState(character, STATES.IDLE, currentFrame);
    resetComboCount(character);
    character.velocity.x = 0;
    character.velocity.y = 0;

    // temporary invincibility, checked in checkHit above
    character.isInvincible = true;
    character.invincibilityEndFrame = currentFrame + BURST_INVINCIBILITY_FRAMES;

    // "screen-clearing explosion" - reset BOTH characters to neutral,
    // separated to a fixed safe distance. An instant reposition rather
    // than a velocity-based push: velocity-based knockback only actually
    // moves someone while they can't move under their own input (see
    // applyKnockbackMovement in gameState.js) - both characters are being
    // set to IDLE right here, so a velocity approach would just get
    // stomped by the client's next move input. A snap-to-neutral-spacing
    // reset also matches "resets both characters to neutral" more directly
    // than a physics push would.
    const opponent = gameState.players.find(p => p.socketId !== character.socketId && !p.isDead);
    if (opponent) {
        const boundaries = gameState.map.boundaries;
        const leftBound = boundaries.left + character.size.width / 2;
        const rightBound = boundaries.right - character.size.width / 2;
        const midpoint = (character.position.x + opponent.position.x) / 2;
        const dir = character.position.x <= opponent.position.x ? -1 : 1;

        character.position.x = Math.max(leftBound, Math.min(rightBound, midpoint + dir * (BURST_SEPARATION_DISTANCE / 2)));
        opponent.position.x = Math.max(leftBound, Math.min(rightBound, midpoint - dir * (BURST_SEPARATION_DISTANCE / 2)));
        opponent.velocity.x = 0;

        // the attacker's own swing gets cut short too - the burst is a
        // full reset of the exchange, not just an escape for the defender
        if (opponent.currentAttackId) {
            gameState.attackHandler.activeAttacks.delete(opponent.currentAttackId);
            opponent.currentAttackId = null;
        }
        opponent.stunEndFrame = 0;
        setCombatState(opponent, STATES.IDLE, currentFrame);
    }

    debugLog(`[AttackHandler] ${character.socketId} landed a combo breaker burst`);
    return true;
}

// ── Hitstun Scaling / Gravity Scaling (originally build-order item 6 /
// spec section 6, "Hitstun Deterioration" - deliberately inverted from the
// spec, see below) ──────────────────────────────────────────────────────
// Spec section 6's premise: hitstun SHRINKS as comboCount rises, so a long
// combo eventually lets the victim escape on its own - deterioration is
// the safety valve against an inescapable combo. That's what this used to
// do (decay-per-hit down to a floor).
//
// Reversed by design request: item 7 (Combo Breakers/Bursts) is the
// intended safety valve instead - a skill-gated escape the victim can
// actively use, rather than a passive timer that bails them out
// regardless of whether they play well. With burst filling that role,
// hitstun shrinking on its own was working against the point of a combo
// system: it made stacking hits progressively LESS threatening (each hit
// stunned the victim for less time than the last), when the intent is the
// opposite - a combo should feel escalating and dangerous, with getting
// out of it something the victim has to earn (fill meter, land the
// precision-bar timing) rather than something that just happens.
//
// getScaledHitstun now GROWS a grounded victim's hitstun per hit instead
// of shrinking it, capped (MAX_HITSTUN_FRAMES) so a combo without a burst
// attempt is dangerous but not a literal forever-lock - that hard ceiling
// is a stand-in for what item 15 (Combo Cycle Breaker - "a hard cap
// distinct from damage/hitstun scaling") will eventually own properly;
// picture this cap as a temporary version of that, not a substitute for
// building it. getScaledGravity (below) already pointed the right
// direction before this change - it speeds up an airborne victim's fall
// as the combo goes on, i.e. also gets MORE oppressive per hit, not less -
// so it didn't need to flip, only hitstun did.
//
// checkComboDrop (bottom of this section) still exists as a pure frame
// comparison, but "the combo gets dropped by its own deterioration" is no
// longer really the expected path now that hitstun doesn't shrink - a real
// drop is now expected to come from the victim successfully bursting, or
// (rarely) the attacker just being slow/mistimed. Kept for diagnostic
// value either way.
//
// NOTE on getScaledGravity: every move in ATTACK_CONFIG_MS currently has
// knockback.y === 0 (see attackSystem.js's ATTACK_CONFIG_MS block) - no
// attack launches anyone airborne yet, so this function is correctly wired
// (gameState.js's applyGravity calls it whenever a HITSTUN'd player isn't
// grounded) but has nothing to scale until some move's per-character data
// gets real vertical knockback.
const HITSTUN_GROWTH_PER_HIT_MS = 60; // each hit after the 1st stuns this much LONGER
const MAX_HITSTUN_MS = 1500;          // hard ceiling - a combo without a burst is dangerous, not literally endless
const HITSTUN_GROWTH_PER_HIT_FRAMES = msToFrames(HITSTUN_GROWTH_PER_HIT_MS);
const MAX_HITSTUN_FRAMES = msToFrames(MAX_HITSTUN_MS);
const BASE_HITSTUN_MS = 300;
const BASE_HITSTUN_FRAMES = msToFrames(BASE_HITSTUN_MS);

const GRAVITY_SCALE_PER_HIT = 0.15; // +15% downward accel per hit into the combo
const MAX_GRAVITY_SCALE = 2.5;      // cap so a very long combo doesn't slam a victim down instantly

function getScaledHitstun(baseHitstunFrames, comboCount) {
    const hitsIntoCombo = Math.max(0, comboCount - 1);
    return Math.min(baseHitstunFrames + hitsIntoCombo * HITSTUN_GROWTH_PER_HIT_FRAMES, MAX_HITSTUN_FRAMES);
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
    // attackFrame is only meaningful while isAttacking is true (set by
    // updateAttacks below) - zero it here too so a stale nonzero value
    // doesn't linger and get sent to clients between attacks.
    player.attackFrame = 0;
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

        // hasOwnProperty guard, not just `characterAttacks[attackType]` -
        // attackType is client-controlled (input.ability, forwarded here
        // unmodified from processInput() in gameState.js). A forged
        // {type:'attack', ability: '__proto__'} (or 'constructor',
        // 'toString', etc.) would otherwise resolve through the prototype
        // chain to a real object - Object.prototype itself - which is
        // truthy and so passes the `!attackConfig` check below despite not
        // being a real move. Every field it's actually used for downstream
        // (startupFrames, damage, range...) would then read as undefined,
        // producing NaN timing/state that could desync or wedge that
        // player's combat state rather than cleanly rejecting as
        // 'invalid_attack' like any other bogus attackType does.
        if (!Object.prototype.hasOwnProperty.call(characterAttacks, attackType)) {
            return { success: false, reason: 'invalid_attack' };
        }

        const attackConfig = characterAttacks[attackType];

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

        debugLog(`[AttackHandler] ${player.socketId} initiated ${attackType}`);

        return {
            success: true,
            attackId,
            durationFrames: attackConfig.durationFrames,
            animation: attackConfig.animation
        };
    }

    // ── Cancel Windows (build-order item 3) ────────────────────────────
    // checks whether attacker's CURRENT attack (attackData) is inside its
    // designated cancel window and whether requestedMove is one it's
    // legal to cancel into. Does not mutate anything - see executeCancel
    // for the actual interrupt.
    //
    // cancelableInto is now an array of {move, atFrame} (refactor-plan.md
    // section 6 - "an explicit list of moves this attack can cancel into,
    // and at what frame of recovery"), not a flat array of move names - so
    // this looks up the specific route instead of a blanket cancelWindowStartFrame
    // for every target.
    canCancel(attackData, requestedMove, currentFrame) {
        const config = attackData.config;

        const route = config.cancelableInto.find(r => r.move === requestedMove);
        if (!route) {
            return false;
        }

        // hitstop-aware, matching updateAttacks' elapsedFrames (see the note
        // there): frozenFrames accumulates while the attacker is frozen, so
        // this has to subtract it too, or a cancel request checked right as
        // the attacker unfreezes would see an elapsedFrames that already
        // jumped past durationFrames from the freeze alone.
        const elapsedFrames = (currentFrame - attackData.startFrame) - (attackData.frozenFrames || 0);

        // "third issue" fix (combat-system-refactor-plan.md section 6): a
        // hit-confirmed cancel opens the instant the hit actually landed
        // (attackData.hitConfirmElapsedFrames, set in checkHit), not after
        // this move's own active frames finish playing out
        // (route.atFrame === activeEndFrame). The old activeEndFrame-based
        // wait was tacking this move's remaining active frames onto the
        // deficit against the DEFENDER's hitstun budget for no reason - the
        // hit already landed, there's nothing left to gain by waiting out
        // the rest of the swing. Falls back to route.atFrame for a
        // block-confirmed cancel, which has no equivalent "confirm moment"
        // yet (item 8, Just Defend/Perfect Parry, is what will eventually
        // give blockstun its own timeline).
        const cancelOpensAt = (config.cancelableOnHit && attackData.hasHit && attackData.hitConfirmElapsedFrames !== undefined)
            ? attackData.hitConfirmElapsedFrames
            : route.atFrame;

        const inCancelWindow = elapsedFrames >= cancelOpensAt && elapsedFrames < config.durationFrames;
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

        debugLog(`[AttackHandler] ${attacker.socketId} canceled ${attackData.type} into ${requestedMove}`);
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
            // is frozen. NOTE (found live-testing the item-11 frame-data
            // pass): "not evaluating it this tick" is NOT the same as
            // pausing elapsedFrames - elapsedFrames is recomputed fresh
            // every tick as (currentFrame - startFrame), an absolute
            // difference that has no memory of frozen gaps. Skipping
            // evaluation only stops RE-TRIGGERING things while frozen; the
            // instant the attacker unfreezes, that raw subtraction still
            // includes every frozen tick, so elapsedFrames JUMPS by the
            // full hitstop duration in one step - which silently ate the
            // entire active/cancel-window budget on every hit (12 frozen
            // frames vs. 3-8 frames of active window), making an attack
            // look "already past recovery" the instant it unfreezes,
            // before a buffered cancel input ever got a chance to be
            // checked. attackData.frozenFrames tracks the actual accumulated
            // freeze so it can be subtracted back out below - THIS is what
            // makes the clock genuinely pause, not the isFrozen skip alone.
            if (isFrozen(attacker)) {
                attackData.frozenFrames = (attackData.frozenFrames || 0) + 1;
                continue;
            }

            const elapsedFrames = (currentFrame - attackData.startFrame) - (attackData.frozenFrames || 0);
            const config = attackData.config;

            // sub-phase transitions - only move the attacker's combatState
            // if they still own this attack instance (a cancel hands
            // combatState to the new attack and deletes this instance
            // outright, so this guard is really just "have we already been
            // superseded by executeCancel this tick")
            if (attacker.currentAttackId === attackId) {
                // Animation-engine sync wire (see
                // animation-engine-refactor-spec.md, "tick-sequence" mode):
                // this is the same elapsedFrames the state machine and
                // checkHit already trust as this attack's authoritative
                // clock, now also exposed on the player so
                // getClientGameState() can forward it to clients and
                // SpriteAnimator can index frameSequence[player.attackFrame]
                // directly instead of running its own ms timer.
                attacker.attackFrame = elapsedFrames;

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

                debugLog(`[AttackHandler] Attack ${attackId} completed`);
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
            // Skip self, dead players, and anyone currently invincible
            // (build-order item 7: a successful combo-breaker burst grants
            // brief invincibility - see triggerComboBreaker/isInvincible)
            if (target.socketId === attacker.socketId || target.isDead || target.isInvincible) continue;

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
                // Recorded BEFORE applyHit runs (build-order item 6 reads
                // this inside applyHit for earliestFollowUpFrame) - same
                // frozen-frame-adjusted units canCancel compares against,
                // so a hit-confirmed cancel can open right here instead of
                // waiting for this move's own active frames to finish
                // playing out. See canCancel below.
                attackData.hitConfirmElapsedFrames = (gameState.tickCount - attackData.startFrame) - (attackData.frozenFrames || 0);
                this.applyHit(gameState, attacker, target, attackData);
                attackData.hasHit = true; // Mark as hit (single hit only)
                debugLog(`[AttackHandler] Hit detected - Range: ${attackRange}, Hitbox: ${attackHitboxWidth}x${attackHitboxHeight}`);
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

        // Combo breaker meter (build-order item 7): fills from taking
        // damage, blocked or not - see fillBurstMeter above.
        fillBurstMeter(target, damage);

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
            // Scaled by combo count (see getScaledKnockback above) so a
            // combo's later hits don't push the defender out of range for
            // the next move before a chain even gets a chance to land.
            const scaledKnockbackX = getScaledKnockback(config.knockback.x, target.comboCount);
            hitboxSystem.applyCornerPushback(attacker, target, {
                x: scaledKnockbackX * knockbackDir,
                y: config.knockback.y
            });

            // Apply hitstun, shortened as the combo goes on (build-order
            // item 6) so long chains eventually let the victim escape.
            setCombatState(target, STATES.HITSTUN, currentFrame);
            target.stunEndFrame = currentFrame + getScaledHitstun(BASE_HITSTUN_FRAMES, target.comboCount);

            // Combo breaker (build-order item 7): arm the precision-bar
            // challenge the instant hitstun begins, if the meter's full and
            // nothing's already pending. Auto-armed rather than requiring a
            // manual start press - see the design note above
            // BURST_TARGET_START_FRAME for why (a two-round-trip start+
            // confirm sequence didn't survive real network latency).
            if (!target.burstChallenge && isBurstAvailable(target)) {
                target.burstChallenge = { startFrame: currentFrame };
            }

            // Earliest frame the attacker could realistically act again.
            // "third issue" fix (combat-system-refactor-plan.md section 6):
            // since a hit-confirmed cancel now opens at the hit-confirm
            // frame itself (see checkHit/canCancel above) rather than
            // waiting for this move's active frames to finish, the only
            // remaining gate before the attacker can act is hitstop itself
            // - so this is just "now + the freeze this hit is about to
            // trigger," not attackStartFrame + a window offset anymore.
            // Non-cancelable moves still have to play out their full
            // duration first, same as before.
            attacker.earliestFollowUpFrame = config.cancelableOnHit
                ? currentFrame + HITSTOP_DURATION_FRAMES
                : attacker.attackStartFrame + config.durationFrames + (attackData.frozenFrames || 0) + HITSTOP_DURATION_FRAMES;

            if (checkComboDrop(attacker, target)) {
                debugLog(`[AttackHandler] combo dropped - ${target.socketId} recovers at frame ${target.stunEndFrame}, ${attacker.socketId} can't follow up until frame ${attacker.earliestFollowUpFrame}`);
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
        debugLog(`[AttackHandler] ${attacker.socketId} hit ${target.socketId} with ${attackData.type} for ${damage.toFixed(1)} damage ${comboNote}`);
    }

    clear() {
        this.activeAttacks.clear();
        this.attackIdCounter = 0;
    }
}

module.exports = { AttackHandler, ATTACK_CONFIG, msToFrames, FRAME_MS, TICK_RATE, incrementComboCount, resetComboCount, calculateScaledDamage, getScaledHitstun, getScaledGravity, checkComboDrop, getScaledKnockback, fillBurstMeter, isBurstAvailable, triggerComboBreaker, handleBurstInput, BURST_CHALLENGE_DURATION_FRAMES };