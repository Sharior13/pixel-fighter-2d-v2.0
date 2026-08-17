import { ASSET_BASE_URL } from "./config.js";
import { debugLog, debugWarn, debugError } from "./debug.js";

class SpriteAnimator {
    constructor(spriteSheets, config) {
        this.spriteSheets = spriteSheets;
        this.config = config;
        this.currentAnimation = 'idle';
        this.currentFrame = 0;
        this.frameTimer = 0;

        // 'transition-loop' state (see animation-engine-refactor-spec.md):
        // which sub-clip (intro one-shot, or the hold loop it hands off to)
        // is currently playing. Reset to 'intro' whenever setAnimation()
        // resets playback.
        this.transitionPhase = 'intro';

        // 'tick-sequence' state: the player.attackFrame value used to
        // produce the currently-drawn frame, kept around so
        // isAnimationFinished() (which is called with no arguments) can
        // still answer correctly without needing the player object again.
        this._lastAttackFrame = 0;

        //track loading across all images
        this._totalSheets = Object.keys(spriteSheets).length;
        this._loadedCount = 0;
        this.isLoaded = false;

        Object.entries(this.spriteSheets).forEach(([name, img]) => {
            if (img.complete && img.naturalWidth !== 0) {
                this._loadedCount++;
            } else {
                img.addEventListener('load', () => {
                    this._loadedCount++;
                    if (this._loadedCount >= this._totalSheets) {
                        this.isLoaded = true;
                        debugLog(`[SpriteAnimator] All sheets loaded: ${this.config.name}`);
                    }
                });
                img.addEventListener('error', () => {
                    debugError(`[SpriteAnimator] Failed to load sheet "${name}" for: ${this.config.name}`);
                });
            }
        });

        if (this._loadedCount >= this._totalSheets) {
            this.isLoaded = true;
        }
    }
    
    // `player` is accepted (and currently unused) so the call signature
    // already matches what the upcoming 'tick-sequence' mode needs (it reads
    // player.attackFrame - see animation-engine-refactor-spec.md) without a
    // second call-site change later. SpriteManager/render.js already pass it
    // through as of this step.
    update(deltaTime, player) {
        if (!this.isLoaded) return;

        const animation = this.config.animations[this.currentAnimation];
        if (!animation) {
            debugWarn(`[SpriteAnimator] Animation not found: ${this.currentAnimation}`);
            return;
        }

        // syncMode branching (see animation-engine-refactor-spec.md). No
        // character data sets syncMode yet, so the missing-value fallback
        // below IS 'loop' - this keeps every current animation playing
        // exactly as before via _updateTimerBased.
        const syncMode = animation.syncMode || 'loop';

        switch (syncMode) {
            case 'loop':
            case 'one-shot':
                this._updateTimerBased(deltaTime, animation);
                break;
            case 'transition-loop':
                this._updateTransitionLoop(deltaTime, animation);
                break;
            case 'tick-sequence':
                this._updateTickSequence(animation, player);
                break;
            default:
                debugWarn(`[SpriteAnimator] Unknown syncMode "${syncMode}", falling back to timer-based playback`);
                this._updateTimerBased(deltaTime, animation);
        }
    }

    // Exactly the pre-refactor update() body, unchanged, just extracted so
    // 'loop' and 'one-shot' (and any animation with no syncMode set) can
    // share it explicitly instead of it being the only path that existed.
    _updateTimerBased(deltaTime, animation) {
        this.frameTimer += deltaTime;

        if (this.frameTimer >= animation.frameDelay) {
            this.frameTimer = 0;
            this.currentFrame++;

            if (this.currentFrame >= animation.frames) {
                if (animation.loop) {
                    this.currentFrame = 0;
                } else {
                    this.currentFrame = animation.frames - 1;
                    if (animation.onComplete) {
                        animation.onComplete();
                    }
                }
            }
        }
    }

    // 'transition-loop' mode (see animation-engine-refactor-spec.md):
    // plays animation.intro once at its own frameDelay, then hands off to
    // animation.hold and loops there. The condition for leaving this
    // animation altogether (exitCondition) is NOT evaluated here - that's
    // animationStateManager's job, deciding whether to call setAnimation()
    // to a different target. This method only owns the intro->hold handoff
    // internal to a single animation staying selected.
    _updateTransitionLoop(deltaTime, animation) {
        const sub = this.transitionPhase === 'hold' ? animation.hold : animation.intro;
        if (!sub) {
            debugWarn(`[SpriteAnimator] transition-loop animation "${this.currentAnimation}" missing "${this.transitionPhase}" clip`);
            return;
        }

        this.frameTimer += deltaTime;

        if (this.frameTimer >= sub.frameDelay) {
            this.frameTimer = 0;
            this.currentFrame++;

            if (this.currentFrame >= sub.frames) {
                if (sub.loop) {
                    this.currentFrame = 0;
                } else if (this.transitionPhase === 'intro') {
                    // intro clip finished - hand off to the hold clip
                    this.transitionPhase = 'hold';
                    this.currentFrame = 0;
                } else {
                    // hold clip authored non-looping (unusual) - just hold
                    // its last frame rather than reading past the end
                    this.currentFrame = sub.frames - 1;
                }
            }
        }
    }

