import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        // Test against tiptap-kit source so a kit change needs no rebuild.
        alias: [{ find: '@plusplusoneplusplus/tiptap-kit', replacement: path.resolve(dirname, '../tiptap-kit/src') }],
    },
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['test/**/*.test.{ts,tsx}'],
        setupFiles: ['test/setup.ts'],
        pool: 'forks',
    },
});
