// Small, low-opacity ping/latency readout, pinned to the bottom-right corner
// (see #ping-display in index.html/style.css). Deliberately unobtrusive -
// this is a diagnostic readout for the player, not a UI focal point.
let pingEl = null;
let measureInterval = null;

// How often to re-measure (ms) and how long to wait for a reply before
// treating it as a dropped/very bad ping.
const PING_INTERVAL_MS = 2000;
const PING_TIMEOUT_MS = 5000;

// Thresholds (ms) for color coding - tuned for a fighting game where input
// timing actually matters, so the bar for "good" is stricter than a typical
// web app's latency budget.
const PING_THRESHOLDS = {
    good: 60,   // <= 60ms: green
    okay: 120,  // <= 120ms: yellow
    poor: 200,  // <= 200ms: orange, anything above is red
};

const getPingEl = () => {
    if (!pingEl) {
        pingEl = document.getElementById('ping-display');
    }
    return pingEl;
};

// The readout is only meaningful while matchmaking or in a match - it starts
// hidden (see index.html) and should go back to hidden the moment we're not
// doing either of those things, rather than just sitting there showing a
// stale/disconnected reading on the main menu.
const showPingEl = () => {
    const el = getPingEl();
    if (el) el.classList.remove('hidden');
};

const hidePingEl = () => {
    const el = getPingEl();
    if (el) el.classList.add('hidden');
};

const colorClassForPing = (ms) => {
    if (ms <= PING_THRESHOLDS.good) return 'ping-good';
    if (ms <= PING_THRESHOLDS.okay) return 'ping-okay';
    if (ms <= PING_THRESHOLDS.poor) return 'ping-poor';
    return 'ping-bad';
};

const renderPing = (ms) => {
    const el = getPingEl();
    if (!el) return;

    el.textContent = `${ms}ms`;
    el.classList.remove('ping-good', 'ping-okay', 'ping-poor', 'ping-bad', 'ping-disconnected');
    el.classList.add(colorClassForPing(ms));
};

const renderDisconnected = () => {
    const el = getPingEl();
    if (!el) return;

    el.textContent = '--ms';
    el.classList.remove('ping-good', 'ping-okay', 'ping-poor', 'ping-bad');
    el.classList.add('ping-disconnected');
};

// Measures one round trip via a plain ack callback (socket.emit with a
// function as the last arg) rather than socket.io's internal engine.io
// ping/pong, which isn't reliably exposed the same way across socket.io
// client versions - a manual echo is simple and version-proof.
const measureOnce = (socket) => {
    if (!socket || !socket.connected) {
        renderDisconnected();
        return;
    }

    const start = Date.now();
    let answered = false;

    const timeoutId = setTimeout(() => {
        if (!answered) {
            renderDisconnected();
        }
    }, PING_TIMEOUT_MS);

    socket.emit('pingCheck', () => {
        answered = true;
        clearTimeout(timeoutId);
        renderPing(Date.now() - start);
    });
};

// Starts the periodic measurement loop for the given socket. Safe to call
// multiple times - always clears any previous loop first, so re-calling on
// a fresh socket (e.g. reconnect) doesn't stack up duplicate intervals.
const startPingMonitor = (socket) => {
    stopPingMonitor();
    showPingEl();

    measureOnce(socket); // first reading immediately, don't wait a full interval
    measureInterval = setInterval(() => measureOnce(socket), PING_INTERVAL_MS);
};

const stopPingMonitor = () => {
    if (measureInterval) {
        clearInterval(measureInterval);
        measureInterval = null;
    }
    renderDisconnected();
    hidePingEl();
};

export { startPingMonitor, stopPingMonitor };