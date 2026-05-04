import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov', 'cobertura'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/**/index.ts']
        },
        testTimeout: 30000,
        hookTimeout: 30000,
        // Use forks pool for native-addon stability — see coc/forge configs
        // for full rationale (Node 24 + vitest 1.6 + better-sqlite3 on
        // macOS Apple Silicon worker threads can SIGSEGV on shutdown).
        pool: 'forks',
    }
});
