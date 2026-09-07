/**
 * unifiedPanelTree — the unified panel's file-tree column state (AC-01).
 *
 * Three promises are under test: the column's open bit and width are panel-level
 * and outlive tab/chat switches and reloads; the width never squeezes the file
 * view below its minimum; and a panel dragged too narrow hides the tree WITHOUT
 * flipping the persisted bit, so widening brings it back.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import {
    DEFAULT_UNIFIED_TREE_STATE,
    UNIFIED_PANEL_VIEW_MIN_WIDTH,
    UNIFIED_TREE_DEFAULT_WIDTH,
    UNIFIED_TREE_MAX_WIDTH,
    UNIFIED_TREE_MIN_PANEL_WIDTH,
    UNIFIED_TREE_MIN_WIDTH,
    clampUnifiedTreeWidth,
    clearUnifiedTreeState,
    isUnifiedTreeVisible,
    maxUnifiedTreeWidth,
    parseUnifiedTreeState,
    readUnifiedTreeState,
    serializeUnifiedTreeState,
    unifiedPanelTreeStorageKey,
    useUnifiedPanelTree,
    writeUnifiedTreeState,
    type UnifiedPanelTreeApi,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';

const WS = 'ws-1';

/** Probe that exposes one consumer's view of the column state to the test. */
function Probe({ workspaceId, name, onApi }: {
    workspaceId: string;
    name: string;
    onApi?: (api: UnifiedPanelTreeApi) => void;
}) {
    const api = useUnifiedPanelTree(workspaceId);
    onApi?.(api);
    return (
        <div>
            <span data-testid={`${name}-open`}>{String(api.state.open)}</span>
            <span data-testid={`${name}-width`}>{api.state.width}</span>
        </div>
    );
}

function openOf(name: string): string {
    return screen.getByTestId(`${name}-open`).textContent ?? '';
}

function widthOf(name: string): string {
    return screen.getByTestId(`${name}-width`).textContent ?? '';
}

describe('unifiedPanelTree width rules', () => {
    it('clamps the tree so the view keeps its minimum', () => {
        const panelWidth = UNIFIED_TREE_MIN_PANEL_WIDTH + 100;
        // Room for 240px of tree; asking for the whole panel gets that instead.
        expect(maxUnifiedTreeWidth(panelWidth)).toBe(panelWidth - UNIFIED_PANEL_VIEW_MIN_WIDTH);
        expect(clampUnifiedTreeWidth(panelWidth, panelWidth)).toBe(panelWidth - UNIFIED_PANEL_VIEW_MIN_WIDTH);
    });

    it('floors the tree at its own minimum', () => {
        expect(clampUnifiedTreeWidth(10, 1200)).toBe(UNIFIED_TREE_MIN_WIDTH);
    });

    it('caps the tree at the absolute maximum however wide the panel is', () => {
        expect(maxUnifiedTreeWidth(5000)).toBe(UNIFIED_TREE_MAX_WIDTH);
        expect(clampUnifiedTreeWidth(4000, 5000)).toBe(UNIFIED_TREE_MAX_WIDTH);
    });

    it('never inverts the range on a panel too narrow for both columns', () => {
        // 200px panel cannot hold tree + view; the max must not go below the min.
        expect(maxUnifiedTreeWidth(200)).toBe(UNIFIED_TREE_MIN_WIDTH);
        expect(clampUnifiedTreeWidth(300, 200)).toBe(UNIFIED_TREE_MIN_WIDTH);
    });

    it('degrades a non-finite requested width to the default', () => {
        expect(clampUnifiedTreeWidth(Number.NaN, 1200)).toBe(UNIFIED_TREE_DEFAULT_WIDTH);
    });

    it('hides an open tree on a too-narrow panel without flipping the stored bit', () => {
        const state = { open: true, width: UNIFIED_TREE_DEFAULT_WIDTH };
        expect(isUnifiedTreeVisible(state, UNIFIED_TREE_MIN_PANEL_WIDTH - 1)).toBe(false);
        // Widening brings it straight back — the bit was never touched.
        expect(isUnifiedTreeVisible(state, UNIFIED_TREE_MIN_PANEL_WIDTH)).toBe(true);
        expect(state.open).toBe(true);
    });

    it('keeps a closed tree hidden however wide the panel is', () => {
        expect(isUnifiedTreeVisible({ open: false, width: 200 }, 5000)).toBe(false);
    });
});