    // 'tick-sequence' mode (see animation-engine-refactor-spec.md): no
    // independent timer at all. The frame to draw is looked up directly
    // from the authoritative combat tick data (player.attackFrame, wired in
    // attackSystem.js's updateAttacks()) via this animation's frameSequence
    // table. Because this reads player.attackFrame fresh every call,
    // hitstop freezes and rollback/reconciliation replays are automatically
    // correct - whatever tick the sim says it's on is exactly the frame
    // shown, with no separate clock that could ever drift from it.
    _updateTickSequence(animation, player) {
        const seq = animation.frameSequence;
        if (!seq || seq.length === 0) {
            debugWarn(`[SpriteAnimator] tick-sequence animation "${this.currentAnimation}" has no frameSequence`);
            return;
        }

        const attackFrame = player?.attackFrame ?? 0;
        this._lastAttackFrame = attackFrame;
        this.currentFrame = seq[attackFrame] ?? seq[seq.length - 1];
    }
    
    setAnimation(animationName, reset = true) {
        if (this.currentAnimation === animationName && !reset) {
            return;
        }
        
        if (!this.config.animations[animationName]) {
            debugWarn(`[SpriteAnimator] Animation not found: ${animationName}`);
            return;
        }
        
        this.currentAnimation = animationName;
        if (reset) {
            this.currentFrame = 0;
            this.frameTimer = 0;
            // restart at the intro clip for transition-loop animations
            this.transitionPhase = 'intro';
        }
    }
    
    draw(ctx, x, y, facing = 1, scale = 1) {
        if (!this.isLoaded) {
            ctx.fillStyle = 'rgba(255, 0, 255, 0.5)';
            ctx.fillRect(x - 25, y - 50, 50, 50);
            return;
        }

        // Declare animation FIRST, then use it to pick the correct sheet image
        const animation = this.config.animations[this.currentAnimation];
        if (!animation) return;

        // transition-loop animations keep their sheet/row/startFrame inside
        // the intro/hold sub-configs rather than on the animation object
        // itself (see animation-engine-refactor-spec.md) - resolve
        // whichever sub-clip is currently active before reading any of
        // those fields. Every other mode just uses `animation` directly,
        // unchanged from before.
        let frameSource = animation;
        if (animation.syncMode === 'transition-loop') {
            frameSource = this.transitionPhase === 'hold' ? animation.hold : animation.intro;
            if (!frameSource) return;
        }

        const sheet = this.spriteSheets[frameSource.sheet || 'main'];
        if (!sheet) {
            debugWarn(`[SpriteAnimator] Sheet "${frameSource.sheet || 'main'}" not found for animation "${this.currentAnimation}"`);
            return;
        }
        
        const frameWidth = this.config.frameWidth;
        const frameHeight = this.config.frameHeight;
        // `|| 0` defaults added for tick-sequence entries, which per the
        // spec don't author startFrame/row/column - existing loop/one-shot
        // data always sets these explicitly, so this is a no-op for it.
        const startFrame = frameSource.startFrame || 0;
        
        let sourceX, sourceY;
        
        if (this.config.layout === 'horizontal') {
            sourceX = (startFrame + this.currentFrame) * frameWidth;
            sourceY = (frameSource.row || 0) * frameHeight;
        } else if (this.config.layout === 'vertical') {
            sourceX = (frameSource.column || 0) * frameWidth;
            sourceY = (startFrame + this.currentFrame) * frameHeight;
        } else {
            // Grid layout
            const totalColumns = this.config.columns || 1;
            const absoluteFrame = startFrame + this.currentFrame;
            sourceX = (absoluteFrame % totalColumns) * frameWidth;
            sourceY = Math.floor(absoluteFrame / totalColumns) * frameHeight;
        }
        
        const destWidth = frameWidth * scale;
        const destHeight = frameHeight * scale;
        const destX = x - (destWidth / 2);
        const destY = y - destHeight;
        
        ctx.save();
        
        if (facing < 0) {
            ctx.translate(x, y);
            ctx.scale(-1, 1);
            ctx.translate(-x, -y);
        }
        
        ctx.imageSmoothingEnabled = false;
        
        ctx.drawImage(
            sheet,
            sourceX, sourceY, frameWidth, frameHeight,
            destX, destY, destWidth, destHeight
        );
        
        ctx.restore();
    }
    
