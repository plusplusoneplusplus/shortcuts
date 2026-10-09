/**
 * Chat table "Wrap text" toggle — real-browser layout proof.
 *
 * Mode: mock-e2e (Playwright + real server; the transcript is injected into the
 * real process response, like composer-pr-chip-popout.spec.ts).
 * Source: packages/coc/src/server/spa/client/react/shared/InteractiveTable.tsx
 *
 * jsdom has no layout, so the vitest suites only cover the state contract.
 * Here, in the chat pop-out at narrow (280-400px) and wide (1280px) widths:
 *   1. Wrapping is off by default; in narrow panes long cells are ellipsized as before.
 *   2. Turning it on (mouse or keyboard) fits the table to the pane and wraps
 *      long URLs, paths and inline code without clipping any cell.
 *   3. Toggles are per table, and the toolbar never overlaps table text.
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

        test('wraps each interactive table to the pane on demand without clipping', async ({ page, serverUrl }) => {
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

            // 1. Off by default; in a narrow pane the long values are ellipsized.
            for (const btn of [firstBtn, secondBtn, manyBtn]) {
                await expect(btn).toHaveAttribute('aria-pressed', 'false');
            }
            const firstBefore = await measure(first.locator('table'));
            if (narrow) {
                expect(firstBefore.clipped.length).toBeGreaterThan(0);
                expect(firstBefore.scrollOverflows).toBe(true);
            }

            // 2. Mouse toggle: the table fits the pane and nothing is clipped.
            await firstBtn.click();
            await expect(firstBtn).toHaveAttribute('aria-pressed', 'true');
            const firstAfter = await measure(first.locator('table'));
            expect(firstAfter.scrollOverflows).toBe(false);
            expect(firstAfter.tableWidth).toBeLessThanOrEqual(firstAfter.boxWidth + 1);
            expect(firstAfter.clipped).toEqual([]);
            for (const value of [LONG_PATH, LONG_CODE]) expect(firstAfter.text).toContain(value);
            await expect(first.locator(`a[href="${LONG_URL}"]`)).toBeVisible();

            // 3. Independent: the other tables did not change.
            await expect(secondBtn).toHaveAttribute('aria-pressed', 'false');
            await expect(manyBtn).toHaveAttribute('aria-pressed', 'false');
            if (narrow) {
                expect((await measure(second.locator('table'))).clipped.length).toBeGreaterThan(0);
            }

            // Keyboard toggle (Enter) on the second table.
            await secondBtn.focus();
            await page.keyboard.press('Enter');
            await expect(secondBtn).toHaveAttribute('aria-pressed', 'true');
            const secondAfter = await measure(second.locator('table'));
            expect(secondAfter.scrollOverflows).toBe(false);
            expect(secondAfter.clipped).toEqual([]);
            await expect(firstBtn).toHaveAttribute('aria-pressed', 'true');

            // The toolbar sits above the table and never covers its text.
            for (const [btn, table] of [[firstBtn, first], [secondBtn, second]] as const) {
                const b = (await btn.boundingBox())!;
                const t = (await table.locator('table').boundingBox())!;
                expect(b.y + b.height).toBeLessThanOrEqual(t.y + 0.5);
            }

            // 4. Too many columns (Space toggles): cells wrap, the table still scrolls when it must.
            await manyBtn.focus();
            await page.keyboard.press(' ');
            await expect(manyBtn).toHaveAttribute('aria-pressed', 'true');
            const manyAfter = await measure(many.locator('table'));
            expect(manyAfter.clipped).toEqual([]);
            expect(manyAfter.scrollOverflows).toBe(narrow);

            // Static tables have no toggle and already wrap; code blocks keep no-wrap.
            const staticTable = answer.locator('table').filter({ hasText: 'short' }).last();
            await expect(staticTable).toBeVisible();
            expect((await measure(staticTable)).clipped).toEqual([]);
            const codeWhiteSpace = await answer.locator('pre code').first()
                .evaluate(el => getComputedStyle(el).whiteSpace);
            expect(codeWhiteSpace).toBe('pre');

            // Turning it off restores the original single-line layout.
            await firstBtn.click();
            await expect(firstBtn).toHaveAttribute('aria-pressed', 'false');
            expect((await measure(first.locator('table'))).clipped).toEqual(firstBefore.clipped);
        });
    });
}
