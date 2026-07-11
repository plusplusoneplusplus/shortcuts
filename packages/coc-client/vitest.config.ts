import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 30000,
        hookTimeout: 30000,
        pool: 'forks',
        dangerouslyIgnoreUnhandledErrors: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov', 'cobertura', 'json'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
        },
    },
});
