const { getCharacterData } = require('../data/characterData.js');
const { getMapData } = require('../data/maps.js');
const { AttackHandler, FRAME_MS, TICK_RATE, msToFrames } = require('./attackSystem.js');
const stateMachine = require('./stateMachine.js');
const hitboxSystem = require('./hitboxSystem.js');
const { STATES } = stateMachine;

const gameStates = new Map();
const gameLoopIntervals = new Map();

// ── Step 0 of the combat refactor: frame-based simulation ─────────────
// gameState.tickCount is now the single source of truth for "what frame are
// we on" - every combat timer (dash, hitstun, combo window, ability
// cooldowns) is scheduled against it instead of Date.now(). This is what
// makes input buffering, cancel windows, and eventually rollback netcode
// (spec sections 1, 3, 17) possible - none of those hold up on wall-clock
// timing once network latency gets involved.
//
// Match-level bookkeeping (matchDuration countdown, the lastInputTime combo-
// timeout nicety below) is intentionally left on Date.now() - those aren't
// frame-precise combat mechanics, just UI/meta timers, so converting them
// isn't part of this step's scope.
const GAME_CONFIG = {
    tickRate: TICK_RATE,
    tickInterval: 1000 / TICK_RATE,
    charSelectTimeout: 30000,
    matchDuration: 180000,
    gravity: 0.5,
    inputBufferSize: 10,
    dash:{
        speed: 6,
        durationFrames: msToFrames(200),
        cooldownFrames: msToFrames(1000),
    },
    block: {
        damageReduction: 0.8,
        perfectWindow: 100,
        perfectReduction: 0.95
    }
};


//initialize game state when match starts
const initializeGameState = (roomId, playerData, mapId)=>{
    if(gameStates.has(roomId)){
        console.warn(`[GameState] Game state already exists for room ${roomId}`);
        return gameStates.get(roomId);
    }

    //load map
    const mapData = getMapData(mapId);
    console.log(`[GameState] Initializing game with map: ${mapData.name}`);

    const gameState = {
        roomId,
        phase: "FIGHT",
        startTime: Date.now(),
        tickCount: 0,

        //map configs
        map: {
            id: mapData.id,
            name: mapData.name,
            width: mapData.width,
            height: mapData.height,
            groundY: mapData.groundY,
            backgroundColor: mapData.backgroundColor,
            platforms: mapData.platforms,
            boundaries: mapData.boundaries
        },

        players: playerData.map((p, index)=>{
            const charData = getCharacterData(p.character);
            
            if(!charData){
                console.error(`[GameState] Invalid character: ${p.character}`);
                throw new Error(`Invalid character: ${p.character}`);
            }

            const spawnPoint = mapData.spawnPoints[index] || { 
                x: index === 0 ? 400 : mapData.width - 400, 
                y: mapData.groundY 
            };

            return {
                socketId: p.socketId,
                playerIndex: p.playerIndex,
                character: p.character,
                username: p.username || "Player", 

                size: {
                    width: 115,
                    height: 190
                },

                //position and movement
                position: {
                    x: spawnPoint.x,
                    y: spawnPoint.y
                },
                //── hurtbox interpolation (build-order item 4) ──
                //snapshot of position at the START of the current tick,
                //refreshed every tick before movement is resolved - lets
                //checkHit/applyKnockbackMovement sweep between where a
                //player was and where they end up this tick, instead of
                //only checking the final position. See hitboxSystem.js.
                previousPosition: {
                    x: spawnPoint.x,
                    y: spawnPoint.y
                },
                //── corner pushback (build-order item 4) ──
                //refreshed every tick from hitboxSystem.isAtScreenWall();
                //read by hitboxSystem.applyCornerPushback to decide whether
                //a landed hit's knockback redirects onto the attacker.
                isAtWall: { left: false, right: false },
                velocity: {
                    x: 0,
                    y: 0
                },
                facing: index === 0 ? 1 : -1,
                currentDirection: 0,

                //match-level state (victory/defeated/active) - separate from
                //combatState below, which is the section-3 per-frame combat
                //state machine. Match outcome isn't a combat-refactor concern.
                state: 'active', // Can be: 'active', 'victory', 'defeated'

                //── combat state machine (server/core/stateMachine.js) ──
                //single authoritative state; isAttacking/isStunned/isDashing/
                //isDead below are now a MIRROR of this, kept in sync by
                //setCombatState() - nothing else should assign them directly.
                ...stateMachine.createInitialCombatState(),

                //legacy flags - synced from combatState, kept so
                //attackSystem.js and the client payload don't need to change
                //this step (sprite/audio retargeting is sections 4-5)
                isGrounded: false,
                isJumping: false,
                isAttacking: false,
                isStunned: false,
                stunEndFrame: 0,
                isDead: false,
                isDashing: false,     
                dashTimer: 0,        
                dashCooldownTimer: 0,
                isBlocking: false,      
                blockActivatedFrame: 0,
                
                //── hitstop / impact freeze (build-order item 2) ──
                //orthogonal to combatState - see stateMachine.js's
                //triggerHitstop/updateHitstopTimer/isFrozen
                hitstopFrames: 0,

                //stats from character data
                health: charData.stats.maxHealth,
                maxHealth: charData.stats.maxHealth,
                speed: charData.stats.speed,
                jumpForce: charData.stats.jumpForce,
                weight: charData.stats.weight,
                
                //abilities and cooldowns (frame counts now, not ms - see
                //getClientGameState() for the ms conversion sent to clients)
                abilities: charData.abilities,
                cooldowns: {
                    dash: 0,
                    attack1: 0,
                    attack2: 0,
                    basic: 0,
                    special: 0,
                    ultimate: 0,
                },
                currentAttack: null,
                currentAttackId: null,
                
                //combat stats
                combo: 0,
                comboWindowEndFrame: 0,
                damage: 0,
                damageReceived: 0,
                killCount: 0,
                
                //raw per-tick network input reception queue - drained every
                //tick regardless of legality (see processInput/gameTick).
                //NOT the same thing as actionBuffer below.
                inputBuffer: [],
                lastInputTime: 0,

                //── input buffer (spec section 1) ──
                //short-lived queue for committed actions (jump/attack/dash)
                //that arrived while illegal to perform, so they still fire
                //the instant the current lock ends instead of being dropped.
                //see addToInputBuffer/pruneInputBuffer/consumeOldestValidInput
                //below.
                actionBuffer: [],

                //highest client input sequence number this player's inputs have been
                //applied through - echoed back to the client in getClientGameState()
                //so it knows which locally-predicted inputs are now confirmed and can
                //be dropped from its replay buffer (see client render.js reconcileLocalPlayer)
                lastProcessedSeq: -1
            };
        }),
        
        //match stats
        winner: null,
        matchEndTime: null,
        
        //projectiles, effects,
        projectiles: [],
        effects: []
    };
    gameState.attackHandler = new AttackHandler();

    gameStates.set(roomId, gameState);
    console.log(`[GameState] Initialized game state for room ${roomId}`);
    
    return gameState;
};


