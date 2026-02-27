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
import { createE2EMockSDKService, type E2EMockAIControls } from './mock-ai';

/**
 * Windows-safe recursive directory removal.
 * On Windows, file handles may linger after server.close(), causing
 * ENOTEMPTY / EBUSY / EPERM.  Retries up to 5 times with 200-3200 ms
 * exponential back-off so CI runners have time to release handles.
 */
const RETRIABLE_CODES = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EACCES']);
export function safeRmSync(dir: string, maxRetries = 5): void {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            return;
        } catch (err: any) {
            const retriable = RETRIABLE_CODES.has(err.code);
            if (attempt === maxRetries || !retriable) {
                if (err.code === 'ENOENT') return;
                throw err;
            }
            const delayMs = 200 * Math.pow(2, attempt);
            const start = Date.now();
            while (Date.now() - start < delayMs) { /* busy-wait in sync context */ }
        }
    }
}

// Import from compiled dist — Playwright doesn't transpile source TS
const { createExecutionServer } = require('../../../dist/server/index');
const { FileProcessStore } = require('@plusplusoneplusplus/pipeline-core');

type ExecutionServer = Awaited<ReturnType<typeof createExecutionServer>>;

/** Internal context that groups resources with a shared lifecycle. */
interface ServerContext {
    server: ExecutionServer;
    mockAI: E2EMockAIControls;
    tmpDir: string;
}

export interface ServerFixture {
    server: ExecutionServer;
    serverUrl: string;
    mockAI: E2EMockAIControls;
}

/**
 * Intercept GET /api/processes (without query params) so the SPA's init()
 * receives an array directly (matching the `Array.isArray(pRes)` check).
 * Requests WITH query params (e.g. workspace filter) pass through unchanged
 * because the repos code expects `{ processes: [...] }`.
 *
 * CDN scripts: Wiki tests need marked, highlight.js, and mermaid. We serve
 * marked from node_modules when available; for highlight.js and mermaid we
 * let requests pass through to the network (required for wiki E2E tests).
 */
async function patchApiResponses(page: Page): Promise<void> {
    const cocRoot = path.join(__dirname, '..', '..', '..');
    const rootNodeModules = path.join(cocRoot, '..', 'node_modules');
    const markedPath = path.join(rootNodeModules, 'marked', 'marked.min.js');

    await page.route('**://cdnjs.cloudflare.com/**', async route => {
        const url = route.request().url();
        if (/highlight\.min\.js/.test(url)) {
            return route.continue();
        }
        return route.fulfill({ status: 200, body: '// cdn stub', contentType: 'text/javascript' });
    });

    await page.route('**://cdn.jsdelivr.net/**', async route => {
        const url = route.request().url();
        if (/marked\.min\.js|\/marked\//.test(url)) {
            if (fs.existsSync(markedPath)) {
                const content = fs.readFileSync(markedPath, 'utf-8');
                return route.fulfill({ status: 200, body: content, contentType: 'text/javascript' });
            }
            return route.continue();
        }
        if (/mermaid.*\.min\.js|\/mermaid@/.test(url)) {
            return route.continue();
        }
        if (/d3.*\.min\.js|\/d3@/.test(url)) {
            return route.continue();
        }
        return route.fulfill({ status: 200, body: '// cdn stub', contentType: 'text/javascript' });
    });

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

export const test = base.extend<ServerFixture & { _context: ServerContext }>({
    _context: async ({}, use) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-'));
        const store = new FileProcessStore({ dataDir: tmpDir });
        const mockAI = createE2EMockSDKService();

        const server = await createExecutionServer({
            store,
            port: 0,
            host: '127.0.0.1',
            dataDir: tmpDir,
            aiService: mockAI.service,
        });

        await use({ server, mockAI, tmpDir });

        await server.close();
        // Allow Windows to release file handles before cleanup
        await new Promise(r => setTimeout(r, process.platform === 'win32' ? 500 : 0));
        safeRmSync(tmpDir);
    },

    server: async ({ _context }, use) => {
        await use(_context.server);
    },

    serverUrl: async ({ server }, use) => {
        await use(server.url);
    },

    mockAI: async ({ _context }, use) => {
        await use(_context.mockAI);
        // Reset mocks after each test for isolation
        _context.mockAI.resetAll();
    },

    // Automatically patch API responses for every page
    page: async ({ page, server }, use) => {
        await patchApiResponses(page);
        await use(page);
    },
});

export { expect };
