/**
 * useNotesSelection — unit tests for the multi-selection hook.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotesSelection } from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesSelection';

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
});
