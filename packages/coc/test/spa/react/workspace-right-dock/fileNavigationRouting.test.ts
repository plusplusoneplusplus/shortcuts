import { describe, expect, it } from 'vitest';
import {
    keyboardNavigationDirection,
    mouseNavigationDirection,
    panelOwnsFileNavigation,
    tabStripClaimsKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/fileNavigationRouting';

describe('file navigation input routing', () => {
    const key = (
        k: string,
        code: string,
        mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {},
    ) => ({ key: k, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

    it('maps only unmodified Alt+Left and Alt+Right on Windows and Linux', () => {
        expect(keyboardNavigationDirection(key('ArrowLeft', 'ArrowLeft', { altKey: true }), false)).toBe('back');
        expect(keyboardNavigationDirection(key('ArrowRight', 'ArrowRight', { altKey: true }), false)).toBe('forward');
        expect(keyboardNavigationDirection(key('ArrowLeft', 'ArrowLeft'), false)).toBeNull();
        expect(keyboardNavigationDirection(key('ArrowLeft', 'ArrowLeft', { altKey: true, ctrlKey: true }), false)).toBeNull();
        expect(keyboardNavigationDirection(key('-', 'Minus', { ctrlKey: true }), false)).toBeNull();
    });

    it('maps Ctrl+- and Ctrl+Shift+- on macOS and leaves Alt+Arrow to the editor', () => {
        expect(keyboardNavigationDirection(key('-', 'Minus', { ctrlKey: true }), true)).toBe('back');
        expect(keyboardNavigationDirection(key('_', 'Minus', { ctrlKey: true, shiftKey: true }), true)).toBe('forward');
        expect(keyboardNavigationDirection(key('ArrowLeft', 'ArrowLeft', { altKey: true }), true)).toBeNull();
        expect(keyboardNavigationDirection(key('-', 'Minus', { metaKey: true }), true)).toBeNull();
        expect(keyboardNavigationDirection(key('-', 'Minus', { ctrlKey: true, altKey: true }), true)).toBeNull();
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

    it('yields Alt+Arrow to a focused strip tab, including its close button', () => {
        const tab = document.createElement('div');
        tab.setAttribute('role', 'tab');
        const close = document.createElement('button');
        tab.appendChild(close);
        const editor = document.createElement('textarea');

        expect(tabStripClaimsKey({ altKey: true }, tab)).toBe(true);
        expect(tabStripClaimsKey({ altKey: true }, close)).toBe(true);
        expect(tabStripClaimsKey({ altKey: false }, tab)).toBe(false);
        expect(tabStripClaimsKey({ altKey: true }, editor)).toBe(false);
        expect(tabStripClaimsKey({ altKey: true }, null)).toBe(false);
    });
});
