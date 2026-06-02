import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemSyncRoutes } from '../../../src/server/routes/work-item-sync-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type {
    WorkItem,
    WorkItemSyncLink,
    WorkItemSyncProviderAdapter,
    WorkItemSyncProviderApplyContext,
    WorkItemSyncProviderPreviewContext,
} from '../../../src/server/work-items';

const REPO_ID = 'sync-test-repo';
const NOW = '2026-01-01T00:00:00.000Z';
const SYNC_LINK: WorkItemSyncLink = {
    provider: 'github',
    remote: {
        owner: 'plusplusoneplusplus',
        repo: 'shortcuts',
        issueId: 'I_kwDOExample',
        issueNumber: 42,
        issueUrl: 'https://github.com/plusplusoneplusplus/shortcuts/issues/42',
    },
    remoteRevision: 'etag-1',
    remoteUpdatedAt: '2026-01-02T00:00:00.000Z',
    lastSyncedAt: '2026-01-02T01:00:00.000Z',
    lastSyncedFingerprint: 'fingerprint-1',
};

type FakeAdapter = WorkItemSyncProviderAdapter & {
    previewCalls: WorkItemSyncProviderPreviewContext[];
    applyCalls: WorkItemSyncProviderApplyContext[];
};

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server | undefined;
let baseUrl: string;
let hierarchyEnabled = true;
let syncEnabled = true;

