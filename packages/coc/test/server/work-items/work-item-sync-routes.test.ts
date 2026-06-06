import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemSyncRoutes } from '../../../src/server/routes/work-item-sync-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    createAzureBoardsWorkItemSyncProviderAdapter,
    importAzureBoardsEpicTreeAsWorkItems,
    type AzureBoardsWorkItem,
    type AzureBoardsWorkItemTransport,
    type AvailableAzureBoardsWorkItemSyncProject,
    type WorkItemSyncProviderAdapter,
} from '../../../src/server/work-items';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { writeProvidersConfig } from '../../../src/server/providers/providers-config';

const REPO_ID = 'sync-test-repo';
const SECOND_REPO_ID = 'sync-test-repo-2';

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

function makeAzureProvider(resolveAccessToken = async () => 'azure-cli-access'): WorkItemSyncProviderAdapter {
    return createAzureBoardsWorkItemSyncProviderAdapter({
        dataDir: tmpDir,
        resolveAccessToken,
    });
}

function relationUrl(workItemId: number): string {
    return `https://dev.azure.com/octo-org/Project%20Alpha/_apis/wit/workItems/${workItemId}`;
}

class FakeAzureBoardsTransport implements AzureBoardsWorkItemTransport {
    readonly items = new Map<number, AzureBoardsWorkItem>();

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
        return this.items.get(workItemId);
    }

    async listWorkItemTree(
        _project: AvailableAzureBoardsWorkItemSyncProject,
        rootWorkItemId: number,
        limit = 200,
    ): Promise<AzureBoardsWorkItem[]> {
        const root = this.items.get(rootWorkItemId);
        if (!root) return [];
        const result: AzureBoardsWorkItem[] = [];
        const queue = [root];
        const seen = new Set<number>();
        while (queue.length > 0 && result.length < limit) {
            const item = queue.shift()!;
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            result.push(item);
            for (const relation of item.relations ?? []) {
                const match = relation.rel === 'System.LinkTypes.Hierarchy-Forward'
                    ? /\/workItems\/(\d+)$/i.exec(relation.url ?? '')
                    : undefined;
                if (!match) continue;
                const child = this.items.get(Number.parseInt(match[1], 10));
                if (child) queue.push(child);
            }
        }
        return result;
    }

    async createWorkItem(): Promise<AzureBoardsWorkItem> {
        throw new Error('FakeAzureBoardsTransport.createWorkItem is not used by sync route tests.');
    }

    async updateWorkItem(): Promise<AzureBoardsWorkItem> {
        throw new Error('FakeAzureBoardsTransport.updateWorkItem is not used by sync route tests.');
    }
}

function makeServer(
    providers: WorkItemSyncProviderAdapter[] = [],
    options: {
        azureBoardsTransport?: AzureBoardsWorkItemTransport;
        workspaces?: WorkspaceInfo[];
        onGitHubBackedEpicTreeChanged?: (workspaceId: string) => void | Promise<void>;
        onAzureBoardsBackedEpicTreeChanged?: (workspaceId: string) => void | Promise<void>;
    } = {},
): http.Server {
    const routes: Route[] = [];
    let workspaces = options.workspaces ?? [
        {
            id: REPO_ID,
            name: 'Sync Test',
            rootPath: tmpDir,
            remoteUrl: 'https://github.com/plusplusoneplusplus/shortcuts.git',
        },
        {
            id: SECOND_REPO_ID,
            name: 'Second Sync Test',
            rootPath: tmpDir,
            remoteUrl: 'https://github.com/plusplusoneplusplus/other.git',
        },
    ];
    registerWorkItemSyncRoutes({
        routes,
        workItemStore: store,
        processStore: {
            getWorkspaces: async () => workspaces,
            updateWorkspace: async (id: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>) => {
                const index = workspaces.findIndex(workspace => workspace.id === id);
                if (index === -1) return undefined;
                workspaces = [
                    ...workspaces.slice(0, index),
                    { ...workspaces[index], ...updates },
                    ...workspaces.slice(index + 1),
                ];
                return workspaces[index];
            },
        } as any,
        dataDir: tmpDir,
        getHierarchyEnabled: () => hierarchyEnabled,
        getSyncEnabled: () => syncEnabled,
        providers,
        azureBoardsTransport: options.azureBoardsTransport,
        onGitHubBackedEpicTreeChanged: options.onGitHubBackedEpicTreeChanged,
        onAzureBoardsBackedEpicTreeChanged: options.onAzureBoardsBackedEpicTreeChanged,
    });
    return http.createServer(createRouter({ routes, spaHtml: '' }));
}