const getGameState = (roomId)=>{
    return gameStates.get(roomId);
};


//update cooldowns - decrements every ability cooldown by exactly one frame
//per tick. (Previously this ran once here AND once again inline in gameTick
//with a ms deltaTime, which double-decremented every cooldown every tick -
//found during this pass's audit per the plan's section 1 note about
//auditing issues while touching this code; fixed as part of the rewrite.)
const updateCooldowns = (player)=>{
    Object.keys(player.cooldowns).forEach(key => {
        if(player.cooldowns[key] > 0){
            player.cooldowns[key] = Math.max(0, player.cooldowns[key] - 1);
        }
    });
};


//process player input
const processInput = (roomId, socketId, input)=>{
    const gameState = gameStates.get(roomId);
    
    if(!gameState || gameState.phase !== "FIGHT"){
        return null;
    }
    
    const player = gameState.players.find(p => p.socketId === socketId);
    
    if(!player || player.isDead){
        return null;
    }
    
    //validate input
    const validatedInput = {
        type: input.type,
        direction: input.direction || 0,
        ability: input.ability || null,
        activate: input.activate !== undefined ? input.activate : null, 
        seq: typeof input.seq === 'number' ? input.seq : undefined,
        timestamp: Date.now()
    };
    
    //add to input buffer
    player.inputBuffer.push(validatedInput);
    
    //keep buffer size limited
    if(player.inputBuffer.length > GAME_CONFIG.inputBufferSize){
        player.inputBuffer.shift();
    }
    
    player.lastInputTime = validatedInput.timestamp;
    
    return validatedInput;
};

