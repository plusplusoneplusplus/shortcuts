import { describe, expect, it } from 'vitest';
import {
    keyboardNavigationDirection,
    mouseNavigationDirection,
    panelOwnsFileNavigation,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/fileNavigationRouting';

describe('file navigation input routing', () => {
    it('maps only unmodified Alt+Left and Alt+Right', () => {
        expect(keyboardNavigationDirection({
            key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
        })).toBe('back');
        expect(keyboardNavigationDirection({
            key: 'ArrowRight', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
        })).toBe('forward');
        expect(keyboardNavigationDirection({
            key: 'ArrowLeft', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
        })).toBeNull();
        expect(keyboardNavigationDirection({
            key: 'ArrowLeft', altKey: true, ctrlKey: true, metaKey: false, shiftKey: false,
        })).toBeNull();
    });

    it('maps auxiliary browser buttons and ignores ordinary clicks', () => {
        expect(mouseNavigationDirection({ button: 3 })).toBe('back');
        expect(mouseNavigationDirection({ button: 4 })).toBe('forward');
        expect(mouseNavigationDirection({ button: 0 })).toBeNull();
        expect(mouseNavigationDirection({ button: 2 })).toBeNull();
    });

    it('requires visibility, interaction ownership, and an active file', () => {
        expect(panelOwnsFileNavigation({
            panelVisible: true, interactionOwned: true, activeFile: true,
        })).toBe(true);
        expect(panelOwnsFileNavigation({
            panelVisible: false, interactionOwned: true, activeFile: true,
        })).toBe(false);
        expect(panelOwnsFileNavigation({
            panelVisible: true, interactionOwned: false, activeFile: true,
        })).toBe(false);
        expect(panelOwnsFileNavigation({
            panelVisible: true, interactionOwned: true, activeFile: false,
        })).toBe(false);
    });
});
