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
        // See packages/coc/vitest.config.ts — forks isolate native-addon
        // teardown to avoid macOS SIGSEGV / Windows ACCESS_VIOLATION;
        // the unhandled-errors flag swallows the post-completion Windows
        // "Worker exited unexpectedly" tinypool race fixed in vitest 4.x.
        pool: 'forks',
        dangerouslyIgnoreUnhandledErrors: true,
    }
});
