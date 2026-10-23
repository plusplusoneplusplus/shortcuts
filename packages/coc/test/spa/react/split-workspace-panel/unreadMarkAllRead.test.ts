import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { markGroupUnreadRead, markNativeUnreadRead } from '../../../../src/server/spa/client/react/features/chat/unreadMarkAllRead';

const patch = vi.hoisted(() => vi.fn());
const groupPage = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/seenStateApi', () => ({ patchSeenState: patch }));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({ getRepoGroupChats: groupPage }));
const completedAt = '2026-10-23T00:00:00.000Z';
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, workspaceId: 'same', type: 'chat', completedAt, ...extra });
const signal = () => new AbortController().signal;
const native = (history: ReturnType<typeof vi.fn>, baseUrl?: string) => ({
    client: { options: { baseUrl }, workspaces: { history } } as unknown as CocClient,
    workspaceId: 'same', tab: 'chats' as const, excluded: new Set<string>(), signal: signal(),
});
const group = (extra: Record<string, unknown> = {}) => ({
    groupId: 'group-a', membershipKey: 'members-a',
    sources: ['same', 'member'].map(workspaceId => ({ workspaceId, role: 'member', available: true })),
    counts: { unread: 2, partial: false }, running: [], queued: [], history: [], hasMore: false,
    ...extra,
});
const groupOptions = () => ({ groupId: 'group-a', baseUrl: 'https://owner.example', serverKey: 'owner', membershipKey: 'members-a', signal: signal() });
beforeEach(() => { vi.clearAllMocks(); patch.mockResolvedValue({}); });

describe('unread preview bulk read', () => {
    it.each([undefined, 'https://box-a.example', 'https://box-b.example'])('batches all native pages on the exact %s owner with the existing visibility rules', async baseUrl => {
        const history = vi.fn()
            .mockResolvedValueOnce({ history: [task('visible'), task('archived', { archived: true }), task('hidden', { mode: 'autopilot' })], hasMore: true })
            .mockResolvedValueOnce({ history: [task('not-loaded'), task('work-item', { workItemId: 'wi' }), task('task', { type: 'run-workflow' })], hasMore: false });
        await markNativeUnreadRead({ ...native(history, baseUrl), excluded: new Set(['autopilot']) });
        expect(history.mock.calls).toEqual([['same', { limit: 100, offset: 0 }], ['same', { limit: 100, offset: 3 }]]);
        expect(patch).toHaveBeenCalledTimes(1);
        expect(patch).toHaveBeenCalledWith('same', [
            { processId: 'visible', seenAt: completedAt }, { processId: 'not-loaded', seenAt: completedAt },
        ], { baseUrl });
    });

    it('does not mutate a truncated native list when a later page fails', async () => {
        const history = vi.fn().mockResolvedValueOnce({ history: [task('visible')], hasMore: true }).mockRejectedValueOnce(new Error('offline'));
        await expect(markNativeUnreadRead(native(history))).rejects.toThrow('offline');
        expect(patch).not.toHaveBeenCalled();
    });

    it('rejects native write failures and mismatched workspace owners', async () => {
        const history = vi.fn().mockResolvedValue({ history: [task('visible')], hasMore: false });
        patch.mockRejectedValueOnce(new Error('write failed'));
        await expect(markNativeUnreadRead(native(history))).rejects.toThrow('write failed');
        patch.mockClear();
        history.mockResolvedValue({ history: [task('wrong', { workspaceId: 'other' })], hasMore: false });
        await expect(markNativeUnreadRead(native(history))).rejects.toThrow('owner');
        expect(patch).not.toHaveBeenCalled();
    });

    it('revokes a pending native scan on scope change before dispatching writes', async () => {
        let resolve!: (page: unknown) => void;
        const history = vi.fn(() => new Promise(done => { resolve = done; }));
        const controller = new AbortController();
        const pending = markNativeUnreadRead({ ...native(history), signal: controller.signal });
        controller.abort();
        resolve({ history: [task('visible')], hasMore: false });
        await expect(pending).rejects.toThrow();
        expect(patch).not.toHaveBeenCalled();
    });

    it.each([undefined, 'https://box-a.example', 'https://box-b.example'])('paginates the full group unread scope on %s and batches equal chat ids separately by owner', async baseUrl => {
        groupPage.mockResolvedValueOnce(group({ history: [{ id: 'same-chat', ownerWorkspaceId: 'same', status: 'completed', endTime: completedAt }], hasMore: true, nextCursor: 'next' }))
            .mockResolvedValueOnce(group({ history: [{ id: 'same-chat', ownerWorkspaceId: 'member', status: 'failed', endTime: completedAt }] }));
        const options = { ...groupOptions(), baseUrl, serverKey: baseUrl ? 'owner' : 'local' };
        await markGroupUnreadRead(options);
        expect(groupPage).toHaveBeenNthCalledWith(2, 'group-a', { limit: 200, cursor: 'next' }, options.baseUrl, options.signal);
        expect(patch.mock.calls).toEqual(['same', 'member'].map(owner => [owner, [{ processId: 'same-chat', seenAt: completedAt }], { baseUrl: options.baseUrl }]));
    });

    it.each(['partial', 'membership', 'unavailable', 'incomplete'])('does not write when the paginated group scope is %s', async reason => {
        groupPage.mockResolvedValueOnce(group({ history: [{ id: 'a', ownerWorkspaceId: 'same', status: 'completed', endTime: completedAt }], hasMore: true, nextCursor: 'next' }))
            .mockResolvedValueOnce(group({
                ...(reason === 'partial' ? { counts: { unread: 2, partial: true } } : {}),
                ...(reason === 'membership' ? { membershipKey: 'members-b' } : {}),
                ...(reason === 'unavailable' ? { sources: [{ workspaceId: 'member', available: false }] } : {}),
            }));
        await expect(markGroupUnreadRead(groupOptions())).rejects.toThrow();
        expect(patch).not.toHaveBeenCalled();
    });

    it('refuses an unresolved remote owner and revokes a pending group scan before writes', async () => {
        await expect(markGroupUnreadRead({ ...groupOptions(), baseUrl: undefined })).rejects.toThrow('unavailable');
        expect(groupPage).not.toHaveBeenCalled();
        let resolve!: (page: unknown) => void;
        groupPage.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const controller = new AbortController();
        const pending = markGroupUnreadRead({ ...groupOptions(), signal: controller.signal });
        controller.abort();
        resolve(group());
        await expect(pending).rejects.toThrow();
        expect(patch).not.toHaveBeenCalled();
    });

    it('reports a failed owner batch after preserving successful owner writes', async () => {
        groupPage.mockResolvedValueOnce(group({ history: ['same', 'member'].map(ownerWorkspaceId => ({ id: 'chat', ownerWorkspaceId, status: 'completed', endTime: completedAt })) }));
        patch.mockImplementation(async owner => { if (owner === 'member') throw new Error('offline'); return {}; });
        await expect(markGroupUnreadRead(groupOptions())).rejects.toThrow('unread conversations remain');
        expect(patch).toHaveBeenCalledTimes(2);
    });
});
