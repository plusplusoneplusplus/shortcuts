import { defineConfig } from 'vitest/config';
import path from 'path';

const resolveAlias = {
    // Redirect open-color to its CJS .js file to avoid the Node ≥ 24
    // ERR_IMPORT_ATTRIBUTE_MISSING error. The open-color package sets
    // "main": "open-color.json", but @excalidraw/excalidraw imports it
    // as `import OpenColor from "open-color"` with no `with { type: "json" }`
    // attribute. open-color.js (module.exports) is resolved by Vite via
    // CJS→ESM interop and works on all Node versions.
    'open-color': path.resolve(__dirname, '../../node_modules/open-color/open-color.js'),
    '@plusplusoneplusplus/coc-server': path.resolve(__dirname, 'src/server/index.ts'),
    '@plusplusoneplusplus/coc-agent-sdk/testing': path.resolve(__dirname, '../coc-agent-sdk/src/testing/index.ts'),
    '@plusplusoneplusplus/coc-client': path.resolve(__dirname, '../coc-client/src/index.ts'),
    // Subpath alias must precede the core alias: Vite matches aliases in
    // order and treats a bare package name as a prefix of its subpaths.
    '@plusplusoneplusplus/coc-connector/teams': path.resolve(__dirname, '../coc-connector/src/teams/index.ts'),
    '@plusplusoneplusplus/coc-connector': path.resolve(__dirname, '../coc-connector/src/index.ts'),
};

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
    // Limit concurrent workers to 2 to avoid OOM on macOS runners
    // (excalidraw + jsdom forks accumulate ~14 GB peak usage at 3 concurrent).
    minWorkers: 1,
    maxWorkers: 2,
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
