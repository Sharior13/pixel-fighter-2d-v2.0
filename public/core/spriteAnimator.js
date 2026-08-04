import { ASSET_BASE_URL } from "./config.js";
import { debugLog, debugWarn, debugError } from "./debug.js";

class SpriteAnimator {
    constructor(spriteSheets, config) {
        this.spriteSheets = spriteSheets;
        this.config = config;
        this.currentAnimation = 'idle';
        this.currentFrame = 0;
        this.frameTimer = 0;

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
    
    update(deltaTime) {
        if (!this.isLoaded) return;
        
        const animation = this.config.animations[this.currentAnimation];
        if (!animation) {
            debugWarn(`[SpriteAnimator] Animation not found: ${this.currentAnimation}`);
            return;
        }
        
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

        const sheet = this.spriteSheets[animation.sheet || 'main'];
        if (!sheet) {
            debugWarn(`[SpriteAnimator] Sheet "${animation.sheet || 'main'}" not found for animation "${this.currentAnimation}"`);
            return;
        }
        
        const frameWidth = this.config.frameWidth;
        const frameHeight = this.config.frameHeight;
        
        let sourceX, sourceY;
        
        if (this.config.layout === 'horizontal') {
            sourceX = (animation.startFrame + this.currentFrame) * frameWidth;
            sourceY = animation.row * frameHeight;
        } else if (this.config.layout === 'vertical') {
            sourceX = animation.column * frameWidth;
            sourceY = (animation.startFrame + this.currentFrame) * frameHeight;
        } else {
            // Grid layout
            const totalColumns = this.config.columns || 1;
            const absoluteFrame = animation.startFrame + this.currentFrame;
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
    
    isAnimationFinished() {
        const animation = this.config.animations[this.currentAnimation];
        if (!animation || animation.loop) return false;
        return this.currentFrame >= animation.frames - 1;
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