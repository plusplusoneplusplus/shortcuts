import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    createGitHubWorkItemSyncProviderAdapter,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueCreateInput,
    type GitHubWorkItemIssueListFilters,
    type GitHubWorkItemIssueTransport,
    type GitHubWorkItemIssueUpdateInput,
} from '../../../src/server/work-items/work-item-sync-github-provider';
import type { WorkItem } from '../../../src/server/work-items/types';

const WORKSPACE_ID = 'github-sync-repo';
const NOW = '2026-01-10T00:00:00.000Z';
const REPO = {
    available: true as const,
    provider: 'github' as const,
    owner: 'octo-org',
    repo: 'octo-repo',
    url: 'https://github.com/octo-org/octo-repo',
    source: 'origin' as const,
};

class FakeGitHubTransport implements GitHubWorkItemIssueTransport {
    repositoriesChecked = 0;
    listedFilters: GitHubWorkItemIssueListFilters[] = [];
    createdInputs: GitHubWorkItemIssueCreateInput[] = [];
    updatedInputs: Array<{ issueNumber: number; input: GitHubWorkItemIssueUpdateInput }> = [];
    issues = new Map<number, GitHubWorkItemIssue>();
    failRepository = false;
    private nextIssueNumber = 100;

    async getRepository(): Promise<void> {
        this.repositoriesChecked++;
        if (this.failRepository) throw new Error('auth unavailable');
    }

    async listIssues(_repo: typeof REPO, filters: GitHubWorkItemIssueListFilters = {}): Promise<GitHubWorkItemIssue[]> {
        this.listedFilters.push(filters);
        return [...this.issues.values()].filter(issue => {
            if (filters.q && !issue.title.toLowerCase().includes(filters.q.toLowerCase())) return false;
            return true;
        });
    }

    async getIssue(_repo: typeof REPO, issueNumber: number): Promise<GitHubWorkItemIssue | undefined> {
        return this.issues.get(issueNumber);
    }

    async createIssue(_repo: typeof REPO, input: GitHubWorkItemIssueCreateInput): Promise<GitHubWorkItemIssue> {
        this.createdInputs.push(input);
        const issue = makeIssue({
            number: this.nextIssueNumber++,
            title: input.title,
            labels: input.labels,
            body: input.body,
            updatedAt: NOW,
        });
        this.issues.set(issue.number, issue);
        return issue;
    }

    async updateIssue(_repo: typeof REPO, issueNumber: number, input: GitHubWorkItemIssueUpdateInput): Promise<GitHubWorkItemIssue> {
        this.updatedInputs.push({ issueNumber, input });
        const existing = this.issues.get(issueNumber);
        const issue = makeIssue({
            ...existing,
            number: issueNumber,
            title: input.title,
            state: input.state,
            labels: input.labels,
            body: input.body,
            updatedAt: NOW,
        });
        this.issues.set(issue.number, issue);
        return issue;
    }
}

let tmpDir: string;
let store: FileWorkItemStore;
let transport: FakeGitHubTransport;

function makeIssue(input: Partial<GitHubWorkItemIssue> & { number: number; title: string }): GitHubWorkItemIssue {
    return {
        id: input.id ?? `I_${input.number}`,
        number: input.number,
        title: input.title,
        state: input.state ?? 'open',
        htmlUrl: input.htmlUrl ?? `https://github.com/octo-org/octo-repo/issues/${input.number}`,
        labels: input.labels ?? [],
        body: input.body ?? '',
        updatedAt: input.updatedAt ?? NOW,
    };
}

async function addItem(input: Partial<WorkItem> & { id: string; title: string }): Promise<WorkItem> {
    const item: WorkItem = {
        id: input.id,
        repoId: WORKSPACE_ID,
        title: input.title,
        description: input.description ?? '',
        status: input.status ?? 'created',
        type: input.type,
        parentId: input.parentId,
        syncLinks: input.syncLinks,
        createdAt: input.createdAt ?? NOW,
        updatedAt: input.updatedAt ?? NOW,
        source: input.source ?? 'manual',
        priority: input.priority,
        tags: input.tags,
    };
    await store.addWorkItem(item);
    return item;
}

