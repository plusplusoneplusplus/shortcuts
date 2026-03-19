import { describe, it, expect } from 'vitest';
import { isAbsolutePath, resolveRelativePath } from '../../../../src/server/spa/client/react/utils/path-resolution';

describe('isAbsolutePath', () => {
    it('returns true for Unix absolute path', () => {
        expect(isAbsolutePath('/home/user/file.md')).toBe(true);
    });

    it('returns true for Windows absolute path with backslash', () => {
        expect(isAbsolutePath('C:\\Users\\file.md')).toBe(true);
    });

    it('returns true for Windows absolute path with forward slash', () => {
        expect(isAbsolutePath('C:/Users/file.md')).toBe(true);
    });

    it('returns false for relative path', () => {
        expect(isAbsolutePath('./relative/path.md')).toBe(false);
    });

    it('returns false for parent-relative path', () => {
        expect(isAbsolutePath('../sibling.md')).toBe(false);
    });

    it('returns false for plain filename', () => {
        expect(isAbsolutePath('file.md')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isAbsolutePath('')).toBe(false);
    });
});

describe('resolveRelativePath', () => {
    it('resolves ./relative path against dir', () => {
        expect(resolveRelativePath('home/user/docs', './other.md')).toBe('home/user/docs/other.md');
    });

    it('resolves ../sibling path against dir', () => {
        expect(resolveRelativePath('home/user/docs', '../sibling.md')).toBe('home/user/sibling.md');
    });

    it('resolves multiple ../ levels', () => {
        expect(resolveRelativePath('a/b/c', '../../x.md')).toBe('a/x.md');
    });

    it('preserves leading slash for Unix absolute base', () => {
        expect(resolveRelativePath('/home/user/docs', './file.md')).toBe('/home/user/docs/file.md');
    });

    it('resolves relative path from absolute Unix dir', () => {
        expect(resolveRelativePath('/home/user/docs', '../sibling.md')).toBe('/home/user/sibling.md');
    });

    it('resolves simple filename without dot-slash', () => {
        expect(resolveRelativePath('base/dir', 'file.md')).toBe('base/dir/file.md');
    });

    it('handles empty rel segment gracefully', () => {
        const result = resolveRelativePath('base/dir', './sub/../file.md');
        expect(result).toBe('base/dir/file.md');
    });
});
