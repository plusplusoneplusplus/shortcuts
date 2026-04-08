import { describe, it, expect } from 'vitest';
import { normalizeRemoteUrl } from '../../src/git/normalize-url';

describe('normalizeRemoteUrl', () => {
    // --- Non-string inputs (crash guard) ---
    it('returns empty string for undefined', () => {
        expect(normalizeRemoteUrl(undefined as unknown as string)).toBe('');
    });

    it('returns empty string for null', () => {
        expect(normalizeRemoteUrl(null as unknown as string)).toBe('');
    });

    it('returns empty string for a number', () => {
        expect(normalizeRemoteUrl(42 as unknown as string)).toBe('');
    });

    it('returns empty string for an object', () => {
        expect(normalizeRemoteUrl({ url: 'x' } as unknown as string)).toBe('');
    });

    it('returns empty string for a boolean', () => {
        expect(normalizeRemoteUrl(true as unknown as string)).toBe('');
    });

    it('returns empty string for an array', () => {
        expect(normalizeRemoteUrl(['a'] as unknown as string)).toBe('');
    });

    // --- Normal string inputs ---
    it('normalizes HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo.git')).toBe('github.com/user/repo');
    });

    it('normalizes SSH shorthand URL', () => {
        expect(normalizeRemoteUrl('git@github.com:user/repo.git')).toBe('github.com/user/repo');
    });

    it('normalizes ssh:// protocol URL', () => {
        expect(normalizeRemoteUrl('ssh://git@github.com/user/repo')).toBe('github.com/user/repo');
    });

    it('normalizes git:// protocol URL', () => {
        expect(normalizeRemoteUrl('git://github.com/user/repo.git/')).toBe('github.com/user/repo');
    });

    it('strips trailing slash', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo/')).toBe('github.com/user/repo');
    });

    it('returns empty string for empty input', () => {
        expect(normalizeRemoteUrl('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
        expect(normalizeRemoteUrl('   ')).toBe('');
    });

    // --- Azure DevOps ---
    it('normalizes Azure DevOps HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://dev.azure.com/org/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps SSH URL', () => {
        expect(normalizeRemoteUrl('git@ssh.dev.azure.com:v3/org/project/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Visual Studio Online URL', () => {
        expect(normalizeRemoteUrl('https://org.visualstudio.com/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });
});
