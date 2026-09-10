/**
 * Ctrl+P / Ctrl+O routing between the Explorer sub-tab and the unified right
 * panel.
 *
 * The whole point of extracting this is that both owners listen on `document`,
 * so "who acts" has to be decided somewhere that can be reasoned about without
 * a DOM: every cell of the focus/mount matrix is pinned here, and the shell
 * test only has to prove it wires the answer up.
 */
import { describe, expect, it } from 'vitest';
import {
    clearExplorerQuickOpenRegistry,
    explorerQuickOpenHasFocus,
    isExplorerQuickOpenMounted,
    quickOpenOwner,
    quickOpenShortcut,
    registerExplorerQuickOpen,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/quickOpenRouting';

/** The four booleans, in the order the rule reads them. */
function owner(panelOpen: boolean, panelHasFocus: boolean, explorerMounted: boolean, explorerHasFocus: boolean) {
    return quickOpenOwner({ panelOpen, panelHasFocus, explorerMounted, explorerHasFocus });
}

describe('quickOpenOwner', () => {
    it('gives it to the panel when the panel holds the focus, even with an Explorer tab mounted', () => {
        expect(owner(true, true, true, false)).toBe('panel');
    });

    it('gives it to the panel with the focus inside and no Explorer tab at all', () => {
        expect(owner(true, true, false, false)).toBe('panel');
    });

    it('gives it to the Explorer tab when the Explorer tab holds the focus', () => {
        expect(owner(true, false, true, true)).toBe('explorer');
    });

    it('gives it to the Explorer tab when focus is elsewhere and both are available', () => {
        // The chat composer, the body, or nothing focused: unchanged behaviour.
        expect(owner(true, false, true, false)).toBe('explorer');
    });

    it('gives it to the Explorer tab when focus is elsewhere and the panel is closed', () => {
        expect(owner(false, false, true, false)).toBe('explorer');
    });

    it('falls back to the panel when focus is elsewhere and no Explorer tab is mounted', () => {
        expect(owner(true, false, false, false)).toBe('panel');
    });

    it('gives it to nobody when the panel is closed and no Explorer tab is mounted', () => {
        expect(owner(false, false, false, false)).toBeNull();
    });

    it('gives a closed eligible group panel Quick Open ownership', () => {
        expect(quickOpenOwner({
            panelOpen: false,
            panelHasFocus: false,
            explorerMounted: false,
            explorerHasFocus: false,
            panelEligibleWhenClosed: true,
        })).toBe('panel');
    });

    it('keeps mounted Explorer precedence over a closed eligible group panel', () => {
        expect(quickOpenOwner({
            panelOpen: false,
            panelHasFocus: false,
            explorerMounted: true,
            explorerHasFocus: false,
            panelEligibleWhenClosed: true,
        })).toBe('explorer');
    });

    it('ignores focus claimed by a panel that is collapsed', () => {
        // A collapsed panel is `display:none`, so nothing in it can really hold
        // the focus — but a stale ref must not out-vote a live Explorer tab.
        expect(owner(false, true, true, false)).toBe('explorer');
        expect(owner(false, true, false, false)).toBeNull();
    });

    it('never returns two owners for one set of facts', () => {
        // Exhaustive over the matrix: the function is total and single-valued,
        // which is what makes "exactly one dialog per keypress" structural.
        for (const panelOpen of [false, true]) {
            for (const panelHasFocus of [false, true]) {
                for (const explorerMounted of [false, true]) {
                    for (const explorerHasFocus of [false, true]) {
                        for (const panelEligibleWhenClosed of [false, true]) {
                            const result = quickOpenOwner({
                                panelOpen,
                                panelHasFocus,
                                explorerMounted,
                                explorerHasFocus,
                                panelEligibleWhenClosed,
                            });
                            expect(result === null || result === 'panel' || result === 'explorer').toBe(true);
                            if (result === 'explorer') expect(explorerMounted).toBe(true);
                            if (result === 'panel') expect(panelOpen || panelEligibleWhenClosed).toBe(true);
                        }
                    }
                }
            }
        }
    });
});

describe('quickOpenShortcut', () => {
    const evt = (over: Partial<KeyboardEvent>) =>
        ({ ctrlKey: false, metaKey: false, altKey: false, key: '', ...over }) as KeyboardEvent;

    it('claims Ctrl+P and Cmd+P as Quick Open', () => {
        expect(quickOpenShortcut(evt({ ctrlKey: true, key: 'p' }))).toBe('quick');
        expect(quickOpenShortcut(evt({ metaKey: true, key: 'p' }))).toBe('quick');
    });

    it('claims Ctrl+O and Cmd+O as Exact Open', () => {
        expect(quickOpenShortcut(evt({ ctrlKey: true, key: 'o' }))).toBe('exact');
        expect(quickOpenShortcut(evt({ metaKey: true, key: 'o' }))).toBe('exact');
    });

    it('claims the capitalised form, so Shift or Caps Lock does not drop the shortcut', () => {
        expect(quickOpenShortcut(evt({ ctrlKey: true, key: 'P' }))).toBe('quick');
        expect(quickOpenShortcut(evt({ ctrlKey: true, key: 'O' }))).toBe('exact');
    });

    it('claims nothing without a modifier, with Alt held, or for another key', () => {
        expect(quickOpenShortcut(evt({ key: 'p' }))).toBeNull();
        expect(quickOpenShortcut(evt({ ctrlKey: true, altKey: true, key: 'p' }))).toBeNull();
        expect(quickOpenShortcut(evt({ ctrlKey: true, key: 'w' }))).toBeNull();
    });
});

describe('explorer quick-open registry', () => {
    it('reports mount and focus from the registered probes, and forgets on unregister', () => {
        clearExplorerQuickOpenRegistry();
        expect(isExplorerQuickOpenMounted()).toBe(false);
        expect(explorerQuickOpenHasFocus()).toBe(false);

        let focused = false;
        const unregister = registerExplorerQuickOpen(() => focused);
        expect(isExplorerQuickOpenMounted()).toBe(true);
        expect(explorerQuickOpenHasFocus()).toBe(false);

        focused = true;
        expect(explorerQuickOpenHasFocus()).toBe(true);

        unregister();
        expect(isExplorerQuickOpenMounted()).toBe(false);
        expect(explorerQuickOpenHasFocus()).toBe(false);
    });
});
