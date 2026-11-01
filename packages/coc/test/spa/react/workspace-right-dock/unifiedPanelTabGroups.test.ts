import { describe, expect, it } from 'vitest';
import {
    groupStripTabs, isGroupBoundaryMove, stripGroupForKind,
    type GroupStripTabsOptions, type UnifiedTabStripGroup,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabGroups';
import type { UnifiedPanelTab, UnifiedTabKind } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const tab = (id: string, kind: UnifiedTabKind = 'file'): UnifiedPanelTab => ({
    id, kind, ownerWorkspaceId: 'workspace', chatId: 'chat', resourceId: id, label: id,
});
const options: GroupStripTabsOptions = { folded: new Set(), narrow: false };
const files = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => tab(id));
const shown = (overrides: Partial<GroupStripTabsOptions> = {}) =>
    groupStripTabs(files, { ...options, ...overrides })[0].shown.map(item => item.id);

describe('stripGroupForKind', () => {
    const mapping: Record<UnifiedTabKind, UnifiedTabStripGroup> = {
        terminal: 'tools', notes: 'tools', settings: 'tools', 'work-items': 'tools',
        'pull-requests': 'tools', todo: 'tools', git: 'tools', file: 'files',
        diff: 'files', note: 'files', paste: 'files', external: 'files',
        browser: 'web', 'html-page': 'web', canvas: 'canvas',
    };
    it.each(Object.entries(mapping))('maps %s to %s', (kind, group) => {
        expect(stripGroupForKind(kind as UnifiedTabKind)).toBe(group);
    });
});