describe('unifiedPanelTree codec', () => {
    it('round-trips open state and width', () => {
        const state = { open: true, width: 260 };
        expect(parseUnifiedTreeState(serializeUnifiedTreeState(state))).toEqual(state);
    });

    it('returns the default for empty, malformed, and non-object payloads', () => {
        expect(parseUnifiedTreeState(null)).toBe(DEFAULT_UNIFIED_TREE_STATE);
        expect(parseUnifiedTreeState('')).toBe(DEFAULT_UNIFIED_TREE_STATE);
        expect(parseUnifiedTreeState('{oops')).toBe(DEFAULT_UNIFIED_TREE_STATE);
        expect(parseUnifiedTreeState('[]')).toBe(DEFAULT_UNIFIED_TREE_STATE);
        expect(parseUnifiedTreeState('null')).toBe(DEFAULT_UNIFIED_TREE_STATE);
    });

    it('keeps the open bit when only the width is corrupt', () => {
        expect(parseUnifiedTreeState('{"open":true,"width":"wide"}'))
            .toEqual({ open: true, width: UNIFIED_TREE_DEFAULT_WIDTH });
    });

    it('bounds a hand-edited width to the absolute range', () => {
        expect(parseUnifiedTreeState('{"open":true,"width":10000}').width).toBe(UNIFIED_TREE_MAX_WIDTH);
        expect(parseUnifiedTreeState('{"open":true,"width":1}').width).toBe(UNIFIED_TREE_MIN_WIDTH);
    });

    it('treats anything other than true as closed', () => {
        expect(parseUnifiedTreeState('{"open":"yes","width":220}').open).toBe(false);
    });
});

describe('useUnifiedPanelTree', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedTreeState();
    });

    afterEach(() => {
        cleanup();
        clearUnifiedTreeState();
        localStorage.clear();
    });

    it('starts closed at the default width', () => {
        render(<Probe workspaceId={WS} name="a" />);
        expect(openOf('a')).toBe('false');
        expect(widthOf('a')).toBe(String(UNIFIED_TREE_DEFAULT_WIDTH));
    });

    it('shares one value across every consumer of the same panel scope', () => {
        let api: UnifiedPanelTreeApi | null = null;
        render(
            <>
                <Probe workspaceId={WS} name="column" onApi={next => { api = next; }} />
                <Probe workspaceId={WS} name="toggle" />
            </>,
        );
        act(() => api!.toggleOpen());
        // The toolbar toggle and the column live in different subtrees; both move.
        expect(openOf('column')).toBe('true');
        expect(openOf('toggle')).toBe('true');
    });

    it('keeps panel scopes apart', () => {
        let api: UnifiedPanelTreeApi | null = null;
        render(
            <>
                <Probe workspaceId={WS} name="one" onApi={next => { api = next; }} />
                <Probe workspaceId="ws-2" name="two" />
            </>,
        );
        act(() => api!.setOpen(true));
        expect(openOf('one')).toBe('true');
        expect(openOf('two')).toBe('false');
    });

    it('persists the open bit and width across a remount', () => {
        let api: UnifiedPanelTreeApi | null = null;
        const first = render(<Probe workspaceId={WS} name="a" onApi={next => { api = next; }} />);
        act(() => api!.setOpen(true));
        act(() => api!.setWidth(300));
        first.unmount();

        render(<Probe workspaceId={WS} name="b" />);
        expect(openOf('b')).toBe('true');
        expect(widthOf('b')).toBe('300');
    });

    it('bounds a width written through the setter', () => {
        let api: UnifiedPanelTreeApi | null = null;
        render(<Probe workspaceId={WS} name="a" onApi={next => { api = next; }} />);
        act(() => api!.setWidth(9999));
        expect(widthOf('a')).toBe(String(UNIFIED_TREE_MAX_WIDTH));
        act(() => api!.setWidth(0));
        expect(widthOf('a')).toBe(String(UNIFIED_TREE_MIN_WIDTH));
    });

    it('does not disturb the width when only the open bit moves', () => {
        let api: UnifiedPanelTreeApi | null = null;
        render(<Probe workspaceId={WS} name="a" onApi={next => { api = next; }} />);
        act(() => api!.setWidth(300));
        act(() => api!.toggleOpen());
        expect(widthOf('a')).toBe('300');
        expect(openOf('a')).toBe('true');
    });

    it('returns a stable snapshot while storage is unchanged', () => {
        writeUnifiedTreeState(WS, { open: true, width: 240 });
        expect(readUnifiedTreeState(WS)).toBe(readUnifiedTreeState(WS));
    });

    it('re-reads a value written straight to localStorage by another tab', () => {
        render(<Probe workspaceId={WS} name="a" />);
        act(() => {
            localStorage.setItem(unifiedPanelTreeStorageKey(WS), JSON.stringify({ open: true, width: 180 }));
            writeUnifiedTreeState(WS, readUnifiedTreeState(WS));
        });
        expect(openOf('a')).toBe('true');
        expect(widthOf('a')).toBe('180');
    });
});
