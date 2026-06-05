import { describe, it, expect } from 'vitest';
import {
    parseNoteDeepLink,
    buildNoteHash,
    parseActivityDeepLink,
    parseForEachRunDeepLink,
    parseGitCommitDeepLink,
    parseTasksDeepLink,
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

describe('parseForEachRunDeepLink', () => {
    it('parses activity, chats, and tasks For Each run links', () => {
        expect(parseForEachRunDeepLink('#repos/ws-1/activity/for-each/run-1')).toEqual({
            workspaceId: 'ws-1',
            runId: 'run-1',
        });
        expect(parseForEachRunDeepLink('#repos/ws-1/chats/for-each/run-2')).toEqual({
            workspaceId: 'ws-1',
            runId: 'run-2',
        });
        expect(parseForEachRunDeepLink('#repos/ws-1/tasks/for-each/run-3')).toEqual({
            workspaceId: 'ws-1',
            runId: 'run-3',
        });
    });

    it('decodes workspace and run identifiers', () => {
        expect(parseForEachRunDeepLink('#repos/ws%201/activity/for-each/run%2Fencoded')).toEqual({
            workspaceId: 'ws 1',
            runId: 'run/encoded',
        });
    });

    it('rejects non-For Each links', () => {
        expect(parseForEachRunDeepLink('#repos/ws-1/activity/ralph/session-1')).toBeNull();
        expect(parseForEachRunDeepLink('#repos/ws-1/activity/for-each')).toBeNull();
        expect(parseForEachRunDeepLink('#repos/ws-1/git/for-each/run-1')).toBeNull();
    });
});

describe('activity and task deep-link reserved parent-run segments', () => {
    it('does not treat Ralph or For Each subroutes as process ids', () => {
        expect(parseActivityDeepLink('#repos/ws-1/activity/ralph/session-1')).toBeNull();
        expect(parseActivityDeepLink('#repos/ws-1/activity/for-each/run-1')).toBeNull();
        expect(parseTasksDeepLink('#repos/ws-1/tasks/ralph/session-1')).toBeNull();
        expect(parseTasksDeepLink('#repos/ws-1/tasks/for-each/run-1')).toBeNull();
    });
});
