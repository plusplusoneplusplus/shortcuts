import { describe, expect, it } from 'vitest';
import type { GitInfoResponse } from '@plusplusoneplusplus/coc-client';
import {
    describeGroupMember,
    groupBranchTile,
    groupChangesTile,
    groupSyncTile,
    repoBranchTile,
    repoChangesTile,
    repoSyncTile,
    summarizeWorkingTree,
    type GroupRailGitMember,
    type RailWorkingTreeSummary,
    type RepoRailGitInput,
} from '../../../../src/server/spa/client/react/features/repo-detail/railGitModel';

const info = (patch: Partial<GitInfoResponse> = {}): GitInfoResponse => ({
    branch: 'feature/search', dirty: true, ahead: 3, behind: 1, upstream: 'origin/feature/search',
    detached: false, isGitRepo: true, remoteUrl: null, ...patch,
});
const tree = (patch: Partial<RailWorkingTreeSummary> = {}): RailWorkingTreeSummary => ({
    paths: 0, staged: 0, modified: 0, untracked: 0, conflicts: [], operation: 'none', ...patch,
});
const ready = <T,>(data: T) => ({ data, readAt: 1, loading: false, failed: false });
const repo = (i?: GitInfoResponse, t?: RailWorkingTreeSummary, failed = false): RepoRailGitInput => ({
    info: i ? { ...ready(i), failed } : { loading: !failed, failed },
    tree: t ? { ...ready(t), failed } : { loading: !failed, failed },
});

describe('summarizeWorkingTree', () => {
    it('counts a path that is both staged and modified once', () => {
        const summary = summarizeWorkingTree({
            changes: [
                { filePath: 'a.ts', status: 'M', stage: 'staged', repositoryRoot: '', repositoryName: '' },
                { filePath: 'a.ts', status: 'M', stage: 'unstaged', repositoryRoot: '', repositoryName: '' },
                { filePath: 'b.ts', status: '?', stage: 'untracked', repositoryRoot: '', repositoryName: '' },
            ],
            repoState: { operation: 'none', conflictFiles: [] },
        });
        expect(summary).toMatchObject({ paths: 2, staged: 1, modified: 1, untracked: 1 });
    });

    it('adds untracked files hidden by the server cap and keeps conflicts', () => {
        const summary = summarizeWorkingTree({
            changes: [{ filePath: 'u1', status: '?', stage: 'untracked', repositoryRoot: '', repositoryName: '' }],
            repoState: { operation: 'merge', conflictFiles: ['x.ts', 'x.ts'] },
            untrackedTruncated: true,
            untrackedTotal: 40,
        });
        expect(summary).toMatchObject({ paths: 40, untracked: 40, conflicts: ['x.ts'], operation: 'merge' });
    });
});

describe('repository tiles', () => {
    it('never reports loading or failed reads as clean or 0/0', () => {
        expect(repoChangesTile(repo()).text).toBe('…');
        expect(repoSyncTile(repo()).text).toBe('↕…');
        const failed = repo(undefined, undefined, true);
        expect(repoChangesTile(failed)).toMatchObject({ text: '?', tone: 'muted' });
        expect(repoSyncTile(failed).text).toBe('↕?');
        expect(repoBranchTile(failed).text).toBe('Git ?');
    });

    it('prioritizes conflicts over changed paths and labels the operation', () => {
        const tile = repoChangesTile(repo(info(), tree({ paths: 4, conflicts: ['a', 'b'], operation: 'rebase' })));
        expect(tile).toMatchObject({ text: '!2', tone: 'conflict' });
        expect(tile.label).toContain('2 conflicted files, rebase in progress');
    });

    it('keeps working-tree cleanliness separate from divergence', () => {
        const input = repo(info({ ahead: 2, behind: 0 }), tree());
        expect(repoChangesTile(input)).toMatchObject({ text: '✓', tone: 'clean' });
        expect(repoSyncTile(input)).toMatchObject({ text: '↑2↓0', tone: 'changed' });
        expect(repoSyncTile(input).label).toBe('Sync status: 2 ahead, 0 behind origin/feature/search');
    });

    it('marks failed refreshes as last known', () => {
        const input = repo(info(), tree({ paths: 5 }), true);
        expect(repoChangesTile(input).label).toBe('Working changes: Last known: 5 changed paths');
        expect(repoBranchTile(input).label).toBe('Branch: last known feature/search');
    });

    it('distinguishes no upstream, detached HEAD and servers that do not report the base', () => {
        expect(repoSyncTile(repo(info({ upstream: null, ahead: 0, behind: 0 }), tree()))).toMatchObject({ text: '↕—', label: 'Sync status: no upstream configured' });
        const detached = repo(info({ detached: true, branch: 'HEAD', upstream: null }), tree());
        expect(repoSyncTile(detached).label).toContain('detached HEAD');
        expect(repoBranchTile(detached).text).toBe('Detached HEAD');
        const legacy = info({ ahead: 0, behind: 0 });
        delete legacy.upstream;
        expect(repoSyncTile(repo(legacy, tree())).text).toBe('↕?');
    });
});

describe('group tiles', () => {
    const member = (id: string, i: GitInfoResponse | null | undefined, stale = false): GroupRailGitMember => ({ id, name: id, stale, info: i });
    const group = (members: GroupRailGitMember[], failed = false) => ({ members, read: { data: {}, readAt: 1, loading: false, failed } });

    it('counts affected repositories and never names a group branch', () => {
        const input = group([
            member('harbor', info()),
            member('beacon', info({ dirty: false, ahead: 0, behind: 0, branch: 'main', upstream: 'origin/main' })),
            member('atlas', info({ branch: 'fix/parser', upstream: null, ahead: 0, behind: 0 })),
            member('gone', undefined, true),
        ]);
        expect(groupChangesTile(input)).toMatchObject({ text: 'R2', tone: 'changed' });
        expect(groupChangesTile(input).label).toContain('2 of 3 repositories changed');
        expect(groupSyncTile(input)).toMatchObject({ text: '↕1' });
        expect(groupSyncTile(input).label).toContain('1 without an upstream comparison');
        expect(groupBranchTile(input).text).toBe('3 repos');
        expect(groupBranchTile(input).label).toContain('each has its own branch');
    });

    it('does not claim clean when a member is unknown', () => {
        const input = group([member('a', info({ dirty: false })), member('b', null)]);
        expect(groupChangesTile(input)).toMatchObject({ text: 'R0', tone: 'muted' });
        expect(groupChangesTile(input).label).toContain('1 unknown');
        expect(groupChangesTile({ members: undefined, read: { loading: true, failed: false } }).text).toBe('…');
    });

    it('describes each member with its own branch and state', () => {
        expect(describeGroupMember(member('a', info()))).toEqual({
            branch: 'feature/search', changes: 'Uncommitted changes', sync: '↑3 ↓1 vs origin/feature/search',
        });
        expect(describeGroupMember(member('b', null)).changes).toBe('Git status unavailable');
        expect(describeGroupMember(member('c', undefined, true)).branch).toBe('Unavailable');
    });
});
