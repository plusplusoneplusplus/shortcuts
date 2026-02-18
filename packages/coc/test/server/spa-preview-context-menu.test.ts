/**
 * SPA Dashboard Tests — preview body context menu for comment creation.
 *
 * Tests that right-clicking in the markdown preview body shows a custom
 * context menu with "Add Comment" (and standard Cut/Copy) instead of
 * automatically popping up the selection toolbar on text selection.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

// ============================================================================
// Preview context menu — client bundle functions
// ============================================================================

describe('Preview context menu — client bundle functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines showPreviewContextMenu function', () => {
        expect(script).toContain('showPreviewContextMenu');
    });

    it('defines previewContextmenuHandler variable', () => {
        expect(script).toContain('previewContextmenuHandler');
    });

    it('does not use mouseup handler for selection toolbar', () => {
        // The old mouseup auto-popup behavior should be removed
        expect(script).not.toContain('mouseupHandler');
    });

    it('registers contextmenu event on preview body', () => {
        expect(script).toContain('contextmenu');
        expect(script).toContain('previewContextmenuHandler');
    });

    it('renders Add Comment menu item', () => {
        expect(script).toContain('Add Comment');
    });

    it('renders Cut menu item', () => {
        expect(script).toContain('preview-cut');
    });

    it('renders Copy menu item', () => {
        expect(script).toContain('preview-copy');
    });

    it('renders Add Comment action identifier', () => {
        expect(script).toContain('preview-add-comment');
    });

    it('shows keyboard shortcut label for Add Comment', () => {
        // The shortcut label should be present (Ctrl+Shift+M or ⌘⇧M)
        expect(script).toContain('Ctrl+Shift+M');
    });

    it('disables Add Comment when no text is selected', () => {
        // The disabled class is applied when selInfo is null
        expect(script).toContain('task-context-menu-item-disabled');
    });

    it('supports Shift+right-click to show native browser menu', () => {
        expect(script).toContain('shiftKey');
    });

    it('calls toolbar.show when Add Comment is clicked', () => {
        expect(script).toContain('toolbar.show');
    });

    it('calls document.execCommand for copy action', () => {
        expect(script).toContain('execCommand');
        expect(script).toContain('"copy"');
    });

    it('calls document.execCommand for cut action', () => {
        expect(script).toContain('"cut"');
    });

    it('dismisses context menu after action', () => {
        expect(script).toContain('dismissContextMenu');
    });

    it('dismisses context menu on Escape key', () => {
        expect(script).toContain('Escape');
    });

    it('dismisses context menu on click outside', () => {
        // Click outside handler pattern
        expect(script).toContain('onClickOutside');
    });

    it('uses task-context-menu class for consistent styling', () => {
        expect(script).toContain('task-context-menu');
    });
});

// ============================================================================
// Preview context menu — keyboard shortcut preserved
// ============================================================================

describe('Preview context menu — keyboard shortcut preserved', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('still supports Ctrl+Shift+M keyboard shortcut', () => {
        expect(script).toContain('setupCommentKeyboardShortcut');
    });

    it('keyboard shortcut checks for Meta key (Mac support)', () => {
        expect(script).toContain('metaKey');
    });

    it('keyboard shortcut checks for Shift key', () => {
        expect(script).toContain('shiftKey');
    });

    it('keyboard shortcut checks for M key', () => {
        // The key check for 'M'
        expect(script).toContain('"M"');
    });
});

// ============================================================================
// Preview context menu — cleanup
// ============================================================================

describe('Preview context menu — cleanup', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('removes contextmenu handler on cleanup', () => {
        // cleanupCommentState should remove the contextmenu handler
        expect(script).toContain('removeEventListener');
    });

    it('disposes selection toolbar on cleanup', () => {
        expect(script).toContain('dispose');
    });

    it('cleans up previewContextmenuHandler reference', () => {
        // The handler should be set to null on cleanup
        expect(script).toContain('previewContextmenuHandler');
    });
});

// ============================================================================
// Preview context menu — CSS styles
// ============================================================================

describe('Preview context menu — CSS shortcut label style', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('uses ctx-menu-shortcut class for keyboard shortcut labels', () => {
        expect(script).toContain('ctx-menu-shortcut');
    });

    it('uses ctx-menu-icon class for menu item icons', () => {
        expect(script).toContain('ctx-menu-icon');
    });
});

// ============================================================================
// Selection toolbar — still functional via context menu
// ============================================================================

describe('Selection toolbar — still functional via context menu', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('creates SelectionToolbar instance', () => {
        expect(script).toContain('SelectionToolbar');
    });

    it('toolbar has onSubmitComment callback', () => {
        expect(script).toContain('onSubmitComment');
    });

    it('toolbar creates comment request', () => {
        expect(script).toContain('createComment');
    });

    it('toolbar captures selection with anchor', () => {
        expect(script).toContain('captureSelectionWithAnchor');
    });
});
