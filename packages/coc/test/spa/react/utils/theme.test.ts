import { describe, it, expect, afterEach } from 'vitest';
import { detectDarkMode } from '../../../../src/server/spa/client/react/utils/theme';

afterEach(() => {
    document.documentElement.classList.remove('dark');
});

describe('detectDarkMode', () => {
    it('returns false when the dark class is absent', () => {
        expect(detectDarkMode()).toBe(false);
    });

    it('returns true when the dark class is present on documentElement', () => {
        document.documentElement.classList.add('dark');
        expect(detectDarkMode()).toBe(true);
    });

    it('returns false after the dark class is removed', () => {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('dark');
        expect(detectDarkMode()).toBe(false);
    });
});
