/**
 * Chat table "Wrap text" toggle — real-browser layout proof.
 *
 * Mode: mock-e2e (Playwright + real server; the transcript is injected into the
 * real process response, like composer-pr-chip-popout.spec.ts).
 * Source: packages/coc/src/server/spa/client/react/shared/InteractiveTable.tsx
 *
 * jsdom has no layout, so the vitest suites only cover the state contract.
 * Here, in the chat pop-out at narrow (280-400px) and wide (1280px) widths:
 *   1. Wrapping is on by default: the table fits the pane and wraps long URLs,
 *      paths and inline code without clipping any cell.
 *   2. Turning it off (mouse or keyboard) restores single-line, ellipsized
 *      cells; turning it back on (Space) re-fits the table.
 *   3. Toggles are per table. The toolbar is one compact row at every width:
 *      every button stays visible inside the table, none overlap, and the
 *      toolbar never covers table text.
 *   4. A table with too many columns still scrolls horizontally; static tables
 *      (no toggle) and code blocks keep their own layout.
 *
 * The server runs from `dist/`, so run `npm run build:client && npm run
 * build:copy-client` before this spec after changing client code.
 */
import { test, expect } from './fixtures/server-fixture';
import { request } from './fixtures/seed';
import type { Locator, Page } from '@playwright/test';

const LONG_URL = 'https://example.com/a/very/long/path/that/never/contains/a/space/anywhere/index.html';
const LONG_PATH = 'packages/coc/src/server/spa/client/react/shared/SomeExtremelyLongComponentFileName.tsx';
const LONG_CODE = 'useSomeVeryLongHookNameThatNeverBreaksNaturally()';

function rows(count: number, row: (i: number) => string): string[] {
    return Array.from({ length: count }, (_, i) => row(i));
}

const ANSWER = [
    'Here are the results.',
    '',
    '| Resource | Location | Notes |',
    '| --- | --- | --- |',
    `| [docs](${LONG_URL}) | \`${LONG_PATH}\` | ${LONG_CODE} |`,
    ...rows(5, i => `| item-${i} | /var/lib/service-${i}/a/deeply/nested/directory/structure/config.yaml | plain words that wrap normally |`),
    '',
    'Second table:',
    '',
    '| Key | Value |',
    '| --- | --- |',
    ...rows(6, i => `| key-${i} | \`/opt/second/table/value-${i}/with/a/long/unbroken/path.json\` |`),
    '',
    'Many columns:',
    '',
    `| ${rows(10, i => `Column${i}`).join(' | ')} |`,
    `| ${rows(10, () => '---').join(' | ')} |`,
    ...rows(5, r => `| ${rows(10, i => `value-${r}-${i}`).join(' | ')} |`),
    '',
    'Small static table:',
    '',
    '| A | B |',
    '| --- | --- |',
    `| ${LONG_PATH} | short |`,
    '',
    '```js',
    `const unchanged = "${'x'.repeat(200)}";`,
    '```',
].join('\n');

async function seedChat(page: Page, serverUrl: string): Promise<string> {
    const processId = `queue_tablewrap-${Date.now().toString(36)}`;
    const res = await request(`${serverUrl}/api/processes`, {
        method: 'POST',
        body: JSON.stringify({
            id: processId,
            promptPreview: 'Show tables',
            fullPrompt: 'Show tables',
            status: 'completed',
            startTime: new Date().toISOString(),
            type: 'chat',
        }),
    });
    if (res.status >= 400) throw new Error(`seed process failed: ${res.status} ${res.body}`);

    await page.route(new RegExp(`/api/processes/${processId}(\\?[^/]*)?$`), async (route) => {
        const response = await route.fetch();
        const parsed = JSON.parse(await response.text());
        if (parsed?.process?.id === processId) {
            parsed.process.conversationTurns = [
                { role: 'user', content: 'Show tables', timestamp: new Date().toISOString(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: ANSWER, timestamp: new Date().toISOString(), turnIndex: 1, timeline: [] },
            ];
        }
        return route.fulfill({ response, body: JSON.stringify(parsed) });
    });
    return processId;
}

/** Toolbar geometry: one row, every button inside the table box, no overlaps. */
async function toolbarLayout(root: Locator) {
    return root.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const bar = el.querySelector('.interactive-table-toolbar')!.getBoundingClientRect();
        const buttons = Array.from(el.querySelectorAll<HTMLElement>('.interactive-table-actions > button, .interactive-table-col-picker-wrapper > button'))
            .map(b => b.getBoundingClientRect());
        const overlaps = buttons.some((a, i) => buttons.some((b, j) => i < j && a.left < b.right - 0.5 && b.left < a.right - 0.5));
        return {
            count: buttons.length,
            tops: [...new Set(buttons.map(b => Math.round(b.top)))],
            inside: buttons.every(b => b.left >= box.left - 0.5 && b.right <= box.right + 0.5),
            overlaps,
            toolbarHeight: bar.height,
            labelsVisible: Array.from(el.querySelectorAll<HTMLElement>('.interactive-table-btn-label')).some(l => l.offsetParent !== null),
        };
    });
}

/** Overflow facts for one table: its scroll box, and any cell whose content is cut. */
async function measure(table: Locator) {
    return table.evaluate((el) => {
        const scroll = (el.closest('.interactive-table-scroll') ?? el.parentElement) as HTMLElement;
        const clipped = Array.from(el.querySelectorAll<HTMLElement>('th, td, .interactive-table-cell-text'))
            .filter(c => c.offsetParent !== null && c.scrollWidth > c.clientWidth + 1)
            .map(c => c.textContent ?? '');
        return {
            scrollOverflows: scroll.scrollWidth > scroll.clientWidth + 1,
            tableWidth: el.getBoundingClientRect().width,
            boxWidth: scroll.clientWidth,
            clipped,
            text: el.textContent ?? '',
        };
    });
}

