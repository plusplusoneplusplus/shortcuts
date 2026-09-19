/**
 * MENU.1 Guards `runMonacoMenuItem` against Monaco's late-armed menu entries.
 *
 * Monaco attaches the mouse-up handler that actually runs a menu action 100ms
 * after the entry renders (`runOnceToEnableMouseUp` in
 * `vs/base/browser/ui/menu/menu.ts`), while the surrounding menu absorbs clicks
 * in its dead space with `preventDefault`. A click that lands in that window is
 * therefore dropped without a trace: the menu stays open, no action runs, and
 * the test only finds out when the widget it was waiting for never appears --
 * which is exactly how the Explorer Peek E2Es kept failing 15s later on a
 * locator that was never going to resolve.
 *
 * The page below is that arming window and nothing else, with the delay dialled
 * up so both halves of the contract are decidable: a bare `click()` is
 * swallowed, and `runMonacoMenuItem` still gets the action to run.
 */

import { test, expect, type Page } from '@playwright/test';
import { runMonacoMenuItem, MENU_ITEM_RUN_TIMEOUT_MS } from './helpers/monaco-menu';

/**
 * Long enough that a click issued the moment the entry renders is reliably
 * inside the window, and short enough that one retry clears it.
 */
const ARMING_DELAY_MS = 600;

/**
 * Monaco's menu, reduced to the two behaviours that make an early click vanish:
 * the entry's activation handler is attached late, and the menu swallows every
 * mouse-up it sees in the meantime. Running the action removes the menu, which
 * is what the real one does the instant an action starts (`onWillRun`).
 */
async function openLateArmedMenu(page: Page): Promise<void> {
    await page.setContent(`<!doctype html>
<html><body style="margin:0">
  <div id="menu" class="monaco-menu" role="menu"
       style="position:absolute;top:20px;left:20px;padding:8px;border:1px solid #888">
    <a id="entry" role="menuitem" href="#" style="display:block;padding:4px 24px">Peek Definition</a>
  </div>
  <div id="result" data-testid="result">idle</div>
  <script>
    const menu = document.getElementById('menu');
    const entry = document.getElementById('entry');
    // "Absorb clicks in menu dead space" -- microsoft/vscode#63575.
    menu.addEventListener('mouseup', event => event.preventDefault());
    setTimeout(() => {
      entry.addEventListener('mouseup', () => {
        document.getElementById('result').textContent = 'ran';
        menu.remove();
      });
    }, ${ARMING_DELAY_MS});
  </script>
</body></html>`);
    await expect(page.locator('#entry')).toBeVisible();
}

test.describe('Monaco menu helper', () => {
    test('MENU.1a a click inside the arming window is swallowed whole', async ({ page }) => {
        await openLateArmedMenu(page);

        // The control case: this is what `startPeekDefinition` used to do, and
        // why it failed. Nothing throws -- the click simply does not land.
        await page.locator('#entry').click();

        await expect(page.getByTestId('result')).toHaveText('idle');
        await expect(page.locator('#entry')).toBeVisible();
    });

    test('MENU.1b runMonacoMenuItem retries until the entry runs', async ({ page }) => {
        await openLateArmedMenu(page);

        await runMonacoMenuItem(page.locator('#entry'));

        await expect(page.getByTestId('result')).toHaveText('ran');
        await expect(page.locator('#entry')).toBeHidden();
    });

    test('MENU.1c an entry that never arms is reported, not waited out', async ({ page }) => {
        await page.setContent(`<!doctype html>
<html><body style="margin:0">
  <div id="menu" role="menu" style="padding:8px">
    <a id="entry" role="menuitem" href="#" style="display:block">Peek Definition</a>
  </div>
  <script>
    document.getElementById('menu').addEventListener('mouseup', event => event.preventDefault());
  </script>
</body></html>`);
        await expect(page.locator('#entry')).toBeVisible();

        // A swallowed click must surface as a menu that would not close, so the
        // failure names the click rather than some later missing widget.
        await expect(runMonacoMenuItem(page.locator('#entry'))).rejects.toThrow(/hidden/i);
    });
});
