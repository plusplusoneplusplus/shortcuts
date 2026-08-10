/**
 * Kusto chart interaction E2E — the real-browser half of interactive-kusto-chart.
 *
 * The vitest suites mock `loadRecharts()` with the npm package, so they prove the
 * component logic but never the thing this feature actually rests on: that the
 * SPA bundle (which deliberately does NOT contain recharts) can pull
 * `/canvas-vendor/recharts.js` at runtime, bind it to the SPA's own React, and
 * draw an interactive chart in a real browser. That is what runs here, against a
 * real server serving the real vendor bundle.
 *
 * The canvas is seeded straight onto disk (descriptor + artifact) because Kusto
 * canvases are created by the `kusto_query` LLM tool, not by a REST endpoint.
 * The pop-out canvas route (`#popout/canvas`) is the entry point: it renders the
 * shared CanvasPanel full-screen without needing a chat process.
 *
 * Coverage:
 *   1. recharts really loads from /canvas-vendor and draws all three series.
 *   2. Hover shows every visible series with exact, unrounded values (AC-03).
 *   3. A legend click hides a series and rescales the y-axis; clicking restores (AC-04).
 *   4. Drag-select zooms the x range; Reset zoom restores it (AC-05).
 *   5. None of the above writes to the canvas — no PUT ever fires (AC-04/AC-07).
 *
 * Like every E2E spec here the server runs from `dist/`, so a client-only change
 * needs `npm run build:copy-client` before this passes — otherwise the browser
 * gets the previously built bundle and the chart never appears.
 */

import * as fs from 'fs';
import * as path from 'path';
import { test, expect, type Page } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';

const WS_ID = 'ws-kusto-chart';
const CANVAS_ID = 'cv-kusto-chart';

/** Services drawn as separate series, and the exact values asserted in the tooltip. */
const SERVICES = ['api-gateway', 'inference', 'auth'] as const;
const LABEL_COUNT = 12;

/**
 * Deliberately long decimals: AC-03 fails if anything rounds them. The
 * api-gateway values are an order of magnitude above the others so hiding it
 * visibly rescales the y-axis (AC-04 DoD-3).
 */
function p95(service: string, i: number): number {
    const base = service === 'api-gateway' ? 9000 : service === 'inference' ? 400 : 120;
    return base + i * 10 + 0.7043;
}

