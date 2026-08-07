/**
 * esbuild config for bundling the CoC SPA client code.
 *
 * Produces:
 *   src/server/spa/client/dist/bundle.js        (IIFE, for <script> inlining)
 *   src/server/spa/client/dist/bundle.css        (for <style> inlining)
 *   src/server/spa/client/dist/editor.worker.js  (Monaco editor worker)
 *   src/server/spa/client/dist/json.worker.js    (Monaco JSON worker)
 *   src/server/spa/client/dist/css.worker.js     (Monaco CSS worker)
 *   src/server/spa/client/dist/html.worker.js    (Monaco HTML worker)
 *   src/server/spa/client/dist/ts.worker.js      (Monaco TypeScript worker)
 *   src/server/spa/client/dist/canvas-vendor/*   (extension-canvas library globals)
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import autoprefixer from 'autoprefixer';
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

async function buildTailwindBundle(inputPath, outputPath) {
    const source = await readFile(inputPath, 'utf-8');
    const result = await postcss([
        tailwindcss({ config: './tailwind.config.js' }),
        autoprefixer(),
    ]).process(source, { from: inputPath, to: outputPath });

    // Preserve any CSS that esbuild already extracted (e.g. Monaco editor styles)
    // by prepending it to the Tailwind output instead of overwriting.
    let existingCss = '';
    try {
        existingCss = await readFile(outputPath, 'utf-8');
    } catch { /* file may not exist yet */ }

    const merged = existingCss
        ? `${existingCss}\n/* --- Tailwind --- */\n${result.css}`
        : result.css;

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, merged, 'utf-8');

    const sizeKb = (Buffer.byteLength(merged, 'utf-8') / 1024).toFixed(1);
    console.log(`\n  ${outputPath}  ${sizeKb}kb\n`);
}

// Stable path aliases so future file moves don't break consumer imports.
const SPA_ROOT = 'src/server/spa/client/react';
const spaAliases = {
    '@spa/features': `${SPA_ROOT}/features`,
    '@spa/ui': `${SPA_ROOT}/ui`,
    '@spa/shared': `${SPA_ROOT}/shared`,
};

// Main dashboard SPA
await esbuild.build({
    entryPoints: ['src/server/spa/client/entry.tsx'],
    outfile: 'src/server/spa/client/dist/bundle.js',
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    sourcemap: false,
    logLevel: 'info',
    alias: spaAliases,
    // Excalidraw publishes its JS and CSS under custom export conditions
    // (`production` / `development`) in its package.json. Without telling
    // esbuild which one to pick, the explicit `import '@excalidraw/excalidraw/index.css'`
    // we do for the diagram renderer styles fails to resolve. We prefer the
    // production bundle for our SPA distribution; the JS resolves fine even
    // without this hint (it has a `default` fallback) but the CSS export
    // does not.
    conditions: ['production'],
    loader: {
        '.ttf': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
        '.css': 'css',
    },
});

// Monaco Editor web workers (separate files — cannot be inlined in IIFE)
const MONACO_WORKERS = [
    { entry: 'monaco-editor/esm/vs/editor/editor.worker.js', out: 'editor.worker.js' },
    { entry: 'monaco-editor/esm/vs/language/json/json.worker.js', out: 'json.worker.js' },
    { entry: 'monaco-editor/esm/vs/language/css/css.worker.js', out: 'css.worker.js' },
    { entry: 'monaco-editor/esm/vs/language/html/html.worker.js', out: 'html.worker.js' },
    { entry: 'monaco-editor/esm/vs/language/typescript/ts.worker.js', out: 'ts.worker.js' },
];

await Promise.all(MONACO_WORKERS.map(worker =>
    esbuild.build({
        entryPoints: [worker.entry],
        outfile: `src/server/spa/client/dist/${worker.out}`,
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: ['es2020'],
        minify: true,
        sourcemap: false,
        logLevel: 'info',
    })
));

// pdf.js worker (Goal 0 AC-04): emitted into dist/ and served at the site root
// as /pdf.worker.js (see PDF_WORKER_URL in pdfJsLoader.ts), wired via
// GlobalWorkerOptions.workerSrc. We bundle the *legacy* worker
// so it runs under the es2020 target and desktop Electron Chromium, matching the
// legacy main build imported by the renderer.
await esbuild.build({
    entryPoints: ['pdfjs-dist/legacy/build/pdf.worker.mjs'],
    outfile: 'src/server/spa/client/dist/pdf.worker.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    sourcemap: false,
    logLevel: 'info',
});

await buildTailwindBundle(
    'src/server/spa/client/tailwind.css',
    'src/server/spa/client/dist/bundle.css'
);