//apply to player movement
const applyMovement = (player, players, direction, deltaTime, mapBoundaries)=>{
    if(!stateMachine.canMove(player.combatState)){
        // NOTE: deliberately NOT zeroing velocity.x here anymore (build-order
        // item 4). This guard runs on EVERY tick for EVERY player, because
        // the client (public/core/socket.js processInputs()) sends a
        // {type:'move', direction} input unconditionally every tick, direction:0
        // included - so moveInputs is essentially never empty, and this
        // branch is reached every single tick a player is locked/stunned.
        // Hit resolution (attackHandler.updateAttacks) runs once at the top
        // of gameTick, BEFORE the per-player loop this is called from - so
        // by the time this guard runs on the same tick a hit landed, any
        // knockback/recoil velocity is already sitting on the player, and
        // blindly zeroing it here discarded it before applyKnockbackMovement
        // (below, in the per-player loop) ever got a chance to integrate it
        // into position. applyKnockbackMovement now owns decaying velocity.x
        // to zero on its own (see KNOCKBACK_STOP_THRESHOLD) once it's actually
        // been used, so this guard only needs to skip input-driven walking.
        return;
    }
    
    //update facing direction
    if(direction !== 0){
        player.facing = direction;
    }

    player.currentDirection = direction;
    
    let speed = player.speed;
    
    if(player.isDashing){
        speed = player.speed * GAME_CONFIG.dash.speed;
    } 
    else if(player.isBlocking){
        speed = 0;
    }
    
    //apply horizontal velocity
    player.velocity.x = direction * speed;
    
    //update position
    player.position.x += player.velocity.x;
    
    //player-to-player collision detection
    players.forEach(p2 => {
        if (p2.socketId === player.socketId) {
            return;
        }
        
        // Calculate overlap
        const dx = player.position.x - p2.position.x;
        const combinedHalfWidth = (player.size.width + p2.size.width) / 2;
        
        // Check if players are overlapping horizontally
        if (Math.abs(dx) < combinedHalfWidth) {
            // Check vertical overlap
            const dy = player.position.y - p2.position.y;
            const combinedHalfHeight = (player.size.height + p2.size.height) / 2;
            
            if (Math.abs(dy) < combinedHalfHeight) {
                // Players are colliding - push them apart
                const overlapX = combinedHalfWidth - Math.abs(dx);
                
                // Push players apart based on direction
                if (dx > 0) {
                    // player is to the right of p2
                    player.position.x += overlapX / 2;
                    p2.position.x -= overlapX / 2;
                } else {
                    // player is to the left of p2
                    player.position.x -= overlapX / 2;
                    p2.position.x += overlapX / 2;
                }
                
                // Immediately clamp both players to boundaries after pushing
                const leftBound = mapBoundaries.left + player.size.width / 2;
                const rightBound = mapBoundaries.right - player.size.width / 2;
                const leftBound2 = mapBoundaries.left + p2.size.width / 2;
                const rightBound2 = mapBoundaries.right - p2.size.width / 2;
                
                player.position.x = Math.max(leftBound, Math.min(rightBound, player.position.x));
                p2.position.x = Math.max(leftBound2, Math.min(rightBound2, p2.position.x));
            }
        }
    });

    //ensure player stays within map boundary
    const leftBound = mapBoundaries.left + player.size.width / 2;
    const rightBound = mapBoundaries.right - player.size.width / 2;
    player.position.x = Math.max(leftBound, Math.min(rightBound, player.position.x));
};


const applyJump = (player)=>{
    if(player.isGrounded && !player.isJumping && stateMachine.canJump(player.combatState)){
        player.velocity.y = -player.jumpForce;
        player.isGrounded = false;
        player.isJumping = true;
    }
};


const applyGravity = (player, deltaTime, groundY)=>{
    if(!player.isGrounded){
        player.velocity.y += GAME_CONFIG.gravity;
        player.position.y += player.velocity.y;
        
        //check if landd
        if(player.position.y >= groundY){
            player.position.y = groundY;
            player.velocity.y = 0;
            player.isGrounded = true;
            player.isJumping = false;
        }
    }
};

