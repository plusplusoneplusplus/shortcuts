/**
 * esbuild config for bundling the pipeline-cli SPA client code.
 *
 * Produces:
 *   src/server/spa/client/dist/bundle.js   (IIFE, for <script> inlining)
 *   src/server/spa/client/dist/bundle.css  (for <style> inlining)
 */
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/server/spa/client/index.ts'],
    outfile: 'src/server/spa/client/dist/bundle.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,          // keep readable for now; minify in later commit
    sourcemap: false,       // inline in <script>, sourcemap not useful
    logLevel: 'info',
});

await esbuild.build({
    entryPoints: ['src/server/spa/client/styles.css'],
    outfile: 'src/server/spa/client/dist/bundle.css',
    bundle: true,
    minify: false,
    logLevel: 'info',
});
