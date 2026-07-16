import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // Resolve the connector subpaths to source so unit tests don't
            // depend on a prior `coc-connector` build. Subpath aliases must
            // precede the core alias — Vite matches in order and treats a bare
            // package name as a prefix of its subpaths.
            '@plusplusoneplusplus/coc-connector/teams': path.resolve(__dirname, '../coc-connector/src/teams/index.ts'),
            '@plusplusoneplusplus/coc-connector/whatsapp': path.resolve(__dirname, '../coc-connector/src/whatsapp/index.ts'),
            '@plusplusoneplusplus/coc-connector': path.resolve(__dirname, '../coc-connector/src/index.ts'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/**/index.ts']
        },
        testTimeout: 60000,
        hookTimeout: 60000,
    }
});
