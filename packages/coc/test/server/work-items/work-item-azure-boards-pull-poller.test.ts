import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    WorkItemAzureBoardsPullPoller,
    importAzureBoardsEpicTreeAsWorkItems,
    type AvailableAzureBoardsWorkItemSyncProject,
    type AzureBoardsWorkItem,
    type AzureBoardsWorkItemTransport,
    type WorkItemAzureBoardsPullPollerTimerApi,
    type WorkItemSyncProviderAdapter,
} from '../../../src/server/work-items';

const REPO_ID = 'azure-poller-test-repo';
const SECOND_REPO_ID = 'azure-poller-second-repo';
const NOW = '2026-01-01T00:00:00.000Z';
const ORG_URL = 'https://dev.azure.com/octo-org';
const PROJECT = 'Project Alpha';

function configuredProject(): AvailableAzureBoardsWorkItemSyncProject {
    return {
        available: true,
        provider: 'azure-boards',
        organizationUrl: ORG_URL,
        project: PROJECT,
        projectId: PROJECT,
        url: `${ORG_URL}/${encodeURIComponent(PROJECT)}`,
        source: 'preference',
    };
}

function makeProvider(): WorkItemSyncProviderAdapter {
    return {
        provider: 'azure-boards',
        async getStatus() {
            return {
                provider: 'azure-boards',
                available: true,
                repository: configuredProject(),
                auth: {
                    mode: 'external',
                    authenticated: true,
                    message: 'Azure CLI authentication is available.',
                },
            };
        },
    };
}

function relationUrl(workItemId: number): string {
    return `${ORG_URL}/${encodeURIComponent(PROJECT)}/_apis/wit/workItems/${workItemId}`;
}

function makeWorkItem(
    id: number,
    title: string,
    overrides: Partial<AzureBoardsWorkItem> = {},
): AzureBoardsWorkItem {
    return {
        id,
        revision: 1,
        title,
        description: '',
        state: 'New',
        workItemType: 'Epic',
        priority: 2,
        tags: '',
        updatedAt: NOW,
        url: `${ORG_URL}/${encodeURIComponent(PROJECT)}/_workitems/edit/${id}`,
        relations: [],
        ...overrides,
    };
}

class FakeAzureBoardsTransport implements AzureBoardsWorkItemTransport {
    readonly items = new Map<number, AzureBoardsWorkItem>();

    set(items: AzureBoardsWorkItem[]): void {
        this.items.clear();
        for (const item of items) {
            this.items.set(item.id, item);
        }
    }

    async getWorkItem(_project: AvailableAzureBoardsWorkItemSyncProject, workItemId: number): Promise<AzureBoardsWorkItem | undefined> {
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
                if (relation.rel !== 'System.LinkTypes.Hierarchy-Forward') continue;
                const match = /\/workItems\/(\d+)$/i.exec(relation.url ?? '');
                if (!match) continue;
                const child = this.items.get(Number.parseInt(match[1], 10));
                if (child) queue.push(child);
            }
        }
        return result;
    }

    async createWorkItem(): Promise<AzureBoardsWorkItem> {
        throw new Error('createWorkItem is not used by the Azure Boards pull poller.');
    }

    async updateWorkItem(): Promise<AzureBoardsWorkItem> {
        throw new Error('updateWorkItem is not used by the Azure Boards pull poller.');
    }
}

function processStore(rootPath: string, workspaceIds = [REPO_ID]) {
    return {
        getWorkspaces: async () => workspaceIds.map(id => ({
            id,
            name: id,
            rootPath,
            remoteUrl: 'https://dev.azure.com/octo-org/Project%20Alpha/_git/repo',
        })),
    } as any;
}

async function importTree(
    store: FileWorkItemStore,
    transport: FakeAzureBoardsTransport,
    workspaceId = REPO_ID,
    rootWorkItemId = 100,
) {
    return importAzureBoardsEpicTreeAsWorkItems(
        { workspaceId, workItemStore: store },
        transport.items.get(rootWorkItemId)!,
        [...transport.items.values()],
        () => NOW,
    );
}

