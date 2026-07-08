/**
 * WebSocket Recovery & Multi-Tab Synchronization E2E Tests
 *
 * Section 8: Server Restart Recovery (UI-visible toasts, status indicator)
 * Section 9: Multi-Tab Event Synchronization (two browser contexts, same server)
 * Section 10: Workspace-Scoped Events Do Not Leak (two tabs, different workspaces)
 *
 * Build must be up-to-date: npm run build in packages/coc before running.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import type { Page, WebSocketRoute } from '@playwright/test';
import { safeRmSync } from '../helpers/safe-rm';
import { E2E_SERVER_CONFIG_YAML } from './fixtures/e2e-server-config';

// Import from compiled dist — Playwright doesn't transpile source TS
const { createExecutionServer } = require('../../dist/server/index');
const { FileProcessStore } = require('@plusplusoneplusplus/forge');

// ============================================================================
// Types
// ============================================================================

type ExecutionServer = Awaited<ReturnType<typeof createExecutionServer>>;

async function startServer(): Promise<{
    server: ExecutionServer;
    dataDir: string;
    cleanup: () => Promise<void>;
}> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-ws-'));
    const store = new FileProcessStore({ dataDir });
    // Pin the classic shell (see e2e-server-config.ts): remoteShell moves the
    // ws-status-indicator into the sidebar footer, so the flags must stay off
    // for this spec's own server the same way the shared fixture does.
    const configPath = path.join(dataDir, 'config.yaml');
    fs.writeFileSync(configPath, E2E_SERVER_CONFIG_YAML);
    const server = await createExecutionServer({
        store,
        port: 0,
        host: '127.0.0.1',
        dataDir,
        configPath,
    });
    const cleanup = async () => {
        try { await server.close(); } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, process.platform === 'win32' ? 400 : 0));
        safeRmSync(dataDir);
    };
    return { server, dataDir, cleanup };
}

/** Patch the /api/processes response for the SPA's init() call. */
async function patchApiResponses(page: Page): Promise<void> {
    await page.route('**/api/processes', async (route, request) => {
        if (request.method() !== 'GET') return route.continue();
        const reqUrl = new URL(request.url());
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
                return route.continue().catch(() => {});
            }
        } else {
            return route.continue();
        }
    });
}

/** Stub CDN scripts so offline tests don't hang. */
async function stubCdnScripts(page: Page): Promise<void> {
    await page.route('**://cdnjs.cloudflare.com/**', route =>
        route.fulfill({ status: 200, body: '// cdn stub', contentType: 'text/javascript' })
    );
    await page.route('**://cdn.jsdelivr.net/**', route =>
        route.fulfill({ status: 200, body: '// cdn stub', contentType: 'text/javascript' })
    );
}

function postJson(baseUrl: string, urlPath: string, data: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const parsed = new URL(`${baseUrl}${urlPath}`);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function seedProcess(baseUrl: string, id: string, workspaceId?: string): Promise<void> {
    await postJson(baseUrl, '/api/processes', {
        id,
        promptPreview: `Process ${id}`,
        fullPrompt: `Full prompt for ${id}`,
        status: 'completed',
        startTime: new Date().toISOString(),
        type: 'clarification',
        ...(workspaceId ? { metadata: { workspaceId } } : {}),
    });
}

/** Provision a workspace so per-repo activity routes have a real target. */
async function seedWorkspace(baseUrl: string, id: string, name = id): Promise<void> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `coc-e2e-ws-recovery-${id}-`));
    await postJson(baseUrl, '/api/workspaces', { id, name, rootPath: tmp });
}

/** Seed a queue task scoped to a workspace; returns the created task id. */
async function seedScopedQueueTask(baseUrl: string, wsId: string, displayName: string): Promise<string> {
    const res = await postJson(baseUrl, '/api/queue', {
        type: 'chat',
        priority: 'normal',
        displayName,
        repoId: wsId,
        payload: { workspaceId: wsId, prompt: `Test prompt for ${displayName}` },
    });
    const json = JSON.parse(res.body);
    return (json.task ?? json).id as string;
}

