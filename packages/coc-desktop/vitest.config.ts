import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: { alias: { '@plusplusoneplusplus/coc-client': path.resolve(__dirname, '../coc-client/src/index.ts') } },
    test: {
        globals: false,
        // Only run our own unit tests — never the forked server-entry, which
        // pulls in the full coc runtime + native modules.
        include: ['test/**/*.test.ts'],
    },
});
