/**
 * Bit flag decoder — real-browser walk of the manual Definition-of-Done steps.
 *
 * The card's logic is covered by jsdom unit tests; this spec covers what jsdom
 * cannot: the esbuild bundle actually mounts the card, the Dev Tools filter box
 * finds it, and saved sets survive a genuine page reload through real
 * localStorage.
 *
 * It drives the standalone `#popout/dev-tools` shell rather than the dashboard,
 * because the tool cards are pure client widgets with no app state — the
 * pop-out is the smallest page that renders them.
 */

import { test, expect, type Page } from './fixtures/server-fixture';

/**
 * One paste mixing every convention the card has to handle: `1 << n` shifts,
 * a hex literal, an `ALL`-style alias, and a `_MASK`/`_SHIFT` pair.
 */
const PERM_SOURCE = [
    'enum Perm : uint32_t {',
    '  READ  = 1 << 0,',
    '  WRITE = 1 << 1,',
    '  EXEC  = 0x0004,',
    '  BOTH  = READ | WRITE,',
    '  SPEED_MASK  = 0x30,',
    '  SPEED_SHIFT = 4,',
    '};',
].join('\n');

const NET_SOURCE = ['#define NET_UP   0x01', '#define NET_FAST 0x02'].join('\n');

/** Open the pop-out Dev Tools shell and expand the bit flag decoder card. */
async function openCard(page: Page, serverUrl: string): Promise<void> {
    await page.goto(`${serverUrl}/#popout/dev-tools`);
    await expect(page.getByTestId('dev-tools-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('dev-tool-toggle-bit-flags').click();
    await expect(page.getByTestId('dev-tool-body-bit-flags')).toBeVisible({ timeout: 5_000 });
}

/** Type into the value box, replacing whatever is there. */
async function typeValue(page: Page, text: string): Promise<void> {
    await page.getByTestId('bitflags-value').fill(text);
}

test.describe('Dev Tools — bit flag decoder', () => {

    test('filter box finds the card, and a pasted enum lists every name with hex and kind', async ({
        page,
        serverUrl,
    }) => {
        // AC-05 DoD 1 — typing `flag` leaves the card as the visible result.
        await page.goto(`${serverUrl}/#popout/dev-tools`);
        await expect(page.getByTestId('dev-tools-panel')).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('dev-tools-filter').fill('flag');
        await expect(page.getByTestId('dev-tool-card-bit-flags')).toBeVisible();
        await expect(page.getByTestId('dev-tool-card-calculator')).toHaveCount(0);

        await page.getByTestId('dev-tool-toggle-bit-flags').click();
        await expect(page.getByTestId('dev-tool-body-bit-flags')).toBeVisible();

        // AC-01 DoD 2 — the parsed table lists every name, its hex value and kind.
        await page.getByTestId('bitflags-source').fill(PERM_SOURCE);
        await expect(page.getByTestId('bitflags-table')).toBeVisible();
        for (const name of ['READ', 'WRITE', 'EXEC', 'BOTH', 'SPEED_MASK', 'SPEED_SHIFT']) {
            await expect(page.getByTestId(`bitflags-row-${name}`)).toBeVisible();
        }
        const table = page.getByTestId('bitflags-table');
        await expect(table).toContainText('0x1');
        await expect(table).toContainText('0x30');
        await expect(table).toContainText('alias');
        await expect(table).toContainText('mask');
        await expect(page.getByTestId('bitflags-parse-status')).toContainText('lines parsed');
        // The set name defaults to the enum's own name once saved.
        await expect(page.getByTestId('bitflags-source')).toHaveValue(PERM_SOURCE);
    });

    test('decodes a value to flag names, and shows an empty state for 0', async ({
        page,
        serverUrl,
    }) => {
        await openCard(page, serverUrl);
        await page.getByTestId('bitflags-source').fill(PERM_SOURCE);

        // AC-02 DoD 1 — 0x85 is READ (bit 0), EXEC (bit 2) and an unnamed bit 7.
        await typeValue(page, '0x85');
        await expect(page.getByTestId('bitflags-decoded-flag-READ')).toContainText('bit 0');
        await expect(page.getByTestId('bitflags-decoded-flag-EXEC')).toContainText('bit 2');
        await expect(page.getByTestId('bitflags-decoded-unknown')).toContainText('0x80');
        // BOTH needs WRITE as well, so a partially matched alias must not appear.
        await expect(page.getByTestId('bitflags-decoded-alias-BOTH')).toHaveCount(0);

        // AC-02 — a C-style expression works, because parsing reuses the calculator.
        await typeValue(page, '0x30 | 4');
        await expect(page.getByTestId('bitflags-decoded-flag-EXEC')).toBeVisible();
        await expect(page.getByTestId('bitflags-decoded-field-SPEED_MASK')).toContainText('3');

        // AC-02 DoD 2 — 0 is an empty state, not an error.
        await typeValue(page, '0');
        await expect(page.getByTestId('bitflags-empty')).toContainText('no flags set');
        await expect(page.getByTestId('bitflags-error')).toHaveCount(0);
    });

    test('checkboxes and the number box are one piece of state', async ({ page, serverUrl }) => {
        await openCard(page, serverUrl);
        await page.getByTestId('bitflags-source').fill(PERM_SOURCE);

        // AC-03 DoD 1 — ticking two flags ORs their values into the number box.
        await page.getByTestId('bitflags-check-READ').check();
        await expect(page.getByTestId('bitflags-value')).toHaveValue('0x1');
        await page.getByTestId('bitflags-check-WRITE').check();
        await expect(page.getByTestId('bitflags-value')).toHaveValue('0x3');
        // Both bits are present, so the composite alias is now reported.
        await expect(page.getByTestId('bitflags-decoded-alias-BOTH')).toBeVisible();

        // Unticking drops the bit back out, even though the alias covers it.
        await page.getByTestId('bitflags-check-WRITE').uncheck();
        await expect(page.getByTestId('bitflags-value')).toHaveValue('0x1');
        await expect(page.getByTestId('bitflags-check-WRITE')).not.toBeChecked();

        // AC-03 DoD 2 — typing a value ticks every flag it covers.
        await typeValue(page, '0xFF');
        for (const name of ['READ', 'WRITE', 'EXEC', 'BOTH']) {
            await expect(page.getByTestId(`bitflags-check-${name}`)).toBeChecked();
        }
    });

    test('copies the decode summary to the clipboard', async ({ page, serverUrl, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await openCard(page, serverUrl);
        await page.getByTestId('bitflags-source').fill(PERM_SOURCE);
        await typeValue(page, '0x85');

        const summary = (await page.getByTestId('bitflags-summary').innerText()).trim();
        expect(summary).toContain('READ');
        expect(summary).toContain('unknown 0x80');

        // AC-06 DoD 1 — the copied text is the one-line summary.
        await page.getByTestId('bitflags-copy').click();
        await expect(page.getByTestId('bitflags-copy')).toContainText('Copied');
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        expect(clip.trim()).toBe(summary);
    });

    test('saved sets survive a page reload and switching between them', async ({
        page,
        serverUrl,
    }) => {
        await openCard(page, serverUrl);
        await page.getByTestId('bitflags-source').fill(PERM_SOURCE);
        await page.getByTestId('bitflags-set-name').fill('Perm');
        await page.getByTestId('bitflags-save').click();
        await expect(page.getByTestId('bitflags-set-select')).toContainText('Perm');

        // AC-04 DoD 1 — a real reload, so this exercises real localStorage.
        await page.reload();
        await expect(page.getByTestId('dev-tools-panel')).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('dev-tool-toggle-bit-flags').click();
        await expect(page.getByTestId('bitflags-source')).toHaveValue(PERM_SOURCE);
        await expect(page.getByTestId('bitflags-set-name')).toHaveValue('Perm');

        // AC-04 DoD 2 — a second set, and switching changes the decode output.
        await page.getByTestId('bitflags-new').click();
        await page.getByTestId('bitflags-source').fill(NET_SOURCE);
        await page.getByTestId('bitflags-set-name').fill('Net');
        await page.getByTestId('bitflags-save').click();

        await typeValue(page, '0x1');
        await expect(page.getByTestId('bitflags-decoded-flag-NET_UP')).toBeVisible();

        const select = page.getByTestId('bitflags-set-select');
        await select.selectOption({ label: 'Perm' });
        await expect(page.getByTestId('bitflags-source')).toHaveValue(PERM_SOURCE);
        await expect(page.getByTestId('bitflags-decoded-flag-READ')).toBeVisible();
        await expect(page.getByTestId('bitflags-decoded-flag-NET_UP')).toHaveCount(0);

        // Delete asks first; declining leaves the set in place.
        page.once('dialog', dialog => dialog.dismiss());
        await page.getByTestId('bitflags-delete').click();
        await expect(select).toContainText('Perm');

        page.once('dialog', dialog => dialog.accept());
        await page.getByTestId('bitflags-delete').click();
        await expect(select).not.toContainText('Perm');
    });
});