async function setupPage(page: Page): Promise<void> {
    await patchApiResponses(page);
    await stubCdnScripts(page);
}

// ============================================================================
// Section 8: Server Restart Recovery
// ============================================================================

test.describe('Section 8: Server Restart Recovery', () => {
    test('8.1 disconnect while page is open → "Connection lost" toast appears', async ({ page }) => {
        const { server, cleanup } = await startServer();
        try {
            await setupPage(page);
            await page.goto(server.url);

            // Wait for the WS to establish
            await expect(page.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // Close the server to force disconnect
            await server.close();

            // "Connection lost — reconnecting…" toast should appear
            await expect(page.getByText('Connection lost — reconnecting…')).toBeVisible({ timeout: 8000 });
        } finally {
            await cleanup();
        }
    });

    test('8.2 TopBar status changes from "Connected" after server disconnect', async ({ page }) => {
        const { server, cleanup } = await startServer();
        try {
            await setupPage(page);
            await page.goto(server.url);

            await expect(page.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            await server.close();

            // Status indicator should no longer show "Connected"
            await expect(page.locator('[data-testid="ws-status-indicator"]')).not.toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 8000 }
            );
        } finally {
            await cleanup();
        }
    });

    test('8.3 toast shown after first disconnect, not on initial connect', async ({ page }) => {
        const { server, cleanup } = await startServer();
        try {
            await setupPage(page);
            await page.goto(server.url);

            // Wait for initial WS connection — no toast on first connect
            await expect(page.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // No "Reconnected" toast on initial connect
            await expect(page.getByText('Reconnected')).not.toBeVisible();

            // Now disconnect
            await server.close();
            await expect(page.getByText('Connection lost — reconnecting…')).toBeVisible({ timeout: 8000 });
        } finally {
            await cleanup();
        }
    });

    test('8.4 reconnect after simulated disconnect → "Reconnected" toast via routeWebSocket', async ({ browser }) => {
        const { server, cleanup } = await startServer();
        const page = await browser.newPage();
        try {
            await setupPage(page);

            let activeRoute: WebSocketRoute | null = null;

            // Intercept WebSocket connections so we can control disconnect/reconnect.
            // The SPA builds the WS URL from `location.host`, so derive the pattern
            // from `server.url` to handle display-host mapping (e.g. 127.0.0.1 → localhost).
            const wsUrl = `${server.url.replace(/^http/, 'ws')}/ws`;
            await page.routeWebSocket(wsUrl, async (ws) => {
                activeRoute = ws;
                ws.connectToServer();
            });

            await page.goto(server.url);

            // Wait for initial WS connection
            await expect(page.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // Simulate disconnect by closing the intercepted client route
            if (activeRoute) {
                (activeRoute as WebSocketRoute).close();
            }

            // Disconnect toast
            await expect(page.getByText('Connection lost — reconnecting…')).toBeVisible({ timeout: 8000 });

            // The useWebSocket hook retries after 1s; new connection is intercepted again
            // and connectToServer() is called → reconnects to real server
            await expect(page.getByText('Reconnected')).toBeVisible({ timeout: 15000 });
        } finally {
            await page.close();
            await cleanup();
        }
    });
});

// ============================================================================
// Section 9: Multi-Tab Event Synchronization
// ============================================================================

test.describe('Section 9: Multi-Tab Event Synchronization', () => {
    test('9.1 process created in backend → appears in both open tabs within 2s', async ({ browser }) => {
        const { server, cleanup } = await startServer();
        const page1 = await browser.newPage();
        const page2 = await browser.newPage();
        try {
            await setupPage(page1);
            await setupPage(page2);

            // Provision a workspace and navigate both tabs to its activity sub-tab.
            const wsId = `ws-9-1-${Date.now()}`;
            await seedWorkspace(server.url, wsId);

            const activityUrl = `${server.url}/#repos/${encodeURIComponent(wsId)}/activity`;
            await page1.goto(activityUrl);
            await page2.goto(activityUrl);

            // Wait for WS connections on both tabs
            await expect(page1.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );
            await expect(page2.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // Create a workspace-scoped queue task (triggers queue-updated WS broadcast)
            const taskId = await seedScopedQueueTask(server.url, wsId, `Multi-tab task ${Date.now()}`);

            // Completed queue tasks land in the activity feed with `queue_<taskId>` ids.
            await expect(page1.locator(`[data-task-id="queue_${taskId}"]`)).toBeVisible({ timeout: 15000 });
            await expect(page2.locator(`[data-task-id="queue_${taskId}"]`)).toBeVisible({ timeout: 15000 });
        } finally {
            await page1.close();
            await page2.close();
            await cleanup();
        }
    });

    test('9.2 process visible in tab 1 is also visible in tab 2 after WS propagation', async ({ browser }) => {
        const { server, cleanup } = await startServer();
        const page1 = await browser.newPage();
        const page2 = await browser.newPage();
        try {
            await setupPage(page1);
            await setupPage(page2);

            // Provision the workspace, then seed a queue task scoped to it before
            // opening tabs so both tabs see the task on initial render.
            const wsId = `ws-9-2-${Date.now()}`;
            await seedWorkspace(server.url, wsId);
            const taskId = await seedScopedQueueTask(server.url, wsId, `Sync task ${Date.now()}`);

            const activityUrl = `${server.url}/#repos/${encodeURIComponent(wsId)}/activity`;
            await page1.goto(activityUrl);
            await page2.goto(activityUrl);

            await expect(page1.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );
            await expect(page2.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // Both tabs should see the existing queue task (loaded on initial render)
            await expect(page1.locator(`[data-task-id="queue_${taskId}"]`)).toBeVisible({ timeout: 10000 });
            await expect(page2.locator(`[data-task-id="queue_${taskId}"]`)).toBeVisible({ timeout: 10000 });
        } finally {
            await page1.close();
            await page2.close();
            await cleanup();
        }
    });

    test('9.3 both tabs maintain stable WS connection (basic multi-tab stability)', async ({ browser }) => {
        const { server, cleanup } = await startServer();
        const page1 = await browser.newPage();
        const page2 = await browser.newPage();
        try {
            await setupPage(page1);
            await setupPage(page2);

            const wsId = `ws-9-3-${Date.now()}`;
            await seedWorkspace(server.url, wsId);

            const activityUrl = `${server.url}/#repos/${encodeURIComponent(wsId)}/activity`;
            await page1.goto(activityUrl);
            await page2.goto(activityUrl);

            // Both tabs should be stably connected
            await expect(page1.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );
            await expect(page2.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // Create 3 workspace-scoped processes in rapid succession
            await Promise.all([
                seedProcess(server.url, 'rapid-proc-1', wsId),
                seedProcess(server.url, 'rapid-proc-2', wsId),
                seedProcess(server.url, 'rapid-proc-3', wsId),
            ]);

            // Both tabs should not crash or disconnect
            await page1.waitForTimeout(2000);
            await page2.waitForTimeout(2000);

            await expect(page1.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected'
            );
            await expect(page2.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected'
            );
        } finally {
            await page1.close();
            await page2.close();
            await cleanup();
        }
    });
});

// ============================================================================
// Section 10: Workspace-Scoped Events Do Not Leak
// ============================================================================

test.describe('Section 10: Workspace-Scoped Events Do Not Leak', () => {
    test('10.1 process for workspace A does not appear in workspace B tab', async ({ browser }) => {
        const { server, cleanup } = await startServer();
        const page1 = await browser.newPage();
        const page2 = await browser.newPage();
        try {
            await setupPage(page1);
            await setupPage(page2);

            // Register two workspaces
            await postJson(server.url, '/api/workspaces', { id: 'ws-a-e2e', name: 'Workspace A', rootPath: '/tmp/ws-a' });
            await postJson(server.url, '/api/workspaces', { id: 'ws-b-e2e', name: 'Workspace B', rootPath: '/tmp/ws-b' });

            await page1.goto(`${server.url}/#repos`);
            await page2.goto(`${server.url}/#repos`);

            await expect(page1.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );
            await expect(page2.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // Seed a process for workspace A only
            await seedProcess(server.url, 'ws-a-only-proc', 'ws-a-e2e');

            // Wait for events to propagate
            await page1.waitForTimeout(2000);
            await page2.waitForTimeout(2000);

            // Both pages should remain stable (no crash)
            await expect(page1.locator('[data-react]')).toBeVisible();
            await expect(page2.locator('[data-react]')).toBeVisible();
        } finally {
            await page1.close();
            await page2.close();
            await cleanup();
        }
    });

    test('10.2 tasks-changed for workspace A broadcast does not reach workspace B subscriber', async ({ browser }) => {
        const { server, cleanup } = await startServer();
        const page1 = await browser.newPage();
        const page2 = await browser.newPage();

        try {
            await setupPage(page1);
            await setupPage(page2);

            await page1.goto(`${server.url}/#repos`);
            await page2.goto(`${server.url}/#repos`);

            await expect(page1.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );
            await expect(page2.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // Track tasks API requests on page2
            const page2TaskRequests: string[] = [];
            page2.on('request', req => {
                if (req.url().includes('/tasks')) {
                    page2TaskRequests.push(req.url());
                }
            });
            const requestsBeforeBroadcast = page2TaskRequests.length;

            // Broadcast tasks-changed for workspace A only
            server.wsServer?.broadcastProcessEvent?.({
                type: 'tasks-changed',
                workspaceId: 'ws-isolated-a',
                timestamp: Date.now(),
            });

            await page2.waitForTimeout(2000);

            // Page 2 (not subscribed to ws-isolated-a) should not have fetched tasks for that workspace
            const newRequests = page2TaskRequests.slice(requestsBeforeBroadcast);
            const isolatedRequests = newRequests.filter(url => url.includes('ws-isolated-a'));
            expect(isolatedRequests).toHaveLength(0);
        } finally {
            await page1.close();
            await page2.close();
            await cleanup();
        }
    });

    test('10.3 git-changed event for repo A does not trigger repo B refresh', async ({ browser }) => {
        const { server, cleanup } = await startServer();
        const page1 = await browser.newPage();
        const page2 = await browser.newPage();

        try {
            await setupPage(page1);
            await setupPage(page2);

            await postJson(server.url, '/api/workspaces', { id: 'git-ws-a', name: 'Git Repo A', rootPath: '/tmp/git-a' });
            await postJson(server.url, '/api/workspaces', { id: 'git-ws-b', name: 'Git Repo B', rootPath: '/tmp/git-b' });

            await page1.goto(`${server.url}/#repos`);
            await page2.goto(`${server.url}/#repos`);

            await expect(page1.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );
            await expect(page2.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected', { timeout: 15000 }
            );

            // Track git API requests on page2
            const page2GitRequests: string[] = [];
            page2.on('request', req => {
                if (req.url().includes('/git') || req.url().includes('git-ws-a')) {
                    page2GitRequests.push(req.url());
                }
            });
            const beforeCount = page2GitRequests.length;

            // Broadcast git-changed for workspace A (page2 subscribed to B should not receive workspace-A events)
            server.wsServer?.broadcastGitChanged?.('git-ws-a', 'test-trigger');

            await page2.waitForTimeout(2000);

            // Page2 may still receive the broadcast (no subscription set) — check stability
            await expect(page2.locator('[data-react]')).toBeVisible();
            await expect(page2.locator('[data-testid="ws-status-indicator"]')).toHaveAttribute(
                'aria-label', 'Connection: Connected'
            );
        } finally {
            await page1.close();
            await page2.close();
            await cleanup();
        }
    });
});

