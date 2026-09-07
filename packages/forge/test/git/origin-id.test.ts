/**
 * Canonical origin identity — the single implementation shared by the server
 * and the SPA.
 *
 * Origin IDs are persisted as storage keys, so every expectation here is a
 * literal pinned value (or an independently computed Node-crypto hash), never a
 * comparison of two wrappers over the same function.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
    resolveCanonicalOrigin,
    resolveCanonicalOriginId,
    normalizeRemoteUrlForHash,
} from '../../src/git/origin-id';
import { normalizeRemoteUrl as normalizeForGrouping } from '../../src/git/normalize-url';

/** Independent expectation for the `git_` fallback, using Node's own SHA-256. */
function expectedGitId(remoteUrl: string): string {
    const normalized = normalizeForGrouping(remoteUrl)
        .trim()
        .toLowerCase() || normalizeRemoteUrlForHash(remoteUrl);
    return `git_${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

describe('resolveCanonicalOriginId — GitHub', () => {
    it('gives the same id to SSH and HTTPS clones of one repo', () => {
        const expected = 'gh_owner_repo';
        for (const remoteUrl of [
            'git@github.com:owner/repo.git',
            'https://github.com/owner/repo.git',
            'https://github.com/owner/repo',
            'ssh://git@github.com/owner/repo',
            'https://github.com/Owner/Repo.git/',
            'https://token@github.com/owner/repo.git',
            'https://user:pass@github.com/owner/repo.git',
        ]) {
            expect(resolveCanonicalOriginId({ remoteUrl, workspaceId: 'ws-1' })).toBe(expected);
        }
    });

    it('keeps distinct repositories and owners apart', () => {
        const ids = [
            'https://github.com/owner/repo',
            'https://github.com/owner/other',
            'https://github.com/other/repo',
        ].map(remoteUrl => resolveCanonicalOriginId({ remoteUrl, workspaceId: 'ws-1' }));
        expect(ids).toEqual(['gh_owner_repo', 'gh_owner_other', 'gh_other_repo']);
        expect(new Set(ids).size).toBe(3);
    });

    it('is independent of the workspace it was resolved from', () => {
        const remoteUrl = 'https://github.com/owner/repo.git';
        expect(resolveCanonicalOriginId({ remoteUrl, workspaceId: 'ws-1' }))
            .toBe(resolveCanonicalOriginId({ remoteUrl, workspaceId: 'ws-2' }));
    });
});

describe('resolveCanonicalOriginId — Azure DevOps', () => {
    it('gives the same org/project id to every ADO URL alias', () => {
        const expected = 'ado_myorg_myproject';
        for (const remoteUrl of [
            'https://dev.azure.com/myorg/myproject/_git/myrepo',
            'https://myorg@dev.azure.com/myorg/myproject/_git/myrepo',
            'git@ssh.dev.azure.com:v3/myorg/myproject/myrepo',
            'https://myorg.visualstudio.com/myproject/_git/myrepo',
        ]) {
            expect(resolveCanonicalOriginId({ remoteUrl, workspaceId: 'ws-1' })).toBe(expected);
        }
    });

    it('scopes identity to org and project, not to the repo', () => {
        expect(resolveCanonicalOriginId({
            remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/repo-a',
            workspaceId: 'ws-1',
        })).toBe(resolveCanonicalOriginId({
            remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/repo-b',
            workspaceId: 'ws-1',
        }));
    });

    it('isolates different projects and different organizations', () => {
        const ids = [
            'https://dev.azure.com/myorg/projecta/_git/repo',
            'https://dev.azure.com/myorg/projectb/_git/repo',
            'https://dev.azure.com/otherorg/projecta/_git/repo',
        ].map(remoteUrl => resolveCanonicalOriginId({ remoteUrl, workspaceId: 'ws-1' }));
        expect(ids).toEqual(['ado_myorg_projecta', 'ado_myorg_projectb', 'ado_otherorg_projecta']);
        expect(new Set(ids).size).toBe(3);
    });
});

describe('resolveCanonicalOriginId — other remotes', () => {
    it('hashes unknown providers to a 16-hex-char git_ id matching Node crypto', () => {
        for (const remoteUrl of [
            'https://gitlab.com/group/project.git',
            'https://bitbucket.org/team/repo',
            'ssh://git@internal.example.com:2222/deep/nested/repo.git',
            'git@git.example.com:team/project.git',
        ]) {
            const id = resolveCanonicalOriginId({ remoteUrl, workspaceId: 'ws-1' });
            expect(id).toMatch(/^git_[0-9a-f]{16}$/);
            expect(id).toBe(expectedGitId(remoteUrl));
        }
    });

    it('ignores credentials and .git suffixes when hashing', () => {
        const base = resolveCanonicalOriginId({ remoteUrl: 'https://gitlab.com/group/project', workspaceId: 'ws-1' });
        for (const remoteUrl of [
            'https://gitlab.com/group/project.git',
            'https://gitlab.com/group/project/',
            'https://user:pass@gitlab.com/group/project.git',
            'https://GitLab.com/Group/Project.git',
        ]) {
            expect(resolveCanonicalOriginId({ remoteUrl, workspaceId: 'ws-1' })).toBe(base);
        }
    });

    it('keeps distinct unknown-provider repos apart', () => {
        const a = resolveCanonicalOriginId({ remoteUrl: 'https://gitlab.com/group/a', workspaceId: 'ws-1' });
        const b = resolveCanonicalOriginId({ remoteUrl: 'https://gitlab.com/group/b', workspaceId: 'ws-1' });
        expect(a).not.toBe(b);
    });
});

describe('resolveCanonicalOriginId — segment encoding', () => {
    it('escapes literal underscores so they cannot forge a separator', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/my_org/my_repo', workspaceId: 'ws-1' }))
            .toBe('gh_my_uorg_my_urepo');
    });

    it('keeps `a_b`/`c` distinct from `a`/`b_c`', () => {
        const left = resolveCanonicalOriginId({ remoteUrl: 'https://github.com/a_b/c', workspaceId: 'ws-1' });
        const right = resolveCanonicalOriginId({ remoteUrl: 'https://github.com/a/b_c', workspaceId: 'ws-1' });
        expect(left).toBe('gh_a_ub_c');
        expect(right).toBe('gh_a_b_uc');
        expect(left).not.toBe(right);
    });

    it('percent-encodes non-ASCII segments as UTF-8 bytes', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/owner/café', workspaceId: 'ws-1' }))
            .toBe('gh_owner_caf_xc3_xa9');
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/owner/日本', workspaceId: 'ws-1' }))
            .toBe('gh_owner__xe6_x97_xa5_xe6_x9c_xac');
    });

    it('decodes percent-escaped segments before encoding', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/owner/caf%C3%A9', workspaceId: 'ws-1' }))
            .toBe('gh_owner_caf_xc3_xa9');
    });

    it('tolerates malformed percent sequences by using them literally', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/owner/re%zzpo', workspaceId: 'ws-1' }))
            .toBe('gh_owner_re_x25zzpo');
    });

    it('lowercases and preserves dots and dashes', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/My-Org/My.Repo', workspaceId: 'ws-1' }))
            .toBe('gh_my-org_my.repo');
    });
});

describe('resolveCanonicalOriginId — local origins', () => {
    it('scopes a remote-less workspace to its id', () => {
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1' })).toBe('local_ws-1');
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl: null })).toBe('local_ws-1');
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1', remoteUrl: '   ' })).toBe('local_ws-1');
    });

    it('keeps separate local workspaces separate', () => {
        expect(resolveCanonicalOriginId({ workspaceId: 'ws-1' }))
            .not.toBe(resolveCanonicalOriginId({ workspaceId: 'ws-2' }));
    });

    it('escapes underscores in the workspace id', () => {
        expect(resolveCanonicalOriginId({ workspaceId: 'my_ws' })).toBe('local_my_uws');
    });

    it('throws when there is neither a remote nor a workspace id', () => {
        expect(() => resolveCanonicalOriginId({})).toThrow(/workspaceId is required/);
        expect(() => resolveCanonicalOriginId({ workspaceId: '   ' })).toThrow(/workspaceId is required/);
        expect(() => resolveCanonicalOriginId({ workspaceId: null, remoteUrl: null })).toThrow(/workspaceId is required/);
    });
});

describe('resolveCanonicalOrigin — identity metadata', () => {
    it('returns synchronously, not a promise', () => {
        expect(resolveCanonicalOrigin({ workspaceId: 'ws-1' })).not.toBeInstanceOf(Promise);
    });

    it('describes a GitHub origin', () => {
        expect(resolveCanonicalOrigin({ remoteUrl: 'git@github.com:Owner/Repo.git', workspaceId: 'ws-1' })).toEqual({
            originId: 'gh_owner_repo',
            provider: 'github',
            remoteUrl: 'git@github.com:Owner/Repo.git',
            normalizedRemoteUrl: 'github.com/owner/repo',
            workspaceId: 'ws-1',
            owner: 'owner',
            repo: 'repo',
        });
    });

    it('describes an Azure DevOps origin, including the repo segment', () => {
        expect(resolveCanonicalOrigin({
            remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
            workspaceId: 'ws-1',
        })).toEqual({
            originId: 'ado_myorg_myproject',
            provider: 'azure-devops',
            remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
            normalizedRemoteUrl: 'dev.azure.com/myorg/myproject/myrepo',
            workspaceId: 'ws-1',
            org: 'myorg',
            project: 'myproject',
            repo: 'myrepo',
        });
    });

    it('describes an unknown-provider origin with its remote hash', () => {
        const identity = resolveCanonicalOrigin({ remoteUrl: 'https://gitlab.com/group/project.git' });
        expect(identity.provider).toBe('git');
        expect(identity.originId).toBe(`git_${identity.remoteHash}`);
        expect(identity.remoteHash).toMatch(/^[0-9a-f]{16}$/);
        expect(identity.normalizedRemoteUrl).toBe('gitlab.com/group/project');
        expect(identity).not.toHaveProperty('workspaceId');
    });

    it('describes a local origin', () => {
        expect(resolveCanonicalOrigin({ workspaceId: ' ws-1 ' })).toEqual({
            originId: 'local_ws-1',
            provider: 'local',
            remoteUrl: null,
            normalizedRemoteUrl: null,
            workspaceId: 'ws-1',
        });
    });

    it('omits workspaceId when none was supplied for a remote origin', () => {
        const identity = resolveCanonicalOrigin({ remoteUrl: 'https://github.com/owner/repo' });
        expect(identity.originId).toBe('gh_owner_repo');
        expect(identity).not.toHaveProperty('workspaceId');
    });
});

describe('normalizeRemoteUrlForHash', () => {
    it('preserves protocol while stripping credentials, .git and trailing slashes', () => {
        expect(normalizeRemoteUrlForHash('HTTPS://user:pass@GitHub.com/Owner/Repo.git/'))
            .toBe('https://github.com/owner/repo');
        expect(normalizeRemoteUrlForHash('git@github.com:owner/repo.git'))
            .toBe('git@github.com:owner/repo');
    });
});