function kustoContent(): string {
    const rows: Array<[string, string, number]> = [];
    for (let i = 0; i < LABEL_COUNT; i++) {
        const ts = `2026-01-01T${String(i).padStart(2, '0')}:00:00Z`;
        for (const service of SERVICES) rows.push([ts, service, p95(service, i)]);
    }
    return JSON.stringify({
        query: 'Latency | summarize percentile(duration, 95) by bin(ts, 1h), service',
        clusterUrl: 'https://help.kusto.windows.net',
        database: 'Samples',
        columns: [
            { name: 'ts', type: 'datetime' },
            { name: 'service', type: 'string' },
            { name: 'p95', type: 'real' },
        ],
        rows,
        truncated: false,
        chartConfig: { type: 'line', x: 'ts', y: ['p95'], series: 'service' },
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

/** Open the pop-out canvas window and switch to the Chart view. */
async function openChart(page: Page, serverUrl: string): Promise<void> {
    await page.goto(`${serverUrl}/?workspace=${WS_ID}&canvasId=${CANVAS_ID}#popout/canvas`);
    await expect(page.locator('[data-testid="kusto-view"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-testid="kusto-view-chart"]').click();
    // The chart only appears once /canvas-vendor/recharts.js has loaded and
    // window.Recharts is bound — the loading placeholder is what shows until then.
    await expect(page.locator('.recharts-surface')).toBeVisible({ timeout: 20_000 });
}

/** Bounding box of the plotted surface, used to aim hovers and drags. */
async function surfaceBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await page.locator('.recharts-wrapper').boundingBox();
    if (!box) throw new Error('recharts wrapper has no box');
    return box;
}

/** Vertical spread of a line path — a proxy for the y-axis scale. */
async function lineSpread(page: Page, index: number): Promise<number> {
    const d = await page.locator('.recharts-line-curve').nth(index).getAttribute('d');
    if (!d) throw new Error('line has no path');
    const ys = [...d.matchAll(/[ML,]\s*[-\d.]+\s*,\s*([-\d.]+)/g)].map(m => parseFloat(m[1]));
    return Math.max(...ys) - Math.min(...ys);
}

/** Number of plotted points on a line — a proxy for the x domain size. */
async function pointCount(page: Page, index: number): Promise<number> {
    const d = await page.locator('.recharts-line-curve').nth(index).getAttribute('d');
    if (!d) throw new Error('line has no path');
    return d.split(',').length;
}

test.describe('Kusto chart interaction (real browser)', () => {
    test('recharts loads from /canvas-vendor and draws every series', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-chart-repo');
        seedKustoCanvas(dataDir);

        const vendorRequests: string[] = [];
        page.on('response', res => {
            if (res.url().includes('/canvas-vendor/recharts.js')) vendorRequests.push(`${res.status()}`);
        });
        const pageErrors: string[] = [];
        page.on('pageerror', err => pageErrors.push(String(err)));

        await openChart(page, serverUrl);

        // Fetched exactly once, from the vendor path — not bundled into the SPA.
        expect(vendorRequests).toEqual(['200']);
        await expect(page.locator('.recharts-line')).toHaveCount(SERVICES.length);
        // The vendor bundle externalizes react to window.React, so the loader must
        // have published the SPA's own instance before the script parsed. A second
        // React copy would blow up inside recharts' hooks and land here.
        expect(await page.evaluate(() => typeof (window as any).Recharts)).toBe('object');
        expect(await page.evaluate(() => typeof (window as any).React?.useState)).toBe('function');
        expect(pageErrors).toEqual([]);
    });

    test('hover shows every visible series at full precision', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-chart-repo');
        seedKustoCanvas(dataDir);
        await openChart(page, serverUrl);

        const box = await surfaceBox(page);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

        const tooltip = page.locator('[data-testid="kusto-chart-tooltip"]');
        await expect(tooltip).toBeVisible({ timeout: 10_000 });
        for (const service of SERVICES) {
            await expect(tooltip).toContainText(service);
        }
        // Exact, unrounded — the headline requirement.
        await expect(tooltip).toContainText(/\.7043\b/);
        await expect(tooltip).not.toContainText(/\d+\.\d\dk/);
    });

    test('legend click hides a series and rescales the y-axis, click restores it', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-chart-repo');
        seedKustoCanvas(dataDir);
        await openChart(page, serverUrl);

        const legend = page.locator('[data-testid="kusto-chart-legend"] button');
        await expect(legend).toHaveCount(SERVICES.length);

        // Index 2 is auth, the smallest series; it is flat while api-gateway dominates.
        const before = await lineSpread(page, 2);
        await legend.filter({ hasText: 'api-gateway' }).click();
        await expect(page.locator('.recharts-line')).toHaveCount(SERVICES.length - 1);
        const after = await lineSpread(page, 1);
        expect(after).toBeGreaterThan(before * 2);

        await legend.filter({ hasText: 'api-gateway' }).click();
        await expect(page.locator('.recharts-line')).toHaveCount(SERVICES.length);
    });

    test('drag zooms the x range and Reset zoom restores it', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-chart-repo');
        seedKustoCanvas(dataDir);
        await openChart(page, serverUrl);

        const full = await pointCount(page, 0);
        const box = await surfaceBox(page);
        const y = box.y + box.height / 2;

        await page.mouse.move(box.x + box.width * 0.3, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.5, y);
        await page.mouse.move(box.x + box.width * 0.7, y);
        await page.mouse.up();

        const reset = page.locator('[data-testid="kusto-chart-reset-zoom"]');
        await expect(reset).toBeVisible({ timeout: 10_000 });
        await expect.poll(() => pointCount(page, 0)).toBeLessThan(full);

        await reset.click();
        await expect(reset).toHaveCount(0);
        await expect.poll(() => pointCount(page, 0)).toBe(full);
    });

    test('hover, legend toggle and zoom never write to the canvas', async ({ page, serverUrl, dataDir }) => {
        await seedWorkspace(serverUrl, WS_ID, 'kusto-chart-repo');
        seedKustoCanvas(dataDir);

        const writes: string[] = [];
        page.on('request', req => {
            if (req.method() !== 'GET' && /\/canvases\//.test(req.url())) writes.push(`${req.method()} ${req.url()}`);
        });

        await openChart(page, serverUrl);

        const box = await surfaceBox(page);
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width / 2, y);
        await expect(page.locator('[data-testid="kusto-chart-tooltip"]')).toBeVisible({ timeout: 10_000 });

        await page.locator('[data-testid="kusto-chart-legend"] button').first().click();
        await expect(page.locator('.recharts-line')).toHaveCount(SERVICES.length - 1);

        await page.mouse.move(box.x + box.width * 0.3, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.7, y);
        await page.mouse.up();
        await expect(page.locator('[data-testid="kusto-chart-reset-zoom"]')).toBeVisible({ timeout: 10_000 });

        // Ephemeral view state: nothing persists, so the revision never bumps.
        expect(writes).toEqual([]);
        const artifact = fs.readFileSync(path.join(dataDir, 'repos', WS_ID, 'canvases', CANVAS_ID, 'artifact.md'), 'utf-8');
        expect(JSON.parse(artifact).chartConfig).toEqual({ type: 'line', x: 'ts', y: ['p95'], series: 'service' });
    });
});
