/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    NOTES_SIDEBAR_RAIL_WIDTH,
    notesSidebarCollapsedStorageKey,
    readNotesSidebarCollapsed,
    useNotesSidebarCollapsed,
} from '../../../../../src/server/spa/client/react/features/notes/editor/NotesSidebarCollapse';

describe('NotesSidebarCollapse store', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('builds the per-workspace key under the coc-notes convention', () => {
        expect(notesSidebarCollapsedStorageKey('ws1')).toBe('coc-notes-sidebar-collapsed-ws1');
        // Virtual workspaces (My Life / My Work) get their own scoped keys.
        expect(notesSidebarCollapsedStorageKey('my_life')).toBe('coc-notes-sidebar-collapsed-my_life');
        expect(notesSidebarCollapsedStorageKey('my_work')).toBe('coc-notes-sidebar-collapsed-my_work');
    });

    it('mirrors the classic rail width (36px / w-9)', () => {
        expect(NOTES_SIDEBAR_RAIL_WIDTH).toBe(36);
    });

    it('reads false by default and true only for a stored "1"', () => {
        const key = notesSidebarCollapsedStorageKey('ws1');
        expect(readNotesSidebarCollapsed(key)).toBe(false);
        localStorage.setItem(key, '1');
        expect(readNotesSidebarCollapsed(key)).toBe(true);
        localStorage.setItem(key, '0');
        expect(readNotesSidebarCollapsed(key)).toBe(false);
    });

    it('useNotesSidebarCollapsed reflects the persisted value and toggles it', () => {
        const key = notesSidebarCollapsedStorageKey('ws1');
        const { result } = renderHook(() => useNotesSidebarCollapsed('ws1'));
        expect(result.current[0]).toBe(false);
        act(() => { result.current[1](); });
        expect(result.current[0]).toBe(true);
        expect(localStorage.getItem(key)).toBe('1');
        act(() => { result.current[1](); });
        expect(result.current[0]).toBe(false);
        expect(localStorage.getItem(key)).toBe('0');
    });

    it('rehydrates from a previously persisted collapsed flag', () => {
        localStorage.setItem(notesSidebarCollapsedStorageKey('ws-restore'), '1');
        const { result } = renderHook(() => useNotesSidebarCollapsed('ws-restore'));
        expect(result.current[0]).toBe(true);
    });

    it('does not write to storage on mount (a workspace with no collapse history stays clean)', () => {
        const key = notesSidebarCollapsedStorageKey('ws1');
        renderHook(() => useNotesSidebarCollapsed('ws1'));
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('re-syncs from storage on a workspace switch without persisting the read', () => {
        localStorage.setItem(notesSidebarCollapsedStorageKey('ws-b'), '1');
        const { result, rerender } = renderHook(
            ({ ws }) => useNotesSidebarCollapsed(ws),
            { initialProps: { ws: 'ws-a' } },
        );
        expect(result.current[0]).toBe(false);
        rerender({ ws: 'ws-b' });
        expect(result.current[0]).toBe(true);
        // Switching workspaces is a read, not a user toggle: ws-a stays clean.
        expect(localStorage.getItem(notesSidebarCollapsedStorageKey('ws-a'))).toBeNull();
    });

    it('keeps different workspaces independent', () => {
        const { result } = renderHook(() => useNotesSidebarCollapsed('ws-a'));
        act(() => { result.current[1](); });
        expect(localStorage.getItem(notesSidebarCollapsedStorageKey('ws-a'))).toBe('1');
        expect(localStorage.getItem(notesSidebarCollapsedStorageKey('ws-b'))).toBeNull();
    });
});