function makeContext() {
    return {
        workspaceId: WORKSPACE_ID,
        workspace: {
            id: WORKSPACE_ID,
            name: 'GitHub Sync',
            rootPath: tmpDir,
            remoteUrl: 'https://github.com/octo-org/octo-repo.git',
        },
        preferences: {},
        workItemStore: store,
    };
}

function makeProvider() {
    return createGitHubWorkItemSyncProviderAdapter({
        transport,
        now: () => NOW,
        createPreviewId: operation => `preview-${operation}`,
    });
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-gh-sync-provider-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
    transport = new FakeGitHubTransport();
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GitHub work item sync provider', () => {
    it('reports available status from workspace origin using external auth only', async () => {
        const provider = makeProvider();

        const status = await provider.getStatus(makeContext());

        expect(status).toMatchObject({
            provider: 'github',
            available: true,
            repository: {
                owner: 'octo-org',
                repo: 'octo-repo',
                source: 'workspaceRemote',
            },
            auth: {
                mode: 'external',
                authenticated: true,
            },
        });
        expect(transport.repositoriesChecked).toBe(1);
        expect(JSON.stringify(status)).not.toMatch(/token|secret|password|credential/i);
    });

    it('does not call the GitHub transport when repo detection fails', async () => {
        const provider = makeProvider();

        const status = await provider.getStatus({
            ...makeContext(),
            workspace: { id: WORKSPACE_ID, name: 'No Remote', rootPath: undefined, remoteUrl: undefined },
        });

        expect(status.available).toBe(false);
        expect(status.reason).toBe('missing-workspace');
        expect(transport.repositoriesChecked).toBe(0);
    });

    it('previews importing GitHub issues without mutating local work items', async () => {
        const provider = makeProvider();
        transport.issues.set(11, makeIssue({
            number: 11,
            title: 'Remote feature',
            labels: ['customer-label', 'coc:type:feature', 'coc:status:planning', 'coc:priority:high', 'coc:unknown:legacy'],
            body: 'Remote body prose.',
        }));
        transport.issues.set(12, makeIssue({
            number: 12,
            title: 'Plain issue',
            labels: ['plain'],
            body: 'No CoC metadata.',
        }));

        const preview = await provider.preview({
            ...makeContext(),
            operation: 'import',
            request: { operation: 'import', provider: 'github' },
            items: [],
        });

        expect(preview).toMatchObject({
            provider: 'github',
            operation: 'import',
            previewId: 'preview-import',
            itemCount: 1,
        });
        expect(preview.creates).toHaveLength(1);
        expect(preview.creates[0]).toMatchObject({
            kind: 'create-local',
            title: 'Remote feature',
            remote: {
                owner: 'octo-org',
                repo: 'octo-repo',
                issueNumber: 11,
            },
            itemType: 'feature',
            status: 'planning',
        });
        expect(preview.creates[0].fields).toContainEqual({
            field: 'tags',
            remoteValue: ['customer-label'],
            proposedValue: ['customer-label'],
        });
        expect(preview.warnings.some(warning => warning.id === 'unknown-coc-labels-11')).toBe(true);
        expect((await store.listWorkItems({ repoId: WORKSPACE_ID })).total).toBe(0);
    });

    it('previews selected subtree export parent-first with creates and updates', async () => {
        const provider = makeProvider();
        await addItem({ id: 'leaf-1', title: 'Leaf', type: 'work-item', parentId: 'pbi-1' });
        const pbi = await addItem({
            id: 'pbi-1',
            title: 'PBI',
            type: 'pbi',
            parentId: 'feature-1',
            syncLinks: [{
                provider: 'github',
                remote: {
                    owner: 'octo-org',
                    repo: 'octo-repo',
                    issueId: 'I_42',
                    issueNumber: 42,
                    issueUrl: 'https://github.com/octo-org/octo-repo/issues/42',
                },
                remoteUpdatedAt: '2026-01-09T00:00:00.000Z',
                lastSyncedAt: '2026-01-09T00:00:00.000Z',
            }],
        });
        const feature = await addItem({ id: 'feature-1', title: 'Feature', type: 'feature' });
        transport.issues.set(42, makeIssue({
            id: 'I_42',
            number: 42,
            title: 'Old PBI title',
            labels: ['coc:type:pbi', 'coc:status:created'],
            body: 'Remote PBI body.',
        }));

        const preview = await provider.preview({
            ...makeContext(),
            operation: 'export-selected',
            request: { operation: 'export-selected', provider: 'github', selectedWorkItemId: feature.id },
            items: [pbi, feature],
        });

        expect(preview.itemCount).toBe(2);
        expect(preview.creates.map(op => op.workItemId)).toEqual(['feature-1']);
        expect(preview.updates.map(op => op.workItemId)).toEqual(['pbi-1']);
        expect(preview.updates[0].fields).toContainEqual({
            field: 'title',
            cocValue: 'PBI',
            remoteValue: 'Old PBI title',
            proposedValue: 'PBI',
        });
    });

    it('previews sync-linked remote-only changes as local updates', async () => {
        const provider = makeProvider();
        const item = await addItem({
            id: 'linked-1',
            title: 'Local title',
            type: 'bug',
            status: 'created',
            updatedAt: '2026-01-01T00:00:00.000Z',
            syncLinks: [{
                provider: 'github',
                remote: {
                    owner: 'octo-org',
                    repo: 'octo-repo',
                    issueNumber: 9,
                },
                remoteUpdatedAt: '2026-01-02T00:00:00.000Z',
                lastSyncedAt: '2026-01-02T00:00:00.000Z',
            }],
        });
        transport.issues.set(9, makeIssue({
            number: 9,
            title: 'Remote title',
            labels: ['coc:type:bug', 'coc:status:planning'],
            body: 'Remote body.',
            updatedAt: '2026-01-03T00:00:00.000Z',
        }));

        const preview = await provider.preview({
            ...makeContext(),
            operation: 'sync-linked',
            request: { operation: 'sync-linked', provider: 'github' },
            items: [item],
        });

        expect(preview.updates).toHaveLength(1);
        expect(preview.updates[0]).toMatchObject({
            kind: 'update-local',
            workItemId: 'linked-1',
            title: 'Remote title',
            status: 'planning',
        });
        expect(preview.updates[0].fields).toContainEqual({
            field: 'title',
            cocValue: 'Local title',
            remoteValue: 'Remote title',
            proposedValue: 'Remote title',
        });
    });

    it('applies import previews by creating linked local work items', async () => {
        const provider = makeProvider();
        transport.issues.set(11, makeIssue({
            number: 11,
            title: 'Remote feature',
            labels: ['customer-label', 'coc:type:feature', 'coc:status:planning', 'coc:priority:high'],
            body: 'Remote feature body.',
        }));

        const result = await provider.apply({
            ...makeContext(),
            operation: 'import',
            request: { operation: 'import', provider: 'github' },
            items: [],
        });

        expect(result).toMatchObject({ applied: 1, skipped: 0, failed: 0 });
        const localItems = await store.listWorkItems({ repoId: WORKSPACE_ID });
        expect(localItems.total).toBe(1);
        const item = await store.getWorkItem(localItems.items[0].id, WORKSPACE_ID);
        expect(item).toMatchObject({
            title: 'Remote feature',
            description: 'Remote feature body.',
            type: 'feature',
            status: 'planning',
            priority: 'high',
            tags: ['customer-label'],
        });
        expect(item?.syncLinks?.[0]).toMatchObject({
            provider: 'github',
            remote: { owner: 'octo-org', repo: 'octo-repo', issueNumber: 11 },
            remoteUpdatedAt: NOW,
            lastSyncedAt: NOW,
            dirty: false,
            conflict: false,
        });
        expect(item?.syncLinks?.[0].lastSyncedFingerprint).toBeTruthy();
    });

    it('applies export-selected creates parent-first and writes child parent metadata', async () => {
        const provider = makeProvider();
        const feature = await addItem({ id: 'feature-1', title: 'Feature', type: 'feature', description: 'Feature body.' });
        await addItem({ id: 'pbi-1', title: 'PBI', type: 'pbi', parentId: feature.id, description: 'PBI body.' });

        const result = await provider.apply({
            ...makeContext(),
            operation: 'export-selected',
            request: { operation: 'export-selected', provider: 'github', selectedWorkItemId: feature.id },
            items: (await Promise.all([
                store.getWorkItem('pbi-1', WORKSPACE_ID),
                store.getWorkItem('feature-1', WORKSPACE_ID),
            ])).filter((item): item is WorkItem => item !== undefined),
        });

        expect(result).toMatchObject({ applied: 2, failed: 0 });
        expect(transport.createdInputs.map(input => input.title)).toEqual(['Feature', 'PBI']);
        expect(transport.updatedInputs.map(entry => entry.issueNumber)).toEqual([100, 101]);
        const childMetadata = JSON.parse(
            transport.updatedInputs[1].input.body.match(/<!-- coc-work-item-sync ([\s\S]*?) -->/)![1],
        );
        expect(childMetadata).toMatchObject({
            workItemId: 'pbi-1',
            parent: { workItemId: 'feature-1', issueNumber: 100 },
        });
        const linkedFeature = await store.getWorkItem('feature-1', WORKSPACE_ID);
        const linkedPbi = await store.getWorkItem('pbi-1', WORKSPACE_ID);
        expect(linkedFeature?.syncLinks?.[0].remote.issueNumber).toBe(100);
        expect(linkedPbi?.syncLinks?.[0].remote.issueNumber).toBe(101);
    });

    it('applies clean sync-linked remote changes to local items and metadata', async () => {
        const provider = makeProvider();
        await addItem({
            id: 'linked-remote',
            title: 'Local title',
            description: 'Local body.',
            type: 'bug',
            status: 'created',
            updatedAt: '2026-01-01T00:00:00.000Z',
            syncLinks: [{
                provider: 'github',
                remote: { owner: 'octo-org', repo: 'octo-repo', issueNumber: 9 },
                remoteUpdatedAt: '2026-01-02T00:00:00.000Z',
                lastSyncedAt: '2026-01-02T00:00:00.000Z',
            }],
        });
        transport.issues.set(9, makeIssue({
            number: 9,
            title: 'Remote title',
            labels: ['coc:type:bug', 'coc:status:planning'],
            body: 'Remote body.',
            updatedAt: '2026-01-03T00:00:00.000Z',
        }));

        const result = await provider.apply({
            ...makeContext(),
            operation: 'sync-linked',
            request: { operation: 'sync-linked', provider: 'github' },
            items: [(await store.getWorkItem('linked-remote', WORKSPACE_ID))!],
        });

        expect(result).toMatchObject({ applied: 1, skipped: 0, failed: 0 });
        const item = await store.getWorkItem('linked-remote', WORKSPACE_ID);
        expect(item).toMatchObject({
            title: 'Remote title',
            description: 'Remote body.',
            status: 'planning',
        });
        expect(item?.syncLinks?.[0]).toMatchObject({
            remoteUpdatedAt: '2026-01-03T00:00:00.000Z',
            lastSyncedAt: NOW,
            conflict: false,
        });
        expect(item?.syncLinks?.[0].lastSyncedFingerprint).toBeTruthy();
    });

    it('applies clean sync-linked local changes to GitHub and keeps failed issues open', async () => {
        const provider = makeProvider();
        await addItem({
            id: 'linked-local',
            title: 'Local title',
            type: 'bug',
            status: 'failed',
            updatedAt: '2026-01-04T00:00:00.000Z',
            syncLinks: [{
                provider: 'github',
                remote: { owner: 'octo-org', repo: 'octo-repo', issueNumber: 12 },
                remoteUpdatedAt: '2026-01-02T00:00:00.000Z',
                lastSyncedAt: '2026-01-02T00:00:00.000Z',
            }],
        });
        transport.issues.set(12, makeIssue({
            number: 12,
            title: 'Old title',
            state: 'closed',
            labels: ['coc:type:bug', 'coc:status:planning'],
            body: 'Remote prose.',
            updatedAt: '2026-01-02T00:00:00.000Z',
        }));

        const result = await provider.apply({
            ...makeContext(),
            operation: 'sync-linked',
            request: { operation: 'sync-linked', provider: 'github' },
            items: [(await store.getWorkItem('linked-local', WORKSPACE_ID))!],
        });

        expect(result).toMatchObject({ applied: 1, skipped: 0, failed: 0 });
        expect(transport.updatedInputs).toHaveLength(1);
        expect(transport.updatedInputs[0].input).toMatchObject({
            title: 'Local title',
            state: 'open',
        });
        expect(transport.updatedInputs[0].input.labels).toContain('coc:status:failed');
        expect((await store.getWorkItem('linked-local', WORKSPACE_ID))?.syncLinks?.[0]).toMatchObject({
            remoteUpdatedAt: NOW,
            lastSyncedAt: NOW,
            conflict: false,
        });
    });

    it('previews both-sides sync changes as conflicts and skips unresolved rows', async () => {
        const provider = makeProvider();
        const item = await addItem({
            id: 'conflicted',
            title: 'Local title',
            type: 'bug',
            status: 'planning',
            updatedAt: '2026-01-04T00:00:00.000Z',
            syncLinks: [{
                provider: 'github',
                remote: { owner: 'octo-org', repo: 'octo-repo', issueNumber: 13 },
                remoteUpdatedAt: '2026-01-02T00:00:00.000Z',
                lastSyncedAt: '2026-01-02T00:00:00.000Z',
            }],
        });
        transport.issues.set(13, makeIssue({
            number: 13,
            title: 'Remote title',
            labels: ['coc:type:bug', 'coc:status:created'],
            body: 'Remote body.',
            updatedAt: '2026-01-03T00:00:00.000Z',
        }));

        const preview = await provider.preview({
            ...makeContext(),
            operation: 'sync-linked',
            request: { operation: 'sync-linked', provider: 'github' },
            items: [item],
        });
        expect(preview.conflicts).toHaveLength(1);
        expect(preview.conflicts[0]).toMatchObject({
            id: 'conflict-conflicted',
            workItemId: 'conflicted',
            allowedResolutions: ['use-coc', 'use-provider', 'skip'],
        });

        const apply = await provider.apply({
            ...makeContext(),
            operation: 'sync-linked',
            request: { operation: 'sync-linked', provider: 'github' },
            items: [item],
        });
        expect(apply).toMatchObject({ applied: 0, skipped: 1, failed: 0 });
        expect(apply.conflicts).toHaveLength(1);
        expect(transport.updatedInputs).toEqual([]);
        expect((await store.getWorkItem('conflicted', WORKSPACE_ID))?.title).toBe('Local title');
    });

    it('applies explicit Use CoC conflict resolutions to GitHub', async () => {
        const provider = makeProvider();
        const item = await addItem({
            id: 'resolved-conflict',
            title: 'Local title',
            type: 'bug',
            status: 'done',
            updatedAt: '2026-01-04T00:00:00.000Z',
            syncLinks: [{
                provider: 'github',
                remote: { owner: 'octo-org', repo: 'octo-repo', issueNumber: 14 },
                remoteUpdatedAt: '2026-01-02T00:00:00.000Z',
                lastSyncedAt: '2026-01-02T00:00:00.000Z',
            }],
        });
        transport.issues.set(14, makeIssue({
            number: 14,
            title: 'Remote title',
            labels: ['coc:type:bug', 'coc:status:planning'],
            body: 'Remote body.',
            updatedAt: '2026-01-03T00:00:00.000Z',
        }));

        const result = await provider.apply({
            ...makeContext(),
            operation: 'sync-linked',
            request: {
                operation: 'sync-linked',
                provider: 'github',
                conflictResolutions: [{ conflictId: 'conflict-resolved-conflict', resolution: 'use-coc' }],
            },
            items: [item],
        });

        expect(result).toMatchObject({ applied: 1, skipped: 0, failed: 0 });
        expect(transport.updatedInputs).toHaveLength(1);
        expect(transport.updatedInputs[0].input).toMatchObject({
            title: 'Local title',
            state: 'closed',
        });
        expect(transport.updatedInputs[0].input.labels).toContain('coc:status:done');
        expect((await store.getWorkItem('resolved-conflict', WORKSPACE_ID))?.syncLinks?.[0]).toMatchObject({
            remoteUpdatedAt: NOW,
            lastSyncedAt: NOW,
            conflict: false,
        });
    });
});