function makeFakeProvider(): FakeAdapter {
    const previewCalls: WorkItemSyncProviderPreviewContext[] = [];
    const applyCalls: WorkItemSyncProviderApplyContext[] = [];
    return {
        provider: 'github',
        previewCalls,
        applyCalls,
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
        async preview(context) {
            previewCalls.push(context);
            return {
                provider: 'github',
                operation: context.operation,
                previewId: 'preview-1',
                generatedAt: NOW,
                itemCount: context.items.length,
                maxItems: 200,
                creates: [],
                updates: context.items.map(item => ({
                    id: `update-${item.id}`,
                    kind: 'update-remote' as const,
                    title: item.title,
                    workItemId: item.id,
                    fields: [{ field: 'title', cocValue: item.title }],
                })),
                links: [],
                noOps: [],
                warnings: [],
                conflicts: [],
            };
        },
        async apply(context) {
            applyCalls.push(context);
            return {
                provider: 'github',
                operation: context.operation,
                applied: context.items.length,
                skipped: 0,
                failed: 0,
                rows: context.items.map(item => ({
                    id: `applied-${item.id}`,
                    status: 'applied' as const,
                    workItemId: item.id,
                    operationId: `update-${item.id}`,
                })),
                warnings: [],
                conflicts: [],
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

async function addItem(input: Partial<WorkItem> & { id: string; title: string }): Promise<WorkItem> {
    const item: WorkItem = {
        id: input.id,
        repoId: REPO_ID,
        title: input.title,
        description: input.description ?? '',
        status: input.status ?? 'created',
        type: input.type,
        parentId: input.parentId,
        syncLinks: input.syncLinks,
        createdAt: input.createdAt ?? NOW,
        updatedAt: input.updatedAt ?? NOW,
        archivedAt: input.archivedAt,
        source: input.source ?? 'manual',
        priority: input.priority,
        tags: input.tags,
    };
    await store.addWorkItem(item);
    return item;
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
    it('reports disabled status and blocks preview when hierarchy is disabled', async () => {
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

        const preview = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/preview`, {
            operation: 'sync-linked',
        });
        expect(preview.status).toBe(403);
        expect(preview.body.error).toContain('workItems.hierarchy.enabled');
    });

    it('reports sync-disabled status when hierarchy is enabled but sync is disabled', async () => {
        hierarchyEnabled = true;
        syncEnabled = false;
        await startServer([makeFakeProvider()]);

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status`);
        expect(status.status).toBe(200);
        expect(status.body.disabledReason).toBe('sync-disabled');
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
        expect(JSON.stringify(status.body)).not.toMatch(/token|secret|password|credential/i);
    });

    it('returns a clear provider-unavailable error when no adapter is registered', async () => {
        await startServer([]);

        const preview = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/preview`, {
            operation: 'sync-linked',
        });
        expect(preview.status).toBe(409);
        expect(preview.body.code).toBe('WORK_ITEM_SYNC_PROVIDER_UNAVAILABLE');
        expect(preview.body.details.provider).toMatchObject({
            provider: 'github',
            available: false,
            reason: 'provider-unavailable',
        });
    });

    it('previews the selected subtree without mutating local work items', async () => {
        const provider = makeFakeProvider();
        await addItem({ id: 'epic-1', title: 'Epic', type: 'epic' });
        await addItem({ id: 'feature-1', title: 'Feature', type: 'feature', parentId: 'epic-1' });
        await addItem({ id: 'pbi-1', title: 'PBI', type: 'pbi', parentId: 'feature-1' });
        await addItem({ id: 'leaf-1', title: 'Leaf', type: 'work-item', parentId: 'pbi-1' });
        await startServer([provider]);

        const preview = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/preview`, {
            operation: 'export-selected',
            selectedWorkItemId: 'epic-1',
        });

        expect(preview.status).toBe(200);
        expect(preview.body.itemCount).toBe(4);
        expect(preview.body.updates).toHaveLength(4);
        expect(provider.previewCalls[0].items.map(item => item.id)).toEqual(['epic-1', 'feature-1', 'pbi-1', 'leaf-1']);
        const leaf = await store.getWorkItem('leaf-1', REPO_ID);
        expect(leaf).toMatchObject({ id: 'leaf-1', title: 'Leaf' });
        expect(leaf?.syncLinks).toBeUndefined();
    });

    it('sync-linked previews only linked non-archived items unless archived are included', async () => {
        const provider = makeFakeProvider();
        await addItem({ id: 'linked-active', title: 'Active linked', syncLinks: [SYNC_LINK] });
        await addItem({ id: 'linked-archived', title: 'Archived linked', syncLinks: [SYNC_LINK], archivedAt: '2026-01-03T00:00:00.000Z' });
        await addItem({ id: 'unlinked', title: 'Unlinked' });
        await startServer([provider]);

        const defaultPreview = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/preview`, {
            operation: 'sync-linked',
        });
        expect(defaultPreview.status).toBe(200);
        expect(provider.previewCalls[0].items.map(item => item.id)).toEqual(['linked-active']);

        const includeArchivedPreview = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/preview`, {
            operation: 'sync-linked',
            includeArchived: true,
        });
        expect(includeArchivedPreview.status).toBe(200);
        expect(provider.previewCalls[1].items.map(item => item.id)).toEqual(['linked-active', 'linked-archived']);
    });

    it('rejects local runs over the hard 200 item cap before invoking the provider', async () => {
        const provider = makeFakeProvider();
        for (let index = 0; index < 201; index++) {
            await addItem({ id: `linked-${index}`, title: `Linked ${index}`, syncLinks: [SYNC_LINK] });
        }
        await startServer([provider]);

        const preview = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/preview`, {
            operation: 'sync-linked',
        });

        expect(preview.status).toBe(400);
        expect(preview.body.error).toContain('limited to 200 items');
        expect(provider.previewCalls).toEqual([]);
    });

    it('passes apply requests and conflict resolutions to the provider', async () => {
        const provider = makeFakeProvider();
        await addItem({ id: 'linked-active', title: 'Active linked', syncLinks: [SYNC_LINK] });
        await startServer([provider]);

        const apply = await request('POST', `/api/workspaces/${REPO_ID}/work-items/sync/apply`, {
            operation: 'sync-linked',
            previewId: 'preview-1',
            conflictResolutions: [{ conflictId: 'conflict-1', resolution: 'skip' }],
        });

        expect(apply.status).toBe(200);
        expect(apply.body).toMatchObject({
            provider: 'github',
            operation: 'sync-linked',
            applied: 1,
            skipped: 0,
            failed: 0,
        });
        expect(provider.applyCalls[0].request.conflictResolutions).toEqual([
            { conflictId: 'conflict-1', resolution: 'skip' },
        ]);
    });
});
