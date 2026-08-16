// Single source of truth for the game's logical gameplay resolution. See
// docs/single-coordinate-system-migration.md.
//
// GAME_HEIGHT is a true fixed constant - vertical extent (character size,
// jump height, hitbox proportions) is identical for every player, always.
//
// GAME_WIDTH is NOT a fixed constant - it's a "Hor+" (horizontal-plus)
// adaptive value, recomputed per session from the player's actual aspect
// ratio. The goal: fill the player's screen/window edge-to-edge with no
// letterbox/pillarbox bars whenever their aspect ratio allows it, rather
// than always centering a fixed 1280-wide box and bar-ing the rest.
//
// Why this is safe to vary per-client: the server is fully authoritative
// for hit detection, movement, and ranges, all expressed in absolute
// world/map coordinates - it has no concept of any client's viewport size
// at all (confirmed by grep: zero references to GAME_WIDTH/GAME_HEIGHT/
// canvas dimensions anywhere under server/). GAME_WIDTH only ever affects
// how much of the map a given camera can see, never what's actually true
// in the simulation.
//
// The trade-off this doesn't eliminate: a player with a wider effective
// window genuinely sees a bit more of the arena to their left/right than a
// player with a narrower one - more advance notice of an approaching
// opponent. BASE_GAME_WIDTH/MAX_GAME_WIDTH below bound how large that gap
// can get, rather than removing it - an unbounded per-device FOV would be
// a much bigger fairness problem than a capped one.
const BASE_GAME_WIDTH = 1280; // the original fixed design width - GAME_WIDTH
                               // never goes below this, so nobody ever sees
                               // LESS of the arena than the original design
const MAX_GAME_WIDTH = 1600;  // cap on extra width, so an ultra-ultrawide
                               // monitor can't see dramatically more of the
                               // arena than everyone else. 1600:720 = 2.22,
                               // close to a 20:9 phone in landscape - most
                               // desktop windows and phones fill completely;
                               // only genuine ultrawide monitors still see a
                               // (smaller than before) residual pillarbox.
const GAME_HEIGHT = 720;
let GAME_WIDTH = BASE_GAME_WIDTH;

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

/**
 * How much display area is available to fit the logical viewport into.
 * Uses the window's own viewport size - the existing orientation-lock gate
 * (fullscreenGate.js) is left completely untouched; this module only needs
 * to work correctly once that gate already considers the device to be in
 * its supported landscape state.
 */
const getAvailableSize = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
});

/**
 * Computes this session's effective GAME_WIDTH from the available display
 * area (Hor+): the width, in logical units, that exactly fills availWidth
 * once availHeight is scaled to exactly fill GAME_HEIGHT - i.e. "how much
 * of the arena, at a fixed vertical scale, does this aspect ratio show with
 * zero bars" - clamped to [BASE_GAME_WIDTH, MAX_GAME_WIDTH].
 *
 * Falling outside that range means: aspect ratio is narrower than 16:9
 * (idealWidth < BASE_GAME_WIDTH) -> GAME_WIDTH stays pinned at
 * BASE_GAME_WIDTH and the game letterboxes (bars top/bottom) exactly like
 * the original fixed-1280 design, since we never want to show less than
 * that. Or aspect ratio is wider than MAX_GAME_WIDTH allows -> GAME_WIDTH
 * pins at the cap and the game pillarboxes (bars left/right), bounding how
 * much extra the widest screens can see.
 */
const computeEffectiveGameWidth = (availWidth, availHeight) => {
    const idealWidth = availWidth * (GAME_HEIGHT / availHeight);
    return Math.min(MAX_GAME_WIDTH, Math.max(BASE_GAME_WIDTH, idealWidth));
};

/**
 * Given the available display area, recomputes this session's GAME_WIDTH
 * (Hor+, see above) and how big the resulting GAME_WIDTH x GAME_HEIGHT
 * rectangle should be drawn, plus the offsets needed to center it (only
 * non-zero once GAME_WIDTH has been clamped to one of its bounds - see
 * computeEffectiveGameWidth).
 */
const computeViewportRect = (availWidth, availHeight) => {
    GAME_WIDTH = computeEffectiveGameWidth(availWidth, availHeight);

    const scale = Math.min(availWidth / GAME_WIDTH, availHeight / GAME_HEIGHT);

    const width = GAME_WIDTH * scale;
    const height = GAME_HEIGHT * scale;

    const offsetX = (availWidth - width) / 2;
    const offsetY = (availHeight - height) / 2;

    return { scale, width, height, offsetX, offsetY };
};

// Last computed rect, kept so screenToLogical() can convert a pointer event
// without needing every caller to re-derive it.
let currentRect = computeViewportRect(BASE_GAME_WIDTH, GAME_HEIGHT);

const getCurrentRect = () => currentRect;

/**
 * Applies the given rect to one or more DOM elements as absolute
 * positioning, so they all occupy exactly the same on-screen rectangle -
 * this is what keeps the canvas and battle UI in visual sync (doc section
 * 11) without requiring them to share a DOM parent (see design note above).
 * Does NOT touch canvas.width/canvas.height (the canvas's internal/logical
 * resolution) - only CSS display geometry. render.js is responsible for
 * keeping canvas.width/height in sync with GAME_WIDTH/GAME_HEIGHT, since
 * GAME_WIDTH can now change on any resize (Hor+), not just once at startup.
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
 * Recomputes the viewport rect (and this session's GAME_WIDTH, see
 * computeEffectiveGameWidth) from the current window size, applies it to
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
 * logical GAME_WIDTH x GAME_HEIGHT game coordinates, using the
 * last-computed viewport rect. See migration doc sections 20-21. (Audit
 * note: this codebase currently has no gameplay code that consumes
 * pointer/touch coordinates - input.js is keyboard-only and touchControls.js
 * dispatches synthetic key events - so nothing calls this yet. Provided for
 * completeness/future use per the module's stated responsibilities.)
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
    BASE_GAME_WIDTH,
    MAX_GAME_WIDTH,
    GAME_HEIGHT,
    getAvailableSize,
    computeEffectiveGameWidth,
    computeViewportRect,
    getCurrentRect,
    applySizing,
    clearSizing,
    updateViewport,
    screenToLogical,
    onResize,
};