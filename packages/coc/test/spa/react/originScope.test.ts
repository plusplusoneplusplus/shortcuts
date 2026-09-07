/**
 * The SPA origin adapters over `@plusplusoneplusplus/forge/git/origin-id`.
 *
 * Origin IDs are persisted storage keys, so the SPA and the server must agree
 * byte-for-byte. These tests pin that agreement plus the two behaviours the SPA
 * keeps for itself: the empty-workspace `local_` placeholder (forge throws
 * instead), and the unknown/known-no-remote distinction in the workspace loader.
 */
import { describe, it, expect } from 'vitest';
import { resolveCanonicalOriginId as forgeResolveCanonicalOriginId } from '@plusplusoneplusplus/forge/git/origin-id';
import {
    resolveCanonicalOriginId,
    resolveOriginScope,
    resolveRepoOriginScope,
    resolveWorkspaceRemoteUrl,
} from '../../../src/server/spa/client/react/repos/originScope';

describe('resolveCanonicalOriginId (SPA)', () => {
    it('produces the pinned canonical IDs', () => {
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl: 'git@github.com:Owner/Repo.git' }))
            .toBe('gh_owner_repo');
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl: 'https://github.com/owner/repo' }))
            .toBe('gh_owner_repo');
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo' }))
            .toBe('ado_myorg_myproject');
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl: 'https://myorg.visualstudio.com/myproject/_git/myrepo' }))
            .toBe('ado_myorg_myproject');
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl: 'https://github.com/my_org/my_repo' }))
            .toBe('gh_my_uorg_my_urepo');
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl: null }))
            .toBe('local_ws-1');
    });

    it('agrees with the forge resolver for every non-empty workspace', () => {
        for (const remoteUrl of [
            'git@github.com:owner/repo.git',
            'https://github.com/Owner/Repo/',
            'https://user:pass@github.com/owner/repo.git',
            'https://dev.azure.com/myorg/myproject/_git/myrepo',
            'git@ssh.dev.azure.com:v3/myorg/myproject/myrepo',
            'https://gitlab.com/group/project.git',
            'ssh://git@internal.example.com:2222/deep/nested/repo.git',
            'https://github.com/owner/café',
            null,
        ]) {
            expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl }))
                .toBe(forgeResolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl }));
        }
    });

    it('keeps the local_ placeholder where forge throws, so a render cannot crash', () => {
        expect(() => forgeResolveCanonicalOriginId({ workspaceId: '' })).toThrow();
        expect(resolveCanonicalOriginId({ workspaceId: '' })).toBe('local_');
        expect(resolveCanonicalOriginId({ workspaceId: '   ' })).toBe('local_');
        expect(resolveCanonicalOriginId({ workspaceId: '', remoteUrl: null })).toBe('local_');
    });

    it('still resolves a real origin when only the workspace id is empty', () => {
        expect(resolveCanonicalOriginId({ workspaceId: '', remoteUrl: 'https://github.com/owner/repo' }))
            .toBe('gh_owner_repo');
    });
});

describe('resolveOriginScope / resolveRepoOriginScope', () => {
    it('carries the untrimmed workspace id alongside the origin id', () => {
        expect(resolveOriginScope({ workspaceId: 'ws-1', remoteUrl: 'https://github.com/owner/repo' }))
            .toEqual({ originId: 'gh_owner_repo', workspaceId: 'ws-1' });
    });

    it('prefers gitInfo.remoteUrl over the workspace remote', () => {
        const scope = resolveRepoOriginScope({
            workspace: { id: 'ws-1', remoteUrl: 'https://github.com/owner/stale' },
            gitInfo: { remoteUrl: 'https://github.com/owner/repo' },
        } as never);
        expect(scope).toEqual({ originId: 'gh_owner_repo', workspaceId: 'ws-1' });
    });

    it('falls back to the workspace remote, then to a local origin', () => {
        expect(resolveRepoOriginScope({ workspace: { id: 'ws-1', remoteUrl: 'https://github.com/owner/repo' } } as never))
            .toEqual({ originId: 'gh_owner_repo', workspaceId: 'ws-1' });
        expect(resolveRepoOriginScope({ workspace: { id: 'ws-1' } } as never))
            .toEqual({ originId: 'local_ws-1', workspaceId: 'ws-1' });
    });

    it('does not throw for a repo with no workspace id at all', () => {
        expect(resolveRepoOriginScope({} as never)).toEqual({ originId: 'local_', workspaceId: '' });
    });
});

describe('resolveWorkspaceRemoteUrl', () => {
    const workspaces = [
        { id: 'ws-1', remoteUrl: 'https://github.com/owner/repo' },
        { id: 'ws-2' },
    ];

    it('returns undefined while the workspace list is unknown', () => {
        expect(resolveWorkspaceRemoteUrl(undefined, 'ws-1')).toBeUndefined();
        expect(resolveWorkspaceRemoteUrl([], 'ws-1')).toBeUndefined();
        expect(resolveWorkspaceRemoteUrl(workspaces, undefined)).toBeUndefined();
        expect(resolveWorkspaceRemoteUrl(workspaces, 'ws-missing')).toBeUndefined();
    });

    it('returns null for a loaded workspace that genuinely has no remote', () => {
        expect(resolveWorkspaceRemoteUrl(workspaces, 'ws-2')).toBeNull();
    });

    it('returns the remote URL when it is known', () => {
        expect(resolveWorkspaceRemoteUrl(workspaces, 'ws-1')).toBe('https://github.com/owner/repo');
    });
});