    getCurrentAnimation() {
        return this.currentAnimation;
    }
    
    // Generalized across syncModes (see animation-engine-refactor-spec.md).
    // Used by animationStateManager.canTransitionTo() to decide whether a
    // NON_INTERRUPTIBLE animation is allowed to be replaced yet.
    isAnimationFinished() {
        const animation = this.config.animations[this.currentAnimation];
        if (!animation) return false;

        // NOTE: unlike update(), this does NOT default a missing syncMode
        // to 'loop'. Current character data (attack1/attack2/hit/defeat,
        // etc.) sets loop:false but has no syncMode field at all - falling
        // back to 'loop' here would make isAnimationFinished() permanently
        // return false for them, and since they're all in
        // NON_INTERRUPTIBLE, canTransitionTo() would then never let the
        // animator leave, freezing on the last frame forever. Only
        // transition-loop/tick-sequence (both newly-introduced, explicitly
        // authored) get their own branch; everything else - including
        // every animation with no syncMode set - falls through to the
        // original animation.loop-based check, unchanged from before.
        switch (animation.syncMode) {
            case 'transition-loop':
                // Authoritative exit is exitCondition(player), evaluated by
                // animationStateManager - not a frame count. Once handed
                // off to the hold clip this behaves like a loop and is
                // never "finished" on its own.
                return false;
            case 'tick-sequence': {
                const seq = animation.frameSequence;
                if (!seq || seq.length === 0) return false;
                return this._lastAttackFrame >= seq.length - 1;
            }
            default:
                if (animation.loop) return false;
                return this.currentFrame >= animation.frames - 1;
        }
    }
}

class SpriteManager {
    constructor() {
        this.animators = new Map();       // Map<socketId, SpriteAnimator> - one per PLAYER, own animation state
        this.loadedSheets = new Map();    // Map<characterId, { images, config }> - shared, cached art (loaded once per character)
    }

    // loads (or reuses already-loaded) image sheets for a character. Safe to call for
    // multiple players sharing the same character - the underlying Image objects and
    // their network load are shared, only the animation STATE below is kept separate.
    _getOrLoadSheets(characterId, config) {
        if (this.loadedSheets.has(characterId)) {
            return this.loadedSheets.get(characterId);
        }

        const images = {};
        Object.entries(config.spriteSheets).forEach(([sheetName, path]) => {
            const img = new Image();
            img.src = `${ASSET_BASE_URL}/${path}`;
            images[sheetName] = img;
        });

        const entry = { images, config };
        this.loadedSheets.set(characterId, entry);
        debugLog(`[SpriteManager] Loading sheets for: ${characterId}`);
        return entry;
    }

    // creates (or replaces) a dedicated animator for this specific player. Two players
    // on the same character get two separate SpriteAnimator instances, pointed at the
    // same cached Image objects, so neither player's animation state can stomp the other's.
    createAnimatorForPlayer(socketId, characterId, config) {
        const { images } = this._getOrLoadSheets(characterId, config);
        const animator = new SpriteAnimator(images, config);
        this.animators.set(socketId, animator);
        debugLog(`[SpriteManager] Created animator for player: ${socketId} (${characterId})`);
        return animator;
    }

    getAnimator(socketId) {
        return this.animators.get(socketId);
    }

    // Promise-based preload for the loading screen: resolves once every sheet for
    // this character has either loaded or failed (a failed sheet still resolves -
    // we don't want one bad asset to hang the loading screen forever, the existing
    // draw()/SpriteAnimator fallback already handles an unloaded sheet gracefully).
    // Safe to call even if _getOrLoadSheets() already kicked off (or finished) these
    // loads earlier - Image objects are cached per-character, so this just attaches
    // to whatever's already in flight instead of re-requesting anything.
    preloadCharacterSheets(characterId, config) {
        const { images } = this._getOrLoadSheets(characterId, config);

        const loadPromises = Object.values(images).map(img => {
            if (img.complete) {
                return Promise.resolve();
            }
            return new Promise(resolve => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
            });
        });

        return Promise.all(loadPromises);
    }

    unregisterPlayer(socketId) {
        this.animators.delete(socketId);
        debugLog(`[SpriteManager] Unregistered animator for player: ${socketId}`);
    }

    // clears per-player animators (and their in-progress animation state) between matches.
    // loadedSheets is intentionally left alone - cached art is safe and worth keeping
    // across rematches/character re-selection.
    clear() {
        this.animators.clear();
        debugLog('[SpriteManager] Cleared all player animators');
    }
}

//create singleton instance
const spriteManager = new SpriteManager();

export { SpriteAnimator, spriteManager };