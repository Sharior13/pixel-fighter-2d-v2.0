// Central switch for all developer-facing console output, alerts, and debug
// visuals (player hitboxes, etc.) on the client. Every other client file
// should route its console.log/warn/error and alert() calls through here
// instead of calling them directly - that's what makes this "one place".
//
// Toggle at runtime with no rebuild needed:
//   - Add ?debug=1 (or ?debug=0) to the URL - persists via localStorage after that.
//   - Or open devtools and run toggleDebugMode() / setDebugMode(true|false).
const DEBUG_STORAGE_KEY = "pixelFighterDebug";

function readInitialDebugState() {
    const params = new URLSearchParams(window.location.search);
    if (params.has("debug")) {
        const enabled = params.get("debug") !== "0" && params.get("debug") !== "false";
        try {
            localStorage.setItem(DEBUG_STORAGE_KEY, enabled ? "1" : "0");
        } catch {
            // localStorage can throw in private/incognito modes in some browsers -
            // debug mode just won't persist across reloads, which is fine.
        }
        return enabled;
    }

    try {
        return localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

let debugEnabled = readInitialDebugState();

const isDebugMode = () => debugEnabled;

const setDebugMode = (enabled) => {
    debugEnabled = !!enabled;
    try {
        localStorage.setItem(DEBUG_STORAGE_KEY, debugEnabled ? "1" : "0");
    } catch {
        // ignore - see readInitialDebugState()
    }
    console.log(`[Debug] Debug mode ${debugEnabled ? "ENABLED" : "DISABLED"} (verbose logs ${debugEnabled ? "on" : "off"}, hitboxes ${debugEnabled ? "visible" : "hidden"})`);
};

const toggleDebugMode = () => setDebugMode(!debugEnabled);

// Routine, high-volume logging (socket events, animation state, matchmaking
// chatter, etc.) - silent unless debug mode is on, so a normal player's
// console stays clean.
const debugLog = (...args) => {
    if (debugEnabled) console.log(...args);
};

const debugWarn = (...args) => {
    if (debugEnabled) console.warn(...args);
};

// Real errors are always surfaced regardless of debug mode - they're not
// "debug noise", they're signals something actually broke.
const debugError = (...args) => console.error(...args);

// Single choke point for user-facing alert() popups (room validation errors,
// custom-room failures, etc.). In debug mode the message is also echoed to
// the console so it's still visible in captured logs after the popup closes.
// Also means there's exactly one place to swap window.alert() for a nicer
// in-game modal later, instead of hunting down every call site.
const notify = (message) => {
    if (debugEnabled) console.log("[Alert]", message);
    window.alert(message);
};

// Exposed on window so debug mode can be flipped from the browser console
// without editing code or query strings.
if (typeof window !== "undefined") {
    window.toggleDebugMode = toggleDebugMode;
    window.setDebugMode = setDebugMode;
}

if (debugEnabled) {
    console.log("[Debug] Debug mode is ON - hitboxes visible, verbose logging enabled. Run toggleDebugMode() in the console to turn it off.");
}

export { isDebugMode, setDebugMode, toggleDebugMode, debugLog, debugWarn, debugError, notify };