for (const width of [280, 320, 400, 1280]) {
    const narrow = width <= 400;
    test.describe(`chat table wrap toggle @ ${width}px`, () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
        });

        test('wraps tables by default, unwraps on demand, and keeps a one-row toolbar', async ({ page, serverUrl }) => {
            const processId = await seedChat(page, serverUrl);
            await page.goto(`${serverUrl}/#popout/activity/${encodeURIComponent(processId)}`);
            await expect(page.getByTestId('popout-shell')).toBeVisible({ timeout: 10_000 });

            const answer = page.locator('.chat-message-content .markdown-body').filter({ has: page.locator('table') }).first();
            const tables = answer.locator('.interactive-table');
            await expect(tables).toHaveCount(3, { timeout: 15_000 });
            const [first, second, many] = [tables.nth(0), tables.nth(1), tables.nth(2)];
            const firstBtn = first.getByRole('button', { name: 'Wrap text' });
            const secondBtn = second.getByRole('button', { name: 'Wrap text' });
            const manyBtn = many.getByRole('button', { name: 'Wrap text' });

            // Toolbar: one compact row of six buttons, all inside the table, no overlaps;
            // labels only when there is room for them.
            for (const root of [first, second, many]) {
                const bar = await toolbarLayout(root);
                expect(bar.count).toBe(6);
                expect(bar.tops).toHaveLength(1);
                expect(bar.inside).toBe(true);
                expect(bar.overlaps).toBe(false);
                expect(bar.toolbarHeight).toBeLessThan(32);
                expect(bar.labelsVisible).toBe(!narrow);
            }
            // The column picker opens inside the table, even in a narrow pane.
            await first.getByRole('button', { name: 'Toggle column visibility' }).click();
            const pickerInside = await first.evaluate((el) => {
                const b = el.getBoundingClientRect();
                const p = el.querySelector('[data-testid="col-picker"]')!.getBoundingClientRect();
                return p.left >= b.left - 0.5 && p.right <= b.right + 0.5;
            });
            expect(pickerInside).toBe(true);
            await first.getByRole('button', { name: 'Toggle column visibility' }).click();

            // 1. On by default: the table fits the pane and nothing is clipped.
            for (const btn of [firstBtn, secondBtn, manyBtn]) {
                await expect(btn).toHaveAttribute('aria-pressed', 'true');
            }
            const firstWrapped = await measure(first.locator('table'));
            expect(firstWrapped.scrollOverflows).toBe(false);
            expect(firstWrapped.tableWidth).toBeLessThanOrEqual(firstWrapped.boxWidth + 1);
            expect(firstWrapped.clipped).toEqual([]);
            for (const value of [LONG_PATH, LONG_CODE]) expect(firstWrapped.text).toContain(value);
            await expect(first.locator(`a[href="${LONG_URL}"]`)).toBeVisible();
            const secondWrapped = await measure(second.locator('table'));
            expect(secondWrapped.scrollOverflows).toBe(false);
            expect(secondWrapped.clipped).toEqual([]);
            // Too many columns: cells wrap, the table still scrolls when it must.
            const manyWrapped = await measure(many.locator('table'));
            expect(manyWrapped.clipped).toEqual([]);
            expect(manyWrapped.scrollOverflows).toBe(narrow);

            // The toolbar sits above the table and never covers its text.
            for (const [btn, table] of [[firstBtn, first], [secondBtn, second]] as const) {
                const b = (await btn.boundingBox())!;
                const t = (await table.locator('table').boundingBox())!;
                expect(b.y + b.height).toBeLessThanOrEqual(t.y + 0.5);
            }

            // 2. Mouse toggle off: single-line cells, ellipsized in a narrow pane.
            await firstBtn.click();
            await expect(firstBtn).toHaveAttribute('aria-pressed', 'false');
            if (narrow) {
                const firstOff = await measure(first.locator('table'));
                expect(firstOff.clipped.length).toBeGreaterThan(0);
                expect(firstOff.scrollOverflows).toBe(true);
            }

            // 3. Independent: the other tables did not change.
            await expect(secondBtn).toHaveAttribute('aria-pressed', 'true');
            await expect(manyBtn).toHaveAttribute('aria-pressed', 'true');

            // Keyboard toggle off (Enter) on the second table, back on with Space.
            await secondBtn.focus();
            await page.keyboard.press('Enter');
            await expect(secondBtn).toHaveAttribute('aria-pressed', 'false');
            if (narrow) {
                expect((await measure(second.locator('table'))).clipped.length).toBeGreaterThan(0);
            }
            await page.keyboard.press(' ');
            await expect(secondBtn).toHaveAttribute('aria-pressed', 'true');
            expect((await measure(second.locator('table'))).clipped).toEqual([]);
            await expect(firstBtn).toHaveAttribute('aria-pressed', 'false');
            expect((await toolbarLayout(first)).tops).toHaveLength(1);

            // Static tables have no toggle and already wrap; code blocks keep no-wrap.
            const staticTable = answer.locator('table').filter({ hasText: 'short' }).last();
            await expect(staticTable).toBeVisible();
            expect((await measure(staticTable)).clipped).toEqual([]);
            const codeWhiteSpace = await answer.locator('pre code').first()
                .evaluate(el => getComputedStyle(el).whiteSpace);
            expect(codeWhiteSpace).toBe('pre');

            // Turning it back on restores the fitted layout.
            await firstBtn.click();
            await expect(firstBtn).toHaveAttribute('aria-pressed', 'true');
            expect((await measure(first.locator('table'))).clipped).toEqual([]);
        });
    });
}
