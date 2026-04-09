import { describe, it, expect } from 'vitest';
import {
    parseNoteDeepLink,
    buildNoteHash,
    parseActivityDeepLink,
    parseGitCommitDeepLink,
} from '../../../../src/server/spa/client/react/layout/Router';

describe('parseNoteDeepLink', () => {
    it('returns null for hash without notes segment', () => {
        expect(parseNoteDeepLink('#repos/ws-1/git')).toBeNull();
        expect(parseNoteDeepLink('#repos/ws-1/tasks')).toBeNull();
        expect(parseNoteDeepLink('#processes/p-1')).toBeNull();
    });

    it('returns null for notes tab without a note path', () => {
        expect(parseNoteDeepLink('#repos/ws-1/notes')).toBeNull();
    });

    it('parses a simple note path', () => {
        expect(parseNoteDeepLink('#repos/ws-1/notes/MyNotebook')).toBe('MyNotebook');
    });

    it('parses a multi-segment note path', () => {
        expect(parseNoteDeepLink('#repos/ws-1/notes/MyNotebook/Section/Page.md'))
            .toBe('MyNotebook/Section/Page.md');
    });

    it('decodes URI-encoded segments individually', () => {
        expect(parseNoteDeepLink('#repos/ws-1/notes/My%20Notebook/Page%201.md'))
            .toBe('My Notebook/Page 1.md');
    });

    it('handles special characters in segments', () => {
        expect(parseNoteDeepLink('#repos/ws-1/notes/%E4%B8%AD%E6%96%87/notes.md'))
            .toBe('中文/notes.md');
    });

    it('handles leading # gracefully', () => {
        expect(parseNoteDeepLink('repos/ws-1/notes/a/b')).toBe('a/b');
    });

    it('returns null for empty string', () => {
        expect(parseNoteDeepLink('')).toBeNull();
        expect(parseNoteDeepLink('#')).toBeNull();
    });

    it('handles encoded workspace ID', () => {
        expect(parseNoteDeepLink('#repos/ws%201/notes/page.md')).toBe('page.md');
    });
});

describe('buildNoteHash', () => {
    it('builds a hash for a simple note path', () => {
        expect(buildNoteHash('ws-1', 'MyNotebook'))
            .toBe('#repos/ws-1/notes/MyNotebook');
    });

    it('builds a hash for a multi-segment note path', () => {
        expect(buildNoteHash('ws-1', 'MyNotebook/Section/Page.md'))
            .toBe('#repos/ws-1/notes/MyNotebook/Section/Page.md');
    });

    it('encodes special characters per segment', () => {
        expect(buildNoteHash('ws-1', 'My Notebook/Page 1.md'))
            .toBe('#repos/ws-1/notes/My%20Notebook/Page%201.md');
    });

    it('encodes unicode characters', () => {
        expect(buildNoteHash('ws-1', '中文/notes.md'))
            .toBe('#repos/ws-1/notes/%E4%B8%AD%E6%96%87/notes.md');
    });

    it('encodes workspace ID', () => {
        expect(buildNoteHash('ws 1', 'page.md'))
            .toBe('#repos/ws%201/notes/page.md');
    });
});

describe('parseNoteDeepLink + buildNoteHash round-trip', () => {
    const cases = [
        'Notebook/Section/Page.md',
        'My Notebook/Page 1.md',
        '中文/notes.md',
        'simple.md',
        'a/b/c/d/e.md',
        'has spaces/and (parens)/file.md',
    ];

    for (const notePath of cases) {
        it(`round-trips "${notePath}"`, () => {
            const hash = buildNoteHash('ws-1', notePath);
            const parsed = parseNoteDeepLink(hash);
            expect(parsed).toBe(notePath);
        });
    }
});
