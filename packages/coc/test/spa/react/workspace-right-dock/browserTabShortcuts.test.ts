import { describe, expect, it } from 'vitest';
import {
    browserTabAriaKeyShortcut,
    browserTabForDigit,
    browserTabShortcutDigit,
    browserTabShortcutDigits,
    browserTabShortcutLabel,
    browserTabShortcutModifierDown,
    isBrowserTabShortcutModifier,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/browserTabShortcuts';

const ctrl = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
const cmd = { ctrlKey: false, metaKey: true, altKey: false, shiftKey: false };

describe('browser tab shortcut keys', () => {
    it('takes the platform modifier with top-row 1–9 only', () => {
        for (let n = 1; n <= 9; n++) {
            expect(browserTabShortcutDigit({ ...ctrl, code: `Digit${n}` }, false)).toBe(n);
            expect(browserTabShortcutDigit({ ...cmd, code: `Digit${n}` }, true)).toBe(n);
        }
        for (const [event, mac] of [
            [{ ...ctrl, code: 'Digit0' }, false],
            [{ ...ctrl, code: 'Numpad1' }, false],
            [{ ...ctrl, code: 'KeyT' }, false],
            [{ ...ctrl, shiftKey: true, code: 'Digit1' }, false],
            [{ ...ctrl, altKey: true, code: 'Digit1' }, false],
            [{ ...ctrl, metaKey: true, code: 'Digit1' }, false],
            [{ ...cmd, code: 'Digit1' }, false],
            [{ ...ctrl, code: 'Digit1' }, true],
            [{ ...cmd, ctrlKey: true, code: 'Digit1' }, true],
        ] as const) {
            expect(browserTabShortcutDigit(event, mac)).toBeNull();
        }
    });

    it('recognises the platform modifier key and its held state', () => {
        expect(isBrowserTabShortcutModifier({ key: 'Control' }, false)).toBe(true);
        expect(isBrowserTabShortcutModifier({ key: 'Meta' }, false)).toBe(false);
        expect(isBrowserTabShortcutModifier({ key: 'Meta' }, true)).toBe(true);
        expect(browserTabShortcutModifierDown({ ctrlKey: true, metaKey: false }, false)).toBe(true);
        expect(browserTabShortcutModifierDown({ ctrlKey: true, metaKey: false }, true)).toBe(false);
    });
});

describe('browser tab shortcut numbering', () => {
    it('numbers up to nine tabs by position', () => {
        expect(browserTabShortcutDigits(0)).toEqual([]);
        expect(browserTabShortcutDigits(3)).toEqual([1, 2, 3]);
        expect(browserTabShortcutDigits(9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('gives 9 to the last tab only, leaving the middle unhinted, past nine tabs', () => {
        expect(browserTabShortcutDigits(11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, null, null, 9]);
    });

    it('selects 1–8 by position and 9 as the last tab, matching every hint', () => {
        const tabs = ['a', 'b', 'c'];
        expect(browserTabForDigit(tabs, 1)).toBe('a');
        expect(browserTabForDigit(tabs, 3)).toBe('c');
        expect(browserTabForDigit(tabs, 4)).toBeNull();
        expect(browserTabForDigit(tabs, 9)).toBe('c');
        expect(browserTabForDigit([], 9)).toBeNull();
        for (const count of [1, 5, 9, 10, 14]) {
            const many = Array.from({ length: count }, (_, index) => index);
            browserTabShortcutDigits(count).forEach((hinted, index) => {
                if (hinted !== null) expect(browserTabForDigit(many, hinted)).toBe(index);
            });
        }
    });

    it('formats hints and accessible shortcuts per platform', () => {
        expect(browserTabShortcutLabel(1, true)).toBe('⌘1');
        expect(browserTabShortcutLabel(9, false)).toBe('Ctrl+9');
        expect(browserTabAriaKeyShortcut(2, true)).toBe('Meta+2');
        expect(browserTabAriaKeyShortcut(2, false)).toBe('Control+2');
    });
});
