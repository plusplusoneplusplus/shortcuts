/**
 * Server Fixture for Playwright E2E Tests
 *
 * Wraps createExecutionServer() into a Playwright test fixture that:
 * 1. Creates a temp dataDir
 * 2. Starts server on port 0
 * 3. Provides `baseURL` and `serverUrl` to the test
 * 4. Tears down server + cleans temp dir in teardown
 *
 * NOTE: Requires `npm run build` before running E2E tests.
 *
 * The SPA's init() expects GET /api/processes to return an array but the API
 * returns { processes: [...] }. We patch the response via page.route() so the
 * SPA correctly populates its state on page load.
 */

import { test as base, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Import from compiled dist — Playwright doesn't transpile source TS
const { createExecutionServer } = require('../../../dist/server/index');
const { FileProcessStore } = require('@plusplusoneplusplus/pipeline-core');

type ExecutionServer = Awaited<ReturnType<typeof createExecutionServer>>;

export interface ServerFixture {
    server: ExecutionServer;
    serverUrl: string;
}

/**
 * Intercept GET /api/processes (without query params) so the SPA's init()
 * receives an array directly (matching the `Array.isArray(pRes)` check).
 * Requests WITH query params (e.g. workspace filter) pass through unchanged
 * because the repos code expects `{ processes: [...] }`.
 */
async function patchApiResponses(page: Page): Promise<void> {
    await page.route('**/api/processes', async (route, request) => {
        if (request.method() !== 'GET') {
            return route.continue();
        }
        const reqUrl = new URL(request.url());
        // Only transform the bare /api/processes call (used by init())
        if (reqUrl.search === '' || reqUrl.search === '?') {
            try {
                const response = await route.fetch();
                const json = await response.json();
                const body = JSON.stringify(json.processes ?? json);
                await route.fulfill({
                    status: response.status(),
                    headers: { ...response.headers(), 'content-type': 'application/json' },
                    body,
                });
            } catch {
                // Response disposed (page navigated away) — ignore
                return route.continue().catch(() => {});
            }
        } else {
            return route.continue();
        }
    });
}

export const test = base.extend<ServerFixture>({
    server: async ({}, use) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-'));
        const store = new FileProcessStore({ dataDir: tmpDir });
        const server = await createExecutionServer({
            store,
            port: 0,
            host: '127.0.0.1',
            dataDir: tmpDir,
        });

        await use(server);

        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    },

    serverUrl: async ({ server }, use) => {
        await use(server.url);
    },

    // Automatically patch API responses for every page
    page: async ({ page, server }, use) => {
        await patchApiResponses(page);
        await use(page);
    },
});

export { expect };