// ---------------------------------------------------------------------------
// Extension-canvas vendored libraries (dist/canvas-vendor/)
//
// Served at the SITE ROOT alongside the Monaco/pdf.js workers, and pulled into
// the extension iframe with classic `<script src>` / `<link rel=stylesheet>`
// tags. The iframe is `sandbox="allow-scripts"` with no `allow-same-origin`, so
// it is an opaque origin sending `Origin: null`; CoC's CORS policy reflects only
// loopback origins and never emits `*`, so CORS-mode subresources (module
// scripts, import maps, `fetch`) get no `Access-Control-Allow-Origin` and are
// blocked. Classic scripts and stylesheets are no-CORS subresource requests and
// are unaffected — hence IIFE globals rather than ESM.
//
// The registry these outputs must stay in step with lives in
// `src/server/canvas/canvas-libraries.ts` (ids, globals, filenames, ordering).
// ---------------------------------------------------------------------------

const CANVAS_VENDOR_DIR = 'src/server/spa/client/dist/canvas-vendor';

/**
 * Rewrite bare imports of a peer library to the global the already-loaded
 * vendor bundle assigned, so Recharts does not ship its own copy of React.
 * `react/jsx-runtime` has no global of its own, so it is shimmed onto
 * `React.createElement` — which is exactly what `jsx(type, props, key)` means
 * when all children arrive inside `props.children`.
 */
function globalExternals(mapping) {
    const names = Object.keys(mapping).map(n => n.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const filter = new RegExp(`^(?:${names.join('|')})$`);
    return {
        name: 'canvas-vendor-global-externals',
        setup(build) {
            build.onResolve({ filter }, args => ({ path: args.path, namespace: 'canvas-global' }));
            build.onLoad({ filter: /.*/, namespace: 'canvas-global' }, args => ({
                contents: mapping[args.path],
                loader: 'js',
            }));
        },
    };
}

const JSX_RUNTIME_SHIM = `
var R = window.React;
function jsx(type, props, key) {
    var config = Object.assign({}, props);
    if (key !== undefined && key !== null) config.key = key;
    // Only 2 args: React.createElement keeps props.children as-is (array
    // children stay a single children prop, so no spurious key warnings).
    return R.createElement(type, config);
}
module.exports = { jsx: jsx, jsxs: jsx, jsxDEV: jsx, Fragment: R.Fragment };
`;

const CANVAS_VENDOR_EXTERNALS = {
    'react': 'module.exports = window.React;',
    'react-dom': 'module.exports = window.ReactDOM;',
    'react-dom/client': 'module.exports = window.ReactDOM;',
    'react/jsx-runtime': JSX_RUNTIME_SHIM,
    'react/jsx-dev-runtime': JSX_RUNTIME_SHIM,
};

const CANVAS_VENDOR_BUNDLES = [
    // react.js bundles React itself, so it must NOT externalize react.
    { entry: 'scripts/canvas-vendor/react.entry.js', out: 'react.js', externals: null },
    { entry: 'scripts/canvas-vendor/recharts.entry.js', out: 'recharts.js', externals: CANVAS_VENDOR_EXTERNALS },
    { entry: 'scripts/canvas-vendor/papaparse.entry.js', out: 'papaparse.js', externals: null },
];

await mkdir(CANVAS_VENDOR_DIR, { recursive: true });

await Promise.all(CANVAS_VENDOR_BUNDLES.map(bundle =>
    esbuild.build({
        entryPoints: [bundle.entry],
        outfile: `${CANVAS_VENDOR_DIR}/${bundle.out}`,
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: ['es2020'],
        minify: true,
        sourcemap: false,
        logLevel: 'info',
        // Vendored bundles are production builds; without this React ships its
        // dev warnings path and Recharts pulls in dev-only invariants.
        define: { 'process.env.NODE_ENV': '"production"' },
        ...(bundle.externals ? { plugins: [globalExternals(bundle.externals)] } : {}),
    })
));

// Static utility CSS for artifacts. NOT the Tailwind Play CDN — that is a
// runtime JIT compiler fetched from a CDN, which breaks air-gapped installs and
// the offline export. The covered utility subset comes from an explicit safelist
// (there is no source tree to scan: artifact markup is authored at runtime).
{
    const inputPath = 'scripts/canvas-vendor/tailwind.canvas.css';
    const outputPath = `${CANVAS_VENDOR_DIR}/tailwind.css`;
    const source = await readFile(inputPath, 'utf-8');
    const result = await postcss([
        tailwindcss({ config: './scripts/canvas-vendor/tailwind.canvas.config.js' }),
        autoprefixer(),
    ]).process(source, { from: inputPath, to: outputPath });
    // Minified — unlike bundle.css this sheet is inlined into every exported
    // React artifact, so whitespace is real payload.
    const minified = await esbuild.transform(result.css, { loader: 'css', minify: true });
    await writeFile(outputPath, minified.code, 'utf-8');
}

for (const name of [...CANVAS_VENDOR_BUNDLES.map(b => b.out), 'tailwind.css']) {
    const bytes = Buffer.byteLength(await readFile(`${CANVAS_VENDOR_DIR}/${name}`, 'utf-8'), 'utf-8');
    console.log(`  ${CANVAS_VENDOR_DIR}/${name}  ${(bytes / 1024).toFixed(1)}kb`);
}
