import { describe, it, expect } from 'vitest';
import { normalizeRelativeNotePath } from '../../src/server/notes/note-chat-bindings-handler';

describe('normalizeRelativeNotePath', () => {
    it('accepts a simple relative path', () => {
        expect(normalizeRelativeNotePath('a.md')).toBe('a.md');
        expect(normalizeRelativeNotePath('dir/a.md')).toBe('dir/a.md');
    });

    it('normalizes backslashes to forward slashes', () => {
        expect(normalizeRelativeNotePath('dir\\sub\\a.md')).toBe('dir/sub/a.md');
    });

    it('collapses consecutive slashes', () => {
        expect(normalizeRelativeNotePath('dir//sub///a.md')).toBe('dir/sub/a.md');
    });

    it('rejects absolute POSIX paths', () => {
        expect(normalizeRelativeNotePath('/abs/path.md')).toBeNull();
    });

    it('rejects parent-directory traversal', () => {
        expect(normalizeRelativeNotePath('../escape.md')).toBeNull();
        expect(normalizeRelativeNotePath('a/../b.md')).toBeNull();
    });

    it('rejects current-directory segments', () => {
        expect(normalizeRelativeNotePath('./a.md')).toBeNull();
    });

    it('rejects empty input', () => {
        expect(normalizeRelativeNotePath('')).toBeNull();
        expect(normalizeRelativeNotePath('/')).toBeNull();
    });

    it('rejects non-string input', () => {
        expect(normalizeRelativeNotePath(null)).toBeNull();
        expect(normalizeRelativeNotePath(undefined)).toBeNull();
        expect(normalizeRelativeNotePath(123)).toBeNull();
    });
});
