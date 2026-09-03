import { describe, it, expect } from 'vitest';
import {
    EMPTY_EXPLORER_TABS,
    activateTab,
    activeTab,
    allTabIds,
    clearTabRevealLine,
    closeTab,
    closeTabs,
    cycleTabs,
    cycleTabsWithin,
    fileTabId,
    findTab,
    hasFileTab,
    moveTab,
    openFileTab,
    openSearchTab,
    otherTabIds,
    parseExplorerTabs,
    pinTab,
    previewTab,
    searchTabId,
    serializeExplorerTabs,
    tabIdsToRight,
    tabLabels,
    type ExplorerTabsState,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTabsModel';

/** Open a pinned file tab — the double-click / deep-link path. */
function openPinned(state: ExplorerTabsState, path: string, name = path.split('/').pop()!): ExplorerTabsState {
    return openFileTab(state, { path, name, preview: false });
}

/** Open a preview file tab — the single-click / search-hit path. */
function openPreview(state: ExplorerTabsState, path: string, name = path.split('/').pop()!): ExplorerTabsState {
    return openFileTab(state, { path, name, preview: true });
}

function paths(state: ExplorerTabsState): string[] {
    return state.tabs.map(tab => tab.path);
}

describe('explorerTabsModel — opening files', () => {
    it('opens a preview tab that a second single click replaces in place', () => {
        let state = openPreview(EMPTY_EXPLORER_TABS, 'src/a.ts');
        expect(paths(state)).toEqual(['src/a.ts']);
        expect(state.tabs[0].preview).toBe(true);

        state = openPreview(state, 'src/b.ts');
        expect(paths(state)).toEqual(['src/b.ts']);
        expect(state.activeId).toBe(fileTabId('src/b.ts'));
        expect(previewTab(state)?.path).toBe('src/b.ts');
    });

    it('replaces the preview tab in its own slot, leaving pinned tabs put', () => {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'src/pinned.ts');
        state = openPreview(state, 'src/first.ts');
        state = openPinned(state, 'src/last.ts');
        expect(paths(state)).toEqual(['src/pinned.ts', 'src/first.ts', 'src/last.ts']);

        state = openPreview(state, 'src/second.ts');
        expect(paths(state)).toEqual(['src/pinned.ts', 'src/second.ts', 'src/last.ts']);
    });

    it('keeps at most one preview tab no matter how many previews are opened', () => {
        let state = EMPTY_EXPLORER_TABS;
        for (const path of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) state = openPreview(state, path);
        expect(state.tabs).toHaveLength(1);
        expect(state.tabs.filter(tab => tab.preview)).toHaveLength(1);
    });

    it('opens a pinned tab that later previews cannot replace', () => {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'src/a.ts');
        state = openPreview(state, 'src/b.ts');
        expect(paths(state)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(state.tabs[0].preview).toBe(false);
    });

    it('promotes an existing preview tab when the same file is opened pinned', () => {
        let state = openPreview(EMPTY_EXPLORER_TABS, 'src/a.ts');
        state = openPinned(state, 'src/a.ts');
        expect(state.tabs).toHaveLength(1);
        expect(state.tabs[0].preview).toBe(false);
    });

    it('never demotes a pinned tab back to preview', () => {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'src/a.ts');
        state = openPreview(state, 'src/a.ts');
        expect(state.tabs[0].preview).toBe(false);
    });

    it('activates the existing tab instead of duplicating an open file', () => {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'src/a.ts');
        state = openPinned(state, 'src/b.ts');
        state = openPinned(state, 'src/a.ts');
        expect(state.tabs).toHaveLength(2);
        expect(state.activeId).toBe(fileTabId('src/a.ts'));
    });

    it('carries a reveal line onto the tab and refreshes it on re-open', () => {
        let state = openFileTab(EMPTY_EXPLORER_TABS, { path: 'a.ts', name: 'a.ts', preview: true, line: 12 });
        expect(state.tabs[0].line).toBe(12);

        state = openFileTab(state, { path: 'a.ts', name: 'a.ts', preview: true, line: 40 });
        expect(state.tabs[0].line).toBe(40);

        // An open with no line must not wipe the pending reveal.
        state = openFileTab(state, { path: 'a.ts', name: 'a.ts', preview: true });
        expect(state.tabs[0].line).toBe(40);
    });

    it('clears a reveal line once the editor has consumed it', () => {
        const state = openFileTab(EMPTY_EXPLORER_TABS, { path: 'a.ts', name: 'a.ts', preview: true, line: 3 });
        const cleared = clearTabRevealLine(state, fileTabId('a.ts'));
        expect(cleared.tabs[0].line).toBeUndefined();
        // Idempotent, and identity-stable once there is nothing left to clear.
        expect(clearTabRevealLine(cleared, fileTabId('a.ts'))).toBe(cleared);
    });

    it('marks trusted absolute-path files read-only', () => {
        const state = openFileTab(EMPTY_EXPLORER_TABS, {
            path: 'trusted:/etc/hosts',
            name: 'hosts',
            preview: true,
            readOnly: true,
        });
        expect(state.tabs[0].readOnly).toBe(true);
    });

    it('reports open files through hasFileTab and findTab', () => {
        const state = openPinned(EMPTY_EXPLORER_TABS, 'src/a.ts');
        expect(hasFileTab(state, 'src/a.ts')).toBe(true);
        expect(hasFileTab(state, 'src/b.ts')).toBe(false);
        expect(findTab(state, fileTabId('src/a.ts'))?.name).toBe('a.ts');
        expect(findTab(state, 'missing')).toBeNull();
    });
});

