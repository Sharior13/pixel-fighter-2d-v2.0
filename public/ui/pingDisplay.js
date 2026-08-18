// Small, low-opacity ping/latency readout, pinned to the bottom-right corner
// (see #ping-display in index.html/style.css). Deliberately unobtrusive -
// this is a diagnostic readout for the player, not a UI focal point.
//
// The actual rendering now lives in a React component
// (public/src/components/PingDisplay.jsx). This file no longer touches the
// DOM directly - it just keeps track of "what should the readout currently
// show" as a plain object, and hands that object to anyone who asks via
// subscribePingState() below. React is one such subscriber, but this file
// doesn't know or care that React is the one listening - it would work
// exactly the same way if the caller were plain JS.
//
// This is a minimal do-it-yourself version of a pattern you'll see called a
// "store" - some state, plus a way to be notified when it changes. It's only
// a few lines because the state here is tiny; don't reach for a library for
// this.
let pingState = {
    visible: false,
    text: '--ms',
    colorClass: 'ping-disconnected',
};

const subscribers = new Set();
let measureInterval = null;

const setPingState = (partial) => {
    pingState = { ...pingState, ...partial };
    subscribers.forEach((callback) => callback(pingState));
};

// Registers a callback to be called with the current state immediately, and
// again every time the state changes. Returns an "unsubscribe" function -
// call it when you no longer want updates (React calls this automatically
// when the component using it goes away, see PingDisplay.jsx).
const subscribePingState = (callback) => {
    subscribers.add(callback);
    callback(pingState);
    return () => subscribers.delete(callback);
};

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

// The readout is only meaningful while matchmaking or in a match - it starts
// hidden and should go back to hidden the moment we're not doing either of
// those things, rather than just sitting there showing a stale/disconnected
// reading on the main menu.
const showPingEl = () => setPingState({ visible: true });

const hidePingEl = () => setPingState({ visible: false });

const colorClassForPing = (ms) => {
    if (ms <= PING_THRESHOLDS.good) return 'ping-good';
    if (ms <= PING_THRESHOLDS.okay) return 'ping-okay';
    if (ms <= PING_THRESHOLDS.poor) return 'ping-poor';
    return 'ping-bad';
};

const renderPing = (ms) => {
    setPingState({ text: `${ms}ms`, colorClass: colorClassForPing(ms) });
};

const renderDisconnected = () => {
    setPingState({ text: '--ms', colorClass: 'ping-disconnected' });
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

export { startPingMonitor, stopPingMonitor, subscribePingState };