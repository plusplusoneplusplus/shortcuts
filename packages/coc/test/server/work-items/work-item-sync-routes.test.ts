import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemSyncRoutes } from '../../../src/server/routes/work-item-sync-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItemSyncProviderAdapter } from '../../../src/server/work-items';

const REPO_ID = 'sync-test-repo';

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server | undefined;
let baseUrl: string;
let hierarchyEnabled = true;
let syncEnabled = true;

function makeFakeProvider(): WorkItemSyncProviderAdapter {
    return {
        provider: 'github',
        async getStatus() {
            return {
                provider: 'github',
                available: true,
                repository: {
                    provider: 'github',
                    owner: 'plusplusoneplusplus',
                    repo: 'shortcuts',
                    url: 'https://github.com/plusplusoneplusplus/shortcuts',
                    source: 'origin',
                },
                auth: {
                    mode: 'external',
                    authenticated: true,
                    message: 'Uses external GitHub authentication.',
                },
            };
        },
    };
}

function makeServer(providers: WorkItemSyncProviderAdapter[] = []): http.Server {
    const routes: Route[] = [];
    registerWorkItemSyncRoutes({
        routes,
        workItemStore: store,
        processStore: {
            getWorkspaces: async () => [{
                id: REPO_ID,
                name: 'Sync Test',
                rootPath: tmpDir,
                remoteUrl: 'https://github.com/plusplusoneplusplus/shortcuts.git',
            }],
        } as any,
        dataDir: tmpDir,
        getHierarchyEnabled: () => hierarchyEnabled,
        getSyncEnabled: () => syncEnabled,
        providers,
    });
    return http.createServer(createRouter({ routes, spaHtml: '' }));
}

async function startServer(providers: WorkItemSyncProviderAdapter[] = []): Promise<void> {
    server = makeServer(providers);
    await new Promise<void>((resolve, reject) => {
        server!.on('error', reject);
        server!.listen(0, '127.0.0.1', () => {
            const addr = server!.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
}

async function request(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = raw;
                try { parsed = raw ? JSON.parse(raw) : undefined; } catch { /* keep raw */ }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-sync-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    hierarchyEnabled = true;
    syncEnabled = true;
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Work Item Sync Routes', () => {
    it('reports disabled status when hierarchy is disabled', async () => {
        hierarchyEnabled = false;
        syncEnabled = true;
        await startServer([makeFakeProvider()]);

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status`);
        expect(status.status).toBe(200);
        expect(status.body).toMatchObject({
            enabled: false,
            disabled: true,
            disabledReason: 'hierarchy-disabled',
            maxItems: 200,
            providers: [],
        });
    });

    it('reports sync-disabled status when hierarchy is enabled but sync is disabled', async () => {
        hierarchyEnabled = true;
        syncEnabled = false;
        await startServer([makeFakeProvider()]);

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status`);
        expect(status.status).toBe(200);
        expect(status.body).toMatchObject({
            enabled: false,
            disabled: true,
            disabledReason: 'sync-disabled',
            maxItems: 200,
            providers: [],
        });
    });

    it('reports provider status without exposing credentials', async () => {
        await startServer([makeFakeProvider()]);

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status`);
        expect(status.status).toBe(200);
        expect(status.body.provider).toMatchObject({
            provider: 'github',
            available: true,
            repository: {
                owner: 'plusplusoneplusplus',
                repo: 'shortcuts',
                source: 'origin',
            },
            auth: { mode: 'external', authenticated: true },
        });
        expect(status.body.providers).toEqual([
            expect.objectContaining({ provider: 'github', available: true }),
            expect.objectContaining({
                provider: 'azure-boards',
                available: false,
                reason: 'provider-unavailable',
                message: expect.stringContaining('planned but unavailable'),
            }),
        ]);
        expect(JSON.stringify(status.body)).not.toMatch(/token|secret|password|credential/i);
    });

    it('reports Azure Boards as planned but unavailable without registering an Azure adapter', async () => {
        await startServer([makeFakeProvider()]);

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status?provider=azure-boards`);
        expect(status.status).toBe(200);
        expect(status.body.provider).toMatchObject({
            provider: 'azure-boards',
            available: false,
            reason: 'provider-unavailable',
            message: expect.stringContaining('planned but unavailable'),
        });
    });

    it('reports GitHub unavailable when no adapter is registered', async () => {
        await startServer([]);

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status?provider=github`);
        expect(status.status).toBe(200);
        expect(status.body.provider).toMatchObject({
            provider: 'github',
            available: false,
            reason: 'provider-unavailable',
        });
    });

    it('does not register legacy per-item preview/apply endpoints', async () => {
        await startServer([makeFakeProvider()]);

        const preview = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/preview`, {
            operation: 'sync-linked',
        });
        const apply = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/apply`, {
            operation: 'sync-linked',
            previewId: 'preview-1',
        });

        expect(preview.status).toBe(404);
        expect(apply.status).toBe(404);
    });
});
