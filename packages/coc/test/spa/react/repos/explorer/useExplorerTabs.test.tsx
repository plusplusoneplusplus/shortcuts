/**
 * Tests for the persisted Explorer editor-tab session (AC-02).
 *
 * Covers the two halves of the persistence slice:
 *  - `explorerStateStore`'s tabs key + codec: the session round-trips through
 *    localStorage under `split-workspace:<wsId>:explorer-tabs`, and nothing but
 *    tab structure is written there.
 *  - `useExplorerTabs`: the operation-shaped API, its stable callbacks, and the
 *    workspace scoping — two workspaces stay independent, two mounts of the
 *    same workspace stay in sync.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    explorerTabsStorageKey,
    useExplorerTabsState,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { useExplorerTabs } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/useExplorerTabs';
import {
    EMPTY_EXPLORER_TABS,
    fileTabId,
    searchTabId,
    serializeExplorerTabs,
    openFileTab,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTabsModel';

beforeEach(() => {
    localStorage.clear();
});

/** Read the persisted session for a workspace as parsed JSON. */
function storedTabs(workspaceId: string): any {
    const raw = localStorage.getItem(explorerTabsStorageKey(workspaceId));
    return raw === null ? null : JSON.parse(raw);
}

describe('explorerTabsStorageKey', () => {
    it('follows the per-workspace split-workspace convention', () => {
        expect(explorerTabsStorageKey('ws-1')).toBe('split-workspace:ws-1:explorer-tabs');
    });

    it('produces distinct keys for distinct workspaces', () => {
        expect(explorerTabsStorageKey('a')).not.toBe(explorerTabsStorageKey('b'));
    });
});

describe('useExplorerTabsState', () => {
    it('starts from the shared empty session when nothing is persisted', () => {
        const { result } = renderHook(() => useExplorerTabsState('ws-1'));
        expect(result.current[0]).toBe(EMPTY_EXPLORER_TABS);
    });

    it('writes the session to localStorage under the workspace key', () => {
        const { result } = renderHook(() => useExplorerTabsState('ws-1'));
        act(() => {
            result.current[1](prev => openFileTab(prev, { path: 'src/a.ts', name: 'a.ts', preview: true }));
        });
        expect(storedTabs('ws-1')).toEqual({
            tabs: [{
                id: fileTabId('src/a.ts'),
                kind: 'file',
                path: 'src/a.ts',
                name: 'a.ts',
                preview: true,
                readOnly: false,
            }],
            activeId: fileTabId('src/a.ts'),
            mru: [fileTabId('src/a.ts')],
        });
    });

    it('restores a persisted session on a fresh mount (page reload)', () => {
        localStorage.setItem(
            explorerTabsStorageKey('ws-1'),
            serializeExplorerTabs(openFileTab(EMPTY_EXPLORER_TABS, {
                path: 'src/a.ts',
                name: 'a.ts',
                preview: false,
            })),
        );
        const { result } = renderHook(() => useExplorerTabsState('ws-1'));
        expect(result.current[0].tabs.map(tab => tab.path)).toEqual(['src/a.ts']);
        expect(result.current[0].activeId).toBe(fileTabId('src/a.ts'));
    });

    it('falls back to an empty session on a corrupt payload rather than throwing', () => {
        localStorage.setItem(explorerTabsStorageKey('ws-1'), '{not json');
        const { result } = renderHook(() => useExplorerTabsState('ws-1'));
        expect(result.current[0]).toBe(EMPTY_EXPLORER_TABS);
    });

    it('returns a referentially stable snapshot across re-renders', () => {
        const { result, rerender } = renderHook(() => useExplorerTabsState('ws-1'));
        act(() => {
            result.current[1](prev => openFileTab(prev, { path: 'a.ts', name: 'a.ts', preview: true }));
        });
        const first = result.current[0];
        rerender();
        expect(result.current[0]).toBe(first);
    });
});

