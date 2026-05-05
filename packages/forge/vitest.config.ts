import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        globalSetup: ['test/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov', 'cobertura'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/**/index.ts']
        },
        testTimeout: 30000,
        hookTimeout: 30000,
        // See packages/coc/vitest.config.ts — forks fix the macOS SIGSEGV
        // during better-sqlite3 worker-thread teardown but trigger
        // "Worker exited unexpectedly" on Windows (vitest 1.6 + tinypool).
        // Use forks only on macOS; default to threads everywhere else.
        pool: process.platform === 'darwin' ? 'forks' : 'threads',
    }
});
