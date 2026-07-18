/**
 * useNotesClipboard — pure planner tests for cut/copy/paste (AC-04).
 *
 * Covers dedupe collision naming and planClipboardPaste for both the cut (move)
 * and copy (duplicate) paths, including selection-root collapse, system-folder
 * skips, and descendant-drop guards.
 */

import { describe, it, expect } from 'vitest';
import {
    dedupeCopyName,
    planClipboardPaste,
    type NotesClipboard,
    type NoteClipboardItem,
} from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesClipboard';

const page = (path: string, name: string): NoteClipboardItem => ({ path, name, type: 'page' });
const folder = (path: string, name: string): NoteClipboardItem => ({ path, name, type: 'notebook' });

/** No system folders in most tests. */
const noSys = () => false;

describe('dedupeCopyName', () => {
    it('returns the name unchanged when there is no collision', () => {
        expect(dedupeCopyName('notes.md', new Set())).toBe('notes.md');
        expect(dedupeCopyName('Work', new Set(['Other']))).toBe('Work');
    });

    it('appends " copy" before the .md extension for a page collision', () => {
        expect(dedupeCopyName('notes.md', new Set(['notes.md']))).toBe('notes copy.md');
    });

    it('bumps to " copy 2", " copy 3" as copies stack up', () => {
        expect(dedupeCopyName('notes.md', new Set(['notes.md', 'notes copy.md']))).toBe('notes copy 2.md');
        expect(
            dedupeCopyName('notes.md', new Set(['notes.md', 'notes copy.md', 'notes copy 2.md'])),
        ).toBe('notes copy 3.md');
    });

    it('appends " copy" to a folder name (no extension)', () => {
        expect(dedupeCopyName('Work', new Set(['Work']))).toBe('Work copy');
        expect(dedupeCopyName('Work', new Set(['Work', 'Work copy']))).toBe('Work copy 2');
    });

    it('treats a leading-dot name as extensionless', () => {
        expect(dedupeCopyName('.env', new Set(['.env']))).toBe('.env copy');
    });
});

describe('planClipboardPaste — cut (move)', () => {
    it('produces one move per row into the destination folder', () => {
        const clip: NotesClipboard = { mode: 'cut', items: [page('A/x.md', 'x.md'), page('B/y.md', 'y.md')] };
        const { moves, copies } = planClipboardPaste(clip, 'Dest', new Set(), noSys);
        expect(copies).toEqual([]);
        expect(moves).toEqual([
            { from: 'A/x.md', to: 'Dest/x.md' },
            { from: 'B/y.md', to: 'Dest/y.md' },
        ]);
    });

    it('collapses to selection roots — a selected child rides along with its folder', () => {
        const clip: NotesClipboard = {
            mode: 'cut',
            items: [folder('Work', 'Work'), page('Work/note.md', 'note.md')],
        };
        const { moves } = planClipboardPaste(clip, 'Dest', new Set(), noSys);
        expect(moves).toEqual([{ from: 'Work', to: 'Dest/Work' }]);
    });

    it('skips a row that already lives in the destination', () => {
        const clip: NotesClipboard = { mode: 'cut', items: [page('Dest/x.md', 'x.md')] };
        const { moves } = planClipboardPaste(clip, 'Dest', new Set(['x.md']), noSys);
        expect(moves).toEqual([]);
    });

    it('guards against moving a folder into itself or its own subtree', () => {
        const clip: NotesClipboard = { mode: 'cut', items: [folder('Work', 'Work')] };
        expect(planClipboardPaste(clip, 'Work', new Set(), noSys).moves).toEqual([]);
        expect(planClipboardPaste(clip, 'Work/Sub', new Set(), noSys).moves).toEqual([]);
    });

    it('skips system folders', () => {
        const clip: NotesClipboard = { mode: 'cut', items: [folder('Tasks', 'Tasks')] };
        const isSys = (it: NoteClipboardItem) => it.name === 'Tasks';
        expect(planClipboardPaste(clip, 'Dest', new Set(), isSys).moves).toEqual([]);
    });

    it('moves to root when destParent is empty', () => {
        const clip: NotesClipboard = { mode: 'cut', items: [page('A/x.md', 'x.md')] };
        expect(planClipboardPaste(clip, '', new Set(), noSys).moves).toEqual([{ from: 'A/x.md', to: 'x.md' }]);
    });
});

describe('planClipboardPaste — copy (duplicate)', () => {
    it('keeps the name when pasting into a folder without a collision', () => {
        const clip: NotesClipboard = { mode: 'copy', items: [page('A/x.md', 'x.md')] };
        const { moves, copies } = planClipboardPaste(clip, 'Dest', new Set(), noSys);
        expect(moves).toEqual([]);
        expect(copies).toEqual([{ from: 'A/x.md', toName: 'x.md', toPath: 'Dest/x.md', type: 'page' }]);
    });

    it('de-dupes to "name copy" when duplicating in place', () => {
        // Copy A/x.md and paste back into A (which already contains x.md).
        const clip: NotesClipboard = { mode: 'copy', items: [page('A/x.md', 'x.md')] };
        const { copies } = planClipboardPaste(clip, 'A', new Set(['x.md']), noSys);
        expect(copies).toEqual([{ from: 'A/x.md', toName: 'x copy.md', toPath: 'A/x copy.md', type: 'page' }]);
    });

    it('reserves each assigned name so sibling copies do not collide', () => {
        const clip: NotesClipboard = {
            mode: 'copy',
            items: [page('A/x.md', 'x.md'), page('B/x.md', 'x.md')],
        };
        // Destination already has x.md; the two same-named sources must get distinct names.
        const { copies } = planClipboardPaste(clip, 'Dest', new Set(['x.md']), noSys);
        expect(copies.map(c => c.toName)).toEqual(['x copy.md', 'x copy 2.md']);
    });

    it('guards against copying a folder into its own subtree', () => {
        const clip: NotesClipboard = { mode: 'copy', items: [folder('Work', 'Work')] };
        expect(planClipboardPaste(clip, 'Work/Sub', new Set(), noSys).copies).toEqual([]);
    });
});
