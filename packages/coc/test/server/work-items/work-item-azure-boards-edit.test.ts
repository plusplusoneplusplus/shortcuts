import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';
import {
    createAzureBoardsWorkItemSyncProviderAdapter,
    type AzureBoardsWorkItem,
    type AzureBoardsWorkItemCreateInput,
    type AzureBoardsWorkItemTransport,
    type AzureBoardsWorkItemUpdateInput,
    type AvailableAzureBoardsWorkItemSyncProject,
} from '../../../src/server/work-items';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { writeProvidersConfig } from '../../../src/server/providers/providers-config';

const REPO_ID = 'azure-edit-test-repo';
const NOW = '2026-06-03T04:00:00.000Z';

function relationUrl(workItemId: number): string {
    return `https://dev.azure.com/octo-org/Project%20Alpha/_apis/wit/workItems/${workItemId}`;
}

function htmlUrl(workItemId: number): string {
    return `https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/${workItemId}`;
}

class FakeAzureBoardsTransport implements AzureBoardsWorkItemTransport {
    readonly items = new Map<number, AzureBoardsWorkItem>();
    readonly calls = {
        get: [] as number[],
        create: [] as AzureBoardsWorkItemCreateInput[],
        update: [] as Array<{ workItemId: number; input: AzureBoardsWorkItemUpdateInput }>,
    };
    failNextUpdate: Error | undefined;
    private nextId = 200;

    set(items: AzureBoardsWorkItem[]): void {
        this.items.clear();
        for (const item of items) {
            this.items.set(item.id, item);
        }
    }

    async getWorkItem(
        _project: AvailableAzureBoardsWorkItemSyncProject,
        workItemId: number,
    ): Promise<AzureBoardsWorkItem | undefined> {
        this.calls.get.push(workItemId);
        return this.items.get(workItemId);
    }

    async listWorkItemTree(): Promise<AzureBoardsWorkItem[]> {
        return [];
    }

    async createWorkItem(
        _project: AvailableAzureBoardsWorkItemSyncProject,
        input: AzureBoardsWorkItemCreateInput,
    ): Promise<AzureBoardsWorkItem> {
        this.calls.create.push(input);
        const id = this.nextId++;
        const item: AzureBoardsWorkItem = {
            id,
            revision: 1,
            url: htmlUrl(id),
            title: input.title,
            description: input.description,
            state: input.state,
            workItemType: input.workItemType,
            priority: input.priority,
            tags: input.tags,
            updatedAt: NOW,
            relations: input.parentWorkItemId !== undefined
                ? [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: relationUrl(input.parentWorkItemId) }]
                : undefined,
        };
        this.items.set(id, item);
        return item;
    }

    async updateWorkItem(
        _project: AvailableAzureBoardsWorkItemSyncProject,
        workItemId: number,
        input: AzureBoardsWorkItemUpdateInput,
    ): Promise<AzureBoardsWorkItem> {
        this.calls.update.push({ workItemId, input });
        if (this.failNextUpdate) {
            throw this.failNextUpdate;
        }
        const existing = this.items.get(workItemId);
        if (!existing) {
            throw new Error(`Missing fake Azure Boards work item ${workItemId}`);
        }
        const parentRelation = Object.prototype.hasOwnProperty.call(input, 'parentWorkItemId')
            ? input.parentWorkItemId === null || input.parentWorkItemId === undefined
                ? undefined
                : { rel: 'System.LinkTypes.Hierarchy-Reverse', url: relationUrl(input.parentWorkItemId) }
            : (existing.relations ?? []).find(relation => relation.rel === 'System.LinkTypes.Hierarchy-Reverse');
        const updated: AzureBoardsWorkItem = {
            ...existing,
            revision: (existing.revision ?? 0) + 1,
            title: input.title,
            description: input.description,
            state: input.state,
            priority: input.priority,
            tags: input.tags,
            updatedAt: NOW,
            relations: parentRelation ? [parentRelation] : undefined,
        };
        this.items.set(workItemId, updated);
        return updated;
    }
}

function makeWorkItem(overrides: Partial<WorkItem>): WorkItem {
    return {
        id: overrides.id ?? 'item-1',
        repoId: overrides.repoId ?? REPO_ID,
        title: overrides.title ?? 'Item',
        description: overrides.description ?? '',
        status: overrides.status ?? 'created',
        type: overrides.type,
        parentId: overrides.parentId,
        tracker: overrides.tracker,
        azureBoardsMirror: overrides.azureBoardsMirror,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        source: overrides.source ?? 'manual',
        tags: overrides.tags,
        priority: overrides.priority,
    };
}

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server | undefined;
let baseUrl: string;

async function configureAzureBoards(): Promise<void> {
    await writeProvidersConfig({
        providers: {
            ado: { orgUrl: 'https://dev.azure.com/octo-org' },
        },
    }, tmpDir);
    writeRepoPreferences(tmpDir, REPO_ID, {
        workItems: {
            sync: {
                azureBoards: { project: 'Project Alpha' },
            },
        },
    });
}

