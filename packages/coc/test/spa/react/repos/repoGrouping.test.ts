/**
 * Tests for repoGrouping utility functions — groupKey and applyGroupOrder.
 */

import { describe, it, expect } from 'vitest';
import {
    groupKey,
    applyGroupOrder,
    groupReposByRemote,
    normalizeRemoteUrl,
    remoteUrlLabel,
} from '../../../../src/server/spa/client/react/repos/repoGrouping';
import type { RepoGroup, RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

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
