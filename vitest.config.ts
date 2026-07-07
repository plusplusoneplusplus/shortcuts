/**
 * Root-level vitest configuration.
 *
 * This config is used when vitest is invoked directly from the repository root
 * (e.g. the CoC final-check validation command):
 *
 *   npx vitest run packages/coc/test/spa/react/...
 *
 * It is NOT used by `npm run test:run -w packages/coc`, which changes into the
 * package directory and picks up packages/coc/vitest.config.ts with its own
 * local vitest 1.x binary.
 *
 * Key purpose: supply the `open-color → open-color.js` alias so that the
 * Node 25+ "needs an import attribute of type: json" error does not surface.
 * @excalidraw/excalidraw ships `import OpenColor from "open-color"` in its ESM
 * dist with no `with { type: "json" }` attribute; the open-color package's
 * `"main"` points to open-color.json, which Node ≥ 24 refuses to load as a
 * bare ESM default import. Redirecting to open-color.js (CJS, module.exports)
 * lets Vite handle the CJS→ESM interop transparently.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'react',
    },
    resolve: {
        alias: {
            // Redirect open-color to the CJS .js file to avoid the
            // ERR_IMPORT_ATTRIBUTE_MISSING error on Node ≥ 24.
            // open-color.js uses module.exports; Vite handles CJS→ESM interop.
            'open-color': path.resolve(__dirname, 'node_modules/open-color/open-color.js'),

            // Source aliases for the coc workspace packages so that test
            // imports resolve to TypeScript sources (same as packages/coc/vitest.config.ts).
            '@plusplusoneplusplus/coc-server': path.resolve(__dirname, 'packages/coc/src/server/index.ts'),
            '@plusplusoneplusplus/coc-agent-sdk/testing': path.resolve(__dirname, 'packages/coc-agent-sdk/src/testing/index.ts'),
            '@plusplusoneplusplus/coc-client': path.resolve(__dirname, 'packages/coc-client/src/index.ts'),
            '@plusplusoneplusplus/teams-bot': path.resolve(__dirname, 'packages/teams-bot/src/index.ts'),
        },
    },
    test: {
        globals: true,
        silent: process.env.VITEST_VERBOSE_LOGS !== '1',
        environment: 'node',
        // Apply the coc setup file so that vi.mock('@excalidraw/excalidraw')
        // and the jsdom localStorage fix take effect for all coc test files.
        setupFiles: ['packages/coc/test/setup.ts'],
        globalSetup: ['packages/coc/test/global-setup.ts'],
        testTimeout: 60000,
        hookTimeout: 60000,
        // Run SPA component tests (tsx/ts under spa/ and server/spa/) in jsdom,
        // mirroring the environmentMatchGlobs from packages/coc/vitest.config.ts.
        environmentMatchGlobs: [
            ['packages/coc/test/spa/**/*.test.tsx', 'jsdom'],
            ['packages/coc/test/spa/**/*.test.ts', 'jsdom'],
            ['packages/coc/test/server/spa/**/*.test.tsx', 'jsdom'],
            ['packages/coc/test/server/spa/**/*.test.ts', 'jsdom'],
        ],
        pool: 'forks',
        minForks: 1,
        maxForks: 2,
        dangerouslyIgnoreUnhandledErrors: true,
    },
});
