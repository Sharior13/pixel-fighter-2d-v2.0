// ============================================================================
// build-client-sim.js
// ============================================================================
// Generates a browser-safe ESM copy of the server's combat simulation under
// public/core/sim/, so bot matches (see public/core/localMatch.js) can run
// the EXACT SAME simulation code the server runs for real PvP matches,
// instead of a hand-maintained second implementation that can drift out of
// balance/behavior sync with every future combat tweak.
//
// server/core/*.js and server/data/*.js are plain CommonJS with no Node-only
// dependencies (no `fs`, no `process` other than debug.js, which isn't
// required by any of these files) - so the only thing standing between them
// and the browser is module syntax. This script does a narrow, mechanical
// require()/module.exports -> import/export rewrite, nothing else. It does
// NOT change any simulation logic.
//
// Output mirrors the source folder structure 1:1 (server/core/x.js ->
// public/core/sim/core/x.js, server/data/x.js -> public/core/sim/data/x.js)
// specifically so existing relative import paths inside these files
// ('./attackSystem.js', '../data/maps.js', etc.) keep working unmodified.
//
// Run via `npm run build:sim`. Wired into `prestart` and the nodemon dev
// script, so it's regenerated automatically - never hand-edit anything
// under public/core/sim/, it will be overwritten.
// ============================================================================

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// [sourceRelativeToRoot, destRelativeToRoot]
const FILES = [
    ["server/core/gameState.js", "public/core/sim/core/gameState.js"],
    ["server/core/attackSystem.js", "public/core/sim/core/attackSystem.js"],
    ["server/core/stateMachine.js", "public/core/sim/core/stateMachine.js"],
    ["server/core/hitboxSystem.js", "public/core/sim/core/hitboxSystem.js"],
    ["server/data/characters.js", "public/core/sim/data/characters.js"],
    ["server/data/maps.js", "public/core/sim/data/maps.js"],
];

// const { a, b, c } = require('X');  ->  import { a, b, c } from 'X';
const NAMED_REQUIRE = /const\s*\{([^}]+)\}\s*=\s*require\((['"])([^'"]+)\2\)\s*;?/g;

// const x = require('X');  ->  import * as x from 'X';
// (only matches plain-identifier requires - the named form above is applied
// first, so by the time this runs any `{ ... } = require(...)` is already
// gone and won't be mismatched here)
const NAMESPACE_REQUIRE = /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\((['"])([^'"]+)\2\)\s*;?/g;

// module.exports = { a, b, c };  ->  export { a, b, c };
// Every file in FILES exports a flat object of plain identifiers (no
// renaming/computed props) - verified by hand for each file above. If a
// future edit to one of these files exports something shaped differently,
// this deliberately throws below rather than silently emitting broken ESM.
const MODULE_EXPORTS = /module\.exports\s*=\s*\{/;

const AUTOGEN_BANNER = (sourceRelPath) => `// ============================================================================
// AUTO-GENERATED - DO NOT EDIT
// Generated from ${sourceRelPath.replace(/\\/g, "/")} by scripts/build-client-sim.js
// Edit the source file and run \`npm run build:sim\` to regenerate.
// ============================================================================

`;

// Some server files need to bind to a DIFFERENT implementation of a
// dependency in the browser, rather than a generated copy of the server's
// own version. gameState.js's debug-logging import is the case that exists
// today: server/core/debug.js reads process.env.DEBUG, which doesn't exist
// in a browser - a generated copy would either crash or (if written
// defensively) always stay silent, neither of which is useful. What the
// browser copy should actually do is log through the CLIENT's own real
// debug.js (public/core/debug.js - localStorage/?debug=1-toggled), which
// already exports the same debugLog/debugWarn/debugError names. This is a
// deliberate per-environment swap, not drift: gameState.js's own log call
// sites (what gets logged, and when) stay identical in both copies - only
// which debug.js answers "is debug mode on right now" differs, which is
// the correct behavior given server and client debug toggles are
// independent switches by design (see public/core/debug.js's own comment).
// Keyed by source-relative path; each entry is a literal specifier rewrite
// applied (after the require->import transform) to that file only.
const IMPORT_PATH_OVERRIDES = {
    "server/core/gameState.js": [
        { from: "from './debug.js'", to: "from '../../debug.js'" },
    ],
    "server/core/attackSystem.js": [
        { from: "from './debug.js'", to: "from '../../debug.js'" },
    ],
};

const transform = (source, sourceRelPath) => {
    if (!MODULE_EXPORTS.test(source)) {
        throw new Error(
            `[build-client-sim] ${sourceRelPath}: no "module.exports = { ... }" block found - ` +
            `this script only knows how to convert that shape. Update the transform if the ` +
            `export style changed.`
        );
    }

    let out = source;
    out = out.replace(NAMED_REQUIRE, (_match, names, _quote, specifier) => `import {${names}} from '${specifier}';`);
    out = out.replace(NAMESPACE_REQUIRE, (_match, name, _quote, specifier) => `import * as ${name} from '${specifier}';`);
    out = out.replace(MODULE_EXPORTS, "export {");

    for (const { from, to } of IMPORT_PATH_OVERRIDES[sourceRelPath] || []) {
        if (!out.includes(from)) {
            throw new Error(
                `[build-client-sim] ${sourceRelPath}: expected import path override target "${from}" ` +
                `not found after transform - the import this override targets may have changed shape.`
            );
        }
        out = out.replace(from, to);
    }

    // safety net: if anything still looks like CommonJS after the rewrite,
    // fail loudly instead of shipping half-converted code to the browser
    if (/\brequire\(/.test(out) || /\bmodule\.exports\b/.test(out)) {
        throw new Error(
            `[build-client-sim] ${sourceRelPath}: leftover CommonJS syntax after transform - ` +
            `this file uses a require()/module.exports pattern this script doesn't handle yet.`
        );
    }

    return AUTOGEN_BANNER(sourceRelPath) + out;
};

const build = () => {
    for (const [srcRel, destRel] of FILES) {
        const srcPath = path.join(ROOT, srcRel);
        const destPath = path.join(ROOT, destRel);

        const source = fs.readFileSync(srcPath, "utf8");
        const converted = transform(source, srcRel);

        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, converted, "utf8");

        console.log(`[build-client-sim] ${srcRel} -> ${destRel}`);
    }

    console.log(`[build-client-sim] done (${FILES.length} files)`);
};

build();
