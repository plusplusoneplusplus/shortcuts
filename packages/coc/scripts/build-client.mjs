/**
 * esbuild config for bundling the CoC SPA client code.
 *
 * Produces:
 *   src/server/spa/client/dist/bundle.js        (IIFE, for <script> inlining)
 *   src/server/spa/client/dist/bundle.css        (for <style> inlining)
 *   src/server/wiki/spa/client/dist/bundle.js    (IIFE, wiki SPA)
 *   src/server/wiki/spa/client/dist/bundle.css   (wiki SPA styles)
 */
import * as esbuild from 'esbuild';

// Main dashboard SPA
await esbuild.build({
    entryPoints: ['src/server/spa/client/index.tsx'],
    outfile: 'src/server/spa/client/dist/bundle.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    sourcemap: false,
    logLevel: 'info',
});

await esbuild.build({
    entryPoints: ['src/server/spa/client/tailwind.css'],
    outfile: 'src/server/spa/client/dist/bundle.css',
    bundle: true,
    minify: false,
    logLevel: 'info',
});

// Wiki SPA
await esbuild.build({
    entryPoints: ['src/server/wiki/spa/client/index.ts'],
    outfile: 'src/server/wiki/spa/client/dist/bundle.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    sourcemap: false,
    logLevel: 'info',
});

await esbuild.build({
    entryPoints: ['src/server/wiki/spa/client/styles.css'],
    outfile: 'src/server/wiki/spa/client/dist/bundle.css',
    bundle: true,
    minify: false,
    logLevel: 'info',
});
