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
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/**/index.ts']
        },
        testTimeout: 30000,
        hookTimeout: 30000,
        environmentMatchGlobs: [
            ['test/spa/**/*.test.tsx', 'jsdom'],
            ['test/spa/**/*.test.ts', 'jsdom'],
        ],
    }
});
