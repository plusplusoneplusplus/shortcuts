// @vitest-environment jsdom
/**
 * Tests for useNotesSectionsExpanded — open/closed state for a stack of root
 * sections. The single-root `useNotesSectionExpanded` cannot be called once per
 * root in a loop, so the stacked sidebar needs this map form (AC-02).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
    useNotesSectionsExpanded,
    notesSectionExpandedStorageKey,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/NotesTreeExpansion';

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
});

describe('useNotesSectionsExpanded', () => {
    it('opens the previously selected root and collapses the rest on a first load', () => {
        const { result } = renderHook(
            () => useNotesSectionsExpanded('ws1', ['default', 'docs', 'specs'], 'docs'),
        );

        expect(result.current.expandedByRoot).toEqual({ default: false, docs: true, specs: false });
        expect(result.current.expandedRootIds).toEqual(['docs']);
    });

    it('falls back to the first listed root when the selected root is unknown', () => {
        const { result } = renderHook(
            () => useNotesSectionsExpanded('ws1', ['default', 'docs'], 'gone'),
        );

        expect(result.current.expandedRootIds).toEqual(['default']);
    });

    it('falls back to the first listed root when no selected root is given', () => {
        const { result } = renderHook(() => useNotesSectionsExpanded('ws1', ['default', 'docs']));

        expect(result.current.expandedRootIds).toEqual(['default']);
    });

    it('keeps at least one section open on a first load', () => {
        const { result } = renderHook(() => useNotesSectionsExpanded('ws1', ['a', 'b', 'c'], 'c'));

        expect(result.current.expandedRootIds.length).toBeGreaterThan(0);
    });

    it('prefers the persisted flag over the default for a stored root', () => {
        localStorage.setItem(notesSectionExpandedStorageKey('ws1', 'docs'), 'false');
        localStorage.setItem(notesSectionExpandedStorageKey('ws1', 'default'), 'true');

        const { result } = renderHook(
            () => useNotesSectionsExpanded('ws1', ['default', 'docs'], 'docs'),
        );

        expect(result.current.expandedByRoot).toEqual({ default: true, docs: false });
    });

    it('leaves every section closed when the user collapsed them all', () => {
        localStorage.setItem(notesSectionExpandedStorageKey('ws1', 'default'), 'false');
        localStorage.setItem(notesSectionExpandedStorageKey('ws1', 'docs'), 'false');

        const { result } = renderHook(
            () => useNotesSectionsExpanded('ws1', ['default', 'docs'], 'default'),
        );

        expect(result.current.expandedRootIds).toEqual([]);
    });

    it('shares storage keys with the single-root section hook', () => {
        localStorage.setItem(notesSectionExpandedStorageKey('ws1', 'docs'), 'true');

        const { result } = renderHook(() => useNotesSectionsExpanded('ws1', ['default', 'docs']));

        expect(result.current.isExpanded('docs')).toBe(true);
    });

    it('persists a toggle under that root own key only', () => {
        const { result } = renderHook(() => useNotesSectionsExpanded('ws1', ['default', 'docs'], 'default'));

        act(() => result.current.toggle('docs'));

        expect(localStorage.getItem(notesSectionExpandedStorageKey('ws1', 'docs'))).toBe('true');
        expect(localStorage.getItem(notesSectionExpandedStorageKey('ws1', 'default'))).toBeNull();
        expect(result.current.expandedRootIds).toEqual(['default', 'docs']);
    });

    it('toggles the default-open root closed', () => {
        const { result } = renderHook(() => useNotesSectionsExpanded('ws1', ['default', 'docs'], 'default'));

        act(() => result.current.toggle('default'));

        expect(result.current.isExpanded('default')).toBe(false);
        expect(localStorage.getItem(notesSectionExpandedStorageKey('ws1', 'default'))).toBe('false');
        expect(result.current.expandedRootIds).toEqual([]);
    });

    it('reports expanded roots in the order they were listed', () => {
        const { result } = renderHook(() => useNotesSectionsExpanded('ws1', ['a', 'b', 'c'], 'c'));

        act(() => result.current.setExpanded('a', true));
        act(() => result.current.setExpanded('b', true));

        expect(result.current.expandedRootIds).toEqual(['a', 'b', 'c']);
    });

    it('picks up a root that appears later', () => {
        localStorage.setItem(notesSectionExpandedStorageKey('ws1', 'late'), 'true');
        const { result, rerender } = renderHook(
            ({ roots }: { roots: string[] }) => useNotesSectionsExpanded('ws1', roots, 'default'),
            { initialProps: { roots: ['default'] } },
        );

        rerender({ roots: ['default', 'late'] });

        expect(result.current.expandedRootIds).toEqual(['default', 'late']);
    });

    it('drops overrides when the workspace changes', () => {
        localStorage.setItem(notesSectionExpandedStorageKey('ws2', 'docs'), 'true');
        const { result, rerender } = renderHook(
            ({ ws }: { ws: string }) => useNotesSectionsExpanded(ws, ['default', 'docs'], 'default'),
            { initialProps: { ws: 'ws1' } },
        );

        act(() => result.current.setExpanded('docs', false));
        rerender({ ws: 'ws2' });

        expect(result.current.isExpanded('docs')).toBe(true);
    });

    it('does not write anything before the user toggles a section', () => {
        renderHook(() => useNotesSectionsExpanded('ws1', ['default', 'docs'], 'default'));

        expect(localStorage.getItem(notesSectionExpandedStorageKey('ws1', 'default'))).toBeNull();
        expect(localStorage.getItem(notesSectionExpandedStorageKey('ws1', 'docs'))).toBeNull();
    });

    it('keeps the map identity stable across unrelated renders', () => {
        const { result, rerender } = renderHook(() => useNotesSectionsExpanded('ws1', ['default', 'docs']));
        const first = result.current.expandedByRoot;

        rerender();

        expect(result.current.expandedByRoot).toBe(first);
    });
});
