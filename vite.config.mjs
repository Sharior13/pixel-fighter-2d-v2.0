import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal Vite setup for the React migration (see docs/react-ui-migration-plan.md).
//
// root: 'public' - Vite treats public/index.html as the app entry, and
// resolves all the existing relative imports (./ui/..., ./core/...) exactly
// as the browser already does today. Nothing about the existing file layout
// changes.
//
// publicDir: 'assets' - Vite's own convention is a "publicDir" folder of
// files that get copied to the build output untouched (no bundling/hashing).
// public/assets already plays that role (title logo, small local images -
// character/music assets are loaded from a CDN, not from here, see
// public/core/config.js), so this just tells Vite about it explicitly
// instead of guessing.
//
// build.outDir: '../dist' - build output goes to a new top-level dist/
// folder (outside public/), so the existing public/ folder that's deployed
// today is left completely alone until you're ready to point deployment at
// dist/ instead. See the phase 2 report for more on this.
export default defineConfig({
    root: 'public',
    publicDir: 'assets',
    plugins: [react()],
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
    },
});
