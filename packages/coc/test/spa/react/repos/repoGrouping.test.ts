/**
 * Tests for repoGrouping utility functions — groupKey and applyGroupOrder.
 */

import { describe, it, expect } from 'vitest';
import {
    groupKey,
    applyGroupOrder,
    groupReposByRemote,
    isRemoteRepo,
    normalizeRemoteUrl,
    remoteUrlLabel,
    sortClonesLocalFirst,
} from '../../../../src/server/spa/client/react/repos/repoGrouping';
import type { RepoGroup, RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

// ── Remote-repo fixtures (AC-04) ──────────────────────────────────────────────
// A remote checkout aggregated by AC-01 carries `baseUrl` + a `remote` marker on
// its workspace, plus `remoteUrl` (when the remote server reported one) so it can
// fold into the matching local group by normalized git URL.

function localRepo(id: string, remoteUrl: string): RepoData {
    return {
        workspace: { id, name: id, rootPath: `/local/${id}`, remoteUrl },
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true, remoteUrl },
    };
}

function remoteRepo(id: string, remoteUrl: string | undefined, serverLabel = 'devbox'): RepoData {
    return {
        workspace: {
            id,
            name: id,
            rootPath: `/remote/${id}`,
            remoteUrl,
            baseUrl: 'http://127.0.0.1:4000',
            remote: { baseUrl: 'http://127.0.0.1:4000', serverId: 'srv-1', serverLabel, offline: false },
        },
        gitInfo: remoteUrl
            ? { branch: 'main', dirty: false, isGitRepo: true, remoteUrl }
            : undefined,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGroup(normalizedUrl: string | null, repoIds: string[]): RepoGroup {
    return {
        normalizedUrl,
        label: normalizedUrl ?? repoIds[0] ?? 'unknown',
        repos: repoIds.map(id => ({ workspace: { id, name: id, rootPath: `/repos/${id}` } })),
        expanded: true,
    };
}

// ── groupKey ─────────────────────────────────────────────────────────────────

describe('groupKey', () => {
    it('returns normalizedUrl for grouped repos', () => {
        const g = makeGroup('github.com/user/repo', ['ws-1', 'ws-2']);
        expect(groupKey(g)).toBe('github.com/user/repo');
    });

    it('returns workspace:{id} for ungrouped repos (no normalizedUrl)', () => {
        const g = makeGroup(null, ['ws-abc']);
        expect(groupKey(g)).toBe('workspace:ws-abc');
    });

    it('returns workspace:unknown when ungrouped group has no repos', () => {
        const g: RepoGroup = { normalizedUrl: null, label: 'empty', repos: [], expanded: true };
        expect(groupKey(g)).toBe('workspace:unknown');
    });
});

// ── applyGroupOrder ───────────────────────────────────────────────────────────

describe('applyGroupOrder', () => {
    it('returns groups unchanged when order is empty', () => {
        const groups = [makeGroup('github.com/a', ['1']), makeGroup('github.com/b', ['2'])];
        expect(applyGroupOrder(groups, [])).toEqual(groups);
    });

    it('reorders two groups', () => {
        const gA = makeGroup('github.com/a', ['1']);
        const gB = makeGroup('github.com/b', ['2']);
        const result = applyGroupOrder([gA, gB], ['github.com/b', 'github.com/a']);
        expect(result[0]).toBe(gB);
        expect(result[1]).toBe(gA);
    });

    it('puts groups not in order array at the end', () => {
        const gA = makeGroup('github.com/a', ['1']);
        const gB = makeGroup('github.com/b', ['2']);
        const gC = makeGroup('github.com/c', ['3']);
        const result = applyGroupOrder([gA, gB, gC], ['github.com/c', 'github.com/a']);
        expect(groupKey(result[0])).toBe('github.com/c');
        expect(groupKey(result[1])).toBe('github.com/a');
        expect(groupKey(result[2])).toBe('github.com/b');
    });

    it('handles ungrouped repos with workspace: keys', () => {
        const gA = makeGroup(null, ['ws-1']);
        const gB = makeGroup(null, ['ws-2']);
        const result = applyGroupOrder([gA, gB], ['workspace:ws-2', 'workspace:ws-1']);
        expect(groupKey(result[0])).toBe('workspace:ws-2');
        expect(groupKey(result[1])).toBe('workspace:ws-1');
    });

    it('does not mutate the original groups array', () => {
        const gA = makeGroup('github.com/a', ['1']);
        const gB = makeGroup('github.com/b', ['2']);
        const original = [gA, gB];
        applyGroupOrder(original, ['github.com/b', 'github.com/a']);
        expect(original[0]).toBe(gA);
    });
});

// ── normalizeRemoteUrl ───────────────────────────────────────────────────────

describe('normalizeRemoteUrl', () => {
    it('normalizes GitHub SSH URL', () => {
        expect(normalizeRemoteUrl('git@github.com:user/repo.git')).toBe('github.com/user/repo');
    });

    it('normalizes GitHub HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo.git')).toBe('github.com/user/repo');
    });

    it('normalizes Azure DevOps HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://dev.azure.com/org/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps HTTPS URL with .git suffix', () => {
        expect(normalizeRemoteUrl('https://dev.azure.com/org/project/_git/repo.git'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps HTTPS URL with PAT auth', () => {
        expect(normalizeRemoteUrl('https://token@dev.azure.com/org/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps SSH URL', () => {
        expect(normalizeRemoteUrl('git@ssh.dev.azure.com:v3/org/project/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps SSH URL with .git suffix', () => {
        expect(normalizeRemoteUrl('git@ssh.dev.azure.com:v3/org/project/repo.git'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes old visualstudio.com HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://org.visualstudio.com/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes visualstudio.com with DefaultCollection', () => {
        expect(normalizeRemoteUrl('https://org.visualstudio.com/DefaultCollection/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('all Azure DevOps URL formats produce identical normalized output', () => {
        const expected = 'dev.azure.com/myorg/myproject/myrepo';
        const urls = [
            'https://dev.azure.com/myorg/myproject/_git/myrepo',
            'git@ssh.dev.azure.com:v3/myorg/myproject/myrepo',
            'https://myorg.visualstudio.com/myproject/_git/myrepo',
            'https://myorg.visualstudio.com/DefaultCollection/myproject/_git/myrepo',
            'https://pat@dev.azure.com/myorg/myproject/_git/myrepo',
        ];
        for (const url of urls) {
            expect(normalizeRemoteUrl(url)).toBe(expected);
        }
    });
});

// ── remoteUrlLabel ───────────────────────────────────────────────────────────

describe('remoteUrlLabel', () => {
    it('strips host from normalized GitHub URL', () => {
        expect(remoteUrlLabel('github.com/user/repo')).toBe('user/repo');
    });

    it('strips host from normalized Azure DevOps URL', () => {
        expect(remoteUrlLabel('dev.azure.com/org/project/repo')).toBe('org/project/repo');
    });

    it('returns as-is when fewer than 3 parts', () => {
        expect(remoteUrlLabel('repo')).toBe('repo');
    });
});

// ── groupReposByRemote (Azure DevOps) ────────────────────────────────────────

describe('groupReposByRemote with Azure DevOps URLs', () => {
    it('groups repos with different Azure DevOps URL formats together', () => {
        const repos: RepoData[] = [
            {
                workspace: { id: '1', name: 'repo-https', rootPath: '/r/1' },
                gitInfo: { branch: 'main', dirty: false, isGitRepo: true, remoteUrl: 'https://dev.azure.com/org/proj/_git/repo' },
            },
            {
                workspace: { id: '2', name: 'repo-ssh', rootPath: '/r/2' },
                gitInfo: { branch: 'main', dirty: false, isGitRepo: true, remoteUrl: 'git@ssh.dev.azure.com:v3/org/proj/repo' },
            },
            {
                workspace: { id: '3', name: 'repo-vs', rootPath: '/r/3' },
                gitInfo: { branch: 'main', dirty: false, isGitRepo: true, remoteUrl: 'https://org.visualstudio.com/proj/_git/repo' },
            },
        ];
        const groups = groupReposByRemote(repos, {});
        const azureGroups = groups.filter(g => g.normalizedUrl?.includes('dev.azure.com'));
        expect(azureGroups).toHaveLength(1);
        expect(azureGroups[0].repos).toHaveLength(3);
        expect(azureGroups[0].label).toBe('org/proj/repo');
    });

    it('creates a group for a single Azure DevOps repo using workspace.remoteUrl (Phase 1 — before gitInfo loads)', () => {
        // Simulates Phase 1: workspace registered with remoteUrl detected, gitInfo not yet loaded.
        const repos: RepoData[] = [
            {
                workspace: { id: 'ws-1', name: 'my-azure-repo', rootPath: '/r/1', remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo' },
                gitInfoLoading: true,
            },
        ];
        const groups = groupReposByRemote(repos, {});
        expect(groups).toHaveLength(1);
        expect(groups[0].normalizedUrl).toBe('dev.azure.com/myorg/myproject/myrepo');
        expect(groups[0].repos).toHaveLength(1);
        expect(groups[0].label).toBe('myorg/myproject/myrepo');
    });

    it('groups two Azure DevOps repos using workspace.remoteUrl without waiting for gitInfo', () => {
        const repos: RepoData[] = [
            {
                workspace: { id: 'ws-1', name: 'clone-https', rootPath: '/r/1', remoteUrl: 'https://dev.azure.com/org/proj/_git/repo' },
                gitInfoLoading: true,
            },
            {
                workspace: { id: 'ws-2', name: 'clone-ssh', rootPath: '/r/2', remoteUrl: 'git@ssh.dev.azure.com:v3/org/proj/repo' },
                gitInfoLoading: true,
            },
        ];
        const groups = groupReposByRemote(repos, {});
        expect(groups).toHaveLength(1);
        expect(groups[0].normalizedUrl).toBe('dev.azure.com/org/proj/repo');
        expect(groups[0].repos).toHaveLength(2);
    });

    it('falls back to workspace.remoteUrl when gitInfo is null (not-a-git-repo response)', () => {
        // Simulates Phase 2 result where branchStatus was null but remoteUrl was detected.
        const repos: RepoData[] = [
            {
                workspace: { id: 'ws-1', name: 'no-commits', rootPath: '/r/1', remoteUrl: 'https://dev.azure.com/org/proj/_git/repo' },
                gitInfo: { branch: null, dirty: false, isGitRepo: false, remoteUrl: null },
            },
        ];
        const groups = groupReposByRemote(repos, {});
        expect(groups).toHaveLength(1);
        // workspace.remoteUrl takes precedence over gitInfo.remoteUrl (null)
        expect(groups[0].normalizedUrl).toBe('dev.azure.com/org/proj/repo');
    });

    it('treats repos with empty normalized URL as ungrouped (defensive guard)', () => {
        // Edge case: if normalizeRemoteUrl somehow returns "", the repo should be ungrouped
        // rather than creating an invisible group with a falsy normalizedUrl.
        const repos: RepoData[] = [
            {
                workspace: { id: 'ws-bad', name: 'bad-url', rootPath: '/r/1' },
                // gitInfo.remoteUrl that normalizes to empty (whitespace-only)
                gitInfo: { branch: 'main', dirty: false, isGitRepo: true, remoteUrl: '   ' },
            },
            {
                workspace: { id: 'ws-ok', name: 'good-repo', rootPath: '/r/2', remoteUrl: 'https://dev.azure.com/org/proj/_git/repo' },
            },
        ];
        const groups = groupReposByRemote(repos, {});
        // ws-bad: remoteUrl normalizes to "" → treated as ungrouped
        // ws-ok: valid Azure DevOps URL → gets a group
        const azureGroup = groups.find(g => g.normalizedUrl?.includes('dev.azure.com'));
        expect(azureGroup).toBeDefined();
        const ungrouped = groups.find(g => g.normalizedUrl === null && g.repos[0].workspace.id === 'ws-bad');
        expect(ungrouped).toBeDefined();
    });
});

// ── isRemoteRepo (AC-04) ──────────────────────────────────────────────────────

describe('isRemoteRepo', () => {
    it('is true for an aggregated remote checkout (carries baseUrl + remote marker)', () => {
        expect(isRemoteRepo(remoteRepo('r1', 'https://github.com/acme/app.git'))).toBe(true);
    });

    it('is false for a local checkout', () => {
        expect(isRemoteRepo(localRepo('l1', 'https://github.com/acme/app.git'))).toBe(false);
    });

    it('is false when only baseUrl is present without a remote marker', () => {
        const repo: RepoData = { workspace: { id: 'x', name: 'x', rootPath: '/x', baseUrl: 'http://127.0.0.1:4000' } };
        expect(isRemoteRepo(repo)).toBe(false);
    });
});

// ── sortClonesLocalFirst (AC-04) ──────────────────────────────────────────────

describe('sortClonesLocalFirst', () => {
    const URL = 'https://github.com/acme/app.git';

    it('moves remote clones after local clones, preserving relative order', () => {
        const r1 = remoteRepo('r1', URL);
        const l1 = localRepo('l1', URL);
        const r2 = remoteRepo('r2', URL);
        const l2 = localRepo('l2', URL);
        const sorted = sortClonesLocalFirst([r1, l1, r2, l2]);
        expect(sorted.map(r => r.workspace.id)).toEqual(['l1', 'l2', 'r1', 'r2']);
    });

    it('returns the same array reference (no-op) when there are no remote clones', () => {
        const input = [localRepo('l1', URL), localRepo('l2', URL)];
        expect(sortClonesLocalFirst(input)).toBe(input);
    });

    it('leaves a remote-only list untouched in order', () => {
        const sorted = sortClonesLocalFirst([remoteRepo('r1', URL), remoteRepo('r2', URL)]);
        expect(sorted.map(r => r.workspace.id)).toEqual(['r1', 'r2']);
    });
});

// ── groupReposByRemote with remote checkouts (AC-04) ──────────────────────────

describe('groupReposByRemote with remote checkouts', () => {
    const URL = 'https://github.com/acme/app.git';
    const OTHER = 'https://github.com/acme/other.git';

    it('(a) folds a remote clone into the local group by normalized URL', () => {
        // Local + remote checkout of the SAME origin → one group, two clones.
        const groups = groupReposByRemote([localRepo('local', URL), remoteRepo('remote', URL)], {});
        const group = groups.find(g => g.normalizedUrl === 'github.com/acme/app');
        expect(group).toBeDefined();
        expect(group!.repos).toHaveLength(2);
        expect(group!.repos.map(r => r.workspace.id).sort()).toEqual(['local', 'remote']);
    });

    it('(b) surfaces a remote-only repo as its own group', () => {
        // Remote checkout whose origin has NO local counterpart → standalone group.
        const groups = groupReposByRemote([localRepo('local', URL), remoteRepo('remoteOnly', OTHER)], {});
        const otherGroup = groups.find(g => g.normalizedUrl === 'github.com/acme/other');
        expect(otherGroup).toBeDefined();
        expect(otherGroup!.repos).toHaveLength(1);
        expect(isRemoteRepo(otherGroup!.repos[0])).toBe(true);
    });

    it('(b) groups a remote-only repo that lacks gitInfo via its workspace.remoteUrl', () => {
        const groups = groupReposByRemote([remoteRepo('remoteOnly', OTHER)], {});
        expect(groups).toHaveLength(1);
        expect(groups[0].normalizedUrl).toBe('github.com/acme/other');
        expect(isRemoteRepo(groups[0].repos[0])).toBe(true);
    });

    it('(c) orders local clones before remote within a folded group (primary stays local)', () => {
        // Remote listed FIRST in the input must still land after the local clone,
        // so the i===0 PRIMARY marker points at a local checkout.
        const groups = groupReposByRemote([remoteRepo('remote', URL), localRepo('local', URL)], {});
        const group = groups.find(g => g.normalizedUrl === 'github.com/acme/app')!;
        expect(group.repos.map(r => r.workspace.id)).toEqual(['local', 'remote']);
        expect(isRemoteRepo(group.repos[0])).toBe(false); // primary = local
    });

    it('keeps multiple locals ahead of multiple remotes in a folded group', () => {
        const groups = groupReposByRemote(
            [remoteRepo('r1', URL), localRepo('l1', URL), remoteRepo('r2', URL), localRepo('l2', URL)],
            {},
        );
        const group = groups.find(g => g.normalizedUrl === 'github.com/acme/app')!;
        expect(group.repos.map(r => r.workspace.id)).toEqual(['l1', 'l2', 'r1', 'r2']);
    });
});