describe('useExplorerTabs — opening', () => {
    it('opens a file as the active preview tab', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'src/a.ts', name: 'a.ts', preview: true }));
        expect(result.current.tabs).toHaveLength(1);
        expect(result.current.active?.path).toBe('src/a.ts');
        expect(result.current.active?.preview).toBe(true);
    });

    it('replaces the preview tab when another file is single-clicked', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: true }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: true }));
        expect(result.current.tabs.map(tab => tab.path)).toEqual(['b.ts']);
    });

    it('keeps a pinned tab and appends when a second file is pinned', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        expect(result.current.tabs.map(tab => tab.path)).toEqual(['a.ts', 'b.ts']);
        expect(result.current.activeId).toBe(fileTabId('b.ts'));
    });

    it('pins a preview tab in place', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: true }));
        act(() => result.current.pin(fileTabId('a.ts')));
        expect(result.current.tabs[0].preview).toBe(false);
        expect(storedTabs('ws-1').tabs[0].preview).toBe(false);
    });

    it('opens a read-only search buffer alongside file tabs', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openSearch({ query: 'todo', name: 'Search: todo' }));
        expect(result.current.tabs.map(tab => tab.id)).toEqual([fileTabId('a.ts'), searchTabId('todo')]);
        expect(result.current.active?.readOnly).toBe(true);
    });
});

describe('useExplorerTabs — activation, ordering, closing', () => {
    it('activates an open tab without changing strip order', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        act(() => result.current.activate(fileTabId('a.ts')));
        expect(result.current.activeId).toBe(fileTabId('a.ts'));
        expect(result.current.tabs.map(tab => tab.path)).toEqual(['a.ts', 'b.ts']);
    });

    it('persists a drag reorder', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        act(() => result.current.move(0, 1));
        expect(result.current.tabs.map(tab => tab.path)).toEqual(['b.ts', 'a.ts']);
        expect(storedTabs('ws-1').tabs.map((tab: any) => tab.path)).toEqual(['b.ts', 'a.ts']);
    });

    it('falls back to the most recently used tab when the active one closes', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        act(() => result.current.openFile({ path: 'c.ts', name: 'c.ts', preview: false }));
        act(() => result.current.activate(fileTabId('a.ts')));
        act(() => result.current.activate(fileTabId('c.ts')));
        act(() => result.current.close(fileTabId('c.ts')));
        expect(result.current.activeId).toBe(fileTabId('a.ts'));
    });

    it('closes a set of tabs and empties the strip on close-all', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        act(() => result.current.closeMany(result.current.idsOther(fileTabId('a.ts'))));
        expect(result.current.tabs.map(tab => tab.path)).toEqual(['a.ts']);
        act(() => result.current.closeAll());
        expect(result.current.tabs).toHaveLength(0);
        expect(result.current.activeId).toBeNull();
        expect(storedTabs('ws-1')).toEqual({ tabs: [], activeId: null, mru: [] });
    });

    it('cycles through tabs in MRU order, forward and backward', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        act(() => result.current.openFile({ path: 'c.ts', name: 'c.ts', preview: false }));
        // MRU is c, b, a — active is c.
        const first = result.current.cycle('forward');
        expect(first).toBe(fileTabId('b.ts'));
        // A held Ctrl continues from the highlighted step without committing it.
        expect(result.current.cycle('forward', first!)).toBe(fileTabId('a.ts'));
        expect(result.current.cycle('backward')).toBe(fileTabId('a.ts'));
    });
});

