import { describe, it, expect } from 'vitest';
import { normalizeRemoteUrl, computeRemoteHash } from '../../src/git/remote';

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
