import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

// In-memory bundle and fixture-only clients. No server, served assets or Git writes.
let script: string;
let css: string;
test.beforeAll(async () => {
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { WorkingTreeAllFilesDiff } from './src/server/spa/client/react/features/git/working-tree/WorkingTreeAllFilesDiff';
            window.fixtureClient = { git: { getWorkingTreeFileDiff: async (ws, path, options) => ({ diff: '@@ -1 +1 @@\\n-old\\n+' + options.stage }), getWorkingTreeFileContent: async () => ({ head: { content: 'new text' }, binary: false, tooLarge: false }), getWorkingTreeChanges: async () => ({ changes:
                ['staged', 'unstaged', 'untracked'].map(stage => ({ stage, filePath: '/repo/src/a.ts',
                    repositoryRoot: '/repo', repositoryName: 'repo', status: stage === 'untracked' ? '?' : 'M' }))
            }) } };
            createRoot(document.getElementById('fixture')).render(<WorkingTreeAllFilesDiff workspaceId="ws" onFileSelect={() => {}} />);
        ` },
        bundle: true, write: false, outfile: '/tmp/working-changes-review-fixture.js',
        jsx: 'automatic', format: 'iife', platform: 'browser',
        plugins: [{ name: 'working-review-fixture', setup(builder) {
            builder.onLoad({ filter: /[/\\]useDiffEngine\.ts$/ }, () => ({ loader: 'ts', contents: `export const useDiffEngine = () => ['legacy', () => {}];` }));
            builder.onLoad({ filter: /[/\\]QueueContext\.tsx$/ }, () => ({ loader: 'ts', contents: `export const useQueue = () => ({ dispatch() {}, state: {} }); export const useQueueOptional = () => null;` }));
            builder.onLoad({ filter: /[/\\]useDiffComments\.ts$/ }, () => ({ loader: 'ts', contents: `export const useDiffComments = () => ({ comments: [], aiLoadingIds: new Set(), aiErrors: new Map(), resolvingIds: new Set(), deletingIds: new Set(), runRelocation() {} });` }));
            builder.onLoad({ filter: /[/\\]cloneRouting\.ts$/ }, () => ({ loader: 'ts', contents: `
                export const useCocClient = () => window.fixtureClient;
                export const useCloneBaseUrl = () => undefined;
                export const useCloneWsUrl = () => path => path;
                export const useResolveCloneBaseUrl = () => () => undefined;
            ` }));
        } }],
    });
    script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    css = await readFile('src/server/spa/client/dist/bundle.css', 'utf8') + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
});

for (const dark of [false, true]) {
    test(`shared working review resizes and becomes a keyboard-accessible drawer (${dark ? 'dark' : 'light'})`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://working-review.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
        await page.goto('http://working-review.test/');
        await page.setContent(`<html class="${dark ? 'dark' : ''}"><body><div id="fixture" style="width:1100px;height:1000px"></div></body></html>`);
        await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0}button,input,select{background:transparent;color:inherit;border:0}' + css });
        await page.addScriptTag({ content: script });
        const navigator = page.getByRole('complementary', { name: 'Changed files' });
        const separator = page.getByRole('separator', { name: 'Resize changed files list' });
        await expect(page.getByTestId('working-tree-file-diff-content')).toContainText('staged');
        await expect(navigator).toBeVisible();
        await expect(separator).toBeVisible();
        // The Git detail host is a block inside a flex column. Its child must
        // fill the available height even though the host itself is not flex.
        const expectFullHeight = async () => {
            const host = (await page.locator('#fixture').boundingBox())!;
            await expect.poll(async () => {
                const bounds = (await page.getByTestId('git-file-review').boundingBox())!;
                return Math.abs(bounds.y + bounds.height - host.y - host.height);
            }).toBeLessThanOrEqual(1);
            const review = (await page.getByTestId('git-file-review').boundingBox())!;
            const diff = (await page.getByTestId('working-tree-file-diff').boundingBox())!;
            expect(Math.abs(diff.y + diff.height - review.y - review.height)).toBeLessThanOrEqual(1);
        };
        await expectFullHeight();
        await page.locator('#fixture').evaluate(element => { element.style.height = '700px'; });
        await expectFullHeight();
        await page.locator('#fixture').evaluate(element => { element.style.display = 'flex'; });
        await expectFullHeight();
        const width = (await navigator.boundingBox())!.width;
        await separator.focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => (await navigator.boundingBox())!.width).toBe(width + 16);
        await page.getByRole('button', { name: 'Tree', exact: true }).click();
        await expect(navigator.locator('[data-file-path]')).toHaveCount(3);
        await navigator.getByRole('button', { name: /, Unstaged,/ }).click();
        await expect(page.getByTestId('working-tree-file-diff-content')).toContainText('unstaged');
        await page.locator('#fixture').evaluate(element => { element.style.width = '420px'; });
        await expect(navigator).toBeHidden();
        await expect(separator).toBeHidden();
        const trigger = page.getByRole('button', { name: 'Files · 3' });
        await trigger.click();
        await expect(navigator).toBeVisible();
        await expect(page.getByRole('textbox')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(navigator).toBeHidden();
        await expect(trigger).toBeFocused();
        await trigger.click();
        await navigator.getByRole('button', { name: /, Untracked,/ }).click();
        await expect(page.getByTestId('working-tree-file-diff-content')).toContainText('new text');
        await expect(navigator).toBeHidden();
        await expectFullHeight();
        expect(errors).toEqual([]);
    });
}
