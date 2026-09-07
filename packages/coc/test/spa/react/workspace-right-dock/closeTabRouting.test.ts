/**
 * The Ctrl/Cmd+W routing rule, on its own.
 *
 * The wiring (capture phase, `requestClose`, where the focus actually is) is
 * covered by `UnifiedPanelCloseTabShortcut.test.tsx`; what is pinned here is the
 * decision itself, and above all the case that separates this shortcut from an
 * ordinary one: focused-with-nothing-to-close must NOT fall through, because
 * the fallthrough closes the user's browser window.
 */
import { describe, expect, it } from 'vitest';
import {
    closeTabOutcome,
    closeTabShortcut,
    type CloseTabOwnerContext,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/closeTabRouting';

function key(over: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'key'>> = {}) {
    return { ctrlKey: false, metaKey: false, altKey: false, key: 'w', ...over };
}

function ctx(over: Partial<CloseTabOwnerContext> = {}): CloseTabOwnerContext {
    return {
        panelOpen: true,
        panelHasFocus: true,
        focusInActiveTerminal: false,
        metaKey: false,
        hasActiveTab: true,
        ...over,
    };
}

describe('closeTabShortcut', () => {
    it('matches Ctrl+W and Cmd+W, in either case', () => {
        expect(closeTabShortcut(key({ ctrlKey: true }))).toBe('close');
        expect(closeTabShortcut(key({ metaKey: true }))).toBe('close');
        expect(closeTabShortcut(key({ ctrlKey: true, key: 'W' }))).toBe('close');
    });

    it('matches with Shift held — Shift+Ctrl+W is not special-cased', () => {
        expect(closeTabShortcut({ ...key({ ctrlKey: true }), shiftKey: true } as never)).toBe('close');
    });

    it('ignores a bare W, Alt+Ctrl+W, and any other letter', () => {
        expect(closeTabShortcut(key())).toBeNull();
        expect(closeTabShortcut(key({ ctrlKey: true, altKey: true }))).toBeNull();
        expect(closeTabShortcut(key({ ctrlKey: true, key: 'p' }))).toBeNull();
    });
});

describe('closeTabOutcome', () => {
    it('closes the active tab when the panel holds the focus', () => {
        expect(closeTabOutcome(ctx())).toBe('close');
    });

    it('leaves the event alone when focus is outside the panel', () => {
        expect(closeTabOutcome(ctx({ panelHasFocus: false }))).toBe('ignore');
    });

    it('leaves the event alone when the panel is collapsed', () => {
        expect(closeTabOutcome(ctx({ panelOpen: false }))).toBe('ignore');
    });

    it('swallows the event with an empty strip rather than closing the browser tab', () => {
        expect(closeTabOutcome(ctx({ hasActiveTab: false }))).toBe('swallow');
    });

    it('hands a plain Ctrl+W to the shell when focus is in the active terminal', () => {
        expect(closeTabOutcome(ctx({ focusInActiveTerminal: true }))).toBe('ignore');
    });

    it('still closes on Cmd+W in a terminal — the carve-out is Ctrl only', () => {
        expect(closeTabOutcome(ctx({ focusInActiveTerminal: true, metaKey: true }))).toBe('close');
    });

    it('closes when a terminal is active but the focus is elsewhere in the panel', () => {
        // Focus parked on the strip's tab button: nobody is typing at a prompt,
        // so falling through would hand Ctrl+W to the browser.
        expect(closeTabOutcome(ctx({ focusInActiveTerminal: false }))).toBe('close');
    });
});