describe('explorerTabsModel — search tabs', () => {
    it('opens a pinned read-only tab that a preview open cannot replace', () => {
        let state = openSearchTab(EMPTY_EXPLORER_TABS, { query: 'foo', name: 'Search: foo' });
        expect(state.tabs[0]).toMatchObject({ kind: 'search', preview: false, readOnly: true, query: 'foo' });

        state = openPreview(state, 'src/a.ts');
        expect(state.tabs).toHaveLength(2);
        expect(state.tabs[0].kind).toBe('search');
    });

    it('re-activates the buffer for a repeated query rather than stacking tabs', () => {
        let state = openSearchTab(EMPTY_EXPLORER_TABS, { query: 'foo', name: 'Search: foo' });
        state = openPinned(state, 'src/a.ts');
        state = openSearchTab(state, { query: 'foo', name: 'Search: foo (2)' });
        expect(state.tabs).toHaveLength(2);
        expect(state.activeId).toBe(searchTabId('foo'));
        expect(state.tabs[0].name).toBe('Search: foo (2)');
    });

    it('gives a different query its own tab', () => {
        let state = openSearchTab(EMPTY_EXPLORER_TABS, { query: 'foo', name: 'Search: foo' });
        state = openSearchTab(state, { query: 'bar', name: 'Search: bar' });
        expect(state.tabs).toHaveLength(2);
    });
});