describe('useExplorerTabs — labels and lookups', () => {
    it('widens colliding filenames to the shortest distinguishing path', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'src/index.ts', name: 'index.ts', preview: false }));
        act(() => result.current.openFile({ path: 'test/index.ts', name: 'index.ts', preview: false }));
        act(() => result.current.openFile({ path: 'src/app.ts', name: 'app.ts', preview: false }));
        expect(result.current.labels.get(fileTabId('src/index.ts'))).toBe('src/index.ts');
        expect(result.current.labels.get(fileTabId('test/index.ts'))).toBe('test/index.ts');
        expect(result.current.labels.get(fileTabId('src/app.ts'))).toBe('app.ts');
    });

    it('finds open tabs and reports the close-others / close-all target sets', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        expect(result.current.find(fileTabId('a.ts'))?.name).toBe('a.ts');
        expect(result.current.find('file:missing.ts')).toBeNull();
        expect(result.current.idsOther(fileTabId('a.ts'))).toEqual([fileTabId('b.ts')]);
        expect(result.current.idsAll()).toEqual([fileTabId('a.ts'), fileTabId('b.ts')]);
    });
});

describe('useExplorerTabs — stability and scoping', () => {
    it('keeps action callbacks referentially stable across state changes', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        const before = {
            openFile: result.current.openFile,
            activate: result.current.activate,
            close: result.current.close,
            cycle: result.current.cycle,
        };
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        expect(result.current.openFile).toBe(before.openFile);
        expect(result.current.activate).toBe(before.activate);
        expect(result.current.close).toBe(before.close);
        expect(result.current.cycle).toBe(before.cycle);
    });

    it('sees the freshest state from a stable callback after a state change', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        const openFile = result.current.openFile;
        act(() => openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        expect(result.current.tabs.map(tab => tab.path)).toEqual(['a.ts', 'b.ts']);
    });

    it('keeps two workspaces fully independent', () => {
        const a = renderHook(() => useExplorerTabs('ws-a'));
        const b = renderHook(() => useExplorerTabs('ws-b'));
        act(() => a.result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => b.result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        expect(a.result.current.tabs.map(tab => tab.path)).toEqual(['a.ts']);
        expect(b.result.current.tabs.map(tab => tab.path)).toEqual(['b.ts']);
        expect(storedTabs('ws-a').tabs).toHaveLength(1);
        expect(storedTabs('ws-b').tabs).toHaveLength(1);
    });

    it('synchronizes two simultaneous mounts of the same workspace', () => {
        const first = renderHook(() => useExplorerTabs('ws-1'));
        const second = renderHook(() => useExplorerTabs('ws-1'));
        act(() => first.result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        expect(second.result.current.tabs.map(tab => tab.path)).toEqual(['a.ts']);
        act(() => second.result.current.close(fileTabId('a.ts')));
        expect(first.result.current.tabs).toHaveLength(0);
    });

    it('restores the session after a remount (workspace switch and back)', () => {
        const first = renderHook(() => useExplorerTabs('ws-1'));
        act(() => first.result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false }));
        act(() => first.result.current.openFile({ path: 'b.ts', name: 'b.ts', preview: false }));
        act(() => first.result.current.activate(fileTabId('a.ts')));
        first.unmount();

        const remounted = renderHook(() => useExplorerTabs('ws-1'));
        expect(remounted.result.current.tabs.map(tab => tab.path)).toEqual(['a.ts', 'b.ts']);
        expect(remounted.result.current.activeId).toBe(fileTabId('a.ts'));
        // The MRU survives too, so Ctrl+Tab picks up where it left off.
        expect(remounted.result.current.cycle('forward')).toBe(fileTabId('b.ts'));
    });

    it('never persists buffer contents — only tab structure reaches storage', () => {
        const { result } = renderHook(() => useExplorerTabs('ws-1'));
        act(() => result.current.openFile({ path: 'a.ts', name: 'a.ts', preview: false, line: 12 }));
        const raw = localStorage.getItem(explorerTabsStorageKey('ws-1'))!;
        expect(raw).not.toContain('content');
        expect(raw).not.toContain('dirty');
        const keys = Object.keys(storedTabs('ws-1').tabs[0]).sort();
        expect(keys).toEqual(['id', 'kind', 'line', 'name', 'path', 'preview', 'readOnly']);
    });
});
