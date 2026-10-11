/**
 * Pure model for the repo-group aggregated chat list: identity, cross-section
 * dedupe, page appends and live-event relevance.
 */
import { describe, it, expect } from 'vitest';
import type { RepoGroupChatFeedResponse } from '@plusplusoneplusplus/coc-client';
import {
    allRepoGroupChatRows,
    appendRepoGroupChatFeedPage,
    buildRepoGroupChatFeedModel,
    canonicalChatId,
    isRepoGroupChatFeedMessage,
    repoGroupChatKey,
} from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';

const sources = [
    { workspaceId: 'grp', role: 'group' as const, name: 'Group', available: true },
    { workspaceId: 'ws-a', role: 'member' as const, name: 'alpha', available: true },
    { workspaceId: 'ws-b', role: 'member' as const, name: 'beta', available: true },
];

function page(overrides: Partial<RepoGroupChatFeedResponse> = {}): RepoGroupChatFeedResponse {
    return {
        groupId: 'grp',
        membershipKey: 'm1',
        sources,
        running: [],
        queued: [],
        history: [],
        hasMore: false,
        counts: { total: 0, running: 0, queued: 0, history: 0, byOwner: {}, partial: false },
        ...overrides,
    } as RepoGroupChatFeedResponse;
}

describe('canonicalChatId', () => {
    it('uses the queue task processId, else the queue_ alias of its id', () => {
        expect(canonicalChatId({ id: 't1', processId: 'p1' }, 'queued')).toBe('p1');
        expect(canonicalChatId({ id: 't1' }, 'running')).toBe('queue_t1');
        expect(canonicalChatId({ id: 'queue_t1' }, 'queued')).toBe('queue_t1');
        expect(canonicalChatId({ id: 'p9' }, 'history')).toBe('p9');
        expect(canonicalChatId({}, 'history')).toBeUndefined();
        expect(canonicalChatId(null, 'queued')).toBeUndefined();
    });
});

describe('buildRepoGroupChatFeedModel', () => {
    it('includes group-owned, delegated and unrelated member chats with owner identity', () => {
        const model = buildRepoGroupChatFeedModel(page({
            running: [{ id: 't-run', processId: 'p-run', ownerWorkspaceId: 'ws-a' }],
            queued: [{ id: 't-q', ownerWorkspaceId: 'ws-b', delegatedFrom: 'grp' }],
            history: [
                { id: 'p-grp', ownerWorkspaceId: 'grp' },
                { id: 'p-unrelated', ownerWorkspaceId: 'ws-b' },
            ],
        }), 'local');
        const rows = allRepoGroupChatRows(model);
        expect(rows.map(r => r.key)).toEqual([
            'local|ws-a|p-run',
            'local|ws-b|queue_t-q',
            'local|grp|p-grp',
            'local|ws-b|p-unrelated',
        ]);
        expect(rows.find(r => r.ownerWorkspaceId === 'grp')!.ownerRole).toBe('group');
        expect(rows[0]).toMatchObject({ ownerRole: 'member', ownerName: 'alpha', section: 'running', canonicalId: 'p-run' });
    });

    it('shows a chat once while it transitions queued → running → history', () => {
        const model = buildRepoGroupChatFeedModel(page({
            running: [{ id: 't1', processId: 'p1', ownerWorkspaceId: 'ws-a' }],
            queued: [{ id: 't2', processId: 'p1', ownerWorkspaceId: 'ws-a' }],
            history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }, { id: 'p2', ownerWorkspaceId: 'ws-a' }],
        }), 'local');
        expect(model.running.map(r => r.canonicalId)).toEqual(['p1']);
        expect(model.queued).toHaveLength(0);
        expect(model.history.map(r => r.canonicalId)).toEqual(['p2']);
    });

    it('keeps a queued follow-up of a finished chat as one queued row', () => {
        const model = buildRepoGroupChatFeedModel(page({
            queued: [{ id: 't-follow', processId: 'p-done', ownerWorkspaceId: 'ws-b' }],
            history: [{ id: 'p-done', ownerWorkspaceId: 'ws-b' }],
        }), 'local');
        expect(model.queued.map(r => r.key)).toEqual(['local|ws-b|p-done']);
        expect(model.history).toHaveLength(0);
    });

    it('never collapses equal ids or titles under different owners', () => {
        const model = buildRepoGroupChatFeedModel(page({
            history: [
                { id: 'same', title: 'Fix bug', ownerWorkspaceId: 'ws-a' },
                { id: 'same', title: 'Fix bug', ownerWorkspaceId: 'ws-b' },
                { id: 'same', title: 'Fix bug', ownerWorkspaceId: 'grp' },
            ],
        }), 'local');
        expect(model.history.map(r => r.key)).toEqual(['local|ws-a|same', 'local|ws-b|same', 'local|grp|same']);
    });

    it('qualifies identity by server so a remote group never collides with local ids', () => {
        const remote = buildRepoGroupChatFeedModel(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }), 'srv-2');
        const local = buildRepoGroupChatFeedModel(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }), 'local');
        expect(remote.history[0].key).not.toBe(local.history[0].key);
        expect(remote.history[0].key).toBe(repoGroupChatKey('srv-2', 'ws-a', 'p1'));
    });

    it('drops rows without an owner or id', () => {
        const model = buildRepoGroupChatFeedModel(page({
            history: [{ id: 'x' }, { ownerWorkspaceId: 'ws-a' }, { id: 'ok', ownerWorkspaceId: 'ws-a' }] as any,
        }), 'local');
        expect(model.history.map(r => r.canonicalId)).toEqual(['ok']);
    });
});

