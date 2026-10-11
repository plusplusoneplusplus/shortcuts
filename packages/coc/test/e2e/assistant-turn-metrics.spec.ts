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
            createRoot(document.getElementById('fixture')).render(
                <ConversationTurnBubble turn={{
                    role: 'assistant', content: 'A compact response with unchanged metrics.',
                    timestamp: '2026-10-11T14:25:00Z', timeline: [],
                    model: 'gpt-6.1-model-with-a-long-name',
                    tokenUsage: { inputTokens: 329900, outputTokens: 387,
                        cacheReadTokens: 120000, cacheWriteTokens: 1000, totalTokens: 330287 },
                    costTimeMs: 22400,
                }} />
            );
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

        // Pane width, not viewport width, controls wrapping (docked panels/pop-outs).
        for (const width of [900, 400, 280, 220, 900]) {
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
                expect(await control.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            }
            if (width === 900) {
                const metricBox = (await metrics.boundingBox())!;
                for (const selector of ['.timestamp', '.assistant-attribution', '.turn-header-actions']) {
                    const box = (await header.locator(selector).boundingBox())!;
                    expect(Math.abs(box.y + box.height - (metricBox.y + metricBox.height))).toBeLessThanOrEqual(1);
                }
                expect(metricBox.height).toBe(16);
            } else {
                expect(bounds.height).toBeGreaterThan(16);
            }
            await metrics.focus();
            await page.keyboard.press('Enter');
            await expect(metrics).toHaveAttribute('aria-expanded', 'true');
            await expect(metrics).toContainText('Cache read: 120,000');
            await expect(metrics).toContainText('Cache write: 1,000');
            await expect(metrics).toContainText('Total: 330,287');
            await expect(metrics).toContainText('Time: 22,400ms');
            expect(await header.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
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
        expect(errors).toEqual([]);
    });
}