async function startServer(
    providers: WorkItemSyncProviderAdapter[] = [],
    options: {
        azureBoardsTransport?: AzureBoardsWorkItemTransport;
        workspaces?: WorkspaceInfo[];
        onGitHubBackedEpicTreeChanged?: (workspaceId: string) => void | Promise<void>;
        onAzureBoardsBackedEpicTreeChanged?: (workspaceId: string) => void | Promise<void>;
    } = {},
): Promise<void> {
    server = makeServer(providers, options);
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

    it('reports only the repo remote provider status without exposing credentials', async () => {
        await startServer([makeFakeProvider()]);

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status`);
        expect(status.status).toBe(200);
        expect(status.body.remoteProvider).toBe('github');
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
        ]);
        expect(JSON.stringify(status.body)).not.toMatch(/token|secret|password|credential/i);
    });

    it('reports Azure Boards as the only remote provider for Azure DevOps workspace remotes', async () => {
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
        await startServer([makeFakeProvider(), makeAzureProvider()], {
            workspaces: [{
                id: REPO_ID,
                name: 'Sync Test',
                rootPath: tmpDir,
                remoteUrl: 'git@ssh.dev.azure.com:v3/octo-org/Project Alpha/octo-repo',
            }],
        });

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status`);

        expect(status.status).toBe(200);
        expect(status.body.remoteProvider).toBe('azure-boards');
        expect(status.body.providers).toEqual([
            expect.objectContaining({ provider: 'azure-boards', available: true }),
        ]);
    });

    it('does not fall back to provider configuration for unsupported remotes', async () => {
        await writeProvidersConfig({
            providers: {
                ado: { orgUrl: 'https://dev.azure.com/octo-org' },
            },
        }, tmpDir);
        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    github: { owner: 'override-org', repo: 'override-repo' },
                    azureBoards: { project: 'Project Alpha' },
                },
            },
        });
        await startServer([makeFakeProvider(), makeAzureProvider()], {
            workspaces: [{
                id: REPO_ID,
                name: 'Sync Test',
                rootPath: tmpDir,
                remoteUrl: 'https://example.com/octo-org/octo-repo.git',
            }],
        });

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status`);

        expect(status.status).toBe(200);
        expect(status.body.remoteProvider).toBeUndefined();
        expect(status.body.provider).toBeUndefined();
        expect(status.body.providers).toEqual([]);
    });

    it('refreshes a missing workspace remote before deriving the remote provider', async () => {
        execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
        execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/plusplusoneplusplus/shortcuts.git'], {
            cwd: tmpDir,
            stdio: 'ignore',
        });
        await startServer([makeFakeProvider()], {
            workspaces: [{
                id: REPO_ID,
                name: 'Sync Test',
                rootPath: tmpDir,
            }],
        });

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status`);

        expect(status.status).toBe(200);
        expect(status.body.remoteProvider).toBe('github');
        expect(status.body.providers).toEqual([
            expect.objectContaining({ provider: 'github', available: true }),
        ]);
    });

    it('reports Azure Boards available from global org URL, workspace project, and Azure CLI auth', async () => {
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
        await startServer([makeFakeProvider(), makeAzureProvider()]);

        const status = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status?provider=azure-boards`);
        expect(status.status).toBe(200);
        expect(status.body.provider).toMatchObject({
            provider: 'azure-boards',
            available: true,
            repository: {
                provider: 'azure-boards',
                organizationUrl: 'https://dev.azure.com/octo-org',
                project: 'Project Alpha',
                projectId: 'Project Alpha',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha',
                source: 'preference',
            },
            auth: { mode: 'external', authenticated: true },
        });
        expect(JSON.stringify(status.body)).not.toMatch(/azure-cli-access|token|bearer|authorization/i);
    });

    it('reports Azure Boards unavailable with explicit sanitized missing-config and auth reasons', async () => {
        await startServer([makeFakeProvider(), makeAzureProvider(async () => undefined)]);

        const missingOrg = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status?provider=azure-boards`);
        expect(missingOrg.status).toBe(200);
        expect(missingOrg.body.provider).toMatchObject({
            provider: 'azure-boards',
            available: false,
            reason: 'missing-org-url',
            auth: { mode: 'external', authenticated: false },
        });

        await stopServer();
        await writeProvidersConfig({
            providers: {
                ado: { orgUrl: 'https://dev.azure.com/octo-org' },
            },
        }, tmpDir);
        await startServer([makeFakeProvider(), makeAzureProvider(async () => undefined)]);

        const missingProject = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status?provider=azure-boards`);
        expect(missingProject.status).toBe(200);
        expect(missingProject.body.provider).toMatchObject({
            provider: 'azure-boards',
            available: false,
            reason: 'missing-project',
            repository: {
                provider: 'azure-boards',
                organizationUrl: 'https://dev.azure.com/octo-org',
            },
            auth: { mode: 'external', authenticated: false },
        });

        await stopServer();
        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    azureBoards: { project: 'Project Alpha' },
                },
            },
        });
        await startServer([makeFakeProvider(), makeAzureProvider(async () => undefined)]);

        const authMissing = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status?provider=azure-boards`);
        expect(authMissing.status).toBe(200);
        expect(authMissing.body.provider).toMatchObject({
            provider: 'azure-boards',
            available: false,
            reason: 'auth-unavailable',
            repository: {
                provider: 'azure-boards',
                project: 'Project Alpha',
            },
            auth: { mode: 'external', authenticated: false },
        });
        expect(JSON.stringify(authMissing.body)).not.toMatch(/token|bearer|authorization/i);
    });

    it('keeps Azure Boards project configuration scoped per workspace', async () => {
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
        writeRepoPreferences(tmpDir, SECOND_REPO_ID, {
            workItems: {
                sync: {
                    azureBoards: { project: 'Project Beta' },
                },
            },
        });
        await startServer([makeFakeProvider(), makeAzureProvider()]);

        const first = await request('GET', `/api/workspaces/${REPO_ID}/work-items/sync/status?provider=azure-boards`);
        const second = await request('GET', `/api/workspaces/${SECOND_REPO_ID}/work-items/sync/status?provider=azure-boards`);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body.provider.repository).toMatchObject({
            organizationUrl: 'https://dev.azure.com/octo-org',
            project: 'Project Alpha',
        });
        expect(second.body.provider.repository).toMatchObject({
            organizationUrl: 'https://dev.azure.com/octo-org',
            project: 'Project Beta',
        });
    });

    it('imports and syncs Azure Boards Epic trees through native hierarchy relations', async () => {
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
        const azureTransport = new FakeAzureBoardsTransport();
        azureTransport.set([
            {
                id: 100,
                revision: 1,
                title: 'Remote Epic',
                description: '<p>Epic body</p>',
                state: 'Active',
                workItemType: 'Epic',
                priority: 2,
                tags: 'Platform; Initiative',
                updatedAt: '2026-06-03T01:00:00Z',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/100',
                relations: [
                    { rel: 'System.LinkTypes.Hierarchy-Forward', url: relationUrl(101) },
                ],
            },
            {
                id: 101,
                revision: 3,
                title: 'Remote Feature',
                description: '<p>Feature body</p>',
                state: 'New',
                workItemType: 'Feature',
                priority: 1,
                tags: 'Frontend',
                updatedAt: '2026-06-03T01:10:00Z',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/101',
                relations: [
                    { rel: 'System.LinkTypes.Hierarchy-Reverse', url: relationUrl(100) },
                    { rel: 'System.LinkTypes.Hierarchy-Forward', url: relationUrl(102) },
                ],
            },
            {
                id: 102,
                revision: 5,
                title: 'Remote PBI',
                description: '<p>PBI body</p>',
                state: 'Resolved',
                workItemType: 'Product Backlog Item',
                priority: 3,
                tags: 'API',
                updatedAt: '2026-06-03T01:20:00Z',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/102',
                relations: [
                    { rel: 'System.LinkTypes.Hierarchy-Reverse', url: relationUrl(101) },
                ],
            },
        ]);
        await startServer([makeFakeProvider(), makeAzureProvider()], { azureBoardsTransport: azureTransport });

        const imported = await request('POST', `/api/workspaces/${REPO_ID}/work-items/import-from-azure-boards`, {
            workItemUrl: 'https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/100',
        });

        expect(imported.status).toBe(201);
        expect(imported.body).toMatchObject({
            title: 'Remote Epic',
            type: 'epic',
            status: 'executing',
            tracker: {
                kind: 'azure-boards-backed',
                provider: 'azure-boards',
                azureBoards: {
                    workItemId: 100,
                    revision: 1,
                },
            },
            azureBoardsMirror: {
                workItemId: 100,
                revision: 1,
                state: 'Active',
            },
        });

        const importedItems = (await store.listWorkItems({ repoId: REPO_ID })).items;
        const root = importedItems.find(item => item.azureBoardsMirror?.workItemId === 100)!;
        const feature = importedItems.find(item => item.azureBoardsMirror?.workItemId === 101)!;
        const pbi = importedItems.find(item => item.azureBoardsMirror?.workItemId === 102)!;
        expect(root.azureBoardsMirror?.lastSyncedLocalFingerprint).toEqual(expect.any(String));
        expect(feature).toMatchObject({
            parentId: root.id,
            type: 'feature',
            status: 'created',
            priority: 'high',
            tags: ['Frontend'],
        });
        expect(pbi).toMatchObject({
            parentId: feature.id,
            type: 'pbi',
            status: 'aiDone',
            priority: 'low',
            tags: ['API'],
        });

        await store.updateWorkItem(root.id, { title: 'Unsynced local epic title' });
        azureTransport.set([
            {
                id: 100,
                revision: 2,
                title: 'Remote Epic Updated',
                description: '<p>Updated epic body</p>',
                state: 'Closed',
                workItemType: 'Epic',
                priority: 1,
                tags: 'Platform',
                updatedAt: '2026-06-03T02:00:00Z',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/100',
                relations: [
                    { rel: 'System.LinkTypes.Hierarchy-Forward', url: relationUrl(101) },
                    { rel: 'System.LinkTypes.Hierarchy-Forward', url: relationUrl(103) },
                ],
            },
            {
                id: 101,
                revision: 4,
                title: 'Remote Feature Updated',
                description: '<p>Feature body updated</p>',
                state: 'Active',
                workItemType: 'Feature',
                priority: 2,
                tags: 'Frontend',
                updatedAt: '2026-06-03T02:10:00Z',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/101',
                relations: [
                    { rel: 'System.LinkTypes.Hierarchy-Reverse', url: relationUrl(100) },
                ],
            },
            {
                id: 103,
                revision: 1,
                title: 'Remote Follow-up Feature',
                description: '<p>Follow-up feature body</p>',
                state: 'New',
                workItemType: 'Feature',
                priority: 2,
                tags: 'Ops',
                updatedAt: '2026-06-03T02:20:00Z',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/103',
                relations: [
                    { rel: 'System.LinkTypes.Hierarchy-Reverse', url: relationUrl(100) },
                ],
            },
        ]);

        const synced = await importAzureBoardsEpicTreeAsWorkItems(
            { workspaceId: REPO_ID, workItemStore: store },
            azureTransport.items.get(100)!,
            [...azureTransport.items.values()],
            undefined,
            { pruneMissing: true },
        );

        expect(synced).toMatchObject({
            created: 1,
            updated: 2,
            deleted: 1,
            deletedItemIds: [pbi.id],
            warnings: [
                {
                    provider: 'azure-boards',
                    code: 'remote-wins-conflict',
                    workItemId: root.id,
                    remoteWorkItemId: 100,
                    fields: ['title', 'description', 'status', 'priority', 'tags', 'parentId'],
                    previousRevision: 1,
                    remoteRevision: 2,
                },
            ],
        });
        expect(synced.root).toMatchObject({
            id: root.id,
            title: 'Remote Epic Updated',
            status: 'done',
            priority: 'high',
            azureBoardsMirror: {
                workItemId: 100,
                revision: 2,
            },
        });
        const syncedItems = (await store.listWorkItems({ repoId: REPO_ID })).items;
        expect(syncedItems.find(item => item.id === pbi.id)).toBeUndefined();
        expect(syncedItems.find(item => item.azureBoardsMirror?.workItemId === 103)).toMatchObject({
            parentId: root.id,
            type: 'feature',
            status: 'created',
            priority: 'normal',
            tags: ['Ops'],
        });
    });

    it('notifies Azure Boards poller configuration after Azure Boards import', async () => {
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
        const azureTransport = new FakeAzureBoardsTransport();
        azureTransport.set([
            {
                id: 100,
                revision: 1,
                title: 'Remote Epic',
                description: '<p>Epic body</p>',
                state: 'Active',
                workItemType: 'Epic',
                priority: 2,
                tags: 'Platform',
                updatedAt: '2026-06-03T01:00:00Z',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha/_workitems/edit/100',
                relations: [],
            },
        ]);
        const onAzureBoardsBackedEpicTreeChanged = vi.fn();
        await startServer([makeFakeProvider(), makeAzureProvider()], {
            azureBoardsTransport: azureTransport,
            onAzureBoardsBackedEpicTreeChanged,
        });

        const imported = await request('POST', `/api/workspaces/${REPO_ID}/work-items/import-from-azure-boards`, {
            workItemId: 100,
        });

        expect(imported.status).toBe(201);
        expect(onAzureBoardsBackedEpicTreeChanged).toHaveBeenCalledWith(REPO_ID);
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

    it('does not register manual per-Epic pull endpoints', async () => {
        await startServer([makeFakeProvider(), makeAzureProvider()]);

        const github = await request('POST', `/api/workspaces/${REPO_ID}/work-items/root-1/sync-from-github`);
        const azure = await request('POST', `/api/workspaces/${REPO_ID}/work-items/root-1/sync-from-azure-boards`);

        expect(github.status).toBe(404);
        expect(azure.status).toBe(404);
    });
});
