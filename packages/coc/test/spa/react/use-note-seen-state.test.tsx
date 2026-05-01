import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNoteSeenState } from '../../../src/server/spa/client/react/features/notes/hooks/useNoteSeenState';
import type { NoteTreeNode } from '../../../src/server/spa/client/react/features/notes/notesApi';

const STORAGE_KEY = 'coc-notes-seen-ws1';

function page(path: string, lastModifiedAt: string): NoteTreeNode {
    return {
        name: path.split('/').pop() ?? path,
        path,
        type: 'page',
        lastModifiedAt,
    };
}

function treeWith(child: NoteTreeNode): NoteTreeNode[] {
    return [
        {
            name: 'Notebook',
            path: 'Notebook',
            type: 'notebook',
            children: [child],
        },
    ];
}

describe('useNoteSeenState', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('seeds the current tree as seen when no stored state exists', () => {
        const note = page('Notebook/Page.md', '2024-01-01T00:00:00.000Z');
        const { result } = renderHook(() => useNoteSeenState('ws1'));

        act(() => {
            result.current.syncSeenState(treeWith(note));
        });

        expect(result.current.isNoteUpdated(note)).toBe(false);
        expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
            'Notebook/Page.md': '2024-01-01T00:00:00.000Z',
        });
    });

    it('reports a note as updated when its mtime is newer than the stored seen time', () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            'Notebook/Page.md': '2024-01-01T00:00:00.000Z',
        }));
        const note = page('Notebook/Page.md', '2024-01-02T00:00:00.000Z');

        const { result } = renderHook(() => useNoteSeenState('ws1'));

        expect(result.current.isNoteUpdated(note)).toBe(true);
    });

    it('clears an update after markAsSeen', () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            'Notebook/Page.md': '2024-01-01T00:00:00.000Z',
        }));
        const note = page('Notebook/Page.md', '2024-01-02T00:00:00.000Z');
        const { result } = renderHook(() => useNoteSeenState('ws1'));

        act(() => {
            result.current.markAsSeen('Notebook/Page.md');
        });

        expect(result.current.isNoteUpdated(note)).toBe(false);
    });

    it('adds newly discovered paths as seen without showing an update', () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
        const note = page('Notebook/New.md', '2024-01-03T00:00:00.000Z');
        const { result } = renderHook(() => useNoteSeenState('ws1'));

        act(() => {
            result.current.syncSeenState(treeWith(note));
        });

        expect(result.current.isNoteUpdated(note)).toBe(false);
        expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
            'Notebook/New.md': '2024-01-03T00:00:00.000Z',
        });
    });
});
