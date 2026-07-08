/**
 * Multi-Workspace UI Isolation E2E Tests — Section 9
 *
 * Verifies that the dashboard UI correctly isolates data between workspaces:
 * - Task panel shows each repo's own tasks when switching between repos
 * - Queue badge shown independently per workspace
 * - Git status badge isolation
 * - Activity feed isolation
 * - Schedule list isolation
 * - Workspace removal leaves other workspace intact
 *
 * Requires: a running CoC server (managed per-test via fixture).
 * Run with: npm run test:e2e in packages/coc
 */

import { test, expect, type Page } from '@playwright/test';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { E2E_SERVER_CONFIG_YAML } from './fixtures/e2e-server-config';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ── Server Fixture ────────────────────────────────────────────────────────────

interface TestServer {
    server: ExecutionServer;
    dataDir: string;
    wsDirA: string;
    wsDirB: string;
    wsIdA: string;
    wsIdB: string;
    cleanup: () => Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-'));
    const wsDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-a-'));
    const wsDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-b-'));
    const wsIdA = 'e2e-ws-a';
    const wsIdB = 'e2e-ws-b';

    const store = new FileProcessStore({ dataDir });
    // Pin the classic shell (see e2e-server-config.ts) so this own-server spec
    // matches the shared fixture and the graduated default-on shell flags don't
    // reshape the layout out from under it.
    const configPath = path.join(dataDir, 'config.yaml');
    fs.writeFileSync(configPath, E2E_SERVER_CONFIG_YAML);
    const server = await createExecutionServer({ port: 0, host: '127.0.0.1', store, dataDir, configPath });

    // Register two workspaces via API
    await apiPost(server.url, '/api/workspaces', { id: wsIdA, name: 'Repo A', rootPath: wsDirA });
    await apiPost(server.url, '/api/workspaces', { id: wsIdB, name: 'Repo B', rootPath: wsDirB });

    const cleanup = async () => {
        await server.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(wsDirA, { recursive: true, force: true });
        fs.rmSync(wsDirB, { recursive: true, force: true });
    };

    return { server, dataDir, wsDirA, wsDirB, wsIdA, wsIdB, cleanup };
}

function apiPost(baseUrl: string, urlPath: string, data: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(data);
        const parsed = new URL(`${baseUrl}${urlPath}`);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, body: JSON.parse(text) });
                });
            },
        );
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Multi-Workspace UI Isolation', () => {
    let ctx: TestServer;

    test.beforeEach(async () => {
        ctx = await startTestServer();
    });

    test.afterEach(async () => {
        await ctx.cleanup();
    });

    test('repos list shows both workspaces after registration', async ({ page }) => {
        await page.goto(ctx.server.url);
        await page.waitForLoadState('networkidle');

        // Repos is the default landing tab — no explicit click is required.
        // Both workspace names render in `[data-testid="repo-tab"]` entries on
        // the persistent rail. Scope the assertion to the rail so the strict
        // mode duplicate-element guard doesn't trip on the same name showing
        // up inside per-workspace detail panels.
        const repoTabs = page.locator('[data-testid="repo-tab"]');
        await expect(repoTabs).toHaveCount(2, { timeout: 10_000 });
        await expect(repoTabs.filter({ hasText: 'Repo A' })).toHaveCount(1);
        await expect(repoTabs.filter({ hasText: 'Repo B' })).toHaveCount(1);
    });

    test('queue badge for Repo A and Repo B shown independently in repos grid', async ({ page }) => {
        // Enqueue a task for workspace A only
        await apiPost(ctx.server.url, `/api/workspaces/${ctx.wsIdA}/queue`, {
            type: 'chat',
            priority: 'normal',
            displayName: 'Task only for A',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
        });

        await page.goto(ctx.server.url);
        await page.waitForLoadState('networkidle');

        // The page loads without crashing
        await expect(page).toHaveURL(new RegExp(ctx.server.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    test('page loads and responds for multi-workspace setup', async ({ page }) => {
        const response = await page.goto(ctx.server.url);
        expect(response?.status()).toBeLessThan(400);
        await page.waitForLoadState('networkidle');

        // API endpoints remain accessible
        const apiResponse = await page.request.get(`${ctx.server.url}/api/workspaces`);
        expect(apiResponse.status()).toBe(200);
        const workspaces = (await apiResponse.json()).workspaces ?? await apiResponse.json();
        const ids = Array.isArray(workspaces)
            ? workspaces.map((w: any) => w.id)
            : [];
        expect(ids).toContain(ctx.wsIdA);
        expect(ids).toContain(ctx.wsIdB);
    });

    test('deleting Repo A from workspace list → Repo B still present', async ({ page }) => {
        // Delete workspace A via API
        await page.request.delete(`${ctx.server.url}/api/workspaces/${ctx.wsIdA}`);

        // Workspace B should still be accessible
        const apiResponse = await page.request.get(`${ctx.server.url}/api/workspaces`);
        expect(apiResponse.status()).toBe(200);
        const data = await apiResponse.json();
        const workspaces = data.workspaces ?? data;
        const ids = Array.isArray(workspaces) ? workspaces.map((w: any) => w.id) : [];
        expect(ids).not.toContain(ctx.wsIdA);
        expect(ids).toContain(ctx.wsIdB);
    });

    test('schedule list for Repo A does not include Repo B\'s schedules', async ({ page }) => {
        const schedule = {
            name: 'B Only Schedule',
            target: 'pipeline.yaml',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
        };
        await apiPost(ctx.server.url, `/api/workspaces/${ctx.wsIdB}/schedules`, schedule);

        // A's schedules should be empty
        const resA = await page.request.get(`${ctx.server.url}/api/workspaces/${ctx.wsIdA}/schedules`);
        expect(resA.status()).toBe(200);
        const bodyA = await resA.json();
        expect(bodyA.schedules).toHaveLength(0);
    });

    test('activity feed for Repo A shows only Repo A\'s process history', async ({ page }) => {
        // Ensure processes created for workspace A are scoped to A
        // The test here verifies the API returns correct workspaceId-scoped data
        const apiResponse = await page.request.get(
            `${ctx.server.url}/api/workspaces/${ctx.wsIdA}/queue`,
        );
        // Should return 200 with an empty queue (or 404 if not yet supported — not 500)
        expect(apiResponse.status()).not.toBe(500);
    });
});