function makeServer(transport: FakeAzureBoardsTransport): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({
        routes,
        workItemStore: store,
        processStore: {
            getWorkspaces: async () => [{
                id: REPO_ID,
                name: 'Azure Edit Test',
                rootPath: tmpDir,
                remoteUrl: 'https://github.com/plusplusoneplusplus/shortcuts.git',
            }],
        } as any,
        getHierarchyEnabled: () => true,
        dataDir: tmpDir,
        azureBoardsProvider: createAzureBoardsWorkItemSyncProviderAdapter({
            dataDir: tmpDir,
            resolveAccessToken: async () => 'azure-cli-access-token',
        }),
        azureBoardsTransport: transport,
    });
    return http.createServer(createRouter({ routes, spaHtml: '' }));
}

async function startServer(transport: FakeAzureBoardsTransport): Promise<void> {
    server = makeServer(transport);
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
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const urlObj = new URL(urlPath, baseUrl);
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: payload
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                : {},
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
        if (payload) req.write(payload);
        req.end();
    });
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'azure-boards-edit-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    await configureAzureBoards();
});

afterEach(async () => {
    await stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Azure Boards-backed work item edits', () => {
    it('creates an Azure Boards child before storing the local child mirror', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'epic-1',
            title: 'Azure Epic',
            type: 'epic',
            tracker: {
                kind: 'azure-boards-backed',
                provider: 'azure-boards',
                azureBoards: {
                    workItemId: 100,
                    workItemUrl: htmlUrl(100),
                    revision: 7,
                    updatedAt: NOW,
                    lastPulledAt: NOW,
                },
            },
            azureBoardsMirror: {
                workItemId: 100,
                workItemUrl: htmlUrl(100),
                revision: 7,
                workItemType: 'Epic',
                state: 'Active',
                updatedAt: NOW,
                lastPulledAt: NOW,
            },
        }));
        const transport = new FakeAzureBoardsTransport();
        await startServer(transport);

        const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
            title: 'New Azure Feature',
            description: 'Feature body',
            type: 'feature',
            parentId: 'epic-1',
            tags: ['customer'],
            priority: 'high',
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            title: 'New Azure Feature',
            description: 'Feature body',
            type: 'feature',
            parentId: 'epic-1',
            azureBoardsMirror: {
                workItemId: 200,
                revision: 1,
                workItemType: 'Feature',
                state: 'New',
                updatedAt: NOW,
            },
        });
        expect(transport.calls.create).toEqual([{
            workItemType: 'Feature',
            title: 'New Azure Feature',
            description: 'Feature body',
            state: 'New',
            priority: 1,
            tags: 'customer',
            parentWorkItemId: 100,
        }]);
        const stored = await store.getWorkItem(res.body.id, REPO_ID);
        expect(stored?.azureBoardsMirror?.workItemId).toBe(200);
    });

    it('pushes core field edits and Azure parent changes before updating the local mirror', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'epic-1',
            title: 'Azure Epic',
            type: 'epic',
            tracker: {
                kind: 'azure-boards-backed',
                provider: 'azure-boards',
                azureBoards: { workItemId: 100, workItemUrl: htmlUrl(100), revision: 1, updatedAt: NOW, lastPulledAt: NOW },
            },
            azureBoardsMirror: { workItemId: 100, workItemUrl: htmlUrl(100), revision: 1, workItemType: 'Epic', state: 'Active', updatedAt: NOW, lastPulledAt: NOW },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'feature-a',
            title: 'Feature A',
            type: 'feature',
            parentId: 'epic-1',
            azureBoardsMirror: { workItemId: 101, workItemUrl: htmlUrl(101), revision: 1, workItemType: 'Feature', state: 'Active', updatedAt: NOW, lastPulledAt: NOW },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'feature-b',
            title: 'Feature B',
            type: 'feature',
            parentId: 'epic-1',
            azureBoardsMirror: { workItemId: 103, workItemUrl: htmlUrl(103), revision: 1, workItemType: 'Feature', state: 'Active', updatedAt: NOW, lastPulledAt: NOW },
        }));
        await store.addWorkItem(makeWorkItem({
            id: 'pbi-1',
            title: 'PBI',
            type: 'pbi',
            parentId: 'feature-a',
            status: 'created',
            azureBoardsMirror: { workItemId: 102, workItemUrl: htmlUrl(102), revision: 3, workItemType: 'Product Backlog Item', state: 'New', updatedAt: NOW, lastPulledAt: NOW },
        }));
        const transport = new FakeAzureBoardsTransport();
        transport.set([
            { id: 102, revision: 3, title: 'PBI', state: 'New', workItemType: 'Product Backlog Item', updatedAt: NOW, url: htmlUrl(102), relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: relationUrl(101) }] },
        ]);
        await startServer(transport);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/pbi-1`, {
            title: 'Updated PBI',
            description: 'Updated body',
            status: 'readyToExecute',
            priority: 'low',
            tags: ['api', 'customer'],
            parentId: 'feature-b',
        });

        expect(res.status).toBe(200);
        expect(transport.calls.update).toEqual([{
            workItemId: 102,
            input: {
                workItemType: 'Product Backlog Item',
                title: 'Updated PBI',
                description: 'Updated body',
                state: 'Active',
                priority: 3,
                tags: 'api; customer',
                parentWorkItemId: 103,
                expectedRevision: 3,
            },
        }]);
        expect(res.body).toMatchObject({
            id: 'pbi-1',
            title: 'Updated PBI',
            description: 'Updated body',
            status: 'readyToExecute',
            priority: 'low',
            tags: ['api', 'customer'],
            parentId: 'feature-b',
            azureBoardsMirror: {
                workItemId: 102,
                revision: 4,
                state: 'Active',
                updatedAt: NOW,
            },
        });
        const stored = await store.getWorkItem('pbi-1', REPO_ID);
        expect(stored?.parentId).toBe('feature-b');
        expect(stored?.azureBoardsMirror?.revision).toBe(4);
    });

    it('fails loudly without storing local edits when Azure rejects an update', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'epic-1',
            title: 'Azure Epic',
            type: 'epic',
            tracker: {
                kind: 'azure-boards-backed',
                provider: 'azure-boards',
                azureBoards: { workItemId: 100, workItemUrl: htmlUrl(100), revision: 1, updatedAt: NOW, lastPulledAt: NOW },
            },
            azureBoardsMirror: { workItemId: 100, workItemUrl: htmlUrl(100), revision: 1, workItemType: 'Epic', state: 'Active', updatedAt: NOW, lastPulledAt: NOW },
        }));
        const transport = new FakeAzureBoardsTransport();
        transport.set([{ id: 100, revision: 1, title: 'Azure Epic', state: 'Active', workItemType: 'Epic', updatedAt: NOW, url: htmlUrl(100) }]);
        transport.failNextUpdate = new Error('remote validation rejected the patch');
        await startServer(transport);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/epic-1`, {
            title: 'Local title that should not persist',
        });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WORK_ITEM_AZURE_BOARDS_UPDATE_FAILED');
        expect(transport.calls.update).toHaveLength(1);
        const stored = await store.getWorkItem('epic-1', REPO_ID);
        expect(stored?.title).toBe('Azure Epic');
        expect(stored?.azureBoardsMirror?.revision).toBe(1);
    });

    it('rejects stale local saves with a typed per-field conflict when the Azure revision changed remotely', async () => {
        await store.addWorkItem(makeWorkItem({
            id: 'epic-1',
            title: 'Azure Epic',
            type: 'epic',
            tracker: {
                kind: 'azure-boards-backed',
                provider: 'azure-boards',
                azureBoards: { workItemId: 100, workItemUrl: htmlUrl(100), revision: 3, updatedAt: NOW, lastPulledAt: NOW },
            },
            azureBoardsMirror: { workItemId: 100, workItemUrl: htmlUrl(100), revision: 3, workItemType: 'Epic', state: 'Active', updatedAt: NOW, lastPulledAt: NOW },
        }));
        const transport = new FakeAzureBoardsTransport();
        transport.set([{
            id: 100,
            revision: 4,
            title: 'Remote changed title',
            description: 'Remote description',
            state: 'Active',
            workItemType: 'Epic',
            priority: 1,
            tags: 'alpha; beta',
            updatedAt: NOW,
            url: htmlUrl(100),
        }]);
        await startServer(transport);

        const res = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/epic-1`, {
            title: 'Stale local title',
            priority: 'low',
        });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WORK_ITEM_SYNC_CONFLICT');
        expect(transport.calls.update).toHaveLength(0);

        const details = res.body.details;
        expect(details).toMatchObject({
            kind: 'work-item-sync-conflict',
            provider: 'azure-boards',
            providerLabel: 'Azure Boards',
            workItemId: 'epic-1',
            remoteWorkItemId: 100,
            localRevision: 3,
            remoteRevision: 4,
        });
        const byField = Object.fromEntries(details.fields.map((f: any) => [f.field, f]));
        expect(byField.title).toEqual({ field: 'title', draft: 'Stale local title', base: 'Azure Epic', remote: 'Remote changed title' });
        expect(byField.priority).toEqual({ field: 'priority', draft: 'low', base: 'normal', remote: 'high' });
        expect(byField.status).toEqual({ field: 'status', draft: 'created', base: 'created', remote: 'executing' });
        expect(byField.description).toEqual({ field: 'description', draft: null, base: null, remote: 'Remote description' });
        expect(byField.tags).toEqual({ field: 'tags', draft: null, base: null, remote: 'alpha, beta' });
        // Remote item has no parent relation, so parent matches the local Epic root and is omitted.
        expect(byField.parent).toBeUndefined();

        const stored = await store.getWorkItem('epic-1', REPO_ID);
        expect(stored?.title).toBe('Azure Epic');
        expect(stored?.azureBoardsMirror?.revision).toBe(3);
    });
});