// ── Knockback movement integration (build-order item 4) ───────────────
// applyHit -> hitboxSystem.applyCornerPushback only set velocity.x/y on a
// landed hit - turning that into actual displacement, with friction decay
// and wall safety, happens here every tick for whichever player isn't
// already having velocity.x driven by applyMovement's input-driven walking
// this tick (hitstun, or attacker recoil while locked in an attack state).
// Without this step the knockback/corner-pushback work above would set
// velocity that never moved anyone.
//
// NOTE: this intentionally does NOT resolve player-vs-player pushbox
// overlap the way applyMovement's walking collision does - general pushbox
// squeezing is its own build-order item (9 / spec section 9), not this one.
// The wall clamp below is what item 4's corner-pushback actually needs:
// once a knocked-back player reaches the stage boundary, the slide stops
// there, same boundary hitboxSystem.isAtScreenWall checks against.
const KNOCKBACK_FRICTION = 0.85; // per-tick decay so a knockback slides to a stop instead of forever
const KNOCKBACK_STOP_THRESHOLD = 0.5;

const applyKnockbackMovement = (player, mapBoundaries) => {
    if (Math.abs(player.velocity.x) < KNOCKBACK_STOP_THRESHOLD) {
        player.velocity.x = 0;
        return;
    }

    const leftBound = mapBoundaries.left + player.size.width / 2;
    const rightBound = mapBoundaries.right - player.size.width / 2;
    const nextX = Math.max(leftBound, Math.min(rightBound, player.position.x + player.velocity.x));

    player.position.x = nextX;

    // Hitting the wall kills the remaining slide; otherwise the knockback
    // decays each tick instead of running forever.
    if (nextX <= leftBound || nextX >= rightBound) {
        player.velocity.x = 0;
    } else {
        player.velocity.x *= KNOCKBACK_FRICTION;
    }
};

const applyDash = (player, currentFrame) => {
    // Can't dash if already dashing, attacking, stunned/locked, or on cooldown
    if(!stateMachine.canDash(player.combatState) ||
       player.dashCooldownTimer > 0 || player.isBlocking || player.velocity.x == 0){
        return { success: false, reason: 'cannot_dash' };
    }
    
    // Activate dash
    stateMachine.setCombatState(player, STATES.DASHING, currentFrame);
    player.dashTimer = GAME_CONFIG.dash.durationFrames;
    player.dashCooldownTimer = GAME_CONFIG.dash.cooldownFrames;
    
    console.log(`[GameState] Player ${player.socketId} dashed!`);

    return { success: true };
};

const applyBlock = (player, activate) => {
    if(activate){
        if(!player.isBlocking && stateMachine.canStartBlock(player.combatState)){
            player.isBlocking = true;
            player.blockActivatedFrame = player.combatStateEnteredFrame; // approximate, block isn't a combatState itself
            console.log(`[GameState] Player ${player.socketId} started blocking`);
        }
    } 
    else {
        if(player.isBlocking){
            player.isBlocking = false;
            console.log(`[GameState] Player ${player.socketId} stopped blocking`);
        }
    }
};

// ── Input Buffering System (build-order item 1 / spec section 1) ──────
// A naive engine drops a jump/attack/dash pressed a few frames before the
// current lock (attack recovery, hitstun, ...) ends, which feels
// unresponsive. Instead, committed actions that can't legally execute the
// instant they arrive get queued here and retried every tick until either
// they succeed or they age out of the window. Movement (continuous, sent
// every tick already) and block (a hold-state, not a one-shot commit) are
// NOT buffered - only jump/attack/dash, which are the ones gated by
// stateMachine's canPerformAction.
const ACTION_BUFFER_WINDOW_FRAMES = 5; // spec calls for a 4-6 frame window

const addToInputBuffer = (player, input, currentFrame) => {
    player.actionBuffer.push({ input, bufferedFrame: currentFrame });
};

const pruneInputBuffer = (player, currentFrame) => {
    player.actionBuffer = player.actionBuffer.filter(
        entry => currentFrame - entry.bufferedFrame <= ACTION_BUFFER_WINDOW_FRAMES
    );
};

// "is this character currently in a state that allows a new action" - the
// SAME base gate jump/attack/dash already share in stateMachine.js. Extra,
// action-specific gates (isGrounded, cooldown, dash velocity/isBlocking)
// are still checked by applyJump/applyDash/initiateAttack themselves at
// execution time, same as they always were for a same-tick input.
const canPerformAction = (player) => {
    return stateMachine.canPerformAction(player.combatState);
};

