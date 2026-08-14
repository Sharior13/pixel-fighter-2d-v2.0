// Single source of truth for the game's logical gameplay resolution. See
// docs/single-coordinate-system-migration.md.
//
// The simulation, camera, renderer, and battle UI all reason about a fixed
// 1280x720 (16:9) logical viewport, regardless of the player's actual device
// resolution. The browser is only responsible for figuring out how large to
// display that fixed rectangle - it never changes what the game itself
// thinks its own dimensions are.
const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const GAME_ASPECT = GAME_WIDTH / GAME_HEIGHT;

// This module intentionally contains ONLY viewport math + DOM sizing for the
// canvas/battle-UI layer. No gameplay, camera, combat, or Socket.IO logic
// belongs here (see migration doc section 6).
//
// Design note (flagging this since the doc's illustrative markup in section
// 11 nests canvas + battle UI inside a shared <div id="gameViewport">):
// this project's #canvas and .game-container are currently DOM siblings of
// <body>, and several other overlays (#touch-controls, #ping-display, the
// fullscreen gate, etc.) assume that sibling structure. Reparenting them
// into a wrapper is a bigger, riskier DOM change than this phase needs.
// Instead, applySizing() below gives both elements matching
// position:absolute geometry (same width/height/left/top) so they occupy
// the same logical rectangle on screen without requiring them to share a
// parent. Functionally equivalent for the "canvas and battle UI share one
// logical viewport" requirement; flag if you'd rather do the actual
// reparenting instead.

// Nothing in this module is wired into render.js/battleUI.js yet - that
// happens in Phase 4 (canvas) and Phase 8 (battle UI), each verified on its
// own. Importing this file still has zero effect on current behavior.

/**
 * How much display area is available to letterbox/pillarbox the logical
 * viewport into. Uses the window's own viewport size - the existing
 * orientation-lock gate (fullscreenGate.js) is left completely untouched;
 * this module only needs to work correctly once that gate already considers
 * the device to be in its supported landscape state.
 */
const getAvailableSize = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
});

/**
 * Given the available display area, computes how big the logical
 * GAME_WIDTH x GAME_HEIGHT rectangle should be drawn, and the offsets
 * needed to center it (letterboxing when the container is relatively
 * taller than 16:9, pillarboxing when it's relatively wider).
 */
const computeViewportRect = (availWidth, availHeight) => {
    const scale = Math.min(availWidth / GAME_WIDTH, availHeight / GAME_HEIGHT);

    const width = GAME_WIDTH * scale;
    const height = GAME_HEIGHT * scale;

    const offsetX = (availWidth - width) / 2;
    const offsetY = (availHeight - height) / 2;

    return { scale, width, height, offsetX, offsetY };
};

// Last computed rect, kept so screenToLogical() can convert a pointer event
// without needing every caller to re-derive it.
let currentRect = computeViewportRect(GAME_WIDTH, GAME_HEIGHT);

const getCurrentRect = () => currentRect;

/**
 * Applies the given rect to one or more DOM elements as absolute
 * positioning, so they all occupy exactly the same on-screen rectangle -
 * this is what keeps the canvas and battle UI in visual sync (doc section
 * 11) without requiring them to share a DOM parent (see design note above).
 * Does NOT touch canvas.width/canvas.height (the canvas's internal/logical
 * resolution) - only CSS display geometry. Internal resolution is set once,
 * in Phase 4.
 */
const applySizing = (elements, rect) => {
    for (const el of elements) {
        if (!el) continue;
        el.style.position = "absolute";
        el.style.left = `${rect.offsetX}px`;
        el.style.top = `${rect.offsetY}px`;
        el.style.width = `${rect.width}px`;
        el.style.height = `${rect.height}px`;
    }
};

/**
 * Reverses applySizing() - clears the inline styles it set, handing sizing
 * back to whatever CSS rules would otherwise apply. Needed anywhere the
 * logical viewport treatment is only active some of the time (e.g. the
 * canvas, which is a full-bleed decorative element on menus and only
 * becomes the fixed-aspect gameplay viewport during an actual battle - see
 * migration doc section 14, "Menus Are Different").
 */
const clearSizing = (elements) => {
    for (const el of elements) {
        if (!el) continue;
        el.style.position = "";
        el.style.left = "";
        el.style.top = "";
        el.style.width = "";
        el.style.height = "";
    }
};

/**
 * Recomputes the viewport rect from the current window size, applies it to
 * the given elements, and returns the rect (also cached for
 * getCurrentRect()/screenToLogical()).
 */
const updateViewport = (elements = []) => {
    const { width, height } = getAvailableSize();
    currentRect = computeViewportRect(width, height);
    applySizing(elements, currentRect);
    return currentRect;
};

/**
 * Converts a physical pointer coordinate (e.g. event.clientX/clientY) into
 * logical 1280x720 game coordinates, using the last-computed viewport rect.
 * See migration doc sections 20-21. (Audit note: this codebase currently has
 * no gameplay code that consumes pointer/touch coordinates - input.js is
 * keyboard-only and touchControls.js dispatches synthetic key events - so
 * nothing calls this yet. Provided for completeness/future use per the
 * module's stated responsibilities.)
 */
const screenToLogical = (clientX, clientY, rect = currentRect) => {
    const logicalX = ((clientX - rect.offsetX) / rect.scale);
    const logicalY = ((clientY - rect.offsetY) / rect.scale);
    return { x: logicalX, y: logicalY };
};

/**
 * Centralized resize/orientation handling (doc section 26): one listener
 * here, rather than every consumer independently listening to
 * window.resize and computing its own scale. Returns an unsubscribe
 * function.
 */
const onResize = (elements, callback) => {
    const handler = () => {
        const rect = updateViewport(elements);
        if (callback) callback(rect);
    };

    window.addEventListener("resize", handler);
    window.addEventListener("orientationchange", handler);

    return () => {
        window.removeEventListener("resize", handler);
        window.removeEventListener("orientationchange", handler);
    };
};

export {
    GAME_WIDTH,
    GAME_HEIGHT,
    GAME_ASPECT,
    getAvailableSize,
    computeViewportRect,
    getCurrentRect,
    applySizing,
    clearSizing,
    updateViewport,
    screenToLogical,
    onResize,
};