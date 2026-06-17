import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    normalizeRemoteUrl,
    computeRemoteHash,
    detectRemoteUrl,
    resolveCanonicalOrigin,
    resolveCanonicalOriginId,
} from '../../src/git/remote';
import { execGitAsync } from '../../src/git/exec';

vi.mock('../../src/git/exec', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/git/exec')>();
    return {
        ...actual,
        execGitAsync: vi.fn(),
    };
});

const mockedExecGitAsync = execGitAsync as unknown as ReturnType<typeof vi.fn>;

describe('normalizeRemoteUrl', () => {
    it('lowercases the URL', () => {
        expect(normalizeRemoteUrl('HTTPS://GITHUB.COM/Owner/Repo')).toBe('https://github.com/owner/repo');
    });

    it('strips trailing .git', () => {
        expect(normalizeRemoteUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
    });

    it('strips trailing slash', () => {
        expect(normalizeRemoteUrl('https://github.com/owner/repo/')).toBe('https://github.com/owner/repo');
    });

    it('strips auth credentials from https URL', () => {
        expect(normalizeRemoteUrl('https://user:pass@github.com/owner/repo')).toBe('https://github.com/owner/repo');
    });

    it('strips auth username-only from https URL', () => {
        expect(normalizeRemoteUrl('https://token@github.com/owner/repo')).toBe('https://github.com/owner/repo');
    });

    it('handles .git + trailing slash together', () => {
        expect(normalizeRemoteUrl('https://github.com/owner/repo.git/')).toBe('https://github.com/owner/repo');
    });

    it('handles auth + .git together', () => {
        expect(normalizeRemoteUrl('https://user:pass@github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
    });

    it('does not modify SSH-style URLs (no auth stripping)', () => {
        const result = normalizeRemoteUrl('git@github.com:owner/repo.git');
        expect(result).toBe('git@github.com:owner/repo');
    });

    it('preserves non-auth URLs unchanged except lowercasing', () => {
        expect(normalizeRemoteUrl('https://github.com/Owner/Repo.git')).toBe('https://github.com/owner/repo');
    });
});

describe('computeRemoteHash', () => {
    it('returns a 16-char hex string', () => {
        const hash = computeRemoteHash('https://github.com/owner/repo.git');
        expect(hash).toHaveLength(16);
        expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('is deterministic for the same URL', () => {
        const url = 'https://github.com/owner/repo.git';
        expect(computeRemoteHash(url)).toBe(computeRemoteHash(url));
    });

    it('produces the same hash for URLs that differ only in .git suffix', () => {
        expect(computeRemoteHash('https://github.com/owner/repo.git'))
            .toBe(computeRemoteHash('https://github.com/owner/repo'));
    });

    it('produces the same hash for URLs that differ only in trailing slash', () => {
        expect(computeRemoteHash('https://github.com/owner/repo'))
            .toBe(computeRemoteHash('https://github.com/owner/repo/'));
    });

    it('produces the same hash for URLs that differ only in credentials', () => {
        expect(computeRemoteHash('https://github.com/owner/repo'))
            .toBe(computeRemoteHash('https://user:pass@github.com/owner/repo'));
    });

    it('produces the same hash for URLs that differ only in casing', () => {
        expect(computeRemoteHash('https://github.com/Owner/Repo'))
            .toBe(computeRemoteHash('https://github.com/owner/repo'));
    });

    it('produces different hashes for different repositories', () => {
        expect(computeRemoteHash('https://github.com/owner/repo-a'))
            .not.toBe(computeRemoteHash('https://github.com/owner/repo-b'));
    });
});

describe('resolveCanonicalOrigin', () => {
    it('resolves GitHub HTTPS remotes to gh_owner_repo IDs', () => {
        const origin = resolveCanonicalOrigin({
            remoteUrl: 'https://github.com/Owner/Repo.git',
            workspaceId: 'ws-a',
        });

        expect(origin).toMatchObject({
            originId: 'gh_owner_repo',
            provider: 'github',
            owner: 'owner',
            repo: 'repo',
            workspaceId: 'ws-a',
            normalizedRemoteUrl: 'github.com/owner/repo',
        });
    });

    it('resolves GitHub HTTPS and SSH clones of the same repository to the same ID', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/Owner/Repo.git' }))
            .toBe(resolveCanonicalOriginId({ remoteUrl: 'git@github.com:owner/repo.git' }));
    });

    it('keeps distinct GitHub repositories isolated', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/owner/repo-a' }))
            .not.toBe(resolveCanonicalOriginId({ remoteUrl: 'https://github.com/owner/repo-b' }));
    });

    it('resolves Azure DevOps HTTPS, SSH, and Visual Studio remotes to ado_org_project IDs', () => {
        const expected = 'ado_org_my_x20project';

        expect(resolveCanonicalOriginId({ remoteUrl: 'https://dev.azure.com/Org/My%20Project/_git/Repo' }))
            .toBe(expected);
        expect(resolveCanonicalOriginId({ remoteUrl: 'git@ssh.dev.azure.com:v3/Org/My%20Project/Repo' }))
            .toBe(expected);
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://Org.visualstudio.com/My%20Project/_git/Repo' }))
            .toBe(expected);
    });

    it('keeps distinct Azure DevOps projects isolated', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://dev.azure.com/org/project-a/_git/repo' }))
            .not.toBe(resolveCanonicalOriginId({ remoteUrl: 'https://dev.azure.com/org/project-b/_git/repo' }));
    });

    it('uses a git hash fallback for unknown Git providers', () => {
        const origin = resolveCanonicalOrigin({ remoteUrl: 'https://git.example.com/org/repo.git' });

        expect(origin.provider).toBe('git');
        expect(origin.originId).toMatch(/^git_[0-9a-f]{16}$/);
        expect(origin.remoteHash).toHaveLength(16);
    });

    it('normalizes credentials, casing, and suffixes for Git fallback IDs', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: 'https://USER:TOKEN@git.example.com/Org/Repo.git' }))
            .toBe(resolveCanonicalOriginId({ remoteUrl: 'https://git.example.com/org/repo/' }));
    });

    it('falls back to a local workspace origin when no remote URL is available', () => {
        expect(resolveCanonicalOriginId({ remoteUrl: undefined, workspaceId: 'ws-local' }))
            .toBe('local_ws-local');
    });

    it('requires workspaceId for local origins without a remote URL', () => {
        expect(() => resolveCanonicalOrigin({ remoteUrl: null }))
            .toThrow('workspaceId is required');
    });
});