// called once per player per tick. Checks two things in order:
//   1) can the OLDEST buffered entry cancel the player's currently active
//      attack (build-order item 3)? If so, do that immediately - this can
//      fire even while combatState is still an attack_* state, since a
//      cancel is specifically the exception to the normal "can't act while
//      attacking" rule.
//   2) otherwise, fall back to the normal path: if the state machine
//      currently allows a fresh action, pop and execute the OLDEST buffered
//      entry (FIFO, per spec - a newer entry further back in the queue is
//      not "peeked ahead of" even if it happens to be more immediately
//      executable). The entry is consumed either way once popped - if the
//      underlying action still refuses (e.g. still on cooldown, not
//      grounded for a jump), that's the same outcome a same-tick unbuffered
//      input would have had, so it's simply dropped rather than requeued.
const consumeOldestValidInput = (gameState, player, currentFrame) => {
    if (player.actionBuffer.length === 0) {
        return;
    }

    const oldest = player.actionBuffer[0];

    if (oldest.input.type === 'attack' && player.currentAttackId) {
        const currentAttackData = gameState.attackHandler.activeAttacks.get(player.currentAttackId);
        if (currentAttackData && gameState.attackHandler.canCancel(currentAttackData, oldest.input.ability, currentFrame)) {
            player.actionBuffer.shift();
            gameState.attackHandler.executeCancel(gameState, player, currentAttackData, oldest.input.ability);
            return;
        }
    }

    if (!canPerformAction(player)) {
        return;
    }

    const { input, bufferedFrame } = player.actionBuffer.shift();

    switch (input.type) {
        case 'jump':
            applyJump(player);
            break;
        case 'dash':
            applyDash(player, currentFrame);
            break;
        case 'attack': {
            const result = gameState.attackHandler.initiateAttack(gameState, player, input.ability);
            const bufferedFor = currentFrame - bufferedFrame;
            if (result.success) {
                console.log(`[GameState] ${player.socketId} started ${input.ability}${bufferedFor > 0 ? ` (buffered ${bufferedFor}f)` : ''}`);
            } else {
                console.log(`[GameState] Buffered attack ${input.ability} failed: ${result.reason}`);
            }
            break;
        }
    }
};

