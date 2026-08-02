// Backend URL. Auto-picks local vs. deployed so you don't have to hand-edit
// this file every time you switch between testing and deploying.
//
// - Running the frontend from localhost/127.0.0.1/a LAN IP (e.g. `npx serve public`,
//   `wrangler pages dev public`, or opening it on your phone via your laptop's
//   192.168.x.x address) -> connects to your local backend, using whatever
//   hostname the page itself was loaded from (so it works from other devices too).
// - Anything else (Cloudflare Pages, etc.) -> connects to the deployed Render backend.
const LOCAL_SERVER_PORT = 2000;
const PROD_SERVER_URL = "https://www.pixel.shrestha-saurav.com.np";

const isLocalHostname =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(window.location.hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(window.location.hostname);

const SERVER_URL = isLocalHostname
    ? `http://${window.location.hostname}:${LOCAL_SERVER_PORT}`
    : PROD_SERVER_URL;

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

export { SERVER_URL, ASSET_BASE_URL };