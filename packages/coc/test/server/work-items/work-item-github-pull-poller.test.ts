import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    clearWorkItemResponseCache,
    getWorkItemResponseCacheEntry,
    makeWorkItemTreeResponseCacheKey,
    refreshWorkItemResponseCacheEntry,
} from '../../../src/server/work-items/work-item-response-cache';
import {
    WorkItemGitHubPullPoller,
    WORK_ITEM_SYNC_MAX_ITEMS,
    importGitHubEpicTreeAsWorkItems,
    type AvailableGitHubWorkItemSyncRepo,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueListFilters,
    type GitHubWorkItemIssueTransport,
    type WorkItemGitHubPullPollerTimerApi,
} from '../../../src/server/work-items';
import type { WorkItem } from '../../../src/server/work-items';

const REPO_ID = 'github-poller-test-repo';
const ORIGIN_ID = 'gh_plusplusoneplusplus_shortcuts';
const NOW = '2026-01-01T00:00:00.000Z';
const OWNER = 'plusplusoneplusplus';
const REPO = 'shortcuts';

function configuredRepo(): AvailableGitHubWorkItemSyncRepo {
    return {
        available: true,
        provider: 'github',
        owner: OWNER,
        repo: REPO,
        url: `https://github.com/${OWNER}/${REPO}`,
        source: 'preference',
    };
}

function makeIssue(
    number: number,
    title: string,
    overrides: Partial<GitHubWorkItemIssue> = {},
): GitHubWorkItemIssue {
    return {
        id: `I_${number}`,
        number,
        title,
        state: 'open',
        htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/${number}`,
        url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/${number}`,
        labels: [],
        body: '',
        updatedAt: NOW,
        ...overrides,
    };
}

function metadataBlock(input: {
    issueNumber: number;
    type: WorkItem['type'];
    parent?: {
        issueNumber?: number;
        owner?: string;
        repo?: string;
    };
}): string {
    return `<!-- coc-work-item-sync ${JSON.stringify({
        schemaVersion: 1,
        provider: 'github',
        remote: {
            owner: OWNER,
            repo: REPO,
            issueNumber: input.issueNumber,
        },
        parent: input.parent,
        type: input.type,
        status: 'created',
        lastSyncedAt: NOW,
    })} -->`;
}

function makeTransport(issues: Map<number, GitHubWorkItemIssue>): GitHubWorkItemIssueTransport {
    return {
        async getRepository() {
            // no-op
        },
        async listIssues() {
            return [...issues.values()];
        },
        async getIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number) {
            return issues.get(issueNumber);
        },
        async createIssue(): Promise<GitHubWorkItemIssue> {
            throw new Error('createIssue is not used by the GitHub pull poller.');
        },
        async updateIssue(): Promise<GitHubWorkItemIssue> {
            throw new Error('updateIssue is not used by the GitHub pull poller.');
        },
    };
}

function processStore(rootPath: string) {
    return {
        getWorkspaces: async () => [{
            id: REPO_ID,
            name: 'GitHub Poller Test',
            rootPath,
            remoteUrl: `https://github.com/${OWNER}/${REPO}.git`,
        }],
    } as any;
}

async function importTree(store: FileWorkItemStore, issues: Map<number, GitHubWorkItemIssue>, rootNumber = 100) {
    return importGitHubEpicTreeAsWorkItems(
        { workspaceId: REPO_ID, workItemStore: store },
        configuredRepo(),
        issues.get(rootNumber)!,
        [...issues.values()],
        () => NOW,
    );
}

let tmpDir: string;
let store: FileWorkItemStore;

