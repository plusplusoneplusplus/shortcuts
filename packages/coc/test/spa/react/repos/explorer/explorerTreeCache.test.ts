/**
 * Tests for explorerTreeCache — the in-memory, per-workspace cache of the File
 * Explorer's fetched tree data (root entries + directory children + a
 * root-loaded flag).
 *
 * These guard AC-02 of preserve-explorer-state: the cached tree survives the
 * `key={ws.id}` remount that a workspace switch triggers (simulated here by
 * unmounting and re-rendering a hook), each workspace's cache is independent, and
 * the cache can be invalidated for a refresh.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';
import {
    useExplorerRootEntries,
    useExplorerChildrenMap,
    useExplorerRootLoaded,
    clearExplorerTreeCache,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';

const SRC: TreeEntry = { name: 'src', type: 'dir', path: 'src' };
const APP: TreeEntry = { name: 'app.ts', type: 'file', path: 'src/app.ts' };

// The cache is module-level and persists across tests; reset it before each.
beforeEach(() => {
    clearExplorerTreeCache();
});

describe('useExplorerRootEntries', () => {
    it('starts as an empty array', () => {
        const { result } = renderHook(() => useExplorerRootEntries('ws-1'));
        expect(result.current[0]).toEqual([]);
    });

    it('stores and returns set entries', () => {
        const { result } = renderHook(() => useExplorerRootEntries('ws-1'));
        act(() => result.current[1]([SRC]));
        expect(result.current[0]).toEqual([SRC]);
    });

    it('supports the functional updater form like useState', () => {
        const { result } = renderHook(() => useExplorerRootEntries('ws-1'));
        act(() => result.current[1]([SRC]));
        act(() => result.current[1](prev => [...prev, APP]));
        expect(result.current[0]).toEqual([SRC, APP]);
    });

    it('survives a remount (workspace switch away and back)', () => {
        const first = renderHook(() => useExplorerRootEntries('ws-1'));
        act(() => first.result.current[1]([SRC]));
        first.unmount();
        const second = renderHook(() => useExplorerRootEntries('ws-1'));
        expect(second.result.current[0]).toEqual([SRC]);
    });

    it('returns a referentially-stable value across re-renders when unchanged', () => {
        const { result, rerender } = renderHook(() => useExplorerRootEntries('ws-1'));
        act(() => result.current[1]([SRC]));
        const firstRef = result.current[0];
        rerender();
        expect(result.current[0]).toBe(firstRef);
    });

    it('keeps distinct workspaces independent', () => {
        const a = renderHook(() => useExplorerRootEntries('ws-a'));
        const b = renderHook(() => useExplorerRootEntries('ws-b'));
        act(() => a.result.current[1]([SRC]));
        expect(a.result.current[0]).toEqual([SRC]);
        expect(b.result.current[0]).toEqual([]);
    });
});

describe('useExplorerChildrenMap', () => {
    it('starts as an empty Map', () => {
        const { result } = renderHook(() => useExplorerChildrenMap('ws-1'));
        expect(result.current[0]).toBeInstanceOf(Map);
        expect(result.current[0].size).toBe(0);
    });

    it('merges directory children via the functional updater', () => {
        const { result } = renderHook(() => useExplorerChildrenMap('ws-1'));
        act(() => result.current[1](prev => new Map(prev).set('src', [APP])));
        expect(result.current[0].get('src')).toEqual([APP]);
    });

    it('survives a remount so a switch-back does not re-fetch children', () => {
        const first = renderHook(() => useExplorerChildrenMap('ws-1'));
        act(() => first.result.current[1](new Map([['src', [APP]]])));
        first.unmount();
        const second = renderHook(() => useExplorerChildrenMap('ws-1'));
        expect(second.result.current[0].get('src')).toEqual([APP]);
    });

    it('shares state across two hook instances for the same workspace', () => {
        const a = renderHook(() => useExplorerChildrenMap('ws-1'));
        const b = renderHook(() => useExplorerChildrenMap('ws-1'));
        act(() => a.result.current[1](new Map([['src', [APP]]])));
        expect(b.result.current[0].get('src')).toEqual([APP]);
    });
});

describe('useExplorerRootLoaded', () => {
    it('starts false and flips to true, surviving a remount', () => {
        const first = renderHook(() => useExplorerRootLoaded('ws-1'));
        expect(first.result.current[0]).toBe(false);
        act(() => first.result.current[1](true));
        first.unmount();
        const second = renderHook(() => useExplorerRootLoaded('ws-1'));
        expect(second.result.current[0]).toBe(true);
    });

    it('is independent per workspace', () => {
        const a = renderHook(() => useExplorerRootLoaded('ws-a'));
        const b = renderHook(() => useExplorerRootLoaded('ws-b'));
        act(() => a.result.current[1](true));
        expect(a.result.current[0]).toBe(true);
        expect(b.result.current[0]).toBe(false);
    });
});

describe('clearExplorerTreeCache', () => {
    it('resets a single workspace and notifies its subscribers', () => {
        const loaded = renderHook(() => useExplorerRootLoaded('ws-1'));
        const entries = renderHook(() => useExplorerRootEntries('ws-1'));
        act(() => loaded.result.current[1](true));
        act(() => entries.result.current[1]([SRC]));
        act(() => clearExplorerTreeCache('ws-1'));
        expect(loaded.result.current[0]).toBe(false);
        expect(entries.result.current[0]).toEqual([]);
    });

    it('clears every workspace when called with no argument', () => {
        const a = renderHook(() => useExplorerRootLoaded('ws-a'));
        const b = renderHook(() => useExplorerRootEntries('ws-b'));
        act(() => a.result.current[1](true));
        act(() => b.result.current[1]([SRC]));
        act(() => clearExplorerTreeCache());
        expect(a.result.current[0]).toBe(false);
        expect(b.result.current[0]).toEqual([]);
    });

    it('does not affect an untouched workspace when clearing a specific one', () => {
        const a = renderHook(() => useExplorerRootLoaded('ws-a'));
        const b = renderHook(() => useExplorerRootLoaded('ws-b'));
        act(() => a.result.current[1](true));
        act(() => b.result.current[1](true));
        act(() => clearExplorerTreeCache('ws-a'));
        expect(a.result.current[0]).toBe(false);
        expect(b.result.current[0]).toBe(true);
    });
});
