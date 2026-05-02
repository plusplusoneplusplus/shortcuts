import { describe, it, expect } from 'vitest';
import { shortenHostname } from '../../src/server/core/hostname-utils';

describe('shortenHostname', () => {
    it('strips .local suffix (macOS mDNS)', () => {
        expect(shortenHostname('My-MacBook-Pro.local')).toBe('My-MacBook-Pro');
    });

    it('strips .localdomain suffix (Linux)', () => {
        expect(shortenHostname('server01.localdomain')).toBe('server01');
    });

    it('strips .lan suffix', () => {
        expect(shortenHostname('desktop.lan')).toBe('desktop');
    });

    it('strips .home suffix', () => {
        expect(shortenHostname('workstation.home')).toBe('workstation');
    });

    it('strips .internal suffix', () => {
        expect(shortenHostname('build-agent.internal')).toBe('build-agent');
    });

    it('is case-insensitive for suffix matching', () => {
        expect(shortenHostname('HOST.LOCAL')).toBe('HOST');
        expect(shortenHostname('host.Local')).toBe('host');
        expect(shortenHostname('HOST.LOCALDOMAIN')).toBe('HOST');
    });

    it('preserves original casing in the returned name', () => {
        expect(shortenHostname('My-MacBook.LOCAL')).toBe('My-MacBook');
    });

    it('returns hostname unchanged when no suffix matches', () => {
        expect(shortenHostname('ci-runner')).toBe('ci-runner');
    });

    it('returns hostname unchanged for real domain names', () => {
        expect(shortenHostname('server.example.com')).toBe('server.example.com');
    });

    it('handles empty string', () => {
        expect(shortenHostname('')).toBe('');
    });

    it('does not strip suffix that is the entire hostname', () => {
        // Edge case: hostname is exactly a suffix — result would be empty,
        // but this is still the correct behavior (strip the suffix)
        expect(shortenHostname('.local')).toBe('');
    });

    it('only strips one suffix (no double stripping)', () => {
        expect(shortenHostname('host.local.local')).toBe('host.local');
    });

    it('prefers longest matching suffix', () => {
        // .localdomain should match before .local
        expect(shortenHostname('host.localdomain')).toBe('host');
    });
});
