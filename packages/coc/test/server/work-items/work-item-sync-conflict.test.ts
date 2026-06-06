import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../../../src/server/work-items/types';
import {
    buildAzureBoardsWorkItemSyncConflict,
    buildGitHubWorkItemSyncConflict,
    buildGitHubWorkItemSyncMetadata,
    upsertGitHubWorkItemSyncMetadataBlock,
    type AzureBoardsWorkItem,
    type GitHubWorkItemIssue,
} from '../../../src/server/work-items';

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-02-02T00:00:00.000Z';

function makeWorkItem(overrides: Partial<WorkItem>): WorkItem {
    return {
        id: overrides.id ?? 'item-1',
        repoId: overrides.repoId ?? 'repo',
        title: overrides.title ?? 'Title',
        description: overrides.description ?? '',
        status: overrides.status ?? 'created',
        type: overrides.type,
        parentId: overrides.parentId,
        tracker: overrides.tracker,
        githubMirror: overrides.githubMirror,
        azureBoardsMirror: overrides.azureBoardsMirror,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        source: overrides.source ?? 'manual',
        tags: overrides.tags,
        priority: overrides.priority,
    };
}

function byField(details: ReturnType<typeof buildGitHubWorkItemSyncConflict>) {
    return Object.fromEntries(details.fields.map(f => [f.field, f]));
}

describe('buildGitHubWorkItemSyncConflict', () => {
    it('surfaces every diverged provider-owned field including a reparent', () => {
        const metadata = buildGitHubWorkItemSyncMetadata({
            workItem: {
                id: 'pbi-1',
                type: 'pbi',
                status: 'executing',
                priority: 'high',
                tags: ['x'],
                description: 'Remote prose',
                parentId: 'feature-remote',
            },
            remote: { owner: 'o', repo: 'r', issueNumber: 50 },
            lastSyncedAt: NOW,
            parent: { workItemId: 'feature-remote', issueNumber: 99, owner: 'o', repo: 'r' },
        });
        const remote: GitHubWorkItemIssue = {
            id: 'I_50',
            number: 50,
            title: 'Remote title',
            state: 'open',
            body: upsertGitHubWorkItemSyncMetadataBlock('Remote prose', metadata),
            labels: ['coc:type:pbi', 'coc:status:executing', 'coc:priority:high', 'x'],
            updatedAt: LATER,
        };
        const current = makeWorkItem({
            id: 'pbi-1',
            title: 'Local title',
            description: 'Local prose',
            status: 'planning',
            priority: 'normal',
            tags: ['y'],
            parentId: 'feature-local',
            githubMirror: { issueNumber: 50, updatedAt: NOW },
        });
        const draft = { ...current, title: 'New draft title', parentId: 'feature-draft' };

        const details = buildGitHubWorkItemSyncConflict({ current, draft, remote, issueNumber: 50 });

        expect(details).toMatchObject({
            kind: 'work-item-sync-conflict',
            provider: 'github',
            providerLabel: 'GitHub',
            workItemId: 'pbi-1',
            issueNumber: 50,
            localUpdatedAt: NOW,
            remoteUpdatedAt: LATER,
        });
        const fields = byField(details);
        expect(fields.title).toEqual({ field: 'title', draft: 'New draft title', base: 'Local title', remote: 'Remote title' });
        expect(fields.description).toEqual({ field: 'description', draft: 'Local prose', base: 'Local prose', remote: 'Remote prose' });
        expect(fields.status).toEqual({ field: 'status', draft: 'planning', base: 'planning', remote: 'executing' });
        expect(fields.priority).toEqual({ field: 'priority', draft: 'normal', base: 'normal', remote: 'high' });
        expect(fields.tags).toEqual({ field: 'tags', draft: 'y', base: 'y', remote: 'x' });
        expect(fields.parent).toEqual({ field: 'parent', draft: 'feature-draft', base: 'feature-local', remote: 'feature-remote' });
    });

    it('returns no fields when the provider did not change any provider-owned field', () => {
        const remote: GitHubWorkItemIssue = {
            id: 'I_7',
            number: 7,
            title: 'Same title',
            state: 'open',
            body: 'Same prose',
            labels: ['coc:type:epic', 'coc:status:created', 'coc:priority:normal'],
            updatedAt: LATER,
        };
        const current = makeWorkItem({
            id: 'epic-1',
            title: 'Same title',
            description: 'Same prose',
            status: 'created',
            githubMirror: { issueNumber: 7, updatedAt: NOW },
        });
        const draft = { ...current, title: 'Local rename' };

        const details = buildGitHubWorkItemSyncConflict({ current, draft, remote, issueNumber: 7 });
        expect(details.fields).toEqual([]);
    });
});

describe('buildAzureBoardsWorkItemSyncConflict', () => {
    function remoteWorkItem(overrides: Partial<AzureBoardsWorkItem> = {}): AzureBoardsWorkItem {
        return {
            id: 300,
            revision: 5,
            title: 'Remote title',
            description: 'Remote description',
            state: 'Active',
            workItemType: 'Epic',
            priority: 1,
            tags: 'beta; alpha',
            updatedAt: LATER,
            ...overrides,
        };
    }

    const current = makeWorkItem({
        id: 'epic-1',
        title: 'Local title',
        description: 'Local description',
        status: 'created',
        priority: 'normal',
        parentId: 'feat-local',
        azureBoardsMirror: { workItemId: 300, revision: 2, updatedAt: NOW },
    });

    it('includes a parent row when the resolved remote parent differs from the local base', () => {
        const details = buildAzureBoardsWorkItemSyncConflict({
            current,
            draft: { ...current, parentId: 'feat-draft' },
            remote: remoteWorkItem(),
            remoteWorkItemId: 300,
            remoteParentLocalId: 'feat-remote',
        });

        expect(details).toMatchObject({
            kind: 'work-item-sync-conflict',
            provider: 'azure-boards',
            providerLabel: 'Azure Boards',
            workItemId: 'epic-1',
            remoteWorkItemId: 300,
            localRevision: 2,
            remoteRevision: 5,
        });
        const fields = byField(details);
        expect(fields.parent).toEqual({ field: 'parent', draft: 'feat-draft', base: 'feat-local', remote: 'feat-remote' });
        expect(fields.tags).toEqual({ field: 'tags', draft: null, base: null, remote: 'alpha, beta' });
        expect(fields.priority).toEqual({ field: 'priority', draft: 'normal', base: 'normal', remote: 'high' });
    });

    it('omits the parent row when the remote parent is not mirrored locally', () => {
        const details = buildAzureBoardsWorkItemSyncConflict({
            current,
            draft: current,
            remote: remoteWorkItem(),
            remoteWorkItemId: 300,
            remoteParentLocalId: undefined,
        });
        expect(byField(details).parent).toBeUndefined();
    });

    it('returns no fields when the remote matches the local base', () => {
        const rootCurrent = makeWorkItem({
            id: 'epic-1',
            title: 'Local title',
            description: 'Local description',
            status: 'created',
            priority: 'normal',
            azureBoardsMirror: { workItemId: 300, revision: 2, updatedAt: NOW },
        });
        const details = buildAzureBoardsWorkItemSyncConflict({
            current: rootCurrent,
            draft: { ...rootCurrent, title: 'Local rename' },
            remote: remoteWorkItem({
                title: 'Local title',
                description: 'Local description',
                state: 'New',
                priority: 2,
                tags: undefined,
            }),
            remoteWorkItemId: 300,
            remoteParentLocalId: null,
        });
        expect(details.fields).toEqual([]);
    });
});
