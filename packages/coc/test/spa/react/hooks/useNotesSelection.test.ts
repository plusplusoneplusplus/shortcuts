/**
 * useNotesSelection — unit tests for the multi-selection hook.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useNotesSelection,
    reduceNotesSelection,
} from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesSelection';

const FLAT_LIST = ['nb/a.md', 'nb/b.md', 'nb/c.md', 'nb/d.md', 'nb/e.md'];

describe('useNotesSelection', () => {
    describe('plain click', () => {
        it('selects a single path and sets anchor', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/b.md', { shift: false, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths]).toEqual(['nb/b.md']);
            expect(result.current.anchorPath).toBe('nb/b.md');
        });

        it('clears previous selection on plain click', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/c.md', { shift: false, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths]).toEqual(['nb/c.md']);
        });
    });

    describe('ctrl/cmd click', () => {
        it('toggles an item into the selection', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/c.md', { shift: false, ctrl: true }, FLAT_LIST));
            expect(result.current.selectedPaths.has('nb/a.md')).toBe(true);
            expect(result.current.selectedPaths.has('nb/c.md')).toBe(true);
            expect(result.current.selectedPaths.size).toBe(2);
        });

        it('toggles an item out of the selection', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/c.md', { shift: false, ctrl: true }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: true }, FLAT_LIST));
            expect(result.current.selectedPaths.has('nb/a.md')).toBe(false);
            expect(result.current.selectedPaths.has('nb/c.md')).toBe(true);
            expect(result.current.selectedPaths.size).toBe(1);
        });

        it('updates anchor to the ctrl-clicked path', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/d.md', { shift: false, ctrl: true }, FLAT_LIST));
            expect(result.current.anchorPath).toBe('nb/d.md');
        });
    });

    describe('shift click (range selection)', () => {
        it('selects a range from anchor to target (forward)', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/b.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/d.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths].sort()).toEqual(['nb/b.md', 'nb/c.md', 'nb/d.md']);
        });

        it('selects a range from anchor to target (backward)', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/d.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/b.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths].sort()).toEqual(['nb/b.md', 'nb/c.md', 'nb/d.md']);
        });

        it('does not change the anchor on shift-click', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/b.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/d.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect(result.current.anchorPath).toBe('nb/b.md');
        });

        it('unions range with prior ctrl-selections', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/e.md', { shift: false, ctrl: true }, FLAT_LIST));
            // Anchor is now nb/e.md
            act(() => result.current.handleSelect('nb/c.md', { shift: true, ctrl: false }, FLAT_LIST));
            // Range from e→c = c, d, e; union with existing a, e → a, c, d, e
            expect(result.current.selectedPaths.has('nb/a.md')).toBe(true);
            expect(result.current.selectedPaths.has('nb/c.md')).toBe(true);
            expect(result.current.selectedPaths.has('nb/d.md')).toBe(true);
            expect(result.current.selectedPaths.has('nb/e.md')).toBe(true);
        });

        it('falls back to single selection when anchor is not in flat list', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/x.md', { shift: false, ctrl: false }, FLAT_LIST));
            // anchor is 'nb/x.md' which is not in FLAT_LIST
            act(() => result.current.handleSelect('nb/c.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths]).toEqual(['nb/c.md']);
            expect(result.current.anchorPath).toBe('nb/c.md');
        });

        it('ignores shift-click if target is not in flat list', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/b.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/unknown.md', { shift: true, ctrl: false }, FLAT_LIST));
            // Selection unchanged
            expect([...result.current.selectedPaths]).toEqual(['nb/b.md']);
        });
    });

    describe('shift click re-scope (AC-01)', () => {
        it('grows the range when the second shift-click moves further from the anchor', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/c.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths].sort()).toEqual(['nb/a.md', 'nb/b.md', 'nb/c.md']);
            act(() => result.current.handleSelect('nb/e.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths].sort()).toEqual([
                'nb/a.md', 'nb/b.md', 'nb/c.md', 'nb/d.md', 'nb/e.md',
            ]);
        });

        it('re-scopes (shrinks) the range on a second shift-click toward the anchor', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/e.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect(result.current.selectedPaths.size).toBe(5);
            // Second shift-click from the SAME anchor must replace, not union.
            act(() => result.current.handleSelect('nb/c.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths].sort()).toEqual(['nb/a.md', 'nb/b.md', 'nb/c.md']);
            // d and e are dropped — this is the union-only bug fix.
            expect(result.current.selectedPaths.has('nb/d.md')).toBe(false);
            expect(result.current.selectedPaths.has('nb/e.md')).toBe(false);
        });

        it('re-scope preserves ctrl-committed selections outside the range', () => {
            const { result } = renderHook(() => useNotesSelection());
            // Commit a via plain click, then ctrl-toggle e (anchor moves to e).
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/e.md', { shift: false, ctrl: true }, FLAT_LIST));
            // Shift back to c → range e..c = c,d,e; union with base {a,e}.
            act(() => result.current.handleSelect('nb/c.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths].sort()).toEqual([
                'nb/a.md', 'nb/c.md', 'nb/d.md', 'nb/e.md',
            ]);
            // Re-scope the range to just d..e; the ctrl-committed a must survive.
            act(() => result.current.handleSelect('nb/d.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths].sort()).toEqual(['nb/a.md', 'nb/d.md', 'nb/e.md']);
        });
    });

    describe('clearSelection', () => {
        it('resets selection and anchor', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/a.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.clearSelection());
            expect(result.current.selectedPaths.size).toBe(0);
            expect(result.current.anchorPath).toBeNull();
        });
    });

    describe('edge cases', () => {
        it('works with a single-item flat list', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('only.md', { shift: false, ctrl: false }, ['only.md']));
            expect([...result.current.selectedPaths]).toEqual(['only.md']);
        });

        it('shift-click on same item as anchor selects just that item', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('nb/c.md', { shift: false, ctrl: false }, FLAT_LIST));
            act(() => result.current.handleSelect('nb/c.md', { shift: true, ctrl: false }, FLAT_LIST));
            expect([...result.current.selectedPaths]).toEqual(['nb/c.md']);
        });
    });

    describe('reduceNotesSelection (pure reducer — grow/re-scope/toggle/reset)', () => {
        const EMPTY = { selectedPaths: new Set<string>(), anchorPath: null, baseSelection: new Set<string>() };

        it('reset: plain click replaces everything with a single row', () => {
            const seeded = reduceNotesSelection(EMPTY, 'nb/a.md', { shift: true, ctrl: true }, FLAT_LIST);
            const next = reduceNotesSelection(seeded, 'nb/d.md', { shift: false, ctrl: false }, FLAT_LIST);
            expect([...next.selectedPaths]).toEqual(['nb/d.md']);
            expect(next.anchorPath).toBe('nb/d.md');
        });

        it('toggle: ctrl click adds then removes and moves the anchor', () => {
            const one = reduceNotesSelection(EMPTY, 'nb/a.md', { shift: false, ctrl: false }, FLAT_LIST);
            const two = reduceNotesSelection(one, 'nb/c.md', { shift: false, ctrl: true }, FLAT_LIST);
            expect([...two.selectedPaths].sort()).toEqual(['nb/a.md', 'nb/c.md']);
            expect(two.anchorPath).toBe('nb/c.md');
            const three = reduceNotesSelection(two, 'nb/c.md', { shift: false, ctrl: true }, FLAT_LIST);
            expect([...three.selectedPaths]).toEqual(['nb/a.md']);
        });

        it('grow then re-scope from a stable anchor', () => {
            const anchor = reduceNotesSelection(EMPTY, 'nb/a.md', { shift: false, ctrl: false }, FLAT_LIST);
            const grown = reduceNotesSelection(anchor, 'nb/e.md', { shift: true, ctrl: false }, FLAT_LIST);
            expect(grown.selectedPaths.size).toBe(5);
            const rescoped = reduceNotesSelection(grown, 'nb/b.md', { shift: true, ctrl: false }, FLAT_LIST);
            expect([...rescoped.selectedPaths].sort()).toEqual(['nb/a.md', 'nb/b.md']);
            expect(rescoped.anchorPath).toBe('nb/a.md');
        });

        it('does not mutate the previous state object', () => {
            const prev = reduceNotesSelection(EMPTY, 'nb/a.md', { shift: false, ctrl: false }, FLAT_LIST);
            const prevSnapshot = [...prev.selectedPaths];
            reduceNotesSelection(prev, 'nb/c.md', { shift: false, ctrl: true }, FLAT_LIST);
            expect([...prev.selectedPaths]).toEqual(prevSnapshot);
        });
    });

    describe('folders are selectable (AC-02)', () => {
        // Flat list interleaves folder rows (NB1, NB1/sec) with page rows, as
        // flattenVisibleNodePaths produces.
        const MIXED_LIST = ['NB1', 'NB1/a.md', 'NB1/sec', 'NB1/sec/b.md', 'NB1/d.md'];

        it('plain-click selects a folder row on its own', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('NB1', { shift: false, ctrl: false }, MIXED_LIST));
            expect([...result.current.selectedPaths]).toEqual(['NB1']);
            expect(result.current.anchorPath).toBe('NB1');
        });

        it('a range spanning folders and pages selects the folder paths too', () => {
            const { result } = renderHook(() => useNotesSelection());
            // Anchor on a page, shift-click a later page: the intervening folder
            // row (NB1/sec) must be pulled into the selection.
            act(() => result.current.handleSelect('NB1/a.md', { shift: false, ctrl: false }, MIXED_LIST));
            act(() => result.current.handleSelect('NB1/d.md', { shift: true, ctrl: false }, MIXED_LIST));
            expect([...result.current.selectedPaths].sort()).toEqual([
                'NB1/a.md', 'NB1/d.md', 'NB1/sec', 'NB1/sec/b.md',
            ]);
            // Folder path explicitly present.
            expect(result.current.selectedPaths.has('NB1/sec')).toBe(true);
        });

        it('ctrl-click adds a folder to a page selection', () => {
            const { result } = renderHook(() => useNotesSelection());
            act(() => result.current.handleSelect('NB1/a.md', { shift: false, ctrl: false }, MIXED_LIST));
            act(() => result.current.handleSelect('NB1', { shift: false, ctrl: true }, MIXED_LIST));
            expect(result.current.selectedPaths.has('NB1')).toBe(true);
            expect(result.current.selectedPaths.has('NB1/a.md')).toBe(true);
            expect(result.current.selectedPaths.size).toBe(2);
        });
    });
});
