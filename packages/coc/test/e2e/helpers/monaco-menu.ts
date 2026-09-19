/**
 * Driving Monaco's own context menu from Playwright.
 *
 * Monaco arms a menu entry's mouse-up handler 100ms after the entry renders
 * (`runOnceToEnableMouseUp` in `vs/base/browser/ui/menu/menu.ts`), so the button
 * release of the user who just opened the menu cannot pick something by
 * accident. A submenu renders 250ms after its parent is hovered, so a test that
 * clicks the entry the moment it turns visible lands squarely inside that
 * window -- and the click is then dropped whole, silently, because the menu's
 * own mouse-up handler absorbs clicks in its dead space. Nothing fails at the
 * click; all that is left to see is a widget that never appears.
 */

import { expect, type Locator } from '@playwright/test';

/** Bounded so a retry aimed at an entry that has just gone fails fast. */
export const MENU_ITEM_CLICK_TIMEOUT_MS = 10_000;

/** How long the menu gets to close before the click counts as swallowed. */
export const MENU_ITEM_RUN_TIMEOUT_MS = 1_500;

/** How many swallowed clicks on one entry are absorbed before giving up. */
export const MENU_ITEM_CLICK_ATTEMPTS = 4;

/**
 * Clicks a Monaco menu entry and returns once the click has been *accepted*.
 *
 * Sleeping out the arming window would only narrow the race: the arming is a
 * `setTimeout` that a loaded CI box can service after the click has already
 * arrived. The context menu instead hides the instant an action *starts*
 * running (`onWillRun` fires before the action is awaited), so the entry going
 * away is the signal that the click took -- whatever the action goes on to do,
 * including a Peek whose preview read is being held open on purpose. Clicking
 * again while the entry is still on screen is what makes this deterministic.
 */
export async function runMonacoMenuItem(item: Locator): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
        await item.click({ timeout: MENU_ITEM_CLICK_TIMEOUT_MS });
        try {
            await expect(item).toBeHidden({ timeout: MENU_ITEM_RUN_TIMEOUT_MS });
            return;
        } catch (error) {
            // Still on screen: the click was swallowed rather than slow. Out of
            // attempts, report it as the missing menu close it is.
            if (attempt >= MENU_ITEM_CLICK_ATTEMPTS) throw error;
        }
    }
}
