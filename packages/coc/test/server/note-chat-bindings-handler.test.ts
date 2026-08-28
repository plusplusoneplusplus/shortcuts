import { describe, it, expect } from 'vitest';
import { normalizeRelativeNotePath, noteSectionPath } from '../../src/server/notes/note-chat-bindings-handler';

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

describe('noteSectionPath', () => {
    it('returns the nearest parent folder — the key a section chat binds to', () => {
        expect(noteSectionPath('MultiModal/first-five-days.md')).toBe('MultiModal');
    });

    it('uses the nearest parent, not the top-level folder', () => {
        // A chat bound to `MultiModal` deliberately does not pick up notes under
        // `MultiModal/sub` — they are a section of their own.
        expect(noteSectionPath('MultiModal/sub/note.md')).toBe('MultiModal/sub');
    });

    it('returns null for a note at the notes root, which has no section', () => {
        expect(noteSectionPath('inbox.md')).toBeNull();
    });

    it('agrees with the client helper on the same inputs', () => {
        // `noteSectionOf` in useNotesChat.ts must return these same strings, or a
        // chat binds to one key and resolves from another.
        expect(noteSectionPath('MultiModal/a.md')).toBe('MultiModal');
        expect(noteSectionPath('MultiModal/sub/a.md')).toBe('MultiModal/sub');
    });
});
