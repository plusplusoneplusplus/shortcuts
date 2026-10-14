import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

declare global {
    interface Window {
        addressHistoryFixture: {
            calls: string[];
            opens: string[];
            panelQueries: string[];
            pending: boolean;
            resolve(): void;
            notify(): void;
            setUrl(url?: string): void;
        };
    }
}

// Real shared address/panel components, with in-memory history and no desktop profile.
let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const bundle = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { BrowserAddressBar } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserAddressBar';
            import { BrowserHistoryPanel } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserHistoryPanel';
            const entries = Array.from({ length: 10 }, (_, i) => ({
                url: i === 0 ? 'https://Example.test/Case?Q=Value#Hash' : 'https://example.test/' + i,
                title: 'Fixture page ' + i, lastVisited: 1000, visitCount: 1,
                completion: i === 0 ? 'Example.test/Case?Q=Value#Hash' : null,
            }));
            const result = () => ({ ok: true, entries, total: entries.length, recording: true, storageError: null });
            const listeners = new Set();
            const pending = [];
            const fixture = window.addressHistoryFixture = {
                calls: [], opens: [], panelQueries: [], pending: false,
                resolve: () => pending.splice(0).forEach(resolve => resolve(result())),
                notify: () => listeners.forEach(notify => notify()),
            };
            const history = {
                suggest: search => {
                    fixture.calls.push(search);
                    return fixture.pending ? new Promise(resolve => pending.push(resolve)) : Promise.resolve(result());
                },
                query: search => { fixture.panelQueries.push(search); return Promise.resolve(result()); },
                onChanged: notify => { listeners.add(notify); return () => listeners.delete(notify); },
            };
            function Fixture() {
                const inputRef = React.useRef(null);
                const [panel, showPanel] = React.useState(false);
                const [url, setUrl] = React.useState(undefined);
                fixture.setUrl = setUrl;
                return <>
                    <div className="flex" style={{ width: 400, margin: 20 }}>
                        <BrowserAddressBar inputRef={inputRef} url={url} history={history} enabled
                            ownerKey="workspace-a:view-a" invalid={false} onEdit={() => {}}
                            onOpen={url => { fixture.opens.push(url); }} />
                        <button onClick={() => showPanel(true)}>History</button>
                    </div>
                    {panel && <BrowserHistoryPanel history={history}
                        onOpen={url => { fixture.opens.push(url); }} onClose={() => showPanel(false)} />}
                </>;
            }
            createRoot(document.getElementById('fixture')).render(<Fixture />);
        ` },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.css': 'empty' },
    });
    script = bundle.outputFiles[0].text;
});

for (const dark of [false, true]) {
    test(`blank address privacy and explicit History (${dark ? 'dark' : 'light'})`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.setContent(`<html class="${dark ? 'dark' : ''}"><body><div id="fixture"></div></body></html>`);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: script });
        const address = page.getByRole('combobox', { name: 'Address' });
        await expect(address).toBeFocused();
        await expect(page.getByRole('listbox')).toHaveCount(0);
        expect(await page.evaluate(() => window.addressHistoryFixture.calls)).toEqual([]);

        await address.fill('   ');
        await address.press('ArrowDown');
        await address.press('ArrowUp');
        await page.evaluate(() => window.addressHistoryFixture.notify());
        await expect(address).toHaveValue('   ');
        await expect(address).toHaveAttribute('aria-expanded', 'false');
        expect(await page.evaluate(() => window.addressHistoryFixture.calls)).toEqual([]);

        await address.fill('ex');
        await expect(page.getByRole('option')).toHaveCount(8);
        await address.press('ArrowDown');
        await expect(address).toHaveAttribute('aria-activedescendant', /.+/);
        await address.fill('');
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await expect(address).not.toHaveAttribute('aria-activedescendant');
        await address.press('ArrowDown');
        await address.press('Enter');
        expect(await page.evaluate(() => window.addressHistoryFixture.opens)).toEqual(['']);

        await page.evaluate(() => { window.addressHistoryFixture.pending = true; });
        await address.fill('late');
        await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
        await address.fill('');
        await page.getByRole('button', { name: 'History', exact: true }).focus();
        await address.focus();
        await page.evaluate(() => {
            window.addressHistoryFixture.notify();
            window.addressHistoryFixture.setUrl('https://updated.test/');
            window.addressHistoryFixture.resolve();
            window.addressHistoryFixture.pending = false;
        });
        await expect(address).toHaveValue('');
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await expect(address).toHaveAttribute('aria-expanded', 'false');
        expect(await page.evaluate(() => window.addressHistoryFixture.calls.every(search => Boolean(search.trim())))).toBe(true);

        await address.press('e');
        await address.press('x');
        await expect(address).toHaveValue('example.test/Case?Q=Value#Hash');
        expect(await address.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]))
            .toEqual([2, 'example.test/Case?Q=Value#Hash'.length]);
        await address.press('Enter');
        expect(await page.evaluate(() => window.addressHistoryFixture.opens))
            .toEqual(['', 'https://Example.test/Case?Q=Value#Hash']);

        await address.fill('');
        await page.getByRole('button', { name: 'History', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByLabel('Search history')).toHaveValue('');
        await expect(page.getByRole('list', { name: 'History entries' }).locator('li')).toHaveCount(10);
        expect(await page.evaluate(() => window.addressHistoryFixture.panelQueries)).toEqual(['']);
        expect(errors).toEqual([]);
    });
}