describe('explorerTabsModel — activation and MRU', () => {
    function threeTabs(): ExplorerTabsState {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'a.ts');
        state = openPinned(state, 'b.ts');
        state = openPinned(state, 'c.ts');
        return state;
    }

    it('tracks activation order most-recent-first', () => {
        const state = threeTabs();
        expect(state.mru).toEqual([fileTabId('c.ts'), fileTabId('b.ts'), fileTabId('a.ts')]);
        const next = activateTab(state, fileTabId('a.ts'));
        expect(next.activeId).toBe(fileTabId('a.ts'));
        expect(next.mru[0]).toBe(fileTabId('a.ts'));
    });

    it('ignores activation of a tab that is not open', () => {
        const state = threeTabs();
        expect(activateTab(state, 'file:nope.ts')).toBe(state);
    });

    it('returns the active tab object', () => {
        expect(activeTab(threeTabs())?.path).toBe('c.ts');
        expect(activeTab(EMPTY_EXPLORER_TABS)).toBeNull();
    });

    it('cycles forward and backward through the MRU with wraparound', () => {
        const state = threeTabs();
        // Active is c (mru index 0); forward steps to the next-least-recent.
        expect(cycleTabs(state, 'forward')).toBe(fileTabId('b.ts'));
        expect(cycleTabs(state, 'backward')).toBe(fileTabId('a.ts'));

        const onOldest = activateTab(state, fileTabId('a.ts'));
        expect(cycleTabs(onOldest, 'forward')).toBe(fileTabId('c.ts'));
    });

    it('walks an explicit MRU snapshot, which is how a held Ctrl reaches the third tab', () => {
        const snapshot = [fileTabId('c.ts'), fileTabId('b.ts'), fileTabId('a.ts')];
        const first = cycleTabsWithin(snapshot, fileTabId('c.ts'), 'forward');
        expect(first).toBe(fileTabId('b.ts'));
        // The caller activated b, reordering the live MRU — walking the
        // snapshot still moves on to a instead of bouncing back to c.
        expect(cycleTabsWithin(snapshot, first, 'forward')).toBe(fileTabId('a.ts'));
        expect(cycleTabsWithin(snapshot, fileTabId('a.ts'), 'forward')).toBe(fileTabId('c.ts'));
        expect(cycleTabsWithin(snapshot, fileTabId('c.ts'), 'backward')).toBe(fileTabId('a.ts'));
        expect(cycleTabsWithin(snapshot, null, 'forward')).toBe(fileTabId('b.ts'));
        expect(cycleTabsWithin(snapshot, 'file:gone', 'forward')).toBe(fileTabId('b.ts'));
        expect(cycleTabsWithin([fileTabId('a.ts')], fileTabId('a.ts'), 'forward')).toBeNull();
        expect(cycleTabsWithin([], null, 'forward')).toBeNull();
    });

    it('has nothing to cycle to with fewer than two tabs', () => {
        expect(cycleTabs(EMPTY_EXPLORER_TABS, 'forward')).toBeNull();
        expect(cycleTabs(openPinned(EMPTY_EXPLORER_TABS, 'a.ts'), 'forward')).toBeNull();
    });

    it('pins a preview tab and leaves an already-pinned tab identical', () => {
        const state = openPreview(EMPTY_EXPLORER_TABS, 'a.ts');
        const pinned = pinTab(state, fileTabId('a.ts'));
        expect(pinned.tabs[0].preview).toBe(false);
        expect(pinTab(pinned, fileTabId('a.ts'))).toBe(pinned);
        expect(pinTab(pinned, 'file:missing')).toBe(pinned);
    });

    it('pinning does not change activation or order', () => {
        let state = openPreview(EMPTY_EXPLORER_TABS, 'a.ts');
        state = openPinned(state, 'b.ts');
        const pinned = pinTab(state, fileTabId('a.ts'));
        expect(pinned.activeId).toBe(state.activeId);
        expect(pinned.mru).toEqual(state.mru);
    });
});

describe('explorerTabsModel — closing', () => {
    function threeTabs(): ExplorerTabsState {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'a.ts');
        state = openPinned(state, 'b.ts');
        state = openPinned(state, 'c.ts');
        return state;
    }

    it('activates the most recently used survivor when the active tab closes', () => {
        // Visit a, then b, then back to c: MRU is c, b, a.
        let state = threeTabs();
        state = activateTab(state, fileTabId('a.ts'));
        state = activateTab(state, fileTabId('c.ts'));
        state = closeTab(state, fileTabId('c.ts'));
        expect(state.activeId).toBe(fileTabId('a.ts'));
    });

    it('leaves the active tab alone when a different tab closes', () => {
        const state = closeTab(threeTabs(), fileTabId('a.ts'));
        expect(state.activeId).toBe(fileTabId('c.ts'));
        expect(paths(state)).toEqual(['b.ts', 'c.ts']);
    });

    it('empties out to a null active tab', () => {
        let state = threeTabs();
        state = closeTabs(state, allTabIds(state));
        expect(state.tabs).toEqual([]);
        expect(state.activeId).toBeNull();
        expect(state.mru).toEqual([]);
    });

    it('is a no-op for ids that are not open', () => {
        const state = threeTabs();
        expect(closeTab(state, 'file:nope.ts')).toBe(state);
        expect(closeTabs(state, [])).toBe(state);
    });

    it('drops closed ids from the MRU', () => {
        const state = closeTab(threeTabs(), fileTabId('b.ts'));
        expect(state.mru).not.toContain(fileTabId('b.ts'));
        expect(state.mru).toHaveLength(2);
    });

    it('computes the Close Others, Close to the Right and Close All target sets', () => {
        const state = threeTabs();
        expect(otherTabIds(state, fileTabId('b.ts'))).toEqual([fileTabId('a.ts'), fileTabId('c.ts')]);
        expect(tabIdsToRight(state, fileTabId('a.ts'))).toEqual([fileTabId('b.ts'), fileTabId('c.ts')]);
        expect(tabIdsToRight(state, fileTabId('c.ts'))).toEqual([]);
        expect(tabIdsToRight(state, 'file:nope.ts')).toEqual([]);
        expect(allTabIds(state)).toHaveLength(3);
    });

    it('closes others down to the one kept tab, which becomes active', () => {
        const state = threeTabs();
        const kept = fileTabId('a.ts');
        const next = closeTabs(state, otherTabIds(state, kept));
        expect(paths(next)).toEqual(['a.ts']);
        expect(next.activeId).toBe(kept);
    });
});

