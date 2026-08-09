/**
 * Kusto result table E2E — the real-browser half of kusto-result-table-ui.
 *
 * The vitest suites can only assert the class contract: padding, borders,
 * alignment, sticky positioning and column widths all come from CSS, and jsdom
 * has no layout engine. Everything this feature is actually about is therefore
 * only provable in a real browser, which is what runs here.
 *
 * The canvas is seeded straight onto disk (descriptor + artifact) because Kusto
 * canvases are created by the `kusto_query` LLM tool, not by a REST endpoint.
 * The pop-out canvas route (`#popout/canvas`) renders the shared CanvasPanel
 * full-screen without needing a chat process. We stay on the Table view.
 *
 * Coverage:
 *   1. Self-contained styling outside `.markdown-body` — padded, bordered,
 *      compact cells (AC-01, AC-02).
 *   2. Long values stay on one line and keep their full text in `title` (AC-02).
 *   3. Numeric columns are right-aligned with tabular figures (AC-03).
 *   4. The table owns its scroll, the header sticks, the page never scrolls (AC-04).
 *   5. At a narrow width every toolbar button stays inside the toolbar (AC-05).
 *   6. Dragging a header edge resizes that column and does not sort (AC-06).
 *
 * Like every E2E spec here the server runs from `dist/`, so this client-only
 * change needs `npm run build:copy-client` before the spec passes — otherwise
 * the browser gets the previously built bundle and every assertion below fails
 * against the old, unstyled table.
 */

import * as fs from 'fs';
import * as path from 'path';
import { test, expect, type Page } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';

const WS_ID = 'ws-kusto-table';
const CANVAS_ID = 'cv-kusto-table';

/** 25 rows — the pagination threshold, so everything is on one scrollable page. */
const ROW_COUNT = 25;
/** A value far wider than its column, used for the ellipsis / title assertions. */
const LONG_NAME =
    'inference-gateway-canary-westus2-extremely-long-service-identifier-that-will-not-fit';

function kustoContent(): string {
    const rows: Array<[string, string, number, number, number, number]> = [];
    for (let i = 0; i < ROW_COUNT; i++) {
        const ts = `2026-08-08T${String(i % 24).padStart(2, '0')}:00:00Z`;
        rows.push([ts, i === 0 ? LONG_NAME : `service-${i}`, 12.5 + i, 140.25 + i, 900.125 + i, 1000 + i]);
    }
    return JSON.stringify({
        query: 'Latency | summarize percentiles(duration, 50, 95, 99), count() by bin(ts, 1h), service',
        clusterUrl: 'https://help.kusto.windows.net',
        database: 'Samples',
        columns: [
            { name: 'ts', type: 'datetime' },
            { name: 'service', type: 'string' },
            { name: 'P50', type: 'real' },
            { name: 'P95', type: 'real' },
            { name: 'P99', type: 'real' },
            { name: 'Count', type: 'long' },
        ],
        rows,
        truncated: false,
        lastRun: { timestamp: new Date().toISOString(), status: 'success', rowCount: rows.length },
    });
}

/** Write the descriptor + artifact the canvas record repository reads. */
function seedKustoCanvas(dataDir: string): void {
    const dir = path.join(dataDir, 'repos', WS_ID, 'canvases', CANVAS_ID);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
        path.join(dir, 'canvas.json'),
        JSON.stringify(
            {
                id: CANVAS_ID,
                workspaceId: WS_ID,
                title: 'Latency percentiles',
                type: 'kusto',
                revision: 1,
                createdAt: now,
                updatedAt: now,
                seq: 1,
                lastEditor: 'ai',
            },
            null,
            2,
        ),
    );
    fs.writeFileSync(path.join(dir, 'artifact.md'), kustoContent());
}

/** Open the pop-out canvas window on the (default) Table view. */
async function openTable(page: Page, serverUrl: string): Promise<void> {
    await page.goto(`${serverUrl}/?workspace=${WS_ID}&canvasId=${CANVAS_ID}#popout/canvas`);
    await expect(page.locator('[data-testid="kusto-view"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.interactive-md-table tbody tr').first()).toBeVisible({ timeout: 20_000 });
}

/** The table is rendered outside `.markdown-body`; this proves it, in the browser. */
async function hasMarkdownBodyAncestor(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const table = document.querySelector('.interactive-md-table');
        return !!table?.closest('.markdown-body');
    });
}

