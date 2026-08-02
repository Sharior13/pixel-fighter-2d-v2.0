const { getCharacterData } = require('../data/characterData.js');
const { getMapData } = require('../data/maps.js');
const { AttackHandler, FRAME_MS, TICK_RATE, msToFrames } = require('./attackSystem.js');
const stateMachine = require('./stateMachine.js');
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
                
                //input buffer
                inputBuffer: [],
                lastInputTime: 0,

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
        player.velocity.x = 0; // Clear horizontal velocity while attacking/stunned/locked
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
        let latestMovement = null;
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
                latestMovement = input;
            }
            else {
                otherInputs.push(input);
            }
        }

        //apply latest movement
        if(latestMovement){
            applyMovement(player, gameState.players, latestMovement.direction, null, gameState.map.boundaries);
            player.currentDirection = latestMovement.direction;
        } else {
            if (player.isStunned && !player.isAttacking) {
                player.velocity.x = 0;
            }
        }

        //process all other inputs
        otherInputs.forEach(input => {
            switch (input.type) {
                case 'jump':
                    applyJump(player);
                    break;
                case 'attack':
                    const result = gameState.attackHandler.initiateAttack(
                        gameState,
                        player,
                        input.ability
                    );
                    
                    if (result.success) {
                        console.log(`[GameState] ${player.socketId} started ${input.ability}`);
                    } else {
                        console.log(`[GameState] Attack ${input.ability} failed: ${result.reason}`);
                    }
                    break;
                case 'block':
                    applyBlock(player, input.activate);
                    break;
                case 'dash':
                    applyDash(player, currentFrame);
                    break;
            }
        });
        
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