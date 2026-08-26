/**
 * Pure helpers behind the right dock's Notes view.
 *
 * These are DOM-free, so they carry the list-shaping rules (which nodes count as
 * notes, ordering, filtering, untitled-name allocation) and the chat-reference
 * format without any React/jsdom involvement.
 */
import { describe, expect, it } from 'vitest';
import type { NoteTreeNode } from '../../../../src/server/spa/client/react/features/notes/notesApi';
import {
    filterDockNotes,
    flattenNoteFiles,
    formatNoteChatReference,
    nextUntitledNotePath,
} from '../../../../src/server/spa/client/react/features/notes/dock/dockNotes';

function page(name: string, notePath: string, lastModifiedAt?: string): NoteTreeNode {
    return { name, path: notePath, type: 'page', lastModifiedAt };
}
function folder(name: string, folderPath: string, children: NoteTreeNode[]): NoteTreeNode {
    return { name, path: folderPath, type: 'notebook', children };
}

describe('flattenNoteFiles', () => {
    it('flattens nested notebooks/sections into a single list of markdown pages', () => {
        const tree: NoteTreeNode[] = [
            folder('Plans', 'Plans', [
                page('mla.md', 'Plans/mla.md', '2026-08-20T10:00:00.000Z'),
                folder('Archive', 'Plans/Archive', [page('old.md', 'Plans/Archive/old.md', '2026-08-01T10:00:00.000Z')]),
            ]),
            page('root.md', 'root.md', '2026-08-25T10:00:00.000Z'),
        ];

        expect(flattenNoteFiles(tree).map(n => n.path)).toEqual([
            'root.md',
            'Plans/mla.md',
            'Plans/Archive/old.md',
        ]);
    });

    it('derives title (extension stripped) and parent folder', () => {
        const notes = flattenNoteFiles([
            folder('Plans', 'Plans', [page('mla cache.md', 'Plans/mla cache.md')]),
            page('root.md', 'root.md'),
        ]);
        const byPath = Object.fromEntries(notes.map(n => [n.path, n]));
        expect(byPath['Plans/mla cache.md'].title).toBe('mla cache');
        expect(byPath['Plans/mla cache.md'].folder).toBe('Plans');
        // A note at the notes root has no folder line to show.
        expect(byPath['root.md'].folder).toBe('');
    });

    it('skips hidden folders/files and non-markdown pages', () => {
        const tree: NoteTreeNode[] = [
            folder('.comments', '.comments', [page('sidecar.md', '.comments/sidecar.md')]),
            page('.secret.md', '.secret.md'),
            page('diagram.png', 'diagram.png'),
            page('keep.md', 'keep.md'),
        ];
        expect(flattenNoteFiles(tree).map(n => n.path)).toEqual(['keep.md']);
    });

    it('orders most-recently-modified first, with mtime-less notes last', () => {
        const notes = flattenNoteFiles([
            page('old.md', 'old.md', '2026-01-01T00:00:00.000Z'),
            page('none.md', 'none.md'),
            page('new.md', 'new.md', '2026-08-25T00:00:00.000Z'),
        ]);
        expect(notes.map(n => n.path)).toEqual(['new.md', 'old.md', 'none.md']);
    });

    it('breaks mtime ties by path so order never depends on traversal order', () => {
        const stamp = '2026-08-25T00:00:00.000Z';
        const notes = flattenNoteFiles([
            page('b.md', 'b.md', stamp),
            page('a.md', 'a.md', stamp),
        ]);
        expect(notes.map(n => n.path)).toEqual(['a.md', 'b.md']);
    });

    it('treats an unparsable mtime like a missing one instead of throwing', () => {
        const notes = flattenNoteFiles([
            page('bad.md', 'bad.md', 'not-a-date'),
            page('good.md', 'good.md', '2026-08-25T00:00:00.000Z'),
        ]);
        expect(notes.map(n => n.path)).toEqual(['good.md', 'bad.md']);
    });

    it('handles an empty / missing tree', () => {
        expect(flattenNoteFiles([])).toEqual([]);
        expect(flattenNoteFiles(undefined)).toEqual([]);
        expect(flattenNoteFiles(null)).toEqual([]);
        // A folder with no children array must not throw.
        expect(flattenNoteFiles([{ name: 'Empty', path: 'Empty', type: 'notebook' }])).toEqual([]);
    });
});

describe('filterDockNotes', () => {
    const notes = flattenNoteFiles([
        folder('Plans', 'Plans', [page('MLA cache.md', 'Plans/MLA cache.md')]),
        page('batching.md', 'batching.md'),
    ]);

    it('keeps everything for a blank / whitespace query', () => {
        expect(filterDockNotes(notes, '')).toHaveLength(2);
        expect(filterDockNotes(notes, '   ')).toHaveLength(2);
    });

    it('matches the title case-insensitively', () => {
        expect(filterDockNotes(notes, 'mla').map(n => n.path)).toEqual(['Plans/MLA cache.md']);
    });

    it('matches the folder path too', () => {
        expect(filterDockNotes(notes, 'plans').map(n => n.path)).toEqual(['Plans/MLA cache.md']);
    });

    it('returns an empty list when nothing matches, without mutating the input', () => {
        expect(filterDockNotes(notes, 'zzz')).toEqual([]);
        expect(notes).toHaveLength(2);
    });
});

describe('nextUntitledNotePath', () => {
    it('uses Untitled.md when free', () => {
        expect(nextUntitledNotePath([])).toBe('Untitled.md');
        expect(nextUntitledNotePath(['Plans/other.md'])).toBe('Untitled.md');
    });

    it('counts up past existing untitled notes', () => {
        expect(nextUntitledNotePath(['Untitled.md'])).toBe('Untitled 2.md');
        expect(nextUntitledNotePath(['Untitled.md', 'Untitled 2.md'])).toBe('Untitled 3.md');
    });

    it('compares case-insensitively (Windows/macOS case-insensitive filesystems)', () => {
        expect(nextUntitledNotePath(['untitled.md'])).toBe('Untitled 2.md');
    });
});

describe('formatNoteChatReference', () => {
    it('emits a notes-root-relative reference the model can read with file tools', () => {
        const text = formatNoteChatReference({ path: 'Plans/mla.md', title: 'mla' });
        expect(text).toContain('<note_reference path="Plans/mla.md">');
        expect(text).toContain('`Plans/mla.md`');
        expect(text).toContain('relative to the notes root');
        expect(text.trimEnd().endsWith('</note_reference>')).toBe(true);
    });

    it('uses forward-slash note paths verbatim (never OS separators)', () => {
        expect(formatNoteChatReference({ path: 'a/b/c.md', title: 'c' })).toContain('path="a/b/c.md"');
    });

    it('returns an empty string for a blank path so callers can no-op', () => {
        expect(formatNoteChatReference({ path: '   ', title: 'x' })).toBe('');
    });
});
