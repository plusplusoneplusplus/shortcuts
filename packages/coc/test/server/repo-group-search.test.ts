import { describe, expect, it } from 'vitest';
import { groupSearchSummary, partitionGroupMembers } from '../../src/server/workspaces/repo-group-search';
import type { RepoGroupMember } from '../../src/server/workspaces/repo-group-workspace';

const member = (workspaceId: string, extra: Partial<RepoGroupMember> = {}): RepoGroupMember => ({
    workspaceId,
    stale: false,
    name: workspaceId.toUpperCase(),
    rootPath: `/repos/${workspaceId}`,
    readOnly: false,
    ...extra,
});

describe('partitionGroupMembers', () => {
    it('keeps membership indexes for live members and order for stale ones', () => {
        const members = [
            member('a', { stale: true, staleReason: 'path-missing' }),
            member('b'),
            member('c', { name: undefined, rootPath: undefined }),
            member('d'),
        ];
        const { live, stale } = partitionGroupMembers(members);
        expect(live.map(({ member: m, memberIndex }) => [m.workspaceId, memberIndex])).toEqual([['b', 1], ['d', 3]]);
        expect(stale.map(m => m.workspaceId)).toEqual(['a', 'c']);
    });
});

describe('groupSearchSummary', () => {
    it.each([
        [3, 0, 0, 'no-searchable-members', 0, 3],
        [0, 0, 0, 'no-searchable-members', 0, 0],
        [2, 2, 2, 'failed', 0, 0],
        [3, 2, 2, 'failed', 0, 1],
        [2, 2, 1, 'partial', 1, 0],
        [3, 2, 0, 'partial', 2, 1],
        [2, 2, 0, 'complete', 2, 0],
    ] as const)('members=%i searchable=%i failed=%i -> %s', (memberCount, searchable, failed, status, searched, unavailable) => {
        expect(groupSearchSummary(memberCount, searchable, failed)).toEqual({
            status,
            memberCount,
            searchableMemberCount: searchable,
            searchedMemberCount: searched,
            unavailableMemberCount: unavailable,
            failedMemberCount: failed,
        });
    });
});
