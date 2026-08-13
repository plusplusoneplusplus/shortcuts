// @vitest-environment jsdom
/**
 * Tests for useNotesTreesExpansion — expanded-folder state for several roots at
 * once, which the stacked sections need because the single-root
 * `useNotesTreeExpansion` cannot be called once per root in a loop.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
    useNotesTreesExpansion,
    notesTreeExpandedStorageKey,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/NotesTreeExpansion';

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
});

describe('useNotesTreesExpansion', () => {
    it('seeds every listed root from its own storage key', () => {
        localStorage.setItem(notesTreeExpandedStorageKey('ws1', 'default'), JSON.stringify(['Inbox']));
        localStorage.setItem(notesTreeExpandedStorageKey('ws1', 'docs'), JSON.stringify(['Guides', 'Guides/api']));

        const { result } = renderHook(() => useNotesTreesExpansion('ws1', ['default', 'docs']));

        expect([...result.current.getExpanded('default')]).toEqual(['Inbox']);
        expect([...result.current.getExpanded('docs')]).toEqual(['Guides', 'Guides/api']);
        expect(Object.keys(result.current.expandedByRoot).sort()).toEqual(['default', 'docs']);
    });

    it('starts empty for a root with nothing stored', () => {
        const { result } = renderHook(() => useNotesTreesExpansion('ws1', ['docs']));

        expect(result.current.getExpanded('docs').size).toBe(0);
    });

    it('keeps roots independent when one is updated', () => {
        const { result } = renderHook(() => useNotesTreesExpansion('ws1', ['default', 'docs']));

        act(() => result.current.setExpanded('docs', new Set(['Guides'])));

        expect([...result.current.getExpanded('docs')]).toEqual(['Guides']);
        expect(result.current.getExpanded('default').size).toBe(0);
    });

    it('persists a change under that root own key only', () => {
        const { result } = renderHook(() => useNotesTreesExpansion('ws1', ['default', 'docs']));

        act(() => result.current.toggleExpanded('docs', 'Guides'));

        expect(JSON.parse(localStorage.getItem(notesTreeExpandedStorageKey('ws1', 'docs'))!)).toEqual(['Guides']);
        expect(localStorage.getItem(notesTreeExpandedStorageKey('ws1', 'default'))).toBeNull();
    });

    it('shares storage keys with the single-root hook so folders survive the switch', () => {
        localStorage.setItem(notesTreeExpandedStorageKey('ws1', 'docs'), JSON.stringify(['Guides']));

        const { result } = renderHook(() => useNotesTreesExpansion('ws1', ['docs']));

        expect([...result.current.getExpanded('docs')]).toEqual(['Guides']);
    });

    it('toggles a folder open then closed', () => {
        const { result } = renderHook(() => useNotesTreesExpansion('ws1', ['docs']));

        act(() => result.current.toggleExpanded('docs', 'Guides'));
        expect(result.current.getExpanded('docs').has('Guides')).toBe(true);

        act(() => result.current.toggleExpanded('docs', 'Guides'));
        expect(result.current.getExpanded('docs').has('Guides')).toBe(false);
        expect(JSON.parse(localStorage.getItem(notesTreeExpandedStorageKey('ws1', 'docs'))!)).toEqual([]);
    });

    it('accepts an updater function', () => {
        const { result } = renderHook(() => useNotesTreesExpansion('ws1', ['docs']));

        act(() => result.current.setExpanded('docs', new Set(['a'])));
        act(() => result.current.setExpanded('docs', prev => new Set([...prev, 'b'])));

        expect([...result.current.getExpanded('docs')].sort()).toEqual(['a', 'b']);
    });

    it('does not write anything before the user changes a root', () => {
        localStorage.setItem(notesTreeExpandedStorageKey('ws1', 'docs'), JSON.stringify(['Guides']));

        renderHook(() => useNotesTreesExpansion('ws1', ['docs', 'other']));

        expect(localStorage.getItem(notesTreeExpandedStorageKey('ws1', 'other'))).toBeNull();
        expect(JSON.parse(localStorage.getItem(notesTreeExpandedStorageKey('ws1', 'docs'))!)).toEqual(['Guides']);
    });

    it('picks up a root that appears later', () => {
        localStorage.setItem(notesTreeExpandedStorageKey('ws1', 'late'), JSON.stringify(['L']));
        const { result, rerender } = renderHook(
            ({ roots }: { roots: string[] }) => useNotesTreesExpansion('ws1', roots),
            { initialProps: { roots: ['docs'] } },
        );

        rerender({ roots: ['docs', 'late'] });

        expect([...result.current.getExpanded('late')]).toEqual(['L']);
    });

    it('drops cached entries when the workspace changes', () => {
        localStorage.setItem(notesTreeExpandedStorageKey('ws2', 'docs'), JSON.stringify(['OtherWs']));
        const { result, rerender } = renderHook(
            ({ ws }: { ws: string }) => useNotesTreesExpansion(ws, ['docs']),
            { initialProps: { ws: 'ws1' } },
        );

        act(() => result.current.setExpanded('docs', new Set(['Guides'])));
        rerender({ ws: 'ws2' });

        expect([...result.current.getExpanded('docs')]).toEqual(['OtherWs']);
    });

    it('keeps the map identity stable across unrelated renders', () => {
        const { result, rerender } = renderHook(() => useNotesTreesExpansion('ws1', ['docs']));
        const first = result.current.expandedByRoot;

        rerender();

        expect(result.current.expandedByRoot).toBe(first);
    });
});