//main game loop update
const gameTick = (roomId, io)=>{
    const gameState = gameStates.get(roomId);
    
    if(!gameState || gameState.phase !== "FIGHT"){
        stopGameLoop(roomId);
        return;
    }
    
    // frame-based combat timing: the server tick IS "one frame" (fixed
    // 60Hz interval below), so tickCount is incremented once per call and
    // used directly as the frame counter everywhere else - no more
    // Date.now()-derived deltaTime for combat scheduling.
    gameState.tickCount++;
    const currentFrame = gameState.tickCount;
    gameState.attackHandler.updateAttacks(gameState);

    const currentTime = Date.now(); // wall-clock, only for the non-combat timers noted below
    
    //check if match time expired
    const elapsedTime = currentTime - gameState.startTime;
    if(elapsedTime >= GAME_CONFIG.matchDuration){
        endMatch(roomId, io);
        return;
    }
    const checkMatchEnd = (gameState) => {
        // Check if time is up
        if (gameState.timeRemaining <= 0) {
            const p1 = gameState.players[0];
            const p2 = gameState.players[1];

            let winner;
            if (p1.health > p2.health) {
                winner = p1.socketId;
                p1.state = 'victory';
                p2.state = 'defeated';
            } else if (p2.health > p1.health) {
                winner = p2.socketId;
                p2.state = 'victory';
                p1.state = 'defeated';
            } else {
                // Draw - both defeated
                winner = null;
                p1.state = 'defeated';
                p2.state = 'defeated';
            }

            return { gameEnded: true, winner, reason: 'timeout' };
        }

        // Check for K.O.
        const alivePlayers = gameState.players.filter(p => !p.isDead);

        if (alivePlayers.length === 1) {
            // One player left - they win
            const winner = alivePlayers[0];
            const loser = gameState.players.find(p => p.socketId !== winner.socketId);

            winner.state = 'victory';
            loser.state = 'defeated';
            // loser.isDead is already true (set by the state machine when health hit 0)

            return { gameEnded: true, winner: winner.socketId, reason: 'ko' };
        }

        if (alivePlayers.length === 0) {
            // Both dead - draw
            gameState.players.forEach(p => p.state = 'defeated');
            return { gameEnded: true, winner: null, reason: 'double_ko' };
        }

        return { gameEnded: false };
    };
    //update all players
    gameState.players.forEach(player=>{
        if(player.isDead){
            return;
        }

        // Snapshot start-of-tick position/wall-contact (build-order item 4)
        // before anything below moves this player - interpolateHurtbox
        // sweeps use previousPosition -> position, and applyCornerPushback
        // reads isAtWall, so both need to reflect where this tick started.
        player.previousPosition = { x: player.position.x, y: player.position.y };
        player.isAtWall = hitboxSystem.isAtScreenWall(player, gameState.map.boundaries);

        // hitstop: freeze this player entirely for a few frames - no
        // cooldowns, no stun/dash timers, no input processing, no physics.
        // Everything below this point is exactly the stuff the spec says
        // should pause ("no movement, animations paused"), so the simplest
        // correct implementation is to just not run any of it this tick.
        if (stateMachine.isFrozen(player)) {
            stateMachine.updateHitstopTimer(player);
            return;
        }

        //update cooldowns - exactly once per tick (see updateCooldowns() note re: the old double-decrement)
        updateCooldowns(player);

        if (player.isStunned && player.stunEndFrame && currentFrame >= player.stunEndFrame) {
            stateMachine.setCombatState(player, STATES.IDLE, currentFrame);
            player.stunEndFrame = 0;
            player.velocity.x = 0; // Clear velocity to prevent walk animation
            console.log(`[GameState] ${player.socketId} stun ended`);
        }

        if(player.dashTimer > 0){
            player.dashTimer -= 1;
            if(player.dashTimer <= 0){
                player.dashTimer = 0;
                if (player.combatState === STATES.DASHING) {
                    stateMachine.setCombatState(player, STATES.IDLE, currentFrame);
                }
            }
        }

        //update dash cooldown
        if(player.dashCooldownTimer > 0){
            player.dashCooldownTimer -= 1;
            if(player.dashCooldownTimer <= 0){
                player.dashCooldownTimer = 0;
            }
        }
        
        //process all buffered inputs
        const moveInputs = [];
        const otherInputs = [];

        //empty the entire buffer
        while(player.inputBuffer.length > 0){
            const input = player.inputBuffer.shift();

            //inputs are shifted out in the order they were pushed (client sends them
            //with a monotonically increasing seq), so the last one processed this
            //tick is always the highest seq seen so far
            if(typeof input.seq === 'number'){
                player.lastProcessedSeq = input.seq;
            }

            if(input.type === 'move'){
                moveInputs.push(input);
            }
            else {
                otherInputs.push(input);
            }
        }

        //apply movement once per buffered move input (one per real client tick),
        //not just the latest one. On a low-latency link inputBuffer usually holds at
        //most one 'move' per gameTick anyway, so this was invisible in local/LAN
        //testing. But over a high-RTT or jittery link, several client ticks' worth of
        //'move' messages routinely land in the buffer between two server gameTick
        //calls - collapsing them to "latestMovement" silently discarded the other
        //ticks' displacement, even though the lastProcessedSeq bump above still
        //marked every one of those seqs as "confirmed". That made the client drop
        //those exact ticks out of pendingInputs and never replay them either, so the
        //authoritative position quietly fell behind what the player actually held
        //down - and the next reconciliation had to snap hard to correct it.
        if(moveInputs.length > 0){
            moveInputs.forEach(moveInput => {
                applyMovement(player, gameState.players, moveInput.direction, null, gameState.map.boundaries);
            });
            player.currentDirection = moveInputs[moveInputs.length - 1].direction;
        }
        // else: no move input this tick. Previously this branch force-zeroed
        // velocity.x whenever the player was stunned, which silently ate any
        // knockback velocity a hit had just set before it ever displaced
        // anyone - build-order item 4 needs that velocity to survive so
        // applyKnockbackMovement (below, after this tick's attack resolves)
        // can actually turn it into movement. Nothing to do here now; the
        // knockback-movement pass replaces this.

        //process all other inputs - jump/attack/dash are committed actions
        //gated by combat-state legality, so they go through the input
        //buffer (see addToInputBuffer/consumeOldestValidInput above) instead
        //of executing directly: a button pressed a few frames before the
        //current lock ends still fires the instant it's legal, rather than
        //being silently dropped like before. Block is a hold-state, not a
        //one-shot committed action, so it stays immediate.
        otherInputs.forEach(input => {
            switch (input.type) {
                case 'jump':
                case 'attack':
                case 'dash':
                    addToInputBuffer(player, input, currentFrame);
                    break;
                case 'block':
                    applyBlock(player, input.activate);
                    break;
            }
        });

        pruneInputBuffer(player, currentFrame);
        consumeOldestValidInput(gameState, player, currentFrame);

        // Knockback movement (build-order item 4): turns whatever velocity.x
        // applyCornerPushback set on this player during the attack resolution
        // just above (hit reaction, or attacker recoil) into actual
        // displacement, with wall safety and friction decay.
        //
        // Gate is stateMachine.canMove(), NOT moveInputs.length - the client
        // (public/core/socket.js processInputs()) sends a {type:'move',
        // direction} input EVERY tick unconditionally, direction:0 included,
        // so moveInputs is essentially never empty for a connected player.
        // Gating on that meant this never ran in a real match (it only
        // looked right in isolated testing where no move inputs were ever
        // sent at all) - knockback velocity got set on hit and then
        // immediately zeroed by applyMovement's own "can't move while
        // locked" guard above, without ever displacing anyone. canMove()
        // correctly identifies "applyMovement just zeroed velocity.x and
        // bailed without moving position" (hitstun, attack lock) versus
        // "applyMovement legitimately owns velocity.x this tick" (free to
        // walk) - only the former should fall through to here.
        if (!stateMachine.canMove(player.combatState)) {
            applyKnockbackMovement(player, gameState.map.boundaries);
        }

        applyGravity(player, null, gameState.map.groundY);

        //classify idle/walking/jumping/airborne now that this tick's physics
        //and inputs have both been applied (event-driven states - attack_*,
        //hitstun, dashing, dead - manage their own transitions above and are
        //left alone by this call)
        stateMachine.resolveMovementState(player, currentFrame);
        
        //reset combo on no recent input (wall-clock: this is about real input
        //cadence over the network, not simulation timing, so it stays as-is)
        if(currentTime - player.lastInputTime > 2000){
            player.combo = 0;
        }
    });
    const matchEndCheck = checkMatchEnd(gameState);

    if (matchEndCheck.gameEnded) {
        gameState.phase = "ENDED";
        
        if (gameLoopIntervals.has(roomId)) {
            clearInterval(gameLoopIntervals.get(roomId));
            gameLoopIntervals.delete(roomId);
        }
        
        io.to(roomId).emit('knockoutAnimation', {
            winner: matchEndCheck.winner
        });
        
        // Play victory/defeat animations for 3 seconds before ending
        const animationDuration = 3000;
        
        setTimeout(() => {
            // Send final game state with animations
            io.to(roomId).emit('gameStateUpdate', {
                players: gameState.players.map(p => ({
                    socketId: p.socketId,
                    playerIndex: p.playerIndex,
                    character: p.character,
                    username: p.username || "Player",
                    size: p.size,
                    position: p.position,
                    velocity: p.velocity,
                    facing: p.facing,
                    speed: p.speed,          // ADDED
                    jumpForce: p.jumpForce,  // ADDED
                    health: p.health,
                    maxHealth: p.maxHealth,
                    isGrounded: p.isGrounded,
                    isAttacking: p.isAttacking,
                    currentAttack: p.currentAttack,
                    attackFrame: p.attackFrame,
                    isBlocking: p.isBlocking,
                    isDashing: p.isDashing,
                    isStunned: p.isStunned,
                    isDead: p.isDead,
                    state: p.state, // 'victory' or 'defeated'
                    cooldowns: msCooldowns(p.cooldowns),
                    combo: p.combo,
                    lastProcessedSeq: p.lastProcessedSeq ?? -1
                })),
                timeRemaining: gameState.timeRemaining
            });
            
            // Send match end event
            io.to(roomId).emit('matchEnd', {
                winner: matchEndCheck.winner,
                finalStats: gameState.players.map(p => ({
                    socketId: p.socketId,
                    character: p.character,
                    health: p.health,
                    damage: p.damage,
                    damageReceived: p.damageReceived,
                    combo: p.combo,
                    killCount: p.killCount
                })),
                reason: matchEndCheck.reason
            });
            
            console.log(`[GameState] Match ended in room ${roomId}. Winner: ${matchEndCheck.winner || 'Draw'}`);
            
            // Don't delete game state immediately - keep for rematch
            // gameStates.delete(roomId);
            
        }, animationDuration);
        
        return; // Stop further game loop iterations
    }
    
    //win conditions
    const alivePlayers = gameState.players.filter(p => !p.isDead);
    if(alivePlayers.length === 1){
        endMatch(roomId, io, alivePlayers[0]);
        return;
    }
    
    //emit state update
    if(gameState.tickCount % 3 === 0) {
        io.to(roomId).emit('gameStateUpdate', getClientGameState(gameState));
    }
};

