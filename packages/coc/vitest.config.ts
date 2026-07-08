import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'react',
    },
    resolve: {
        alias: {
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
            '@plusplusoneplusplus/teams-bot': path.resolve(__dirname, '../teams-bot/src/index.ts'),
        },
    },
    test: {
        globals: true,
        // The full CoC suite emits tens of thousands of console lines from
        // passing tests; suppress them by default so local broad validation
        // stays comfortably under outer command timeouts.
        silent: process.env.VITEST_VERBOSE_LOGS !== '1',
        environment: 'node',
        include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
        setupFiles: ['test/setup.ts'],
        globalSetup: ['test/global-setup.ts'],
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
        testTimeout: 60000,
        hookTimeout: 60000,
        environmentMatchGlobs: [
            ['test/spa/**/*.test.tsx', 'jsdom'],
            ['test/spa/**/*.test.ts', 'jsdom'],
        ],
        // Use child_process forks instead of worker_threads. Worker threads
        // on macOS Apple Silicon (Node 24 + vitest 1.6) can crash with
        // SIGSEGV on shutdown when test files load native addons (notably
        // better-sqlite3 from forge/coc). On Windows the same workload in
        // worker threads can hard-crash with ACCESS_VIOLATION (exit code
        // 3221225477) mid-suite. Forks isolate each test file in its own
        // OS process so native-addon teardown happens on process exit.
        pool: 'forks',
        poolOptions: {
            forks: {
                // Limit concurrent forks to 2 to avoid OOM on macOS runners
                // (excalidraw + jsdom forks accumulate ~14 GB peak usage at 3 concurrent).
                // minForks must be ≤ maxForks; without it tinypool defaults minThreads
                // to nCPUs-1 which can exceed maxForks and trigger a startup conflict.
                minForks: 1,
                maxForks: 2,
            },
        },
        // The Windows fork pool (vitest 1.6 + tinypool) sometimes raises
        // a post-completion "Worker exited unexpectedly" unhandled error
        // when a worker process exits before tinypool has a chance to
        // detach its `error` listener (vitest-dev/vitest#10057, fixed in
        // vitest 4.x but not backported to 1.6). Every test file already
        // passed at that point, so swallow the cleanup-time error rather
        // than fail an otherwise-green run.
        dangerouslyIgnoreUnhandledErrors: true,
    }
});
