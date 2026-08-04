import { debugLog, debugWarn } from "./debug.js";
// Backend URL. Auto-picks local vs. deployed so you don't have to hand-edit
// this file every time you switch between testing and deploying.
//
// - Running the frontend from localhost/127.0.0.1/a LAN IP (e.g. `npx serve public`,
//   `wrangler pages dev public`, or opening it on your phone via your laptop's
//   192.168.x.x address) -> connects to your local backend, using whatever
//   hostname the page itself was loaded from (so it works from other devices too).
// - Anything else (Cloudflare Pages, etc.) -> connects to whichever deployed region
//   answers its health check fastest (see REGIONS / pickFastestRegion below).
const LOCAL_SERVER_PORT = 2000;

// Regional backends to race by proximity/latency (production only). Must have
// at least one entry - there's no separate single-server fallback, so if a
// region goes away for good, remove it here. Each entry's backend must expose
// a CORS-enabled `GET /health` that returns quickly - see the
// app.get('/health', ...) route in server/server.js.
const REGIONS = [
    { name: "eu", url: "https://eu.pixel.shrestha-saurav.com.np" },
    { name: "sg", url: "https://sg.pixel.shrestha-saurav.com.np" },
];

// Don't let one slow/unreachable region hold up the race - Promise.any below
// still resolves as soon as ANY region answers, but a region that neither
// succeeds nor fails (e.g. a firewall silently dropping packets) would
// otherwise hang forever and never let Promise.any fall through to reject.
const REGION_HEALTH_TIMEOUT_MS = 4000;

const isLocalHostname =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(window.location.hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(window.location.hostname);

async function pingRegion(region) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REGION_HEALTH_TIMEOUT_MS);

    try {
        await fetch(`${region.url}/health`, { mode: "cors", signal: controller.signal });
        return region;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Races every region's /health endpoint and returns whichever answers first -
// so if e.g. "eu" is down, pingRegion("eu") just loses the race and "sg" wins
// on its own, with no special-casing needed. Promise.any (not allSettled) is
// the point here: it short-circuits on the first success instead of waiting
// for every region to settle, so a dead region doesn't slow down picking a
// live one.
async function pickFastestRegion() {
    if (REGIONS.length === 0) {
        throw new Error("[Region] REGIONS is empty - add at least one backend to public/core/config.js");
    }

    try {
        const fastest = await Promise.any(REGIONS.map(pingRegion));
        debugLog(`[Region] Closest server: ${fastest.name} (${fastest.url})`);
        return fastest.url;
    } catch (err) {
        // Promise.any only rejects (with an AggregateError) if EVERY region's health
        // check failed/timed out. Rather than giving up, fall back to the first
        // configured region and let the actual socket connection attempt it anyway -
        // a failed /health fetch doesn't necessarily mean the backend is really down
        // (e.g. a network that blocks plain HTTP requests but allows websockets).
        debugWarn(`[Region] All region health checks failed, falling back to ${REGIONS[0].name} (${REGIONS[0].url})`, err);
        return REGIONS[0].url;
    }
}

// Kicked off once immediately at module load - NOT lazily inside getServerUrl() -
// so the health-check race runs in the background while the player is still
// looking at the title screen. By the time they actually click Quick Play /
// Create Room / Join Room, this has usually already resolved and
// initializeSocket() in socket.js barely has to wait on it at all.
const serverUrlPromise = isLocalHostname
    ? Promise.resolve(`http://${window.location.hostname}:${LOCAL_SERVER_PORT}`)
    : pickFastestRegion();

// Always async (even for the local-dev case, which resolves instantly) so
// every caller awaits the same shape rather than branching on whether a
// region race is in flight.
async function getServerUrl() {
    return serverUrlPromise;
}

// Where character sprites and music are hosted (Cloudflare R2 bucket, custom
// domain or r2.dev subdomain). Used for the "characters/..." and "music/..."
// asset paths referenced throughout the game code. Background images and the
// title logo are small enough to stay bundled with the frontend, so they are
// NOT affected by this constant - only characters/ and music/ moved to R2.
//
// No local/prod split here (unlike SERVER_URL) - the CDN is reachable from
// anywhere, including local dev, so there's nothing to switch between.
// Served via jsDelivr's free CDN, pulling directly from this repo's public/assets
// folder - no separate upload/hosting account needed. @main tracks the default
// branch; swap to a commit hash or tag if you want to pin a specific version
// instead of always serving latest (jsDelivr caches by URL, so pinning avoids
// any cache-invalidation lag when assets change).
const ASSET_BASE_URL = "https://cdn.jsdelivr.net/gh/Sharior13/assets-pixel-fighter-2d";

export { getServerUrl, ASSET_BASE_URL };