describe('explorerTabsModel — reordering', () => {
    function threeTabs(): ExplorerTabsState {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'a.ts');
        state = openPinned(state, 'b.ts');
        state = openPinned(state, 'c.ts');
        return state;
    }

    it('moves a tab to a later slot', () => {
        expect(paths(moveTab(threeTabs(), 0, 2))).toEqual(['b.ts', 'c.ts', 'a.ts']);
    });

    it('moves a tab to an earlier slot', () => {
        expect(paths(moveTab(threeTabs(), 2, 0))).toEqual(['c.ts', 'a.ts', 'b.ts']);
    });

    it('does not change which tab is active', () => {
        const state = threeTabs();
        const moved = moveTab(state, 2, 0);
        expect(moved.activeId).toBe(state.activeId);
        expect(moved.mru).toEqual(state.mru);
    });

    it('ignores no-op and out-of-range moves', () => {
        const state = threeTabs();
        expect(moveTab(state, 1, 1)).toBe(state);
        expect(moveTab(state, -1, 0)).toBe(state);
        expect(moveTab(state, 0, 3)).toBe(state);
        expect(moveTab(state, 5, 0)).toBe(state);
    });
});

describe('explorerTabsModel — labels', () => {
    it('shows the bare filename when nothing collides', () => {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'src/a.ts');
        state = openPinned(state, 'src/b.ts');
        const labels = tabLabels(state.tabs);
        expect(labels.get(fileTabId('src/a.ts'))).toBe('a.ts');
        expect(labels.get(fileTabId('src/b.ts'))).toBe('b.ts');
    });

    it('adds the shortest distinguishing parent path on a collision', () => {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'src/index.ts', 'index.ts');
        state = openPinned(state, 'test/index.ts', 'index.ts');
        const labels = tabLabels(state.tabs);
        expect(labels.get(fileTabId('src/index.ts'))).toBe('src/index.ts');
        expect(labels.get(fileTabId('test/index.ts'))).toBe('test/index.ts');
    });

    it('grows the suffix until the colliding paths differ', () => {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'a/shared/index.ts', 'index.ts');
        state = openPinned(state, 'b/shared/index.ts', 'index.ts');
        const labels = tabLabels(state.tabs);
        expect(labels.get(fileTabId('a/shared/index.ts'))).toBe('a/shared/index.ts');
        expect(labels.get(fileTabId('b/shared/index.ts'))).toBe('b/shared/index.ts');
    });

    it('leaves a search tab label alone even when a file shares its name', () => {
        let state = openSearchTab(EMPTY_EXPLORER_TABS, { query: 'foo', name: 'results.txt' });
        state = openPinned(state, 'src/results.txt', 'results.txt');
        const labels = tabLabels(state.tabs);
        expect(labels.get(searchTabId('foo'))).toBe('results.txt');
        expect(labels.get(fileTabId('src/results.txt'))).toBe('results.txt');
    });
});

