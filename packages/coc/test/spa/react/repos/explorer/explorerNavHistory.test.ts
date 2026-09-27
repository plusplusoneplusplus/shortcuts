import { describe, expect, it } from 'vitest';
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
    { scopeWorkspaceId = 'workspace-a', column = 1 }: { scopeWorkspaceId?: string; column?: number } = {},
): UnifiedPanelNavigationLocation {
    return {
        scopeWorkspaceId,
        tabId,
        selection: {
            selectionStartLineNumber: line,
            selectionStartColumn: column,
            positionLineNumber: line,
            positionColumn: column,
        },
    };
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

    it('compares the complete selection', () => {
        const base = location('a', 4, { column: 3 });
        expect(navigationLocationsEqual(base, location('a', 4, { column: 3 }))).toBe(true);
        expect(navigationLocationsEqual(base, location('a', 4, { column: 4 }))).toBe(false);
        expect(navigationLocationsEqual(base, location('a', 5, { column: 3 }))).toBe(false);
    });
});

describe('unified panel navigation history — VS Code-style recording', () => {
    it('coalesces ordinary movement within ten lines and keeps the latest selection', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 10));
        history = record(history, location('a', 19, { column: 7 }));

        expect(history.entries).toEqual([location('a', 19, { column: 7 })]);
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

    // Regression: replacing the current entry used to truncate the forward
    // branch, so any nearby click or cursor move after Back disabled Forward.
    it.each<NavigationLocationReason>(['user', 'programmatic'])(
        'keeps the forward branch when a nearby %s move replaces the current entry after Back',
        reason => {
            let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
            history = record(history, location('a', 40));
            history = record(history, location('b', 1));
            history = finishNavigationReplay(stepNavigationHistory(history, 'back')!.history);

            history = record(history, location('a', 45, { column: 4 }), reason);

            expect(history.entries).toEqual([location('a', 1), location('a', 45, { column: 4 }), location('b', 1)]);
            expect(history.index).toBe(1);
            expect(stepNavigationHistory(history, 'forward')?.location).toEqual(location('b', 1));
        },
    );

    it('keeps the forward branch when the current entry is replaced in the middle of a longer history', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
        history = record(history, location('b', 1));
        history = record(history, location('c', 1));
        history = finishNavigationReplay(stepNavigationHistory(history, 'back')!.history);
        history = finishNavigationReplay(stepNavigationHistory(history, 'back')!.history);

        history = record(history, location('a', 1, { column: 9 }));

        expect(history.entries.map(entry => entry.tabId)).toEqual(['a', 'b', 'c']);
        expect(history.index).toBe(0);
        expect(canNavigateHistory(history, 'forward')).toBe(true);
    });

    it('truncates the forward branch when a distant move after Back adds a new entry', () => {
        let history = record(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY, location('a', 1));
        history = record(history, location('b', 1));
        history = finishNavigationReplay(stepNavigationHistory(history, 'back')!.history);

        history = record(history, location('a', 50));

        expect(history.entries.map(entry => [entry.tabId, entry.selection.positionLineNumber])).toEqual([
            ['a', 1],
            ['a', 50],
        ]);
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
