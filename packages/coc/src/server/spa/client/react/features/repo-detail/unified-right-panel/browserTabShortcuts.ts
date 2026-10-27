/**
 * Ctrl/Cmd+1–9 browser-tab switching (`features.browserTabShortcuts`).
 *
 * Numbering follows the browser convention over the web (`browser`) tabs the
 * strip renders, in their visible order: 1–8 pick that tab and 9 the last one.
 * Each tab shows at most one hint, and only digits that reach a tab are hinted:
 * with nine or fewer tabs every tab shows its position; with more, tabs 9 to
 * n-1 show nothing and the last shows 9. Other tab kinds are never numbered.
 *
 * The platform modifier is Command on macOS and Control elsewhere; Shift,
 * Alt/AltGr and the other platform's modifier leave the key alone.
 */

import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';

/** How long the modifier must be held alone before hints appear, so Ctrl+C never flashes them. */
export const BROWSER_TAB_HINT_DELAY_MS = 250;

export function browserTabShortcutsMac(): boolean {
    return isMacPlatform();
}

/** Whether this key is the platform modifier itself. */
export function isBrowserTabShortcutModifier(event: Pick<KeyboardEvent, 'key'>, mac: boolean): boolean {
    return event.key === (mac ? 'Meta' : 'Control');
}

/** Whether the platform modifier is still down during this event. */
export function browserTabShortcutModifierDown(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>, mac: boolean): boolean {
    return mac ? event.metaKey : event.ctrlKey;
}

/** The digit of a Ctrl/Cmd+1–9 shortcut on the top row, else null. */
export function browserTabShortcutDigit(
    event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code'>,
    mac: boolean,
): number | null {
    if (event.altKey || event.shiftKey || (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return null;
    const match = /^Digit([1-9])$/.exec(event.code ?? '');
    return match ? Number(match[1]) : null;
}

/** The hinted digit of each of `count` numbered tabs, by position. */
export function browserTabShortcutDigits(count: number): (number | null)[] {
    return Array.from({ length: count }, (_, index) => {
        if (count <= 9 || index < 8) return index + 1;
        return index === count - 1 ? 9 : null;
    });
}

/** The tab a digit selects: 1–8 by position, 9 the last. */
export function browserTabForDigit<T>(tabs: readonly T[], digit: number): T | null {
    if (digit === 9) return tabs.at(-1) ?? null;
    return tabs[digit - 1] ?? null;
}

/** Visible hint text, e.g. `⌘1` or `Ctrl+1`. */
export function browserTabShortcutLabel(digit: number, mac: boolean): string {
    return mac ? `⌘${digit}` : `Ctrl+${digit}`;
}

/** `aria-keyshortcuts` value, e.g. `Meta+1` or `Control+1`. */
export function browserTabAriaKeyShortcut(digit: number, mac: boolean): string {
    return `${mac ? 'Meta' : 'Control'}+${digit}`;
}
