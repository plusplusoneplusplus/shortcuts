import { describe, expect, it } from 'vitest';
import {
    dropReplayedNavigationEntry,
    EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY,
    navigationReopenInput,
    parseUnifiedPanelNavigationHistory,
    recordNavigationLocation,
    serializeUnifiedPanelNavigationHistory,
    stepNavigationHistory,
    UNIFIED_PANEL_NAVIGATION_LIMIT,
    type UnifiedPanelNavigationHistory,
    type UnifiedPanelNavigationLocation,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelNavigationHistory';

const WS = 'ws-1';

function loc(path: string, line: number, scopeWorkspaceId = WS): UnifiedPanelNavigationLocation {
    return {
        scopeWorkspaceId,
        tabId: `file|chat-1|${scopeWorkspaceId}|${path}`,
        file: { ownerWorkspaceId: scopeWorkspaceId, resourceId: path, label: path },
        selection: {
            selectionStartLineNumber: line,
            selectionStartColumn: 1,
            positionLineNumber: line,
            positionColumn: 1,
        },
    };
}

function history(...entries: UnifiedPanelNavigationLocation[]): UnifiedPanelNavigationHistory {
    return entries.reduce(
        (acc, entry) => recordNavigationLocation(acc, entry, 'navigation'),
        EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY,
    );
}

const paths = (value: UnifiedPanelNavigationHistory) => value.entries.map(entry => entry.file.resourceId);

describe('unifiedPanelNavigationHistory', () => {
    it('steps back onto an entry whose tab is closed and yields a preview reopen input', () => {
        const start = history(loc('a.ts', 1), loc('b.ts', 30), loc('a.ts', 1));
        const step = stepNavigationHistory(start, 'back', WS);
        expect(step?.location.file.resourceId).toBe('b.ts');
        expect(step?.history.replaying).toBe(true);
        expect(navigationReopenInput(step!.location, 'chat-2')).toEqual({
            ownerWorkspaceId: WS,
            resourceId: 'b.ts',
            label: 'b.ts',
            chatId: 'chat-2',
        });
    });

    it('never steps onto another scope’s entries', () => {
        const mixed: UnifiedPanelNavigationHistory = {
            entries: [loc('a.ts', 1), loc('x.ts', 5, 'ws-2'), loc('b.ts', 30)],
            index: 2,
            replaying: false,
        };
        expect(stepNavigationHistory(mixed, 'back', WS)?.history.index).toBe(0);
        expect(stepNavigationHistory({ ...mixed, index: 0 }, 'forward', WS)?.history.index).toBe(2);
        expect(stepNavigationHistory({ ...mixed, index: 0 }, 'back', WS)).toBeNull();
    });

    it('drops a missing entry so the next step in the same direction moves past it', () => {
        const start = history(loc('a.ts', 1), loc('gone.ts', 5), loc('c.ts', 9));
        const back = stepNavigationHistory(start, 'back', WS)!;
        const afterBack = dropReplayedNavigationEntry(back.history, 'back');
        expect(paths(afterBack)).toEqual(['a.ts', 'c.ts']);
        expect(afterBack.replaying).toBe(false);
        expect(stepNavigationHistory(afterBack, 'back', WS)?.location.file.resourceId).toBe('a.ts');

        const forward = stepNavigationHistory({ ...start, index: 0 }, 'forward', WS)!;
        const afterForward = dropReplayedNavigationEntry(forward.history, 'forward');
        expect(stepNavigationHistory(afterForward, 'forward', WS)?.location.file.resourceId).toBe('c.ts');
    });

    it('collapses neighbours left adjacent at the same position after a drop', () => {
        const start = history(loc('a.ts', 1), loc('gone.ts', 5), loc('a.ts', 1), loc('c.ts', 9));
        const step = stepNavigationHistory({ ...start, index: 2 }, 'back', WS)!;
        const dropped = dropReplayedNavigationEntry(step.history, 'back');
        expect(paths(dropped)).toEqual(['a.ts', 'c.ts']);
        expect(stepNavigationHistory(dropped, 'back', WS)).toBeNull();
        expect(stepNavigationHistory(dropped, 'forward', WS)?.location.file.resourceId).toBe('c.ts');
    });

    it('still collapses an identical adjacent record', () => {
        const start = history(loc('a.ts', 1), loc('a.ts', 1));
        expect(start.entries).toHaveLength(1);
    });

    it('round-trips through the persisted codec without the replay flag', () => {
        const start = { ...history(loc('a.ts', 1), loc('b.ts', 30)), index: 0, replaying: true };
        const loaded = parseUnifiedPanelNavigationHistory(serializeUnifiedPanelNavigationHistory(start), WS);
        expect(loaded).toEqual({ entries: start.entries, index: 0, replaying: false });
    });

    it('loads old or foreign persisted data safely', () => {
        expect(parseUnifiedPanelNavigationHistory(null, WS)).toBe(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY);
        expect(parseUnifiedPanelNavigationHistory('{not json', WS)).toBe(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY);
        expect(parseUnifiedPanelNavigationHistory(JSON.stringify({
            entries: [loc('a.ts', 1)], index: 0,
        }), WS)).toBe(EMPTY_UNIFIED_PANEL_NAVIGATION_HISTORY);

        const { file: _file, ...withoutFile } = loc('old.ts', 3);
        const loaded = parseUnifiedPanelNavigationHistory(JSON.stringify({
            version: 1,
            entries: [loc('a.ts', 1), withoutFile, loc('x.ts', 2, 'ws-2'), loc('b.ts', 30)],
            index: 2,
        }), WS);
        expect(paths(loaded)).toEqual(['a.ts', 'b.ts']);
        expect(loaded.index).toBe(0);
    });

    it('keeps at most the history limit when loading', () => {
        const entries = Array.from({ length: UNIFIED_PANEL_NAVIGATION_LIMIT + 5 }, (_, i) => loc(`f${i}.ts`, 1));
        const loaded = parseUnifiedPanelNavigationHistory(JSON.stringify({
            version: 1, entries, index: entries.length - 1,
        }), WS);
        expect(loaded.entries).toHaveLength(UNIFIED_PANEL_NAVIGATION_LIMIT);
        expect(loaded.index).toBe(UNIFIED_PANEL_NAVIGATION_LIMIT - 1);
    });
});