//main server side game loop
const startGameLoop = (roomId, io)=>{
    if(gameLoopIntervals.has(roomId)){
        console.warn(`[GameState] Game loop already running for room ${roomId}`);
        return;
    }
    
    console.log(`[GameState] Starting game loop for room ${roomId}`);
    
    const intervalId = setInterval(()=>{
        gameTick(roomId, io);
    }, GAME_CONFIG.tickInterval);
    
    gameLoopIntervals.set(roomId, intervalId);
};


const stopGameLoop = (roomId)=>{
    if(gameLoopIntervals.has(roomId)){
        clearInterval(gameLoopIntervals.get(roomId));
        gameLoopIntervals.delete(roomId);
        console.log(`[GameState] Stopped game loop for room ${roomId}`);
    }
};

//handle end of match
const endMatch = (roomId, io, winner = null)=>{
    const gameState = gameStates.get(roomId);
    
    if(!gameState){
        return;
    }
    
    gameState.phase = "ENDED";
    gameState.matchEndTime = Date.now();
    
    if(!winner){
        winner = gameState.players.reduce((prev, current) => 
            current.health > prev.health ? current : prev
        );
    }
    
    gameState.winner = winner.socketId;
    
    stopGameLoop(roomId);
    
    //emit match end event
    io.to(roomId).emit('matchEnd', {
        winner: winner.socketId,
        finalStats: gameState.players.map(p => ({
            socketId: p.socketId,
            character: p.character,
            health: p.health,
            damage: p.damage,
            damageReceived: p.damageReceived,
            killCount: p.killCount
        }))
    });
    
    console.log(`[GameState] Match ended in room ${roomId}, winner: ${winner.socketId}`);
    
    setTimeout(()=>{
        deleteGameState(roomId);
    }, 5000);
};

