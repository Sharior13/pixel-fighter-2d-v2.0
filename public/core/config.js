// Backend URL. Auto-picks local vs. deployed so you don't have to hand-edit
// this file every time you switch between testing and deploying.
//
// - Running the frontend from localhost/127.0.0.1 (e.g. `npx serve public`,
//   `wrangler pages dev public`) -> connects to your local backend.
// - Anything else (Cloudflare Pages, etc.) -> connects to the deployed Render backend.
const LOCAL_SERVER_URL = "http://localhost:2000";
const PROD_SERVER_URL = "www.pixel.shrestha-saurav.com.np";

const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const SERVER_URL = isLocal ? LOCAL_SERVER_URL : PROD_SERVER_URL;

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


