import { defineConfig } from 'vitest/config';
import path from 'path';
import { resolveMaxWorkers } from './vitest.workers';

// Array form (not an object) because one entry has to be a RegExp: the tests
// module-mock MonacoFileEditor through its old home,
// `features/repo-detail/explorer/MonacoFileEditor`, using relative specifiers.
// The implementation now lives in `shared/file-viewer/MonacoFileEditor`, so
// without this collapse the legacy specifier and the shared one would be two
// module ids and `vi.mock` on the old path would not cover anything rendering
// through the shared viewer. Order is preserved, which the coc-connector
// subpath alias below depends on.
const resolveAlias = [
    {
        find: /^.*\/features\/repo-detail\/explorer\/MonacoFileEditor$/,
        replacement: path.resolve(__dirname, 'src/server/spa/client/react/shared/file-viewer/MonacoFileEditor'),
    },
    // Redirect open-color to its CJS .js file to avoid the Node ≥ 24
    // ERR_IMPORT_ATTRIBUTE_MISSING error. The open-color package sets
    // "main": "open-color.json", but @excalidraw/excalidraw imports it
    // as `import OpenColor from "open-color"` with no `with { type: "json" }`
    // attribute. open-color.js (module.exports) is resolved by Vite via
    // CJS→ESM interop and works on all Node versions.
    { find: 'open-color', replacement: path.resolve(__dirname, '../../node_modules/open-color/open-color.js') },
    { find: '@plusplusoneplusplus/coc-server', replacement: path.resolve(__dirname, 'src/server/index.ts') },
    { find: '@plusplusoneplusplus/coc-agent-sdk/testing', replacement: path.resolve(__dirname, '../coc-agent-sdk/src/testing/index.ts') },
    { find: '@plusplusoneplusplus/coc-client', replacement: path.resolve(__dirname, '../coc-client/src/index.ts') },
    // Subpath alias must precede the core alias: Vite matches aliases in
    // order and treats a bare package name as a prefix of its subpaths.
    { find: '@plusplusoneplusplus/coc-connector/teams', replacement: path.resolve(__dirname, '../coc-connector/src/teams/index.ts') },
    { find: '@plusplusoneplusplus/coc-connector', replacement: path.resolve(__dirname, '../coc-connector/src/index.ts') },
];

const commonTestOptions = {
    globals: true,
    // The full CoC suite emits tens of thousands of console lines from
    // passing tests; suppress them by default so local broad validation
    // stays comfortably under outer command timeouts.
    silent: process.env.VITEST_VERBOSE_LOGS !== '1',
    setupFiles: ['test/setup.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Use child_process forks instead of worker_threads so native-addon
    // teardown happens on process exit instead of shared worker teardown.
    pool: 'forks' as const,
    // The worker ceiling is a memory limit, not a CPU one: see
    // resolveMaxWorkers() in ./vitest.workers.ts for the per-OS numbers and
    // why macOS is the only platform that has to stay at 2.
    minWorkers: 1,
    maxWorkers: resolveMaxWorkers(),
};

export default defineConfig({
    resolve: {
        alias: resolveAlias,
    },
    test: {
        ...commonTestOptions,
        coverage: {
            provider: 'v8',
            // 'json' produces coverage-final.json (istanbul format) which is required to
            // merge coverage across CI shards via `nyc report --temp-dir`. Without it,
            // sharded coverage runs only emit lcov.info per shard, which cannot be
            // accurately merged.
            reporter: ['text', 'html', 'lcov', 'cobertura', 'json'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/**/index.ts']
        },
        projects: [
            {
                resolve: {
                    alias: resolveAlias,
                },
                test: {
                    ...commonTestOptions,
                    name: 'node',
                    environment: 'node',
                    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
                    exclude: ['test/spa/**/*.test.ts', 'test/spa/**/*.test.tsx'],
                },
            },
            {
                resolve: {
                    alias: resolveAlias,
                },
                test: {
                    ...commonTestOptions,
                    name: 'spa',
                    environment: 'jsdom',
                    include: ['test/spa/**/*.test.ts', 'test/spa/**/*.test.tsx'],
                },
            },
        ],
    }
});
