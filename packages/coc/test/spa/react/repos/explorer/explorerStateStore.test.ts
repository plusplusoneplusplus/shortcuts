/**
 * Tests for explorerStateStore — per-workspace, localStorage-backed persistence
 * of the File Explorer's UI state (expanded paths + selected/open preview file).
 *
 * These guard AC-01 of preserve-explorer-state: state survives a remount
 * (workspace switch) and a reload, keyed per workspace, and each workspace's
 * state is independent.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    explorerExpandedStorageKey,
    explorerSelectedStorageKey,
    explorerPreviewStorageKey,
    useExplorerExpandedPaths,
    useExplorerSelectedPath,
    useExplorerPreviewFile,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';

beforeEach(() => {
    localStorage.clear();
});

describe('explorerStateStore — storage keys', () => {
    it('scopes keys per workspace under the split-workspace convention', () => {
        expect(explorerExpandedStorageKey('ws-1')).toBe('split-workspace:ws-1:explorer-expanded');
        expect(explorerSelectedStorageKey('ws-1')).toBe('split-workspace:ws-1:explorer-selected');
        expect(explorerPreviewStorageKey('ws-1')).toBe('split-workspace:ws-1:explorer-preview');
    });

    it('produces distinct keys for distinct workspaces', () => {
        expect(explorerExpandedStorageKey('a')).not.toBe(explorerExpandedStorageKey('b'));
    });
});

describe('useExplorerExpandedPaths', () => {
    it('starts empty when nothing is persisted', () => {
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        expect(result.current[0]).toBeInstanceOf(Set);
        expect(result.current[0].size).toBe(0);
    });

    it('persists to localStorage as a JSON array under the per-workspace key', () => {
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        act(() => result.current[1](new Set(['src', 'src/components'])));
        expect(result.current[0]).toEqual(new Set(['src', 'src/components']));
        const raw = localStorage.getItem(explorerExpandedStorageKey('ws-1'));
        expect(JSON.parse(raw!)).toEqual(['src', 'src/components']);
    });

    it('supports functional updater form like useState', () => {
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        act(() => result.current[1](new Set(['src'])));
        act(() => result.current[1](prev => {
            const next = new Set(prev);
            next.add('docs');
            return next;
        }));
        expect(result.current[0]).toEqual(new Set(['src', 'docs']));
    });

    it('shares state across two hook instances for the same workspace', () => {
        const a = renderHook(() => useExplorerExpandedPaths('ws-1'));
        const b = renderHook(() => useExplorerExpandedPaths('ws-1'));
        act(() => a.result.current[1](new Set(['src'])));
        expect(b.result.current[0]).toEqual(new Set(['src']));
    });

    it('keeps distinct workspaces independent', () => {
        const a = renderHook(() => useExplorerExpandedPaths('ws-a'));
        const b = renderHook(() => useExplorerExpandedPaths('ws-b'));
        act(() => a.result.current[1](new Set(['src'])));
        expect(a.result.current[0]).toEqual(new Set(['src']));
        expect(b.result.current[0].size).toBe(0);
    });

    it('restores from pre-seeded localStorage (simulates a reload)', () => {
        localStorage.setItem(explorerExpandedStorageKey('ws-1'), JSON.stringify(['a', 'a/b']));
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        expect(result.current[0]).toEqual(new Set(['a', 'a/b']));
    });

    it('falls back to empty on malformed persisted JSON', () => {
        localStorage.setItem(explorerExpandedStorageKey('ws-1'), '{not json');
        const { result } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        expect(result.current[0].size).toBe(0);
    });

    it('returns a referentially-stable value across re-renders when unchanged', () => {
        const { result, rerender } = renderHook(() => useExplorerExpandedPaths('ws-1'));
        act(() => result.current[1](new Set(['src'])));
        const first = result.current[0];
        rerender();
        expect(result.current[0]).toBe(first);
    });
});

describe('useExplorerSelectedPath', () => {
    it('starts null and round-trips through localStorage', () => {
        const { result } = renderHook(() => useExplorerSelectedPath('ws-1'));
        expect(result.current[0]).toBeNull();
        act(() => result.current[1]('src/index.ts'));
        expect(result.current[0]).toBe('src/index.ts');
        expect(JSON.parse(localStorage.getItem(explorerSelectedStorageKey('ws-1'))!)).toBe('src/index.ts');
    });

    it('can be cleared back to null', () => {
        const { result } = renderHook(() => useExplorerSelectedPath('ws-1'));
        act(() => result.current[1]('src/index.ts'));
        act(() => result.current[1](null));
        expect(result.current[0]).toBeNull();
    });
});

describe('useExplorerPreviewFile', () => {
    it('starts null and round-trips a preview file', () => {
        const { result } = renderHook(() => useExplorerPreviewFile('ws-1'));
        expect(result.current[0]).toBeNull();
        act(() => result.current[1]({ path: 'src/index.ts', name: 'index.ts' }));
        expect(result.current[0]).toEqual({ path: 'src/index.ts', name: 'index.ts' });
    });

    it('restores a preview file from pre-seeded localStorage (reload)', () => {
        localStorage.setItem(
            explorerPreviewStorageKey('ws-1'),
            JSON.stringify({ path: 'a/b.ts', name: 'b.ts' }),
        );
        const { result } = renderHook(() => useExplorerPreviewFile('ws-1'));
        expect(result.current[0]).toEqual({ path: 'a/b.ts', name: 'b.ts' });
    });

    it('ignores malformed preview payloads', () => {
        localStorage.setItem(explorerPreviewStorageKey('ws-1'), JSON.stringify({ path: 5 }));
        const { result } = renderHook(() => useExplorerPreviewFile('ws-1'));
        expect(result.current[0]).toBeNull();
    });
});
