/**
 * gitRoute — the single parser/builder for `#repos/{wsId}/git…` URLs.
 *
 * A repo group's Git tab hosts one member repository, so its routes have to
 * carry BOTH ids: the group owns the page, the member owns the data. These
 * tests pin the round trip in both directions, the encoding rules, and the two
 * ways a group route can be incomplete (no member at all, or a dangling
 * `member` marker) — neither of which may be mistaken for a commit SHA.
 */
import { describe, expect, it } from 'vitest';
import {
    GIT_ROUTE_MEMBER_MARKER,
    buildGitRouteHash,
    buildGitRouteSuffix,
    isSameGitRouteScope,
    parseGitRoute,
    type GitRouteDescriptor,
} from '../../../../src/server/spa/client/react/layout/gitRoute';

const GROUP = 'group-frontend';

function roundTrip(descriptor: GitRouteDescriptor): GitRouteDescriptor | null {
    return parseGitRoute(buildGitRouteHash(descriptor));
}

describe('parseGitRoute — single repo', () => {
    it('returns null for anything that is not a Git route', () => {
        expect(parseGitRoute('#repos/ws1/chats')).toBeNull();
        expect(parseGitRoute('#repos/ws1')).toBeNull();
        expect(parseGitRoute('#wiki/w1')).toBeNull();
        expect(parseGitRoute('')).toBeNull();
    });

    it('reads plain history, a commit, and a commit file', () => {
        expect(parseGitRoute('#repos/ws1/git')).toEqual({
            routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: null, filePath: null,
        });
        expect(parseGitRoute('#repos/ws1/git/abc1234')).toEqual({
            routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'abc1234', filePath: null,
        });
        expect(parseGitRoute('#repos/ws1/git/abc1234/src%2Findex.ts')).toEqual({
            routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'abc1234', filePath: 'src/index.ts',
        });
    });

    it('reads the branch range and one of its files', () => {
        expect(parseGitRoute('#repos/ws1/git/branch-range')?.commitHash).toBe('branch-range');
        expect(parseGitRoute('#repos/ws1/git/branch-range/src%2Fa%20b.ts')).toEqual({
            routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'branch-range', filePath: 'src/a b.ts',
        });
    });

    it('treats `member` as an ordinary ref for a plain repo', () => {
        expect(parseGitRoute('#repos/ws1/git/member/repo-b')).toEqual({
            routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'member', filePath: 'repo-b',
        });
    });

    it('ignores query metadata when reading the path', () => {
        expect(parseGitRoute('#repos/ws1/git/abc1234?panel=diff')).toEqual({
            routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'abc1234', filePath: null,
        });
    });
});

describe('parseGitRoute — repo group', () => {
    it('reads the member, the commit and the file', () => {
        expect(parseGitRoute(`#repos/${GROUP}/git/member/repo-b/abc1234/src%2Findex.ts`)).toEqual({
            routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: 'abc1234', filePath: 'src/index.ts',
        });
    });

    it('reads a member with no selection as that member’s history', () => {
        expect(parseGitRoute(`#repos/${GROUP}/git/member/repo-b`)).toEqual({
            routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: null, filePath: null,
        });
    });

    it('never reads the member marker or a member id as a commit', () => {
        // Dangling marker: incomplete link, not a commit called "member".
        expect(parseGitRoute(`#repos/${GROUP}/git/member`)).toEqual({
            routeWorkspaceId: GROUP, workspaceId: null, commitHash: null, filePath: null,
        });
        expect(parseGitRoute(`#repos/${GROUP}/git/member/repo-b`)?.commitHash).toBeNull();
        expect(GIT_ROUTE_MEMBER_MARKER).toBe('member');
    });

    it('leaves the member unresolved for a bare entry and for an older SHA link', () => {
        expect(parseGitRoute(`#repos/${GROUP}/git`)).toEqual({
            routeWorkspaceId: GROUP, workspaceId: null, commitHash: null, filePath: null,
        });
        expect(parseGitRoute(`#repos/${GROUP}/git/abc1234/src.ts`)).toEqual({
            routeWorkspaceId: GROUP, workspaceId: null, commitHash: 'abc1234', filePath: 'src.ts',
        });
    });

    it('decodes a member id that needs escaping', () => {
        expect(parseGitRoute(`#repos/${GROUP}/git/member/repo%2Fb/abc`)).toEqual({
            routeWorkspaceId: GROUP, workspaceId: 'repo/b', commitHash: 'abc', filePath: null,
        });
    });
});