describe('appendRepoGroupChatFeedPage', () => {
    it('appends without duplicating rows already shown in any section', () => {
        const first = buildRepoGroupChatFeedModel(page({
            running: [{ id: 't1', processId: 'p-active', ownerWorkspaceId: 'ws-a' }],
            history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }],
            hasMore: true,
            nextCursor: 'c1',
        }), 'local');
        const next = appendRepoGroupChatFeedPage(first, page({
            history: [
                { id: 'p1', ownerWorkspaceId: 'ws-a' },
                { id: 'p-active', ownerWorkspaceId: 'ws-a' },
                { id: 'p1', ownerWorkspaceId: 'ws-b' },
                { id: 'p2', ownerWorkspaceId: 'grp' },
            ],
            hasMore: false,
            counts: { total: 5, running: 1, queued: 0, history: 4, byOwner: {}, partial: false },
        }));
        expect(next.history.map(r => r.key)).toEqual(['local|ws-a|p1', 'local|ws-b|p1', 'local|grp|p2']);
        expect(next.running).toBe(first.running);
        expect(next.hasMore).toBe(false);
        expect(next.nextCursor).toBeUndefined();
        expect(next.counts.total).toBe(5);
    });
});

describe('isRepoGroupChatFeedMessage', () => {
    const ids = new Set(['grp', 'ws-a']);
    const shown = new Set(['p-shown']);
    it('accepts lifecycle and queue events of source workspaces only', () => {
        expect(isRepoGroupChatFeedMessage({ type: 'process-added', process: { workspaceId: 'ws-a' } }, ids, shown)).toBe(true);
        expect(isRepoGroupChatFeedMessage({ type: 'process-updated', process: { workspaceId: 'grp' } }, ids, shown)).toBe(true);
        expect(isRepoGroupChatFeedMessage({ type: 'process-updated', process: { workspaceId: 'other' } }, ids, shown)).toBe(false);
        expect(isRepoGroupChatFeedMessage({ type: 'queue-updated', queue: { repoId: 'ws-a' } }, ids, shown)).toBe(true);
        expect(isRepoGroupChatFeedMessage({ type: 'queue-updated', queue: { repoId: 'other' } }, ids, shown)).toBe(false);
        expect(isRepoGroupChatFeedMessage({ type: 'process-removed', processId: 'p-shown' }, ids, shown)).toBe(true);
        expect(isRepoGroupChatFeedMessage({ type: 'process-removed', processId: 'p-other' }, ids, shown)).toBe(false);
        expect(isRepoGroupChatFeedMessage({ type: 'cron-updated' }, ids, shown)).toBe(false);
        expect(isRepoGroupChatFeedMessage(null, ids, shown)).toBe(false);
    });
});
