import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeRemoteUrl, computeRemoteHash, detectRemoteUrl } from '../../src/git/remote';
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

    it('uses a short 5s timeout to avoid blocking on non-git directories', async () => {
        mockedExecGitAsync.mockResolvedValueOnce('https://github.com/owner/repo.git');

        await detectRemoteUrl('/repo');
        expect(mockedExecGitAsync).toHaveBeenCalledWith(
            ['remote', 'get-url', 'origin'],
            '/repo',
            { timeout: 5_000 },
        );
    });
});
