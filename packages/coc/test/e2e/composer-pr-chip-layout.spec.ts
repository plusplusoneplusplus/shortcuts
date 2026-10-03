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
                    window.showReady = () => setState('ready');
                    return <ComposerPrChip item={{ ...ready, state }} onDismiss={() => {}}
                        onRefresh={() => {}} autoFix={{ enabled: true }} />;
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
    test(`PR chip fits its container while resizing at ${fontSize}px base font`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<div id="fixture" class="overflow-hidden rounded-t-lg"></div>');
        await page.addStyleTag({ content: css });
        await page.addStyleTag({ content: `html { font-size: ${fontSize}px; }` });
        await page.addScriptTag({ content: script });
        const chip = page.getByTestId('composer-pr-chip');
        await expect(chip).toHaveAttribute('data-state', 'loading');
        await page.evaluate(() => (window as any).showReady());
        await expect(chip).toHaveAttribute('data-state', 'ready');

        for (const width of [900, 600, 420, 280, 900]) {
            await page.setViewportSize({ width, height: 1000 });
            const author = page.getByTestId('composer-pr-chip-author');
            if (width < 500) await expect(author).toHaveCount(0);
            else await expect(author).toBeVisible();
            const bounds = await chip.boundingBox();
            expect(await chip.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            for (const id of ['composer-pr-chip-title', 'composer-pr-chip-status', 'composer-pr-chip-checks',
                'composer-pr-chip-reviewers', 'composer-pr-chip-autofix-badge-pr', 'composer-pr-chip-diff',
                'composer-pr-chip-refresh-pr', 'composer-pr-chip-view-pr', 'composer-pr-chip-dismiss-pr']) {
                const control = page.getByTestId(id);
                await expect(control).toBeVisible();
                const box = await control.boundingBox();
                expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
                expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
                if (id === 'composer-pr-chip-title') expect(box!.width).toBeGreaterThanOrEqual(128);
            }
        }
        expect(errors).toEqual([]);
    });
}
