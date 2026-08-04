// Central switch for all developer-facing console output on the server.
// Every other server file should route its console.log/warn calls through
// debugLog/debugWarn here instead of calling console directly - that's what
// makes this "one place".
//
// Controlled by the DEBUG env var - set DEBUG=true (or DEBUG=1) in Render's
// environment settings (or a local .env) to turn on verbose logging. Off by
// default, so production logs aren't flooded with per-tick/per-input noise.
const debugEnabled = ["1", "true"].includes((process.env.DEBUG || "").trim().toLowerCase());

const isDebugMode = () => debugEnabled;

// Routine, high-volume logging (match lifecycle, socket events, per-tick
// state, matchmaking chatter, etc.) - silent unless DEBUG is set.
const debugLog = (...args) => {
    if (debugEnabled) console.log(...args);
};

const debugWarn = (...args) => {
    if (debugEnabled) console.warn(...args);
};

// Real errors are always surfaced regardless of DEBUG - they're not "debug
// noise", they're signals something actually broke.
const debugError = (...args) => console.error(...args);

if (debugEnabled) {
    console.log("[Debug] Debug mode is ON (verbose server logging enabled). Set DEBUG=false to turn it off.");
}

module.exports = { isDebugMode, debugLog, debugWarn, debugError };
