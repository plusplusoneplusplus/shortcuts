import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'react',
    },
    resolve: {
        alias: {
            '@plusplusoneplusplus/coc-server': path.resolve(__dirname, 'src/server/index.ts'),
            '@plusplusoneplusplus/coc-client': path.resolve(__dirname, '../coc-client/src/index.ts'),
        },
    },
    test: {
        globals: true,
        setupFiles: ['test/setup.ts'],
        globalSetup: ['test/global-setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov', 'cobertura'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/**/index.ts']
        },
        testTimeout: 60000,
        hookTimeout: 60000,
        // Use child_process forks instead of worker_threads. Worker threads
        // on macOS Apple Silicon (Node 24 + vitest 1.6) can crash with
        // SIGSEGV on shutdown when test files load native addons (notably
        // better-sqlite3 from forge/coc). On Windows the same workload in
        // worker threads can hard-crash with ACCESS_VIOLATION (exit code
        // 3221225477) mid-suite. Forks isolate each test file in its own
        // OS process so native-addon teardown happens on process exit.
        pool: 'forks',
        // The Windows fork pool (vitest 1.6 + tinypool) sometimes raises
        // a post-completion "Worker exited unexpectedly" unhandled error
        // when a worker process exits before tinypool has a chance to
        // detach its `error` listener (vitest-dev/vitest#10057, fixed in
        // vitest 4.x but not backported to 1.6). Every test file already
        // passed at that point, so swallow the cleanup-time error rather
        // than fail an otherwise-green run.
        dangerouslyIgnoreUnhandledErrors: true,
        // Vitest 4 removed `environmentMatchGlobs`; the supported migration
        // is to split env-specific test sets into projects. SPA tests run
        // in jsdom; everything else runs in node. Both inherit the shared
        // root settings above via `extends: true`.
        projects: [
            {
                extends: true,
                test: {
                    name: 'jsdom',
                    include: ['test/spa/**/*.test.ts', 'test/spa/**/*.test.tsx'],
                    environment: 'jsdom',
                },
            },
            {
                extends: true,
                test: {
                    name: 'node',
                    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
                    exclude: ['test/spa/**/*.test.ts', 'test/spa/**/*.test.tsx'],
                    environment: 'node',
                },
            },
        ],
    }
});