/** Numeric shorthand for a computed style value. */
async function px(page: Page, selector: string, prop: string, nth = 0): Promise<number> {
    const raw = await page
        .locator(selector)
        .nth(nth)
        .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
    return parseFloat(raw);
}

test.describe('Kusto result table (real browser)', () => {
    test('cells are padded, bordered and compact with no .markdown-body ancestor', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-table-repo');
        seedKustoCanvas(dataDir);
        await openTable(page, serverUrl);

        // AC-01: none of the styling below may come from the chat markdown block.
        expect(await hasMarkdownBodyAncestor(page)).toBe(false);

        const cell = '.interactive-md-table tbody td';
        expect(await px(page, cell, 'padding-top')).toBeGreaterThan(0);
        expect(await px(page, cell, 'padding-left')).toBeGreaterThan(0);
        expect(await px(page, cell, 'border-bottom-width')).toBeGreaterThan(0);
        // AC-02: compact typography, not the inherited canvas font size.
        expect(await px(page, cell, 'font-size')).toBeLessThanOrEqual(12.5);

        const header = '.interactive-md-table thead th';
        expect(await px(page, header, 'padding-top')).toBeGreaterThan(0);
        expect(await px(page, header, 'font-weight')).toBeGreaterThanOrEqual(600);
        const headerBg = await page
            .locator(header)
            .first()
            .evaluate(el => getComputedStyle(el).backgroundColor);
        expect(headerBg).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('long values stay on one line, are ellipsised and keep their full text in title', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-table-repo');
        seedKustoCanvas(dataDir);
        await openTable(page, serverUrl);

        const tsCell = page.locator('.interactive-md-table tbody tr').first().locator('td').first();
        await expect(tsCell).toHaveText('2026-08-08T00:00:00Z');
        // AC-02 DoD-3: one line. Two lines at 12px/1.4 plus padding would exceed 30px.
        const tsBox = await tsCell.boundingBox();
        expect(tsBox!.height).toBeLessThan(30);

        const nameCell = page.locator('.interactive-md-table tbody tr').first().locator('td').nth(1);
        await expect(nameCell).toHaveAttribute('title', LONG_NAME);
        const whiteSpace = await nameCell.evaluate(el => getComputedStyle(el).whiteSpace);
        const overflow = await nameCell.evaluate(el => getComputedStyle(el).textOverflow);
        expect(whiteSpace).toBe('nowrap');
        expect(overflow).toBe('ellipsis');
        // Clipped, not stretched: the text block stops at the 320px default cap
        // and is genuinely ellipsised (rendered width < the text's own width).
        const text = nameCell.locator('.interactive-table-cell-text');
        const metrics = await text.evaluate(el => ({
            width: el.getBoundingClientRect().width,
            scrollWidth: el.scrollWidth,
        }));
        expect(metrics.width).toBeLessThanOrEqual(321);
        expect(metrics.scrollWidth).toBeGreaterThan(metrics.width + 20);
        const nameBox = await nameCell.boundingBox();
        expect(nameBox!.height).toBeLessThan(30);

        // And the long column has not pushed the table past its scroll container.
        const fits = await page.evaluate(() => {
            const scroll = document.querySelector('.interactive-table-scroll')!;
            return scroll.scrollWidth <= scroll.clientWidth + 1;
        });
        expect(fits).toBe(true);
    });

    test('numeric columns are right-aligned with tabular figures', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-table-repo');
        seedKustoCanvas(dataDir);
        await openTable(page, serverUrl);

        // Columns: 0 ts, 1 service (strings) — 2..5 P50/P95/P99/Count (numeric).
        const firstRow = page.locator('.interactive-md-table tbody tr').first();
        for (const i of [2, 3, 4, 5]) {
            const td = firstRow.locator('td').nth(i);
            expect(await td.evaluate(el => getComputedStyle(el).textAlign)).toBe('right');
            expect(await td.evaluate(el => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
            const th = page.locator('.interactive-md-table thead th').nth(i);
            // The header text is laid out by a flex row, so alignment is justify-content.
            expect(await th.locator('.interactive-table-header-content').evaluate(el => getComputedStyle(el).justifyContent)).toBe('flex-end');
        }
        // KustoView passes alignments all 'left'; string columns must keep that.
        const tsTd = firstRow.locator('td').first();
        expect(await tsTd.evaluate(el => getComputedStyle(el).textAlign)).toBe('left');
    });

    test('the table owns its scroll, the header sticks and the page does not move', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-table-repo');
        seedKustoCanvas(dataDir);
        // Short viewport so 25 rows cannot fit — the scroll container must overflow.
        await page.setViewportSize({ width: 1100, height: 520 });
        await openTable(page, serverUrl);

        const scroll = page.locator('.interactive-table-scroll');
        const overflow = await scroll.evaluate(el => ({
            canScroll: el.scrollHeight > el.clientHeight,
            overflowY: getComputedStyle(el).overflowY,
        }));
        expect(overflow.canScroll).toBe(true);
        expect(['auto', 'scroll']).toContain(overflow.overflowY);

        const headerBefore = (await page.locator('.interactive-md-table thead th').first().boundingBox())!;
        const rowBefore = (await page.locator('.interactive-md-table tbody tr').first().boundingBox())!;
        const bodyScrollBefore = await page.evaluate(() => window.scrollY + document.documentElement.scrollTop);

        await scroll.evaluate(el => {
            el.scrollTop = 160;
        });
        await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);

        const headerAfter = (await page.locator('.interactive-md-table thead th').first().boundingBox())!;
        const rowAfter = (await page.locator('.interactive-md-table tbody tr').first().boundingBox())!;

        // AC-04 DoD-2: the header did not move; the first data row did.
        expect(Math.abs(headerAfter.y - headerBefore.y)).toBeLessThan(2);
        expect(rowBefore.y - rowAfter.y).toBeGreaterThan(50);

        // AC-04 DoD-3: the page itself never scrolled.
        const bodyScrollAfter = await page.evaluate(() => window.scrollY + document.documentElement.scrollTop);
        expect(bodyScrollAfter).toBe(bodyScrollBefore);
    });

    test('every toolbar button stays inside the toolbar at a narrow width', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-table-repo');
        seedKustoCanvas(dataDir);
        await page.setViewportSize({ width: 520, height: 720 });
        await openTable(page, serverUrl);

        const toolbar = page.locator('.interactive-table-toolbar');
        const bar = (await toolbar.boundingBox())!;
        const titles = ['Show filters', 'Toggle column visibility', 'Copy as Markdown', 'Copy as CSV', 'Expand table'];
        for (const title of titles) {
            const btn = toolbar.locator(`button[title="${title}"]`);
            await expect(btn).toBeVisible();
            const box = (await btn.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(bar.x - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
            expect(box.y).toBeGreaterThanOrEqual(bar.y - 1);
            expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
        }
    });

    test('dragging a header edge resizes that column without sorting it', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-table-repo');
        seedKustoCanvas(dataDir);
        await openTable(page, serverUrl);

        const writes: string[] = [];
        page.on('request', req => {
            if (req.method() !== 'GET' && /\/canvases\//.test(req.url())) writes.push(`${req.method()} ${req.url()}`);
        });

        const firstCellBefore = await page.locator('.interactive-md-table tbody tr').first().locator('td').first().textContent();
        const th = page.locator('.interactive-md-table thead th').first();
        const widthBefore = (await th.boundingBox())!.width;
        const neighbour = page.locator('.interactive-md-table thead th').nth(1);
        const neighbourBefore = (await neighbour.boundingBox())!.width;

        const handle = page.locator('[data-testid="interactive-table-resizer-col_0"]');
        const hb = (await handle.boundingBox())!;
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        // Hovering seeds the measured widths and flips the table to fixed layout.
        // That must be invisible — no column may move before the drag starts.
        expect((await th.boundingBox())!.width).toBeCloseTo(widthBefore, 0);
        expect((await neighbour.boundingBox())!.width).toBeCloseTo(neighbourBefore, 0);

        await page.mouse.down();
        await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 5 });
        await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2, { steps: 5 });
        await page.mouse.up();

        await expect
            .poll(async () => (await th.boundingBox())!.width)
            .toBeGreaterThan(widthBefore + 90);
        const widthAfter = (await th.boundingBox())!.width;
        expect(widthAfter - widthBefore).toBeLessThan(160);

        // The neighbour keeps its width — the table grows instead of reflowing.
        const neighbourAfter = (await neighbour.boundingBox())!.width;
        expect(Math.abs(neighbourAfter - neighbourBefore)).toBeLessThan(2);

        // AC-06: the drag started on the sortable <th> but must not have sorted it.
        await expect(th.locator('.interactive-table-sort-indicator')).toHaveCount(0);
        const firstCellAfter = await page.locator('.interactive-md-table tbody tr').first().locator('td').first().textContent();
        expect(firstCellAfter).toBe(firstCellBefore);

        // Widths are session-local: nothing is written back to the canvas.
        expect(writes).toEqual([]);
    });
});
