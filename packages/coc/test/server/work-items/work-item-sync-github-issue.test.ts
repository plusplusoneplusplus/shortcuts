import { describe, expect, it } from 'vitest';
import {
    buildGitHubWorkItemIssueUpdate,
    buildGitHubWorkItemLabels,
    formatGitHubWorkItemSyncMetadataBlock,
    hasExactlyOneGitHubWorkItemSyncMetadataBlock,
    parseGitHubWorkItemIssue,
    parseGitHubWorkItemSyncMetadataBlocks,
    stripGitHubWorkItemSyncMetadataBlocks,
} from '../../../src/server/work-items/work-item-sync-github-issue';
import type { WorkItem } from '../../../src/server/work-items/types';

const BASE_WORK_ITEM: WorkItem = {
    id: 'wi-1',
    repoId: 'repo-a',
    title: 'Sync hierarchy',
    description: 'Implement sync mapping',
    status: 'planning',
    type: 'feature',
    parentId: 'epic-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'manual',
    priority: 'high',
    tags: ['customer-visible', 'coc:type:spoofed'],
};

const REMOTE = {
    owner: 'octo-org',
    repo: 'octo-repo',
    issueId: 'I_kwDOExample',
    issueNumber: 42,
    issueUrl: 'https://github.com/octo-org/octo-repo/issues/42',
};

