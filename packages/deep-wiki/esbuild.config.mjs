/**
 * esbuild configuration for bundling deep-wiki CLI for npm publishing.
 *
 * Bundles @plusplusoneplusplus/pipeline-core (workspace-only, not on npm) into
 * the output. External dependencies that are already published on npm remain
 * external so they are resolved from the consumer's node_modules at runtime.
 */

import * as esbuild from 'esbuild';

/** Packages that are on npm and should NOT be bundled */
const EXTERNAL_DEPS = [
    '@github/copilot-sdk',
    'commander',
    'js-yaml',
];

const isWatch = process.argv.includes('--watch');

/**
 * Strip the shebang from source files so the banner is the only one.
 * The source index.ts already has #!/usr/bin/env node which would duplicate.
 */
const stripShebangPlugin = {
    name: 'strip-shebang',
    setup(build) {
        build.onLoad({ filter: /\.ts$/ }, async (args) => {
            const fs = await import('fs');
            let contents = await fs.promises.readFile(args.path, 'utf8');
            if (contents.startsWith('#!')) {
                contents = contents.replace(/^#![^\n]*\n/, '');
            }
            return { contents, loader: 'ts' };
        });
    },
};

/** @type {esbuild.BuildOptions} */
const buildOptions = {
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    external: EXTERNAL_DEPS,
    banner: {
        js: '#!/usr/bin/env node',
    },
    plugins: [stripShebangPlugin],
    logLevel: 'info',
};

if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
} else {
    await esbuild.build(buildOptions);
}
