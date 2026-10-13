import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let script: string;
let css: string;
const payload = {
    parent: { workspaceId: 'ws-parent', processId: 'queue_parent' },
    child: { workspaceId: 'ws-child', processId: 'queue_child' },
    jobId: 'queue_child', title: 'Finish delegated search implementation with accessible result cards',
    repository: { workspaceId: 'ws-child', name: 'Repository-with-a-long-name-for-responsive-layout' },
    terminalEventId: 'child-terminal', outcome: 'completed',
    summary: '**Outcome**\n\n' + 'Readable result summary with commit abc1234.\n'.repeat(100),
    links: ['javascript:alert(1)'],
};
const rawJson = `  ${JSON.stringify(payload, null, 2)}\n`;

test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: {
            resolveDir: process.cwd(), loader: 'tsx', contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { SentinelResultCard } from './src/server/spa/client/react/features/chat/conversation/SentinelResultCard';
                import { parseSentinelResult } from './src/server/spa/client/react/features/chat/conversation/sentinelResult';
                import { SENTINEL_JOB_REVIEW_PREFIX } from './src/server/delegation/sentinel-job-review-instructions';
                const rawJson = ${JSON.stringify(rawJson)};
                const content = SENTINEL_JOB_REVIEW_PREFIX + '\\n' + rawJson;
                const result = parseSentinelResult({
                    role: 'user', content, relayRequestId: 'delegated-review-' + 'a'.repeat(64), timeline: [],
                }, content, 'ws-parent', 'queue_parent');
                Object.defineProperty(navigator, 'clipboard', { value: {
                    writeText: async text => { window.copiedJson = text; },
                }});
                createRoot(document.getElementById('fixture')).render(
                    <SentinelResultCard result={result} sourceSelectionId="ws-parent" />
                );
            `,
        },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.css': 'empty' },
        plugins: [{
            name: 'unused-diagram-view',
            setup(builder) {
                builder.onResolve({ filter: /\/ExcalidrawPreview$/ }, () => ({ path: 'diagram', namespace: 'fixture' }));
                builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                    contents: 'export const ExcalidrawPreview = () => null;',
                }));
            },
        }],
    });
    script = result.outputFiles[0].text;
});

for (const dark of [false, true]) {
    for (const width of [320, 1024]) {
        test(`collapsed result, keyboard and overflow at ${width}px in ${dark ? 'dark' : 'light'}`, async ({ page }) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setViewportSize({ width, height: 900 });
            await page.route('http://result.test/**', route => route.fulfill({
                contentType: 'text/html', body: '<div id="fixture" style="padding:12px"></div>',
            }));
            await page.goto('http://result.test/');
            await page.addStyleTag({ content: css });
            if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
            await page.addScriptTag({ content: script });
            const card = page.getByRole('region', { name: 'Delegated job result' });
            const summary = page.getByTestId('sentinel-result-summary');
            const raw = page.getByTestId('sentinel-result-raw');
            await expect(card).toBeVisible();
            await expect(summary).toBeHidden();
            await expect(raw).toBeHidden();
            const height = (await card.boundingBox())!.height;
            expect(height).toBeLessThan(300);
            await expect(card.getByRole('link', { name: 'Open job' })).toHaveAttribute('href', '#repos/ws-child/chats/queue_child');
            expect(await card.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

            const detailsToggle = card.locator('summary', { hasText: /^Details$/ });
            await detailsToggle.focus();
            await page.keyboard.press('Enter');
            await expect(summary).toBeVisible();
            await expect(summary.locator('strong')).toHaveText('Outcome');
            expect((await card.boundingBox())!.height).toBeGreaterThan(height + 300);
            expect(await card.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            await page.keyboard.press('Space');
            await expect(summary).toBeHidden();
            await page.keyboard.press('Tab');
            const rawToggle = card.locator('summary', { hasText: /^Raw JSON$/ });
            await expect(rawToggle).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(raw).toBeVisible();
            await expect(raw).toHaveText(rawJson, { useInnerText: false });
            expect(await card.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
            await page.keyboard.press('Tab');
            await expect(raw).toBeFocused();
            await page.keyboard.press('Tab');
            const copy = card.getByRole('button', { name: 'Copy JSON' });
            await expect(copy).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(card.getByRole('status')).toHaveText('JSON copied');
            expect(await page.evaluate(() => Reflect.get(window, 'copiedJson'))).toBe(rawJson);
            expect(await card.locator('a').count()).toBe(1);
            expect(errors).toEqual([]);
        });
    }
}
