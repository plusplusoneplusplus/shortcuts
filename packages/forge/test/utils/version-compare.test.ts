import { describe, it, expect } from 'vitest';
import { compareVersions } from '../../src/utils/version-compare';

describe('compareVersions', () => {
    it('returns 0 for equal versions', () => {
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('0.0.1', '0.0.1')).toBe(0);
        expect(compareVersions('10.20.30', '10.20.30')).toBe(0);
    });

    it('returns 1 when first is greater', () => {
        expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
        expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
        expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
        expect(compareVersions('0.0.2', '0.0.1')).toBe(1);
    });

    it('returns -1 when first is less', () => {
        expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
        expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
        expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
        expect(compareVersions('0.0.1', '0.0.2')).toBe(-1);
    });

    it('handles versions with fewer than 3 parts', () => {
        expect(compareVersions('1', '1.0.0')).toBe(0);
        expect(compareVersions('1.0', '1.0.0')).toBe(0);
        expect(compareVersions('1', '0.9.9')).toBe(1);
        expect(compareVersions('1.1', '1.0.5')).toBe(1);
    });

    it('returns undefined for malformed versions', () => {
        expect(compareVersions('', '1.0.0')).toBeUndefined();
        expect(compareVersions('1.0.0', '')).toBeUndefined();
        expect(compareVersions('abc', '1.0.0')).toBeUndefined();
        expect(compareVersions('1.0.0', 'xyz')).toBeUndefined();
        expect(compareVersions('1.0.0.0', '1.0.0')).toBeUndefined();
        expect(compareVersions('-1.0.0', '1.0.0')).toBeUndefined();
        expect(compareVersions('1.0.0', '1.0.-1')).toBeUndefined();
    });

    it('returns undefined for non-integer version parts', () => {
        expect(compareVersions('1.0.0-beta', '1.0.0')).toBeUndefined();
        expect(compareVersions('1.0.0', '1.0.0-rc1')).toBeUndefined();
        expect(compareVersions('1.2.3a', '1.2.3')).toBeUndefined();
    });
});
