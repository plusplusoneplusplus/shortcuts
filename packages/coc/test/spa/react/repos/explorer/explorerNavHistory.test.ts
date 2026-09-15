import { describe, expect, it } from 'vitest';
import type { editor as monacoEditor } from 'monaco-editor';
import {
    EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY,
    UNIFIED_PANEL_NAVIGATION_LIMIT,
    canNavigateHistory,
    finishNavigationReplay,
    navigationLocationsEqual,
    pruneClosedNavigationTabs,
    recordNavigationLocation,
    sameNavigationLocationIdentity,
    stepNavigationHistory,
    type NavigationLocationReason,
    type UnifiedPanelNavigationHistory,
    type UnifiedPanelNavigationLocation,
} from '../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelNavigationHistory';

function location(
    tabId: string,
    line: number,
    {
        scopeWorkspaceId = 'workspace-a',
        column = 1,
        scrollTop = line * 20,
    }: { scopeWorkspaceId?: string; column?: number; scrollTop?: number } = {},
): UnifiedPanelNavigationLocation {
    const selection = {
        selectionStartLineNumber: line,
        selectionStartColumn: column,
        positionLineNumber: line,
        positionColumn: column,
    };
    const viewState: monacoEditor.ICodeEditorViewState = {
        cursorState: [{
            inSelectionMode: false,
            selectionStart: { lineNumber: line, column },
            position: { lineNumber: line, column },
        }],
        viewState: {
            scrollLeft: 0,
            firstPosition: { lineNumber: line, column: 1 },
            firstPositionDeltaTop: 0,
            scrollTop,
            scrollTopWithoutViewZones: scrollTop,
        },
        contributionsState: {},
    };
    return { scopeWorkspaceId, tabId, selection, viewState };
}

function record(
    history: UnifiedPanelNavigationHistory,
    next: UnifiedPanelNavigationLocation,
    reason: NavigationLocationReason = 'user',
): UnifiedPanelNavigationHistory {
    return recordNavigationLocation(history, next, reason);
}

describe('unified panel navigation history — location comparison', () => {
    it('uses panel scope and concrete tab identity', () => {
        const base = location('file|clone-a|src/a.ts', 4);
        expect(sameNavigationLocationIdentity(base, location('file|clone-a|src/a.ts', 40))).toBe(true);
        expect(sameNavigationLocationIdentity(base, location('file|clone-b|src/a.ts', 4))).toBe(false);
        expect(sameNavigationLocationIdentity(base, location('file|clone-a|src/a.ts', 4, {
            scopeWorkspaceId: 'workspace-b',
        }))).toBe(false);
    });

    it('compares the complete selection and Monaco view state', () => {
        const base = location('a', 4, { column: 3, scrollTop: 80 });
        expect(navigationLocationsEqual(base, location('a', 4, { column: 3, scrollTop: 80 }))).toBe(true);
        expect(navigationLocationsEqual(base, location('a', 4, { column: 4, scrollTop: 80 }))).toBe(false);
        expect(navigationLocationsEqual(base, location('a', 4, { column: 3, scrollTop: 120 }))).toBe(false);
    });
});

describe('unified panel navigation history — VS Code-style recording', () => {
    it('coalesces ordinary movement within ten lines and keeps the latest exact view', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 10));
        history = record(history, location('a', 19, { column: 7, scrollTop: 360 }));

        expect(history.entries).toEqual([location('a', 19, { column: 7, scrollTop: 360 })]);
    });

    it.each<NavigationLocationReason>(['navigation', 'jump'])(
        'records nearby %s movement as a distinct location',
        reason => {
            let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 10));
            history = record(history, location('a', 11), reason);

            expect(history.entries).toHaveLength(2);
        },
    );

    it('coalesces movement on the same line even when caused by navigation', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 10, { column: 1 }));
        history = record(history, location('a', 10, { column: 20 }), 'navigation');

        expect(history.entries).toEqual([location('a', 10, { column: 20 })]);
    });

    it('records distant movement and cross-file movement', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
        history = record(history, location('a', 11));
        history = record(history, location('b', 11));

        expect(history.entries.map(entry => [entry.tabId, entry.selection.positionLineNumber])).toEqual([
            ['a', 1],
            ['a', 11],
            ['b', 11],
        ]);
    });

    it('truncates the forward branch when a location is recorded after Back', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
        history = record(history, location('a', 20));
        history = record(history, location('b', 1));
        const back = stepNavigationHistory(history, 'back')!;
        history = finishNavigationReplay(back.history);
        history = record(history, location('c', 1));

        expect(history.entries.map(entry => entry.tabId)).toEqual(['a', 'a', 'c']);
        expect(canNavigateHistory(history, 'forward')).toBe(false);
    });

    it('keeps only the newest fifty locations', () => {
        let history = EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY;
        for (let index = 0; index <= UNIFIED_PANEL_NAVIGATION_LIMIT; index += 1) {
            history = record(history, location(`file-${index}`, 1));
        }

        expect(history.entries).toHaveLength(UNIFIED_PANEL_NAVIGATION_LIMIT);
        expect(history.entries[0].tabId).toBe('file-1');
        expect(history.index).toBe(UNIFIED_PANEL_NAVIGATION_LIMIT - 1);
    });
});

describe('unified panel navigation history — replay and pruning', () => {
    it('steps both ways, does nothing at boundaries, and suppresses replay events', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
        history = record(history, location('b', 1));

        const back = stepNavigationHistory(history, 'back')!;
        expect(back.location.tabId).toBe('a');
        expect(stepNavigationHistory(back.history, 'back')).toBeNull();
        expect(record(back.history, location('c', 1))).toBe(back.history);

        const settled = finishNavigationReplay(back.history);
        const forward = stepNavigationHistory(settled, 'forward')!;
        expect(forward.location.tabId).toBe('b');
        expect(stepNavigationHistory(finishNavigationReplay(forward.history), 'forward')).toBeNull();
    });

    it('prunes closed tabs and keeps the current exact location when adjacent repeats collapse', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
        history = record(history, location('b', 1));
        history = record(history, location('a', 1, { column: 8 }));
        history = record(history, location('c', 1));
        history = finishNavigationReplay(stepNavigationHistory(history, 'back')!.history);

        history = pruneClosedNavigationTabs(history, new Set(['a', 'c']));

        expect(history.entries).toEqual([
            location('a', 1, { column: 8 }),
            location('c', 1),
        ]);
        expect(history.index).toBe(0);
        expect(history.replaying).toBe(false);
    });

    it('preserves a forward branch when pruning a different closed tab', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
        history = record(history, location('b', 1));
        history = record(history, location('c', 1));
        history = record(history, location('d', 1));
        history = finishNavigationReplay(stepNavigationHistory(history, 'back')!.history);
        history = finishNavigationReplay(stepNavigationHistory(history, 'back')!.history);

        history = pruneClosedNavigationTabs(history, new Set(['a', 'b', 'c']));

        expect(history.index).toBe(1);
        expect(stepNavigationHistory(history, 'forward')?.location).toEqual(location('c', 1));
    });

    it('returns the same state when every referenced tab remains open', () => {
        const history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
        expect(pruneClosedNavigationTabs(history, new Set(['a']))).toBe(history);
    });
});
