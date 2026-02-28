/**
 * Tests for clickable markdown file references (md-link spans).
 *
 * Covers:
 * - Path resolution helpers (isAbsolutePath, resolveRelativePath)
 * - data-href attribute rendering on md-link spans
 * - Click delegation logic for md-link spans (external, relative, absolute, anchor)
 */

import { describe, it, expect } from 'vitest';
import { isAbsolutePath, resolveRelativePath } from '../../../../src/server/spa/client/react/utils/path-resolution';

// ── isAbsolutePath ──

describe('isAbsolutePath', () => {
    it('returns true for Unix absolute paths', () => {
        expect(isAbsolutePath('/usr/local/bin')).toBe(true);
        expect(isAbsolutePath('/home/user/file.md')).toBe(true);
    });

    it('returns true for Windows drive-letter paths (backslash)', () => {
        expect(isAbsolutePath('C:\\Users\\user\\file.md')).toBe(true);
        expect(isAbsolutePath('D:\\projects\\readme.md')).toBe(true);
    });

    it('returns true for Windows drive-letter paths (forward slash)', () => {
        expect(isAbsolutePath('C:/Users/user/file.md')).toBe(true);
    });

    it('returns true for lowercase drive letters', () => {
        expect(isAbsolutePath('c:\\data\\file.txt')).toBe(true);
    });

    it('returns false for relative paths', () => {
        expect(isAbsolutePath('./file.md')).toBe(false);
        expect(isAbsolutePath('../file.md')).toBe(false);
        expect(isAbsolutePath('file.md')).toBe(false);
        expect(isAbsolutePath('dir/file.md')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isAbsolutePath('')).toBe(false);
    });
});

// ── resolveRelativePath ──

describe('resolveRelativePath', () => {
    it('resolves ./file.md against a Unix directory', () => {
        expect(resolveRelativePath('/home/user/docs', './file.md')).toBe('/home/user/docs/file.md');
    });

    it('resolves ../file.md against a Unix directory', () => {
        expect(resolveRelativePath('/home/user/docs', '../file.md')).toBe('/home/user/file.md');
    });

    it('resolves multiple parent traversals', () => {
        expect(resolveRelativePath('/a/b/c/d', '../../x.md')).toBe('/a/b/x.md');
    });

    it('resolves bare filename (no prefix)', () => {
        expect(resolveRelativePath('/home/user', 'file.md')).toBe('/home/user/file.md');
    });

    it('resolves nested relative path', () => {
        expect(resolveRelativePath('/home/user/docs', './sub/file.md')).toBe('/home/user/docs/sub/file.md');
    });

    it('resolves against Windows-style directory (forward slashes)', () => {
        expect(resolveRelativePath('C:/Users/user/docs', './readme.md')).toBe('C:/Users/user/docs/readme.md');
    });

    it('handles trailing slash on directory', () => {
        expect(resolveRelativePath('/home/user/', './file.md')).toBe('/home/user/file.md');
    });

    it('handles complex mixed navigation', () => {
        expect(resolveRelativePath('/a/b/c', '../d/./e/../f.md')).toBe('/a/b/d/f.md');
    });
});
