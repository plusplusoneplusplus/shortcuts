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
        environment: 'node',
        include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
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
        environmentMatchGlobs: [
            ['test/spa/**/*.test.tsx', 'jsdom'],
            ['test/spa/**/*.test.ts', 'jsdom'],
        ],
        // Use child_process forks instead of worker_threads. Worker threads
        // on macOS Apple Silicon (Node 24 + vitest 1.6) can crash with
        // SIGSEGV on shutdown when test files load native addons (notably
        // better-sqlite3 from forge/coc). Forks isolate each test file in
        // its own OS process so addon teardown happens on process exit
        // without the worker-thread cleanup race. Slightly slower startup
        // but eliminates the macOS CI segfault.
        pool: 'forks',
    }
});
