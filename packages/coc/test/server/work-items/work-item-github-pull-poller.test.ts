import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    WorkItemGitHubPullPoller,
    importGitHubEpicTreeAsWorkItems,
    type AvailableGitHubWorkItemSyncRepo,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueTransport,
    type WorkItemGitHubPullPollerTimerApi,
} from '../../../src/server/work-items';
import type { WorkItem } from '../../../src/server/work-items';

const REPO_ID = 'github-poller-test-repo';
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-poller-test-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

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
        expect(await store.getWorkItem(closedChild.id, REPO_ID)).toBeDefined();

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
});