describe('buildGitRouteHash', () => {
    it('omits the member segment for a plain repo', () => {
        expect(buildGitRouteHash({
            routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'abc', filePath: null,
        })).toBe('#repos/ws1/git/abc');
    });

    it('serializes the member for a group', () => {
        expect(buildGitRouteHash({
            routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: 'abc', filePath: 'src/a.ts',
        })).toBe(`#repos/${GROUP}/git/member/repo-b/abc/src%2Fa.ts`);
    });

    it('drops the file when there is no revision to hang it on', () => {
        expect(buildGitRouteSuffix({
            routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: null, filePath: 'src/a.ts',
        })).toBe('/git/member/repo-b');
    });

    it('falls back to a bare group entry when the member is unknown', () => {
        expect(buildGitRouteHash({
            routeWorkspaceId: GROUP, workspaceId: null, commitHash: null, filePath: null,
        })).toBe(`#repos/${GROUP}/git`);
    });

    it('encodes the member id and the file path per segment', () => {
        expect(buildGitRouteHash({
            routeWorkspaceId: GROUP, workspaceId: 'repo/b', commitHash: 'abc', filePath: 'src/a b.ts',
        })).toBe(`#repos/${GROUP}/git/member/repo%2Fb/abc/src%2Fa%20b.ts`);
    });
});

describe('round trips', () => {
    const cases: GitRouteDescriptor[] = [
        { routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: null, filePath: null },
        { routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'abc1234', filePath: null },
        { routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'abc1234', filePath: 'src/a b.ts' },
        { routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'branch-range', filePath: null },
        { routeWorkspaceId: 'ws1', workspaceId: 'ws1', commitHash: 'branch-range', filePath: 'src/a.ts' },
        { routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: null, filePath: null },
        { routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: 'abc1234', filePath: null },
        { routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: 'abc1234', filePath: 'src/a b.ts' },
        { routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: 'branch-range', filePath: null },
        { routeWorkspaceId: GROUP, workspaceId: 'repo-b', commitHash: 'branch-range', filePath: 'a/b.ts' },
        { routeWorkspaceId: GROUP, workspaceId: null, commitHash: null, filePath: null },
        { routeWorkspaceId: GROUP, workspaceId: 'repo/b', commitHash: 'abc', filePath: 'x/y z.ts' },
    ];

    for (const descriptor of cases) {
        it(`round-trips ${buildGitRouteHash(descriptor)}`, () => {
            expect(roundTrip(descriptor)).toEqual(descriptor);
        });
    }
});

describe('isSameGitRouteScope', () => {
    it('needs both the page owner and the data member to agree', () => {
        expect(isSameGitRouteScope(
            { routeWorkspaceId: GROUP, workspaceId: 'repo-b' },
            { routeWorkspaceId: GROUP, workspaceId: 'repo-b' },
        )).toBe(true);
        expect(isSameGitRouteScope(
            { routeWorkspaceId: GROUP, workspaceId: 'repo-b' },
            { routeWorkspaceId: GROUP, workspaceId: 'repo-a' },
        )).toBe(false);
        expect(isSameGitRouteScope(
            { routeWorkspaceId: GROUP, workspaceId: 'repo-b' },
            { routeWorkspaceId: 'repo-b', workspaceId: 'repo-b' },
        )).toBe(false);
        expect(isSameGitRouteScope(null, { routeWorkspaceId: GROUP, workspaceId: 'repo-b' })).toBe(false);
    });
});