//cooldowns are tracked in frames internally (see the note at the top of this
//file) but the client/UI still expects milliseconds (battleUI.js's ultimate
//bar divides by a fixed 30000ms, and the cooldown readout does cd/1000 for
//seconds) - that wire format is owned by build-order item 13 (meter economy
/// Ultimate bar repurpose), not this step, so this converts back to the same
//ms values the client has always received.
const msCooldowns = (cooldowns) => {
    const out = {};
    Object.keys(cooldowns).forEach(key => {
        out[key] = cooldowns[key] * FRAME_MS;
    });
    return out;
};

//client game state
const getClientGameState = (gameState)=>{
    return {
        roomId: gameState.roomId,
        phase: gameState.phase,
        tickCount: gameState.tickCount,
        timeRemaining: GAME_CONFIG.matchDuration - (Date.now() - gameState.startTime),
        map: gameState.map,
        players: gameState.players.map(p => ({
            socketId: p.socketId,
            playerIndex: p.playerIndex,
            character: p.character,
            username: p.username || "Player",
            size: p.size,
            position: p.position,
            velocity: p.velocity,
            facing: p.facing,
            speed: p.speed,          // ADDED
            jumpForce: p.jumpForce,  // ADDED
            health: p.health,
            maxHealth: p.maxHealth,
            isGrounded: p.isGrounded,
            isAttacking: p.isAttacking || false,
            currentAttack: p.currentAttack || null,
            attackFrame: p.attackFrame || 0,
            isBlocking: p.isBlocking,
            isDashing: p.isDashing, 
            dashTimer: p.dashTimer * FRAME_MS,
            dashCooldownTimer: p.dashCooldownTimer * FRAME_MS,
            isStunned: p.isStunned,
            isDead: p.isDead,
            // NOT yet consumed client-side (sprite/audio retargeting onto
            // combatState/hitstop is sections 4-5, not this item) - exposed
            // now so that work has the data to key off when it lands.
            isFrozen: stateMachine.isFrozen(p),
            state: p.state || 'active', // FIXED: Include state for animations
            cooldowns: msCooldowns(p.cooldowns),
            combo: p.combo,
            lastProcessedSeq: p.lastProcessedSeq ?? -1
        })),
        projectiles: gameState.projectiles,
        effects: gameState.effects
    };
};


const deleteGameState = (roomId)=>{
    stopGameLoop(roomId);
    gameStates.delete(roomId);
    console.log(`[GameState] Deleted game state for room ${roomId}`);
};

module.exports = { GAME_CONFIG, initializeGameState, getGameState, processInput, startGameLoop, stopGameLoop, endMatch, deleteGameState, getClientGameState };