describe('groupStripTabs', () => {
    it('returns only nonempty groups in fixed order and retains saved order inside each', () => {
        const input = [tab('c', 'canvas'), tab('w', 'browser'), tab('f'), tab('t', 'todo'), tab('f2')];
        const result = groupStripTabs(input, options);
        expect(result.map(item => item.group)).toEqual(['tools', 'files', 'web', 'canvas']);
        expect(result[1].tabs.map(item => item.id)).toEqual(['f', 'f2']);
        expect(groupStripTabs([], options)).toEqual([]);
        expect(groupStripTabs([tab('c', 'canvas')], options).map(item => item.group)).toEqual(['canvas']);
    });

    it('uses the default cap and fills remaining room from the saved prefix', () => {
        expect(shown()).toEqual(['a', 'b', 'c']);
        expect(shown({ cap: 2 })).toEqual(['a', 'b']);
        expect(shown({ cap: 20 })).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(shown({ cap: 0 })).toEqual([]);
        expect(shown({ cap: -2 })).toEqual([]);
        expect(shown({ cap: Number.NaN })).toEqual(['a', 'b', 'c']);
    });

    it('reserves pinned, active and preview before filling, even above the cap', () => {
        expect(shown({ pinnedId: 'f', activeId: 'e', previewId: 'd' })).toEqual(['f', 'e', 'd']);
        expect(shown({ cap: 1, pinnedId: 'f', activeId: 'e', previewId: 'd' })).toEqual(['f', 'e', 'd']);
        expect(shown({ cap: 0, pinnedId: 'f', activeId: 'e', previewId: 'd' })).toEqual(['f', 'e', 'd']);
        expect(shown({ pinnedId: 'f', activeId: 'f', previewId: 'f' })).toEqual(['a', 'b', 'f']);
    });

    it('keeps saved order rather than selection-priority order inside the original cap', () => {
        expect(shown({ pinnedId: 'c', activeId: 'b', previewId: 'a' })).toEqual(['a', 'b', 'c']);
        expect(shown({ pinnedId: 'f', activeId: 'b' })).toEqual(['a', 'b', 'f']);
    });

    it('puts promoted active last, with promoted preview after it', () => {
        expect(shown({ activeId: 'e' })).toEqual(['a', 'b', 'e']);
        expect(shown({ pinnedId: 'f', activeId: 'd' })).toEqual(['a', 'f', 'd']);
        expect(shown({ activeId: 'e', previewId: 'd' })).toEqual(['a', 'e', 'd']);
        expect(shown({ activeId: 'b', previewId: 'e' })).toEqual(['a', 'b', 'e']);
        expect(shown({ activeId: 'e', previewId: 'b' })).toEqual(['a', 'b', 'e']);
        expect(shown({ activeId: 'e', previewId: 'e' })).toEqual(['a', 'b', 'e']);
    });

    it('ignores ids missing from a group', () => {
        expect(shown({ pinnedId: 'missing', activeId: 'missing', previewId: 'missing' })).toEqual(['a', 'b', 'c']);
    });

    it('folds inactive groups to their label, keeping a pinned tab visible', () => {
        const folded = new Set<UnifiedTabStripGroup>(['files']);
        expect(shown({ folded })).toEqual([]);
        expect(shown({ folded, pinnedId: 'f', previewId: 'e' })).toEqual(['f']);
        expect(shown({ folded, pinnedId: 'f', activeId: 'e', previewId: 'd' })).toEqual(['e', 'f']);
        expect(shown({ folded, activeId: 'e', previewId: 'd' })).toEqual(['e']);
    });

    it('makes only inactive narrow groups label-only and respects explicit folds', () => {
        expect(shown({ narrow: true })).toEqual([]);
        expect(shown({ narrow: true, pinnedId: 'f' })).toEqual(['f']);
        expect(shown({ narrow: true, activeId: 'e' })).toEqual(['a', 'b', 'e']);
        expect(shown({ narrow: true, activeId: 'e', folded: new Set(['files']) })).toEqual(['e']);
        const result = groupStripTabs([...files, tab('browser', 'browser')], { ...options, narrow: true, activeId: 'e' });
        expect(result.map(item => [item.group, item.shown.length, item.hasActive])).toEqual([
            ['files', 3, true], ['web', 0, false],
        ]);
    });

    it('reports hidden dirty/error markers, not visible markers', () => {
        const result = groupStripTabs(files, {
            ...options, activeId: 'a', dirtyIds: new Set(['a', 'e']), errorIds: new Set(['d']),
        })[0];
        expect(result.hidden.map(item => item.id)).toEqual(['d', 'e', 'f']);
        expect(result).toMatchObject({ hasActive: true, hiddenDirty: true, hiddenError: true });
        expect(groupStripTabs(files, {
            ...options, dirtyIds: new Set(['a']), errorIds: new Set(['b']),
        })[0]).toMatchObject({ hasActive: false, hiddenDirty: false, hiddenError: false });
        expect(groupStripTabs(files, options)[0]).toMatchObject({ hiddenDirty: false, hiddenError: false });
    });

    it('does not mutate input arrays, tabs or sets', () => {
        const input = Object.freeze(files.map(item => Object.freeze({ ...item })));
        const folded = new Set<UnifiedTabStripGroup>(['files']);
        const dirtyIds = new Set(['e']);
        groupStripTabs(input, { ...options, folded, dirtyIds, activeId: 'e' });
        expect(input.map(item => item.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect([...folded]).toEqual(['files']);
        expect([...dirtyIds]).toEqual(['e']);
    });
});

describe('isGroupBoundaryMove', () => {
    const tabs = [tab('f'), tab('n', 'note'), tab('t', 'terminal'), tab('w', 'browser'), tab('c', 'canvas')];
    it('allows same-group moves, including the same id', () => {
        expect(isGroupBoundaryMove(tabs, 'f', 'n')).toBe(false);
        expect(isGroupBoundaryMove(tabs, 'f', 'f')).toBe(false);
    });
    it('rejects other groups and missing endpoints', () => {
        for (const id of ['t', 'w', 'c', 'missing']) expect(isGroupBoundaryMove(tabs, 'f', id)).toBe(true);
        expect(isGroupBoundaryMove(tabs, 'missing', 'f')).toBe(true);
        expect(isGroupBoundaryMove([], 'missing', 'missing')).toBe(true);
    });
});
