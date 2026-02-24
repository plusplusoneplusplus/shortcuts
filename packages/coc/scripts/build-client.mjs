/**
 * esbuild config for bundling the CoC SPA client code.
 *
 * Produces:
 *   src/server/spa/client/dist/bundle.js        (IIFE, for <script> inlining)
 *   src/server/spa/client/dist/bundle.css        (for <style> inlining)
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

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.css, 'utf-8');

    const sizeKb = (Buffer.byteLength(result.css, 'utf-8') / 1024).toFixed(1);
    console.log(`\n  ${outputPath}  ${sizeKb}kb\n`);
}

// Main dashboard SPA
await esbuild.build({
    entryPoints: ['src/server/spa/client/index.tsx'],
    outfile: 'src/server/spa/client/dist/bundle.js',
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    sourcemap: false,
    logLevel: 'info',
    // Mark Node.js built-ins as external so that tree-shaken pipeline-core
    // server-side modules (ai, copilot-sdk) don't break the browser bundle.
    external: ['child_process', 'fs', 'os', 'path', 'url', 'net', 'tls', 'http', 'https', 'stream', 'crypto', 'events', 'util'],
});

await buildTailwindBundle(
    'src/server/spa/client/tailwind.css',
    'src/server/spa/client/dist/bundle.css'
);
