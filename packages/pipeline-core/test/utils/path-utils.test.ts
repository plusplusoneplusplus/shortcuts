import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'path';
import { toForwardSlashes } from '../../src/utils/path-utils';
import { isWithinDirectory } from '../../src/utils/path-security';

describe('toForwardSlashes', () => {
    it('converts backslashes to forward slashes', () => {
        expect(toForwardSlashes('a\\b\\c')).toBe('a/b/c');
    });

    it('leaves forward slashes unchanged', () => {
        expect(toForwardSlashes('a/b/c')).toBe('a/b/c');
    });

    it('handles mixed separators', () => {
        expect(toForwardSlashes('a\\b/c\\d')).toBe('a/b/c/d');
    });

    it('returns empty string unchanged', () => {
        expect(toForwardSlashes('')).toBe('');
    });

    it('handles strings with no separators', () => {
        expect(toForwardSlashes('file.txt')).toBe('file.txt');
    });

    it('handles consecutive backslashes', () => {
        expect(toForwardSlashes('a\\\\b')).toBe('a//b');
    });

    it('handles Windows-style absolute paths', () => {
        expect(toForwardSlashes('C:\\Users\\name\\file.txt')).toBe('C:/Users/name/file.txt');
    });
});

describe('isWithinDirectory', () => {
    it('returns true for exact match', () => {
        const base = path.resolve('/tmp/base');
        expect(isWithinDirectory(base, base)).toBe(true);
    });

    it('returns true for a child path', () => {
        const base = path.resolve('/tmp/base');
        const child = path.join(base, 'child', 'file.txt');
        expect(isWithinDirectory(child, base)).toBe(true);
    });

    it('returns false for a traversal attempt', () => {
        const base = path.resolve('/tmp/base');
        const traversal = path.join(base, '..', 'other');
        expect(isWithinDirectory(traversal, base)).toBe(false);
    });

    it('returns false for an unrelated path', () => {
        const base = path.resolve('/tmp/base');
        const other = path.resolve('/tmp/other');
        expect(isWithinDirectory(other, base)).toBe(false);
    });

    it('returns false for prefix-overlapping sibling', () => {
        const base = path.resolve('/tmp/base');
        const sibling = path.resolve('/tmp/base-extra');
        expect(isWithinDirectory(sibling, base)).toBe(false);
    });

    it('resolves relative paths against cwd', () => {
        const cwd = process.cwd();
        expect(isWithinDirectory('child', cwd)).toBe(true);
    });
});
