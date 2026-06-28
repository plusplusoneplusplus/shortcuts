import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        // Only run our own unit tests — never the forked server-entry, which
        // pulls in the full coc runtime + native modules.
        include: ['test/**/*.test.ts'],
    },
});
