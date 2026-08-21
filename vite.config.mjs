import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal Vite setup for the React migration (see docs/react-ui-migration-plan.md).
//
// root: 'public' - Vite treats public/index.html as the app entry, and
// resolves all the existing relative imports (./ui/..., ./core/...) exactly
// as the browser already does today. Nothing about the existing file layout
// changes.
//
// build.outDir: '../dist' - build output goes to a new top-level dist/
// folder (outside public/), so the existing public/ folder that's deployed
// today is left completely alone until you're ready to point deployment at
// dist/ instead. See the phase 2 report for more on this.
//
// Why there's a custom plugin instead of Vite's built-in `publicDir` option:
// some backgrounds are loaded with a path built at runtime from data, e.g.
// `../assets/background/${mapId}.gif` in render.js/assetPreloader.js. Vite
// can only bundle/hash paths it can see as a literal string in the code, so
// these need a stable, unhashed copy sitting at a predictable path in the
// build output instead. Vite's `publicDir` option copies a folder's
// *contents* to the root of dist/, dropping the folder's own name (so
// public/assets/x.png would become dist/x.png, not dist/assets/x.png) -
// which doesn't match the "assets/..." paths this game's code actually
// requests at runtime. This plugin just copies public/assets straight to
// dist/assets, keeping the prefix intact, after Vite's own build finishes.
const copyAssetsPlugin = () => ({
    name: 'copy-assets-preserving-prefix',
    closeBundle() {
        cpSync(resolve(__dirname, 'public/assets'), resolve(__dirname, 'dist/assets'), { recursive: true });
    },
});

export default defineConfig({
    root: 'public',
    plugins: [react(), copyAssetsPlugin()],
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
    },
});