describe('detectRemoteUrl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns origin URL when origin remote exists', async () => {
        mockedExecGitAsync.mockResolvedValueOnce('https://github.com/owner/repo.git');

        const url = await detectRemoteUrl('/repo');
        expect(url).toBe('https://github.com/owner/repo.git');
    });

    it('falls back to first remote when origin fails', async () => {
        mockedExecGitAsync
            .mockRejectedValueOnce(new Error('no origin'))          // git remote get-url origin
            .mockResolvedValueOnce('upstream\nbackup\n')             // git remote (list remotes)
            .mockResolvedValueOnce('https://github.com/other/repo'); // git remote get-url upstream

        const url = await detectRemoteUrl('/repo');
        expect(url).toBe('https://github.com/other/repo');
    });

    it('returns undefined when no remotes configured', async () => {
        mockedExecGitAsync
            .mockRejectedValueOnce(new Error('no origin'))
            .mockResolvedValueOnce('');

        const url = await detectRemoteUrl('/repo');
        expect(url).toBeUndefined();
    });

    it('returns undefined when all git calls fail', async () => {
        mockedExecGitAsync
            .mockRejectedValueOnce(new Error('no origin'))
            .mockRejectedValueOnce(new Error('not a git repo'));

        const url = await detectRemoteUrl('/not-a-repo');
        expect(url).toBeUndefined();
    });

    it('returns undefined when origin URL is empty', async () => {
        mockedExecGitAsync.mockResolvedValueOnce('');

        const url = await detectRemoteUrl('/repo');
        expect(url).toBeUndefined();
    });
});
