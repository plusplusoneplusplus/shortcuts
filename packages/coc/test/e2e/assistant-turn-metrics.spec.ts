import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The real shared bubble and stylesheet, isolated from running servers and jobs.
let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { ConversationTurnBubble } from './src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
            const root = createRoot(document.getElementById('fixture'));
            window.renderTurn = (overrides = {}) => root.render(
                <ConversationTurnBubble wsId="workspace-one" taskId="chat-one" turn={{
                    role: 'assistant', content: 'A compact response with unchanged metrics.',
                    timestamp: '2026-10-11T14:25:00Z', timeline: [],
                    model: 'gpt-6.1-model-with-a-long-name',
                    tokenUsage: { inputTokens: 329900, outputTokens: 387,
                        cacheReadTokens: 120000, cacheWriteTokens: 1000, totalTokens: 330287 },
                    costTimeMs: 22400, ...overrides,
                }} />
            );
            window.renderTurn();
        ` },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        conditions: ['production'], loader: { '.css': 'empty', '.ttf': 'dataurl' },
        alias: { '@spa/features': './src/server/spa/client/react/features', '@spa/ui': './src/server/spa/client/react/ui', '@spa/shared': './src/server/spa/client/react/shared' },
    });
    script = result.outputFiles[0].text;
});

for (const dark of [false, true]) {
    test(`assistant metrics fit narrow panes and align inline (${dark ? 'dark' : 'light'})`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://metrics.test/**', route => route.fulfill(
            new URL(route.request().url()).pathname === '/'
                ? { contentType: 'text/html', body: `<html class="${dark ? 'dark' : ''}"><body style="margin:0;background:${dark ? '#1e1e1e' : '#fff'}"><div id="fixture" style="margin:16px"></div></body></html>` }
                : { json: {} },
        ));
        await page.goto('http://metrics.test/');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: script });
        const header = page.locator('.turn-header');
        const metrics = page.getByRole('button', { name: /Token usage and elapsed time/ });
        await expect(metrics).toHaveText('↓329.9k↑38722.4s');
        await expect(metrics).toHaveAttribute('aria-expanded', 'false');
        await expect(metrics.locator('[title="Input tokens: 329,900"]')).toBeVisible();
        await expect(metrics.locator('[title="Output tokens: 387"]')).toBeVisible();
        expect(await metrics.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

        // Pane width, not viewport width, controls truncation (docked panels/pop-outs).
        for (const width of [900, 400, 320, 280, 220, 900]) {
            await page.locator('#fixture').evaluate((el, w) => { el.style.width = `${w}px`; }, width);
            await header.hover();
            expect(await header.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            const bounds = (await header.boundingBox())!;
            for (const selector of ['.timestamp', '.assistant-stats-badge', '.bubble-raw-btn', '.bubble-copy-btn', '.bubble-copy-html-btn']) {
                const control = header.locator(selector);
                await expect(control).toBeVisible();
                const box = (await control.boundingBox())!;
                expect(box.x).toBeGreaterThanOrEqual(bounds.x);
                expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
            }
            const metricBox = (await metrics.boundingBox())!;
            let previousRight = bounds.x;
            for (const selector of ['.assistant-attribution', '.timestamp', '.assistant-stats-badge', '.turn-header-actions']) {
                const box = (await header.locator(selector).boundingBox())!;
                expect(Math.abs(box.y + box.height / 2 - (metricBox.y + metricBox.height / 2))).toBeLessThanOrEqual(1);
                expect(box.x).toBeGreaterThanOrEqual(previousRight - 1);
                previousRight = box.x + box.width;
            }
            expect(bounds.height).toBe(16);
            expect(metricBox.height).toBe(16);
            await expect(header.locator('.assistant-attribution')).toHaveAttribute('title', /gpt-6.1-model-with-a-long-name/);
            await expect(header.locator('.timestamp')).toHaveAttribute('aria-label', /2026/);
            await metrics.focus();
            await page.keyboard.press('Enter');
            await expect(metrics).toHaveAttribute('aria-expanded', 'true');
            await expect(metrics).toContainText('Cache read: 120,000');
            await expect(metrics).toContainText('Cache write: 1,000');
            await expect(metrics).toContainText('Total: 330,287');
            await expect(metrics).toContainText('Time: 22,400ms');
            expect((await header.boundingBox())!.height).toBe(16);
            const details = header.locator('.assistant-stats-details');
            const detailBox = (await details.boundingBox())!;
            expect(detailBox.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
            expect(detailBox.x).toBeGreaterThanOrEqual(bounds.x - 1);
            expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
            expect(await details.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
            await page.keyboard.press('Escape');
            await expect(metrics).toHaveAttribute('aria-expanded', 'false');
            await expect(metrics).toBeFocused();
            await page.keyboard.press('Tab');
            const raw = header.locator('.bubble-raw-btn');
            await expect(raw).toBeFocused();
            await expect(raw).toHaveCSS('opacity', '1');
            await page.keyboard.press('Tab');
            await expect(header.locator('.bubble-copy-btn')).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(header.locator('.bubble-copy-html-btn')).toBeFocused();
            if (width === 280 || width === 900) {
                await page.screenshot({ path: testInfo.outputPath(`metrics-${width}.png`) });
            }
        }
        // Large values, optional metadata, error/pin/JSON actions and live turns
        // share the layout without depending on a viewport breakpoint.
        for (const overrides of [
            { provider: 'codex', model: 'very-long-model-'.repeat(20), pinnedAt: '2026-10-11T14:25:00Z', content: '{"answer":42}', tokenUsage: { inputTokens: 1234567890, outputTokens: 987654321 }, costTimeMs: 999999999 },
            { provider: 'claude', isError: true, tokenUsage: undefined, costTimeMs: 0 },
            { timestamp: undefined, model: undefined, tokenUsage: { outputTokens: 987654321 }, costTimeMs: undefined },
            { streaming: true },
            { tokenUsage: undefined, costTimeMs: undefined },
        ]) {
            await page.evaluate(overrides => (window as any).renderTurn(overrides), overrides);
            await expect(header.locator('.assistant-attribution')).toHaveCount(1);
            for (const width of [220, 280, 400, 900]) {
                await page.setViewportSize({ width: Math.max(320, width + 32), height: 720 });
                await page.locator('#fixture').evaluate((el, w) => { el.style.width = `${w}px`; }, width);
                const jsonToggle = header.locator('.bubble-json-toggle-btn');
                if (await jsonToggle.count()) await jsonToggle.click();
                await header.hover();
                const bounds = (await header.boundingBox())!;
                expect(bounds.height).toBe(16);
                let previousRight = bounds.x;
                for (const child of await header.locator(':scope > *:not(.role-label)').all()) {
                    const box = (await child.boundingBox())!;
                    expect(box.x).toBeGreaterThanOrEqual(previousRight - 1);
                    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
                    expect(box.y).toBeGreaterThanOrEqual(bounds.y - 1);
                    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
                    previousRight = box.x + box.width;
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
                await expect(page.locator('.chat-message')).toHaveAttribute('data-ws-id', 'workspace-one');
                await expect(page.locator('.chat-message')).toHaveAttribute('data-chat-id', 'chat-one');
            }
        }
        expect(errors).toEqual([]);
    });
}
