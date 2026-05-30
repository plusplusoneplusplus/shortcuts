import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 30000,
        pool: 'forks',
        poolOptions: {
            forks: {
                minForks: 1,
                maxForks: 2,
            },
        },
    },
});
