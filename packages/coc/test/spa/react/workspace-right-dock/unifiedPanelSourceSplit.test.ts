// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SOURCE_SPLIT_DIVIDER_WIDTH,
    SOURCE_SPLIT_MIN_PANE_WIDTH,
    canSplitTab,
    clampSourceSplitRatio,
    clearSourceSplits,
    isSourceSplitWide,
    readSourceSplit,
    reconcileSourceSplit,
    sourceSplitForDrop,
    sourceSplitScopeKey,
    writeSourceSplit,
    type SourceSplitState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelSourceSplit';
import type { UnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function file(id: string, extra: Partial<UnifiedPanelTab> = {}): UnifiedPanelTab {
    return { id, kind: 'file', ownerWorkspaceId: 'ws', chatId: 'chat', resourceId: `${id}.ts`, label: `${id}.ts`, ...extra };
}
const terminal: UnifiedPanelTab = {
    id: 'term', kind: 'terminal', ownerWorkspaceId: 'ws', chatId: null, resourceId: 'terminal', label: 'Terminal',
};

afterEach(() => clearSourceSplits());

describe('source split rules', () => {
    it('accepts only source file tabs', () => {
        expect(canSplitTab(file('a'))).toBe(true);
        expect(canSplitTab(terminal)).toBe(false);
        expect(canSplitTab({ ...terminal, kind: 'browser' })).toBe(false);
        expect(canSplitTab(null)).toBe(false);
    });

    it('keeps the active file on the left and the dropped file on the right', () => {
        expect(sourceSplitForDrop(null, file('a'), file('b'))).toEqual({ left: 'a', right: 'b', focus: 'right', ratio: 0.5 });
    });

    it('shows the sole active file in both panes, and a dropped file beside a non-file tab on both sides', () => {
        expect(sourceSplitForDrop(null, file('a'), file('a'))).toMatchObject({ left: 'a', right: 'a' });
        expect(sourceSplitForDrop(null, terminal, file('b'))).toMatchObject({ left: 'b', right: 'b' });
    });

    it('replaces the right pane of an existing split without adding a third pane', () => {
        const split: SourceSplitState = { left: 'a', right: 'b', focus: 'left', ratio: 0.3 };
        expect(sourceSplitForDrop(split, file('a'), file('c'))).toEqual({ left: 'a', right: 'c', focus: 'right', ratio: 0.3 });
    });

    it('rejects a non-file drop without changing the split', () => {
        const split: SourceSplitState = { left: 'a', right: 'b', focus: 'left', ratio: 0.5 };
        expect(sourceSplitForDrop(split, file('a'), terminal)).toBe(split);
        expect(sourceSplitForDrop(null, file('a'), terminal)).toBeNull();
    });

    it('moves an activated file into the focused pane and keeps the split under a non-file tab', () => {
        const split: SourceSplitState = { left: 'a', right: 'b', focus: 'left', ratio: 0.5 };
        const tabs = [file('a'), file('b'), file('c'), terminal];
        expect(reconcileSourceSplit(split, tabs, file('a'))).toBe(split);
        expect(reconcileSourceSplit(split, tabs, file('c'))).toEqual({ ...split, left: 'c' });
        expect(reconcileSourceSplit(split, tabs, terminal)).toBe(split);
    });

    it('ends the split when a pane file is no longer visible', () => {
        const split: SourceSplitState = { left: 'a', right: 'b', focus: 'left', ratio: 0.5 };
        expect(reconcileSourceSplit(split, [file('a')], file('a'))).toBeNull();
        expect(reconcileSourceSplit(split, [file('a'), terminal, { ...file('b'), kind: 'canvas' }], file('a'))).toBeNull();
    });

    it('collapses below two minimum panes plus the divider', () => {
        const boundary = SOURCE_SPLIT_MIN_PANE_WIDTH * 2 + SOURCE_SPLIT_DIVIDER_WIDTH;
        expect(isSourceSplitWide(boundary)).toBe(true);
        expect(isSourceSplitWide(boundary - 1)).toBe(false);
        expect(isSourceSplitWide(0)).toBe(false);
    });

    it('bounds the divider so each pane keeps its minimum width', () => {
        const width = 1004;
        const min = SOURCE_SPLIT_MIN_PANE_WIDTH / (width - SOURCE_SPLIT_DIVIDER_WIDTH);
        expect(clampSourceSplitRatio(0, width)).toBeCloseTo(min);
        expect(clampSourceSplitRatio(1, width)).toBeCloseTo(1 - min);
        expect(clampSourceSplitRatio(0.4, width)).toBe(0.4);
        expect(clampSourceSplitRatio(Number.NaN, width)).toBe(0.5);
        expect(clampSourceSplitRatio(0.1, 300)).toBe(0.5);
    });
});

describe('source split session store', () => {
    it('isolates panel scopes and chats, and keeps nothing in localStorage', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const a = sourceSplitScopeKey('ws', 'chat-1');
        const b = sourceSplitScopeKey('ws', 'chat-2');
        const remote = sourceSplitScopeKey('remote:host|ws', 'chat-1');
        expect(new Set([a, b, remote]).size).toBe(3);
        const split: SourceSplitState = { left: 'a', right: 'b', focus: 'right', ratio: 0.5 };
        writeSourceSplit(a, split);
        expect(readSourceSplit(a)).toBe(split);
        expect(readSourceSplit(b)).toBeNull();
        expect(readSourceSplit(remote)).toBeNull();
        expect(setItem).not.toHaveBeenCalled();
        setItem.mockRestore();
        clearSourceSplits();
        expect(readSourceSplit(a)).toBeNull();
    });
});