beforeEach(async () => {
    clearWorkItemResponseCache();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-poller-test-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    clearWorkItemResponseCache();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

function createScopedStore(): FileWorkItemStore {
    return new FileWorkItemStore({
        dataDir: tmpDir,
        scopeResolver: repoId => {
            if (repoId === REPO_ID || repoId === ORIGIN_ID) {
                return { storageRepoId: ORIGIN_ID, legacyRepoIds: [REPO_ID] };
            }
            return undefined;
        },
    });
}

async function primeOriginTreeCache(): Promise<string> {
    const key = makeWorkItemTreeResponseCacheKey(ORIGIN_ID, {
        tracker: 'github-backed',
        includeArchived: false,
        includeDone: false,
    });
    await refreshWorkItemResponseCacheEntry(key, ORIGIN_ID, 'tree', async () => ({ stale: true }));
    expect(getWorkItemResponseCacheEntry(key)).toBeDefined();
    return key;
}

describe('WorkItemGitHubPullPoller', () => {
    it('configures per-workspace polling and honors disabled preferences', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [100, makeIssue(100, 'Polling Epic', {
                labels: ['coc:type:epic'],
                body: 'Polling epic',
            })],
        ]);
        await importTree(store, issues);

        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    github: {
                        owner: OWNER,
                        repo: REPO,
                        pollingEnabled: false,
                        pollIntervalMinutes: 1,
                    },
                },
            },
        });

        const scheduled: Array<{ handler: () => void | Promise<void>; ms: number; id: number }> = [];
        const cleared: unknown[] = [];
        const timerApi: WorkItemGitHubPullPollerTimerApi = {
            setInterval(handler, ms) {
                const id = scheduled.length + 1;
                scheduled.push({ handler, ms, id });
                return id;
            },
            clearInterval(timer) {
                cleared.push(timer);
            },
        };
        const poller = new WorkItemGitHubPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            transport: makeTransport(issues),
            timerApi,
        });

        await poller.start();

        expect(scheduled).toHaveLength(0);

        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    github: {
                        owner: OWNER,
                        repo: REPO,
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
        const issues = new Map<number, GitHubWorkItemIssue>([
            [100, makeIssue(100, 'Polling Epic', {
                labels: ['coc:type:epic'],
                body: 'Polling epic',
            })],
        ]);
        await importTree(store, issues);
        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    github: {
                        owner: OWNER,
                        repo: REPO,
                        pollingEnabled: true,
                        pollIntervalMinutes: 1,
                    },
                },
            },
        });
        const scheduled: Array<{ handler: () => void | Promise<void>; ms: number; id: number }> = [];
        const cleared: unknown[] = [];
        const timerApi: WorkItemGitHubPullPollerTimerApi = {
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
        const poller = new WorkItemGitHubPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            transport: makeTransport(issues),
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

    it('polls GitHub-backed Epic roots, prunes missing descendants, and deletes missing roots', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [100, makeIssue(100, 'Remote Epic', {
                labels: ['coc:type:epic'],
                body: 'Remote epic',
            })],
            [101, makeIssue(101, 'Remote Feature', {
                body: `Remote feature\n\n${metadataBlock({
                    issueNumber: 101,
                    type: 'feature',
                    parent: { owner: OWNER, repo: REPO, issueNumber: 100 },
                })}`,
            })],
        ]);
        const imported = await importTree(store, issues);
        const child = imported.items.find(item => item.githubMirror?.issueNumber === 101)!;
        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    github: {
                        owner: OWNER,
                        repo: REPO,
                        pollingEnabled: true,
                    },
                },
            },
        });
        const poller = new WorkItemGitHubPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            transport: makeTransport(issues),
            now: () => '2026-01-03T00:00:00.000Z',
        });

        issues.set(100, makeIssue(100, 'Remote Epic Updated', {
            labels: ['coc:type:epic', 'polled-tag'],
            body: 'Remote epic updated',
            updatedAt: '2026-01-02T00:00:00.000Z',
        }));
        issues.delete(101);

        const pullResult = await poller.pollWorkspace(REPO_ID);

        expect(pullResult).toMatchObject({
            rootsConsidered: 1,
            rootsSynced: 1,
            created: 0,
            updated: 1,
            deleted: 1,
            deletedItemIds: [child.id],
            errors: [],
        });
        const updatedRoot = await store.getWorkItem(imported.root.id, REPO_ID);
        expect(updatedRoot?.title).toBe('Remote Epic Updated');
        expect(updatedRoot?.tags).toEqual(['polled-tag']);
        expect(await store.getWorkItem(child.id, REPO_ID)).toBeUndefined();

        issues.delete(100);
        const deleteResult = await poller.pollWorkspace(REPO_ID);

        expect(deleteResult).toMatchObject({
            rootsConsidered: 1,
            rootsSynced: 1,
            created: 0,
            updated: 0,
            deleted: 1,
            deletedItemIds: [imported.root.id],
            errors: [],
        });
        expect(await store.getWorkItem(imported.root.id, REPO_ID)).toBeUndefined();
    });

    it('clears origin-scoped response cache when a ws-* poll updates a mirrored tree', async () => {
        store = createScopedStore();
        const issues = new Map<number, GitHubWorkItemIssue>([
            [100, makeIssue(100, 'Remote Epic', {
                labels: ['coc:type:epic'],
                body: 'Remote epic',
            })],
        ]);
        await importTree(store, issues);
        const cacheKey = await primeOriginTreeCache();
        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    github: {
                        owner: OWNER,
                        repo: REPO,
                        pollingEnabled: true,
                    },
                },
            },
        });
        const poller = new WorkItemGitHubPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            transport: makeTransport(issues),
            now: () => '2026-01-03T00:00:00.000Z',
        });

        issues.set(100, makeIssue(100, 'Remote Epic Updated', {
            labels: ['coc:type:epic'],
            body: 'Remote epic updated',
            updatedAt: '2026-01-02T00:00:00.000Z',
        }));

        const pullResult = await poller.pollWorkspace(REPO_ID);

        expect(pullResult).toMatchObject({ updated: 1, errors: [] });
        expect(getWorkItemResponseCacheEntry(cacheKey)).toBeUndefined();
    });

    it('does not resurrect a deleted closed-issue mirror on re-poll, but still re-imports open issues', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [100, makeIssue(100, 'Remote Epic', {
                labels: ['coc:type:epic'],
                body: 'Remote epic',
            })],
            [101, makeIssue(101, 'Open Child', {
                body: `Open child\n\n${metadataBlock({
                    issueNumber: 101,
                    type: 'feature',
                    parent: { owner: OWNER, repo: REPO, issueNumber: 100 },
                })}`,
            })],
            [102, makeIssue(102, 'Closed Child', {
                state: 'closed',
                body: `Closed child\n\n${metadataBlock({
                    issueNumber: 102,
                    type: 'feature',
                    parent: { owner: OWNER, repo: REPO, issueNumber: 100 },
                })}`,
            })],
        ]);
        const imported = await importTree(store, issues);
        const openChild = imported.items.find(item => item.githubMirror?.issueNumber === 101)!;
        const closedChild = imported.items.find(item => item.githubMirror?.issueNumber === 102)!;
        // Closed issues are still part of the initial import.
        expect(closedChild).toBeDefined();
        expect(closedChild.status).toBe('done');
        expect(closedChild.githubMirror?.state).toBe('closed');

        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: {
                sync: {
                    github: {
                        owner: OWNER,
                        repo: REPO,
                        pollingEnabled: true,
                    },
                },
            },
        });
        const poller = new WorkItemGitHubPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            transport: makeTransport(issues),
            now: () => '2026-01-03T00:00:00.000Z',
        });

        // An untouched closed mirror is preserved across polls (not pruned, not recreated).
        const firstPoll = await poller.pollWorkspace(REPO_ID);
        expect(firstPoll).toMatchObject({ created: 0, deleted: 0, errors: [] });
        expect(await store.getWorkItem(closedChild.id, REPO_ID)).toMatchObject({ status: 'done' });

        // Deleting the closed mirror locally must be durable: the next poll must not recreate it.
        expect(await store.removeWorkItem(closedChild.id)).toBe(true);
        const afterClosedDelete = await poller.pollWorkspace(REPO_ID);
        expect(afterClosedDelete).toMatchObject({ created: 0, deleted: 0, errors: [] });
        expect(await store.getWorkItem(closedChild.id, REPO_ID)).toBeUndefined();
        const afterClosed = await store.listWorkItems({ repoId: REPO_ID });
        expect(afterClosed.items.map(item => item.githubMirror?.issueNumber).filter(Boolean).sort())
            .toEqual([100, 101]);

        // Open issues stay authoritative on GitHub: deleting one locally re-imports it on the next poll.
        expect(await store.removeWorkItem(openChild.id)).toBe(true);
        const afterOpenDelete = await poller.pollWorkspace(REPO_ID);
        expect(afterOpenDelete).toMatchObject({ created: 1, errors: [] });
        const afterOpen = await store.listWorkItems({ repoId: REPO_ID });
        expect(afterOpen.items.map(item => item.githubMirror?.issueNumber).filter(Boolean).sort())
            .toEqual([100, 101]);
    });

    it('flags and logs truncation when the candidate fetch reaches the cap', async () => {
        const root = makeIssue(100, 'Remote Epic', {
            labels: ['coc:type:epic'],
            body: 'Remote epic',
        });
        await importTree(store, new Map([[100, root]]));

        // More remote issues exist than the cap allows; the transport honors the
        // limit (like the real gh-CLI transport) and returns exactly the cap.
        const candidates: GitHubWorkItemIssue[] = [root];
        for (let n = 1; candidates.length < WORK_ITEM_SYNC_MAX_ITEMS + 50; n++) {
            if (n === 100) continue;
            candidates.push(makeIssue(n, `Filler ${n}`));
        }
        const cappingTransport: GitHubWorkItemIssueTransport = {
            async getRepository() {},
            async listIssues(_repo, filters?: GitHubWorkItemIssueListFilters) {
                const limit = filters?.limit ?? candidates.length;
                return candidates.slice(0, limit);
            },
            async getIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number) {
                return candidates.find(issue => issue.number === issueNumber);
            },
            async createIssue(): Promise<GitHubWorkItemIssue> {
                throw new Error('createIssue is not used by the GitHub pull poller.');
            },
            async updateIssue(): Promise<GitHubWorkItemIssue> {
                throw new Error('updateIssue is not used by the GitHub pull poller.');
            },
        };

        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: { sync: { github: { owner: OWNER, repo: REPO, pollingEnabled: true } } },
        });
        const logs: string[] = [];
        const poller = new WorkItemGitHubPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            transport: cappingTransport,
            now: () => '2026-01-03T00:00:00.000Z',
            logError: message => logs.push(message),
        });

        const pullResult = await poller.pollWorkspace(REPO_ID);

        expect(pullResult.candidatesConsidered).toBe(WORK_ITEM_SYNC_MAX_ITEMS);
        expect(pullResult.truncated).toBe(true);
        expect(pullResult.errors).toEqual([]);
        expect(logs.some(message =>
            message.includes(String(WORK_ITEM_SYNC_MAX_ITEMS)) && message.toLowerCase().includes('truncated'),
        )).toBe(true);
    });

    it('does not flag truncation when the candidate fetch is under the cap', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [100, makeIssue(100, 'Remote Epic', { labels: ['coc:type:epic'], body: 'Remote epic' })],
        ]);
        await importTree(store, issues);
        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: { sync: { github: { owner: OWNER, repo: REPO, pollingEnabled: true } } },
        });
        const logs: string[] = [];
        const poller = new WorkItemGitHubPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            transport: makeTransport(issues),
            now: () => '2026-01-03T00:00:00.000Z',
            logError: message => logs.push(message),
        });

        const pullResult = await poller.pollWorkspace(REPO_ID);

        expect(pullResult.candidatesConsidered).toBe(1);
        expect(pullResult.truncated).toBe(false);
        expect(logs).toEqual([]);
    });

    it('preserves an unpushed local edit on poll, surfaces it as a warning, and logs it', async () => {
        const issues = new Map<number, GitHubWorkItemIssue>([
            [100, makeIssue(100, 'Remote Epic', { labels: ['coc:type:epic'], body: 'Remote epic' })],
        ]);
        const tree = await importTree(store, issues);
        const rootId = tree.root.id;

        // The user edits the title locally but has not pushed it back to GitHub.
        await store.updateWorkItem(rootId, { title: 'Local unpushed title' });
        // The remote title also moves, so the next poll is a genuine conflict.
        issues.set(100, makeIssue(100, 'Remote moved title', {
            labels: ['coc:type:epic'],
            body: 'Remote epic',
            updatedAt: '2026-01-02T00:00:00.000Z',
        }));

        writeRepoPreferences(tmpDir, REPO_ID, {
            workItems: { sync: { github: { owner: OWNER, repo: REPO, pollingEnabled: true, pollIntervalMinutes: 1 } } },
        });

        const scheduled: Array<{ handler: () => void | Promise<void> }> = [];
        const timerApi: WorkItemGitHubPullPollerTimerApi = {
            setInterval(handler) {
                scheduled.push({ handler });
                return scheduled.length;
            },
            clearInterval() {
                // no-op
            },
        };
        const logs: string[] = [];
        const poller = new WorkItemGitHubPullPoller({
            dataDir: tmpDir,
            processStore: processStore(tmpDir),
            workItemStore: store,
            transport: makeTransport(issues),
            now: () => '2026-01-03T00:00:00.000Z',
            timerApi,
            logError: message => logs.push(message),
        });

        // Structured warning is surfaced from the pull result.
        const pullResult = await poller.pollWorkspace(REPO_ID);
        expect(pullResult.warnings).toHaveLength(1);
        expect(pullResult.warnings[0]).toMatchObject({
            code: 'local-edits-preserved',
            workItemId: rootId,
            issueNumber: 100,
            fields: ['title'],
        });

        // The scheduled (timer-driven) poll logs the conflict so it is observable.
        await poller.configureWorkspace(REPO_ID);
        expect(scheduled).toHaveLength(1);
        await scheduled[0].handler();
        expect(logs.some(message =>
            message.includes('#100') && message.toLowerCase().includes('unpushed'),
        )).toBe(true);

        // The unpushed local edit survives both polls.
        const updated = await store.getWorkItem(rootId, REPO_ID);
        expect(updated?.title).toBe('Local unpushed title');
    });
});
