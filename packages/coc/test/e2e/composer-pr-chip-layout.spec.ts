import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Render the real component and built stylesheet without a running CoC server.
// Only automation hooks are stubbed to keep all badges present without API writes.
let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: {
            resolveDir: process.cwd(), loader: 'tsx', contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { ComposerPrFoldRow } from './src/server/spa/client/react/features/chat/conversation/ComposerPrFoldRow';
                import { ComposerPrChip } from './src/server/spa/client/react/features/chat/conversation/ComposerPrChip';
                const ready = {
                    key: 'pr', repoId: 'ws', number: 850, state: 'ready',
                    pr: { number: 850, title: 'A pull request with a long title', status: 'merged',
                        author: { displayName: 'plusplusoneplusplus'.repeat(5) },
                        diffStats: { additions: 12345, deletions: 6789, changedFiles: 3 } },
                    checksState: 'ready', checks: [{ id: 'ci', name: 'CI', status: 'success' }],
                    reviewersState: 'ready', reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'approved' }],
                };
                function Fixture() {
                    const [state, setState] = React.useState('loading');
                    window.showState = next => setState(next);
                    return <><ComposerPrChip item={{ ...ready, state, error: 'Long error message '.repeat(20) }}
                        onDismiss={() => { window.dismissed = true; }} onRetry={() => { window.retried = true; }}
                        onRefresh={() => {}} autoFix={{ enabled: true }} />
                        <ComposerPrFoldRow summary={{ count: 12, numbers: [850, 849, 848, 847],
                            dotStatuses: ['merged', 'closed'], breakdownText: '10 merged · 2 closed' }}
                            open={false} onToggle={() => { window.toggled = true; }} /></>;
                }
                createRoot(document.getElementById('fixture')).render(<Fixture />);
            `,
        },
        bundle: true, write: false, format: 'iife', platform: 'browser',
        loader: { '.css': 'empty' },
        plugins: [{
            name: 'automation-fixture',
            setup(builder) {
                builder.onResolve({ filter: /\/usePrAuto(FixTrigger|MergeMutation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
                builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
                    export const usePrAutoFixTrigger = () => ({ armed: true });
                    export const usePrAutoMergeMutation = () => ({});
                ` }));
            },
        }],
    });
    script = result.outputFiles[0].text;
});

for (const fontSize of [16, 24]) {
    for (const dark of [false, true]) {
        test(`PR banners stay on one row at ${fontSize}px (${dark ? 'dark' : 'light'})`, async ({ page }) => {
            test.setTimeout(120_000);
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setContent(`<div id="fixture" class="composer-pr-container overflow-hidden rounded-t-lg"></div>`);
            await page.addStyleTag({ content: css });
            await page.addStyleTag({ content: `html { font-size: ${fontSize}px; }` });
            if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
            await page.addScriptTag({ content: script });
            const chip = page.getByTestId('composer-pr-chip');

            // A narrow pane in a wide viewport must compact too. Resize both ways
            // and check every fetch state, including the original loading transition.
            for (const width of [900, 700, 699, 600, 500, 499, 420, 380, 379, 320, 280, 900]) {
                await page.setViewportSize({ width: 1200, height: 1000 });
                await page.locator('#fixture').evaluate((el, w) => { el.style.width = `${w}px`; }, width);
                for (const state of ['loading', 'error', 'ready']) {
                    await page.evaluate(next => (window as any).showState(next), state);
                    await expect(chip).toHaveAttribute('data-state', state);
                    // ResizeObserver is throttled; wait for the author policy to settle.
                    if (state === 'ready') {
                        const author = page.getByTestId('composer-pr-chip-author');
                        // JS drops the author below 500px; rem container queries hide
                        // author/diff earlier when the base font is larger.
                        const roomy = width > 31.1875 * fontSize;
                        if (width < 500) await expect(author).toHaveCount(0);
                        else if (!roomy) await expect(author).toBeHidden();
                        // When space is tight the author may truncate to nothing before the title.
                        else if (width >= 900) await expect(author).toBeVisible();
                        else await expect(author).toHaveCount(1);
                        // The title outranks the author for space at every width.
                        const titleWidth = (await page.getByTestId('composer-pr-chip-title').boundingBox())!.width;
                        expect(titleWidth).toBeGreaterThanOrEqual(width < 500 ? 24 : 64);
                        await expect(page.getByRole('link', { name: 'View pull request' })).toBeVisible();
                    }
                    for (const row of [chip, page.getByTestId('composer-pr-fold-row')]) {
                        expect(await row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
                        const bounds = (await row.boundingBox())!;
                        // Every visible direct child occupies the same vertical center;
                        // the old wrapping layout fits horizontally but fails this check.
                        for (const child of await row.locator(':scope > *').all()) {
                            if (!await child.isVisible()) continue;
                            const box = (await child.boundingBox())!;
                            expect(Math.abs(box.y + box.height / 2 - (bounds.y + (bounds.height - 1) / 2))).toBeLessThanOrEqual(1);
                            expect(box.x).toBeGreaterThanOrEqual(bounds.x);
                            expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
                        }
                    }
                    await expect(page.getByRole('button', { name: 'Dismiss pull request' })).toBeVisible();
                    if (state === 'ready') {
                        for (const id of ['composer-pr-chip-status', 'composer-pr-chip-checks',
                            'composer-pr-chip-reviewers', 'composer-pr-chip-autofix-badge-pr',
                            'composer-pr-chip-refresh-pr', 'composer-pr-chip-view-pr']) {
                            await expect(page.getByTestId(id)).toBeVisible();
                        }
                        const view = page.getByRole('link', { name: 'View pull request' });
                        await view.focus();
                        await expect(view).toBeFocused();
                        await page.keyboard.press('Tab');
                        await expect(page.getByRole('button', { name: 'Dismiss pull request' })).toBeFocused();
                        await expect(page.getByTestId('composer-pr-chip-diff')).toBeVisible({ visible: width > 31.1875 * fontSize });
                    }
                }
            }
            await page.setViewportSize({ width: 280, height: 1000 });
            await page.locator('#fixture').evaluate(el => { el.style.width = '100%'; });
            await page.getByRole('button', { name: 'Dismiss pull request' }).focus();
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => (window as any).dismissed)).toBe(true);
            await page.getByTestId('composer-pr-fold-row').focus();
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => (window as any).toggled)).toBe(true);
            expect(errors).toEqual([]);
        });
    }
}
