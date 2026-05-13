/**
 * esbuild config for bundling the CoCContainer SPA client.
 *
 * Produces:
 *   src/server/spa/client/dist/bundle.js   (IIFE)
 *   src/server/spa/client/dist/bundle.css  (inlined styles)
 */
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/server/spa/client/entry.tsx'],
    outfile: 'src/server/spa/client/dist/bundle.js',
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    sourcemap: false,
    logLevel: 'info',
    loader: {
        '.css': 'css',
    },
});
