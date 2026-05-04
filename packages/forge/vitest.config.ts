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
        // See packages/coc/vitest.config.ts — forge ships better-sqlite3
        // and worker_threads on macOS Apple Silicon (Node 24 + vitest 1.6)
        // can SIGSEGV during native-addon teardown. Forks each file into
        // its own OS process; teardown runs on process exit so the
        // worker-thread cleanup race vanishes.
        pool: 'forks',
    }
});