describe('work item GitHub issue mapping', () => {
    it('builds CoC-owned labels while preserving user labels and tags', () => {
        const labels = buildGitHubWorkItemLabels({
            workItem: BASE_WORK_ITEM,
            existingLabels: [
                'user-existing',
                { name: 'coc:type:bug' },
                { name: 'coc:status:failed' },
                { name: 'coc:unknown:old' },
            ],
        });

        expect(labels).toEqual([
            'user-existing',
            'customer-visible',
            'coc:type:feature',
            'coc:status:planning',
            'coc:priority:high',
        ]);
    });

    it('creates an idempotent body with exactly one hidden metadata block', () => {
        const first = buildGitHubWorkItemIssueUpdate({
            workItem: BASE_WORK_ITEM,
            remote: REMOTE,
            lastSyncedAt: '2026-01-02T00:00:00.000Z',
            existingIssue: {
                labels: ['remote-user', 'coc:type:bug'],
                body: 'Remote prose that should survive.',
            },
        });

        expect(hasExactlyOneGitHubWorkItemSyncMetadataBlock(first.body)).toBe(true);
        expect(first.body).toContain('Remote prose that should survive.');
        expect(first.body).not.toContain(BASE_WORK_ITEM.description);
        expect(first.labels).toEqual([
            'remote-user',
            'customer-visible',
            'coc:type:feature',
            'coc:status:planning',
            'coc:priority:high',
        ]);
        expect(parseGitHubWorkItemSyncMetadataBlocks(first.body).metadata).toEqual({
            schemaVersion: 1,
            provider: 'github',
            remote: REMOTE,
            workItemId: 'wi-1',
            parent: { workItemId: 'epic-1' },
            type: 'feature',
            status: 'planning',
            lastSyncedAt: '2026-01-02T00:00:00.000Z',
        });

        const second = buildGitHubWorkItemIssueUpdate({
            workItem: BASE_WORK_ITEM,
            remote: REMOTE,
            lastSyncedAt: '2026-01-03T00:00:00.000Z',
            existingIssue: {
                labels: first.labels,
                body: first.body,
            },
        });

        expect(hasExactlyOneGitHubWorkItemSyncMetadataBlock(second.body)).toBe(true);
        expect(second.body).toContain('Remote prose that should survive.');
        expect(parseGitHubWorkItemSyncMetadataBlocks(second.body).metadata?.lastSyncedAt)
            .toBe('2026-01-03T00:00:00.000Z');
    });

    it('omits parent metadata when the provider explicitly exports an item as unparented', () => {
        const update = buildGitHubWorkItemIssueUpdate({
            workItem: BASE_WORK_ITEM,
            remote: REMOTE,
            lastSyncedAt: '2026-01-02T00:00:00.000Z',
            parent: null,
        });

        expect(parseGitHubWorkItemSyncMetadataBlocks(update.body).metadata?.parent).toBeUndefined();
    });

    it('parses labels and hidden metadata while preserving user labels as tags', () => {
        const update = buildGitHubWorkItemIssueUpdate({
            workItem: {
                ...BASE_WORK_ITEM,
                status: 'failed',
                type: 'bug',
                priority: 'low',
                tags: ['backend'],
            },
            remote: REMOTE,
            lastSyncedAt: '2026-01-02T00:00:00.000Z',
        });

        const parsed = parseGitHubWorkItemIssue({
            labels: ['customer', 'coc:type:bug', 'coc:status:failed', 'coc:priority:low'],
            body: update.body,
        });

        expect(parsed).toMatchObject({
            type: 'bug',
            status: 'failed',
            priority: 'low',
            tags: ['customer'],
            unknownCocLabels: [],
            invalidMetadataBlocks: 0,
        });
        expect(parsed.metadata).toMatchObject({
            schemaVersion: 1,
            provider: 'github',
            workItemId: 'wi-1',
            type: 'bug',
            status: 'failed',
        });
    });

    it('handles missing metadata without treating body prose as sync state', () => {
        const parsed = parseGitHubWorkItemIssue({
            labels: ['triaged', 'coc:type:pbi'],
            body: 'Plain issue body with no hidden metadata.',
        });

        expect(parsed.metadata).toBeUndefined();
        expect(parsed.metadataBlocks).toEqual([]);
        expect(parsed.invalidMetadataBlocks).toBe(0);
        expect(parsed.type).toBe('pbi');
        expect(parsed.status).toBeUndefined();
        expect(parsed.tags).toEqual(['triaged']);
        expect(parsed.bodyWithoutMetadata).toBe('Plain issue body with no hidden metadata.');
    });

    it('cleans duplicate metadata blocks to exactly one while keeping prose', () => {
        const oldBlock = formatGitHubWorkItemSyncMetadataBlock({
            schemaVersion: 1,
            provider: 'github',
            remote: { owner: 'octo-org', repo: 'octo-repo', issueNumber: 1 },
            workItemId: 'old',
            type: 'epic',
            status: 'created',
            lastSyncedAt: '2026-01-01T00:00:00.000Z',
        });
        const bodyWithDuplicates = `Intro prose.\n\n${oldBlock}\n\nMiddle prose.\n\n${oldBlock}\n\nEnding prose.`;

        expect(parseGitHubWorkItemSyncMetadataBlocks(bodyWithDuplicates).metadataBlocks).toHaveLength(2);
        expect(stripGitHubWorkItemSyncMetadataBlocks(bodyWithDuplicates)).toContain('Intro prose.');
        expect(stripGitHubWorkItemSyncMetadataBlocks(bodyWithDuplicates)).toContain('Middle prose.');
        expect(stripGitHubWorkItemSyncMetadataBlocks(bodyWithDuplicates)).toContain('Ending prose.');

        const update = buildGitHubWorkItemIssueUpdate({
            workItem: BASE_WORK_ITEM,
            remote: REMOTE,
            lastSyncedAt: '2026-01-04T00:00:00.000Z',
            existingIssue: { body: bodyWithDuplicates },
        });

        expect(hasExactlyOneGitHubWorkItemSyncMetadataBlock(update.body)).toBe(true);
        expect(update.body).toContain('Intro prose.');
        expect(update.body).toContain('Middle prose.');
        expect(update.body).toContain('Ending prose.');
        expect(parseGitHubWorkItemSyncMetadataBlocks(update.body).metadata?.workItemId).toBe('wi-1');
    });

    it('reports unknown coc labels without preserving them as user tags', () => {
        const parsed = parseGitHubWorkItemIssue({
            labels: [
                'user-label',
                'coc:type:feature',
                'coc:status:not-real',
                'coc:priority:urgent',
                'coc:custom:value',
            ],
            body: '',
        });

        expect(parsed.type).toBe('feature');
        expect(parsed.status).toBeUndefined();
        expect(parsed.priority).toBeUndefined();
        expect(parsed.tags).toEqual(['user-label']);
        expect(parsed.unknownCocLabels).toEqual([
            'coc:status:not-real',
            'coc:priority:urgent',
            'coc:custom:value',
        ]);
    });

    it('does not include secrets, local paths, or arbitrary work item fields in metadata', () => {
        const workItemWithRuntimeState: WorkItem & { accessToken: string; localPath: string } = {
            ...BASE_WORK_ITEM,
            accessToken: 'secret-token',
            localPath: '/home/example/repo',
        };

        const update = buildGitHubWorkItemIssueUpdate({
            workItem: workItemWithRuntimeState,
            remote: REMOTE,
            lastSyncedAt: '2026-01-02T00:00:00.000Z',
        });

        const rawMetadata = JSON.stringify(parseGitHubWorkItemSyncMetadataBlocks(update.body).metadata);
        expect(rawMetadata).not.toContain('secret-token');
        expect(rawMetadata).not.toContain('/home/example/repo');
        expect(rawMetadata).not.toContain('accessToken');
        expect(rawMetadata).not.toContain('localPath');
    });
});
