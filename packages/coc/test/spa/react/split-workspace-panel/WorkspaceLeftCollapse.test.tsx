/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    LEFT_RAIL_WIDTH,
    readLeftCollapsed,
    splitWorkspaceLeftCollapsedStorageKey,
    toggleLeftCollapsed,
    useLeftCollapsed,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';

describe('WorkspaceLeftCollapse store', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('builds the per-workspace key under the split-workspace convention', () => {
        expect(splitWorkspaceLeftCollapsedStorageKey('ws1')).toBe('split-workspace:ws1:left-collapsed');
        expect(splitWorkspaceLeftCollapsedStorageKey('other')).toBe('split-workspace:other:left-collapsed');
    });

    it('mirrors the classic rail width (36px / w-9)', () => {
        expect(LEFT_RAIL_WIDTH).toBe(36);
    });

    it('reads false by default and true only for a stored "1"', () => {
        const key = splitWorkspaceLeftCollapsedStorageKey('ws1');
        expect(readLeftCollapsed(key)).toBe(false);
        localStorage.setItem(key, '1');
        expect(readLeftCollapsed(key)).toBe(true);
        localStorage.setItem(key, '0');
        expect(readLeftCollapsed(key)).toBe(false);
    });

    it('toggleLeftCollapsed flips the persisted flag between 1 and 0', () => {
        const key = splitWorkspaceLeftCollapsedStorageKey('ws1');
        toggleLeftCollapsed(key);
        expect(localStorage.getItem(key)).toBe('1');
        toggleLeftCollapsed(key);
        expect(localStorage.getItem(key)).toBe('0');
    });

    it('useLeftCollapsed reflects the persisted value and toggles it', () => {
        const key = splitWorkspaceLeftCollapsedStorageKey('ws1');
        const { result } = renderHook(() => useLeftCollapsed(key));
        expect(result.current[0]).toBe(false);
        act(() => { result.current[1](); });
        expect(result.current[0]).toBe(true);
        expect(localStorage.getItem(key)).toBe('1');
        act(() => { result.current[1](); });
        expect(result.current[0]).toBe(false);
    });

    it('rehydrates from a previously persisted collapsed flag', () => {
        const key = splitWorkspaceLeftCollapsedStorageKey('ws-restore');
        localStorage.setItem(key, '1');
        const { result } = renderHook(() => useLeftCollapsed(key));
        expect(result.current[0]).toBe(true);
    });

    it('stays in sync across separate subtrees (cross-tree store)', () => {
        const key = splitWorkspaceLeftCollapsedStorageKey('ws1');
        const a = renderHook(() => useLeftCollapsed(key));
        const b = renderHook(() => useLeftCollapsed(key));
        expect(a.result.current[0]).toBe(false);
        expect(b.result.current[0]).toBe(false);
        // Toggling from one consumer updates the other, even a plain (non-hook)
        // toggle from outside React (mirrors the Router keydown path).
        act(() => { a.result.current[1](); });
        expect(a.result.current[0]).toBe(true);
        expect(b.result.current[0]).toBe(true);
        act(() => { toggleLeftCollapsed(key); });
        expect(a.result.current[0]).toBe(false);
        expect(b.result.current[0]).toBe(false);
    });

    it('keeps different workspaces independent', () => {
        const k1 = splitWorkspaceLeftCollapsedStorageKey('ws-a');
        const k2 = splitWorkspaceLeftCollapsedStorageKey('ws-b');
        toggleLeftCollapsed(k1);
        expect(localStorage.getItem(k1)).toBe('1');
        expect(localStorage.getItem(k2)).toBeNull();
    });
});
