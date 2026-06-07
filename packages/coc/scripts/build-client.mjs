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
    define: {
        'process.env.SHOW_COMMIT_CHAT_LENS': JSON.stringify(process.env.SHOW_COMMIT_CHAT_LENS === 'true' ? 'true' : 'false'),
    },
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

await buildTailwindBundle(
    'src/server/spa/client/tailwind.css',
    'src/server/spa/client/dist/bundle.css'
);
