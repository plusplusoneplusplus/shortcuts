import { describe, expect, it } from 'vitest';
import { groupRepoGroupChatRows } from '../../../../src/server/spa/client/react/repos/repoGroupChatHierarchy';
import type { RepoGroupChatRow } from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';
function row(owner: string, id: string, item = {}): RepoGroupChatRow {
    return { key: `server|${owner}|${id}`, serverKey: 'server', ownerWorkspaceId: owner, ownerRole: 'member',
        canonicalId: id, section: 'history', item: { id, ...item } };
}
describe('owner-local chat hierarchy', () => {
    it.each([
        { ralph: { sessionId: 'same' } },
        { forEach: { runId: 'same' } },
        { mapReduce: { runId: 'same' } },
        { taskGroup: { groupType: 'custom', groupId: 'same' } },
    ])('keeps colliding group ids in separate owner containers', context => {
        const rows = [row('a', '1', context), row('b', '2', context), row('a', '3', context)];
        const groups = groupRepoGroupChatRows(rows);
        expect(groups).toHaveLength(2);
        expect(groups[0].rows.map(row => row.ownerWorkspaceId)).toEqual(['a', 'a']);
        expect(groups[1].rows.map(row => row.ownerWorkspaceId)).toEqual(['b']);
        expect(new Set(groups.flatMap(group => group.rows.map(row => row.key))).size).toBe(3);
    });
    it('nests only owner-local spawn links and flattens search with each result once', () => {
        const rows = [row('a', 'parent'), row('b', 'delegated', { parentProcessId: 'parent' }), row('a', 'child', { parentProcessId: 'parent' })];
        const groups = groupRepoGroupChatRows(rows);
        expect(groups[0].rows.map(row => row.canonicalId)).toEqual(['parent', 'child']);
        expect(groups[1].rows.map(row => row.canonicalId)).toEqual(['delegated']);
        expect(groupRepoGroupChatRows(rows, true).map(group => group.rows[0].key)).toEqual(rows.map(row => row.key));
    });
    it('keeps same-named folders owner-local and pinned or active members outside folder containers', () => {
        const rows = [
            row('a', '1', { folderId: 'same', folderName: 'Work' }),
            row('b', '2', { folderId: 'same', folderName: 'Work' }),
            row('a', 'pin', { folderId: 'same', pinnedAt: '2026-01-01' }),
        ];
        const groups = groupRepoGroupChatRows(rows, false, true);
        expect(groups).toHaveLength(3);
        expect(groups[0].key).not.toBe(groups[1].key);
        expect(groups[0].label).toBe('Folder / Work');
        expect(groups[2].label).toBe('');
    });
    it('keeps individual pins out of run and spawned-tree containers', () => {
        const rows = [
            row('a', 'pin', { pinnedAt: '2026-01-01', ralph: { sessionId: 'r' } }),
            row('a', 'child', { ralph: { sessionId: 'r' }, parentProcessId: 'pin' }),
        ];
        const groups = groupRepoGroupChatRows(rows);
        expect(groups[0]).toMatchObject({ key: rows[0].key, label: '' });
        expect(groups[0].rows).toHaveLength(1);
        expect(groups[1].rows).toHaveLength(1);
    });
});
