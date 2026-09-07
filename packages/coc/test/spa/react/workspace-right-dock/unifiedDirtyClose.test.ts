/**
 * unifiedDirtyClose — which unified-panel closes have to ask about unsaved
 * edits, and what the prompt calls them (AC-05).
 *
 * The pure half of the guard. The cases that matter are the ones that must NOT
 * prompt: a read-only tab (a chat source link can never be dirty, and offering
 * to save one would imply a write path it does not have), and every kind that
 * holds nothing to save.
 */
import { describe, expect, it } from 'vitest';
import {
    DIRTY_CLOSE_KINDS,
    DIRTY_CLOSE_SAVE_FAILED,
    dirtyCloseLabel,
    needsDirtyCloseConfirm,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedDirtyClose';
import { ALL_UNIFIED_TAB_KINDS } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { TRUSTED_PATH_PREFIX } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';

describe('needsDirtyCloseConfirm', () => {
    it('asks before closing a dirty editable file tab', () => {
        expect(needsDirtyCloseConfirm({ kind: 'file' }, true)).toBe(true);
    });

    it('closes a clean file tab straight through', () => {
        expect(needsDirtyCloseConfirm({ kind: 'file' }, false)).toBe(false);
    });

    it('never prompts for a read-only file tab', () => {
        // A chat source link is a reference, not an authorization: it has no
        // write path, so a save prompt would be a lie.
        expect(needsDirtyCloseConfirm({ kind: 'file', readOnly: true }, true)).toBe(false);
    });

    it('never prompts for a missing tab', () => {
        expect(needsDirtyCloseConfirm(undefined, true)).toBe(false);
        expect(needsDirtyCloseConfirm(null, true)).toBe(false);
    });

    it('asks before closing a note or a canvas with a pending autosave', () => {
        // Both autosave, so their unsaved window is a debounce rather than a
        // buffer — but a close that beats the timer loses the text just the same.
        expect(needsDirtyCloseConfirm({ kind: 'note' }, true)).toBe(true);
        expect(needsDirtyCloseConfirm({ kind: 'canvas' }, true)).toBe(true);
        expect(needsDirtyCloseConfirm({ kind: 'note' }, false)).toBe(false);
        expect(needsDirtyCloseConfirm({ kind: 'canvas' }, false)).toBe(false);
    });

    it('only prompts for kinds that can both report and write back edits', () => {
        const prompting = ALL_UNIFIED_TAB_KINDS.filter(kind => needsDirtyCloseConfirm({ kind }, true));
        expect(prompting).toEqual(['file', 'note', 'canvas']);
        expect([...DIRTY_CLOSE_KINDS].sort()).toEqual(['canvas', 'file', 'note']);
    });

    it('never prompts for a kind that holds nothing to save', () => {
        // A diff is reconstructed, a terminal is guarded by the terminate
        // prompt instead, and Explorer/Notes are navigators.
        for (const kind of ['diff', 'terminal', 'explorer', 'notes'] as const) {
            expect(needsDirtyCloseConfirm({ kind }, true)).toBe(false);
        }
    });
});

describe('dirtyCloseLabel', () => {
    it('names the file by its path', () => {
        expect(dirtyCloseLabel({ resourceId: 'src/a.ts', label: 'a.ts' })).toBe('src/a.ts');
    });

    it('strips the internal trusted-path marker', () => {
        expect(dirtyCloseLabel({ resourceId: `${TRUSTED_PATH_PREFIX}/tmp/a.ts`, label: 'a.ts' }))
            .toBe('/tmp/a.ts');
    });

    it('attributes a repo-group member so two namesakes stay tellable apart', () => {
        expect(dirtyCloseLabel({ resourceId: 'src/a.ts', label: 'a.ts', repoLabel: 'api' }))
            .toBe('api: src/a.ts');
    });

    it('falls back to the label when the descriptor carries no usable path', () => {
        expect(dirtyCloseLabel({ resourceId: '   ', label: 'Untitled' })).toBe('Untitled');
    });
});

describe('DIRTY_CLOSE_SAVE_FAILED', () => {
    it('says the tab is still open', () => {
        expect(DIRTY_CLOSE_SAVE_FAILED).toContain('still open');
    });
});