let tmpDir: string;
let store: FileWorkItemStore;
let transport: FakeAzureBoardsTransport;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'azure-poller-test-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    transport = new FakeAzureBoardsTransport();
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('WorkItemAzureBoardsPullPoller', () => {
    it('configures per-workspace polling and honors disabled preferences', async () => {
        transport.set([
            makeWorkItem(100, 'Polling Epic', { workItemType: 'Epic' }),
        ]);
        await importTree(store, transport);

        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    azureBoards: {
                        project: PROJECT,
                        pollingEnabled: false,
                        pollIntervalMinutes: 1,
                    },
                },
            },
        });

        const scheduled: Array<{ handler: () => void | Promise<void>; ms: number; id: number }> = [];
        const cleared: unknown[] = [];
        const timerApi: WorkItemAzureBoardsPullPollerTimerApi = {
            setInterval(handler, ms) {
                const id = scheduled.length + 1;
                scheduled.push({ handler, ms, id });
                return id;
            },
            clearInterval(timer) {
                cleared.push(timer);
            },
        };
        const poller = new WorkItemAzureBoardsPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            provider: makeProvider(),
            transport,
            timerApi,
        });

        await poller.start();

        expect(scheduled).toHaveLength(0);

        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    azureBoards: {
                        project: PROJECT,
                        pollingEnabled: true,
                        pollIntervalMinutes: 1,
                    },
                },
            },
        });

        await poller.configureWorkspace(REPO_ID);

        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].ms).toBe(60_000);

        poller.dispose();
        expect(cleared).toEqual([1]);
    });

    it('suppresses and clears timers when global work item sync is disabled', async () => {
        transport.set([
            makeWorkItem(100, 'Polling Epic', { workItemType: 'Epic' }),
        ]);
        await importTree(store, transport);
        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    azureBoards: {
                        project: PROJECT,
                        pollingEnabled: true,
                        pollIntervalMinutes: 1,
                    },
                },
            },
        });
        const scheduled: Array<{ handler: () => void | Promise<void>; ms: number; id: number }> = [];
        const cleared: unknown[] = [];
        const timerApi: WorkItemAzureBoardsPullPollerTimerApi = {
            setInterval(handler, ms) {
                const id = scheduled.length + 1;
                scheduled.push({ handler, ms, id });
                return id;
            },
            clearInterval(timer) {
                cleared.push(timer);
            },
        };
        let syncEnabled = false;
        const poller = new WorkItemAzureBoardsPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            provider: makeProvider(),
            transport,
            timerApi,
            getSyncEnabled: () => syncEnabled,
        });

        await poller.start();

        expect(scheduled).toHaveLength(0);

        syncEnabled = true;
        await poller.configureWorkspace(REPO_ID);
        expect(scheduled).toHaveLength(1);

        syncEnabled = false;
        await poller.configureWorkspace(REPO_ID);
        expect(cleared).toEqual([1]);
    });

    it('polls Azure-backed Epic roots, prunes descendants, reports remote-wins warnings, and deletes missing roots', async () => {
        transport.set([
            makeWorkItem(100, 'Remote Epic', {
                workItemType: 'Epic',
                description: '<p>Remote epic</p>',
                relations: [{ rel: 'System.LinkTypes.Hierarchy-Forward', url: relationUrl(101) }],
            }),
            makeWorkItem(101, 'Remote Feature', {
                workItemType: 'Feature',
                description: '<p>Remote feature</p>',
                relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: relationUrl(100) }],
            }),
        ]);
        const imported = await importTree(store, transport);
        const child = imported.items.find(item => item.azureBoardsMirror?.workItemId === 101)!;
        await store.updateWorkItem(imported.root.id, { title: 'Unsynced local epic title' });
        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    azureBoards: {
                        project: PROJECT,
                        pollingEnabled: true,
                    },
                },
            },
        });
        const poller = new WorkItemAzureBoardsPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            provider: makeProvider(),
            transport,
            now: () => '2026-01-03T00:00:00.000Z',
        });

        transport.set([
            makeWorkItem(100, 'Remote Epic Updated', {
                revision: 2,
                workItemType: 'Epic',
                description: '<p>Updated epic</p>',
                state: 'Closed',
                priority: 1,
                tags: 'Platform',
                updatedAt: '2026-01-02T00:00:00.000Z',
            }),
        ]);

        const pullResult = await poller.pollWorkspace(REPO_ID);

        expect(pullResult).toMatchObject({
            rootsConsidered: 1,
            rootsSynced: 1,
            created: 0,
            updated: 1,
            deleted: 1,
            deletedItemIds: [child.id],
            warnings: [{
                provider: 'azure-boards',
                code: 'remote-wins-conflict',
                workItemId: imported.root.id,
                remoteWorkItemId: 100,
                previousRevision: 1,
                remoteRevision: 2,
            }],
            errors: [],
        });
        const updatedRoot = await store.getWorkItem(imported.root.id, REPO_ID);
        expect(updatedRoot).toMatchObject({
            title: 'Remote Epic Updated',
            status: 'done',
            priority: 'high',
            tags: ['Platform'],
            azureBoardsMirror: {
                workItemId: 100,
                revision: 2,
                lastPulledAt: '2026-01-03T00:00:00.000Z',
            },
        });
        expect(await store.getWorkItem(child.id, REPO_ID)).toBeUndefined();

        transport.set([]);
        const deleteResult = await poller.pollWorkspace(REPO_ID);

        expect(deleteResult).toMatchObject({
            rootsConsidered: 1,
            rootsSynced: 1,
            created: 0,
            updated: 0,
            deleted: 1,
            deletedItemIds: [imported.root.id],
            warnings: [],
            errors: [],
        });
        expect(await store.getWorkItem(imported.root.id, REPO_ID)).toBeUndefined();
    });

    it('polls only the requested workspace', async () => {
        transport.set([
            makeWorkItem(100, 'Repo One Epic'),
            makeWorkItem(200, 'Repo Two Epic'),
        ]);
        const repoOne = await importTree(store, transport, REPO_ID, 100);
        const repoTwo = await importTree(store, transport, SECOND_REPO_ID, 200);
        writeRepoPreferences(tmpDir, REPO_ID, { workItems: { sync: { azureBoards: { project: PROJECT } } } });
        writeRepoPreferences(tmpDir, SECOND_REPO_ID, { workItems: { sync: { azureBoards: { project: PROJECT } } } });
        const poller = new WorkItemAzureBoardsPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir, [REPO_ID, SECOND_REPO_ID]),
            workItemStore: store,
            provider: makeProvider(),
            transport,
        });

        transport.set([
            makeWorkItem(100, 'Repo One Epic Updated', { revision: 2 }),
            makeWorkItem(200, 'Repo Two Epic Updated', { revision: 2 }),
        ]);

        const result = await poller.pollWorkspace(REPO_ID);

        expect(result).toMatchObject({
            workspaceId: REPO_ID,
            rootsConsidered: 1,
            rootsSynced: 1,
            updated: 1,
            errors: [],
        });
        expect((await store.getWorkItem(repoOne.root.id, REPO_ID))?.title).toBe('Repo One Epic Updated');
        expect((await store.getWorkItem(repoTwo.root.id, SECOND_REPO_ID))?.title).toBe('Repo Two Epic');
    });
});
