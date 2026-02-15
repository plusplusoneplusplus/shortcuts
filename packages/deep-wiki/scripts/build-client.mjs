/**
 * esbuild config for bundling the deep-wiki SPA client code.
 *
 * Produces:
 *   src/server/spa/client/dist/bundle.js   (IIFE, for <script> inlining)
 *   src/server/spa/client/dist/bundle.css  (for <style> inlining)
 *
 * NOTE: This is separate from esbuild.config.mjs (root), which bundles the
 *       CLI entry point for npm publishing. This script only handles the
 *       browser-side SPA code.
 */
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/server/spa/client/index.ts'],
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
    entryPoints: ['src/server/spa/client/styles.css'],
    outfile: 'src/server/spa/client/dist/bundle.css',
    bundle: true,
    minify: false,
    logLevel: 'info',
});
