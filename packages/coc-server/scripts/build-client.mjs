/**
 * esbuild config for bundling the DeepWiki SPA client code.
 *
 * Produces:
 *   src/wiki/spa/client/dist/bundle.js   (IIFE, for <script> inlining)
 *   src/wiki/spa/client/dist/bundle.css  (for <style> inlining)
 */
import { mkdir, copyFile } from 'fs/promises';
import * as esbuild from 'esbuild';

const outDir = 'src/wiki/spa/client/dist';
await mkdir(outDir, { recursive: true });

await esbuild.build({
    entryPoints: ['src/wiki/spa/client/index.ts'],
    outfile: `${outDir}/bundle.js`,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    sourcemap: false,
    logLevel: 'info',
});

// Copy CSS (styles + ask-widget) into bundle.css
await esbuild.build({
    entryPoints: ['src/wiki/spa/client/styles.css'],
    outfile: `${outDir}/bundle.css`,
    bundle: true,
    minify: false,
    logLevel: 'info',
});