describe('explorerTabsModel — persistence codec', () => {
    function session(): ExplorerTabsState {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'src/a.ts');
        state = openFileTab(state, { path: 'src/b.ts', name: 'b.ts', preview: true, line: 7 });
        state = openSearchTab(state, { query: 'foo', name: 'Search: foo' });
        state = openFileTab(state, {
            path: 'trusted:/etc/hosts',
            name: 'hosts',
            preview: false,
            readOnly: true,
        });
        return activateTab(state, fileTabId('src/a.ts'));
    }

    it('round-trips tabs, order, active tab, preview flags and MRU', () => {
        const state = session();
        const restored = parseExplorerTabs(serializeExplorerTabs(state));
        expect(restored.tabs).toEqual(state.tabs);
        expect(restored.activeId).toBe(state.activeId);
        expect(restored.mru).toEqual(state.mru);
    });

    it('falls back to an empty session for malformed payloads', () => {
        expect(parseExplorerTabs('null')).toBe(EMPTY_EXPLORER_TABS);
        expect(parseExplorerTabs('"nope"')).toBe(EMPTY_EXPLORER_TABS);
        expect(parseExplorerTabs('{}')).toBe(EMPTY_EXPLORER_TABS);
        expect(parseExplorerTabs('{"tabs":[]}')).toBe(EMPTY_EXPLORER_TABS);
        expect(parseExplorerTabs('{"tabs":"x"}')).toBe(EMPTY_EXPLORER_TABS);
    });

    it('drops individual malformed tabs but keeps the valid ones', () => {
        const raw = JSON.stringify({
            tabs: [
                { kind: 'file', path: 'a.ts', name: 'a.ts', preview: false, readOnly: false },
                { kind: 'file', name: 'no-path.ts', preview: false, readOnly: false },
                { kind: 'file', path: 'b.ts', preview: false, readOnly: false },
                { kind: 'nonsense', path: 'c.ts', name: 'c.ts' },
                { kind: 'search', name: 'no query' },
                null,
            ],
            activeId: fileTabId('a.ts'),
            mru: [fileTabId('a.ts')],
        });
        const restored = parseExplorerTabs(raw);
        expect(restored.tabs.map(tab => tab.path)).toEqual(['a.ts']);
    });

    it('repairs a payload with duplicate ids, two previews and a stale active id', () => {
        const raw = JSON.stringify({
            tabs: [
                { kind: 'file', path: 'a.ts', name: 'a.ts', preview: true, readOnly: false },
                { kind: 'file', path: 'b.ts', name: 'b.ts', preview: true, readOnly: false },
                { kind: 'file', path: 'a.ts', name: 'a.ts', preview: false, readOnly: false },
            ],
            activeId: fileTabId('gone.ts'),
            mru: [fileTabId('gone.ts'), fileTabId('b.ts')],
        });
        const restored = parseExplorerTabs(raw);
        expect(restored.tabs.map(tab => tab.path)).toEqual(['a.ts', 'b.ts']);
        expect(restored.tabs.filter(tab => tab.preview)).toHaveLength(1);
        expect(restored.mru).toEqual([fileTabId('b.ts'), fileTabId('a.ts')]);
        expect(restored.activeId).toBe(fileTabId('b.ts'));
    });

    it('persists no buffer contents — only tab structure', () => {
        const raw = serializeExplorerTabs(session());
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect(Object.keys(parsed).sort()).toEqual(['activeId', 'mru', 'tabs']);
        for (const tab of parsed.tabs as Record<string, unknown>[]) {
            expect(Object.keys(tab).sort()).toEqual(
                expect.arrayContaining(['id', 'kind', 'name', 'path', 'preview', 'readOnly']),
            );
            expect(tab).not.toHaveProperty('content');
        }
    });
});

describe('explorerTabsModel — reference stability', () => {
    it('returns the same state object when an operation changes nothing', () => {
        let state = openPinned(EMPTY_EXPLORER_TABS, 'a.ts');
        state = openPinned(state, 'b.ts');
        expect(activateTab(state, fileTabId('b.ts'))).toBe(state);
        expect(openPinned(state, 'b.ts')).toBe(state);
        expect(moveTab(state, 0, 0)).toBe(state);
        expect(closeTabs(state, ['file:missing'])).toBe(state);
    });
});
