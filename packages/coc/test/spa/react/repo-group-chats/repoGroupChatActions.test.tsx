/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCocClientFor, resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import { applyRepoGroupChatAction, applyRepoGroupQueueControl } from '../../../../src/server/spa/client/react/repos/repoGroupChatActions';
import type { RepoGroupChatAction } from '../../../../src/server/spa/client/react/repos/repoGroupChatActions';
import type { RepoGroupChatRow } from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';

const sources = ['ws-a', 'ws-b'].map(workspaceId => ({ workspaceId, role: 'member' as const, available: true }));
function row(owner: string, action: RepoGroupChatAction): RepoGroupChatRow {
    return { key: `server|${owner}|same`, serverKey: 'server', ownerWorkspaceId: owner, ownerRole: 'member', canonicalId: 'same',
        section: action === 'cancel' ? 'running' : 'history',
        item: { id: 'same', pinnedAt: action === 'unpin' ? '2026-01-01' : undefined, archived: action === 'unarchive' } };
}
afterEach(() => { vi.restoreAllMocks(); resetSpaCocClientForTests(); });
describe('concrete owner actions', () => {
    it.each(['pin', 'unpin', 'archive', 'unarchive', 'delete', 'cancel'] as const)('routes %s separately for colliding ids and retains partial failures', async action => {
        const client = getCocClientFor('https://owner.test');
        const request = vi.spyOn(client, 'request').mockImplementation(async (_path, options) => {
            if (options?.query?.workspace === 'ws-b') throw new Error('Owner B denied');
            return {} as never;
        });
        const remove = vi.spyOn(client.processes, 'delete').mockImplementation(async (_id, query) => {
            if (query?.workspace === 'ws-b') throw new Error('Owner B denied');
        });
        const cancel = vi.spyOn(client.processes, 'cancel').mockImplementation(async (_id, query) => {
            if (query?.workspace === 'ws-b') throw new Error('Owner B denied');
            return {} as never;
        });
        const result = await applyRepoGroupChatAction([row('ws-a', action), row('ws-b', action)], action, sources, 'https://owner.test');
        expect(result.succeeded).toEqual(['server|ws-a|same']);
        expect(result.failed).toEqual([{ key: 'server|ws-b|same', ownerWorkspaceId: 'ws-b', error: 'Owner B denied' }]);
        const owners = action === 'delete' ? remove.mock.calls.map(call => call[1]?.workspace)
            : action === 'cancel' ? cancel.mock.calls.map(call => call[1]?.workspace)
            : request.mock.calls.map(call => call[1]?.query?.workspace);
        expect(owners).toEqual(['ws-a', 'ws-b']);
        expect(request.mock.calls.every(call => !String(call[0]).includes('group-ai'))).toBe(true);
    });

    it('never calls local APIs for unresolved remote or stale owners', async () => {
        const local = vi.spyOn(getCocClientFor(), 'request');
        const unavailable = await applyRepoGroupChatAction([row('ws-a', 'delete')], 'delete', sources);
        expect(unavailable.failed).toHaveLength(1);
        const stale = await applyRepoGroupChatAction([row('ws-a', 'cancel')], 'cancel', [{ ...sources[0], stale: true }], 'https://owner.test');
        expect(stale.failed).toHaveLength(1);
        expect(local).not.toHaveBeenCalled();
    });

    it.each(['pause', 'resume', 'delay'] as const)('targets exactly one owner queue for %s', async action => {
        const queue = getCocClientFor('https://owner.test').queue;
        const pause = vi.spyOn(queue, 'pause').mockResolvedValue({} as never);
        const resume = vi.spyOn(queue, 'resume').mockResolvedValue({} as never);
        const delay = vi.spyOn(queue, 'setTaskDelay').mockResolvedValue({} as never);
        await applyRepoGroupQueueControl(sources[1], action, 'server', 'https://owner.test', 1);
        if (action === 'delay') expect(delay).toHaveBeenCalledWith({ scope: 'all', delayMinutes: 1 }, { workspace: 'ws-b' });
        else expect(action === 'pause' ? pause : resume).toHaveBeenCalledWith({ workspace: 'ws-b' });
    });
});
