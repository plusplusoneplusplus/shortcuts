import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

declare global {
    interface Window {
        addressCopyFixture: {
            copies: { trusted: boolean; handled: boolean; payload: Record<string, string> }[];
            menus: boolean[];
            setPage(url: string, title?: string, owner?: string): void;
            commandCopy(): void;
        };
    }
}

let script: string;
test.beforeAll(async () => {
    const bundle = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { BrowserAddressBar } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserAddressBar';
            const fixture = window.addressCopyFixture = {
                copies: [], menus: [], commandCopy: () => document.execCommand('copy'),
            };
            // Capture fixture writes, not clipboard reads. Never publish to the OS clipboard.
            let payload;
            document.addEventListener('copy', event => {
                payload = {};
                Object.defineProperty(event.clipboardData, 'setData', {
                    value: (type, value) => { payload[type] = value; },
                });
            }, true);
            document.addEventListener('copy', event => {
                fixture.copies.push({ trusted: event.isTrusted, handled: event.defaultPrevented, payload });
                event.preventDefault();
            });
            function Fixture() {
                const inputRef = React.useRef(null);
                const [page, setPage] = React.useState({
                    url: 'https://example.test/Case?one=1&two=2#Part',
                    title: 'Fixture <Page> & "Title"', owner: 'workspace-a:view-a',
                });
                fixture.setPage = (url, title, owner = page.owner) => setPage({ url, title, owner });
                return <div style={{ width: 600 }}>
                    <BrowserAddressBar inputRef={inputRef} url={page.url}
                        committedPage={page.title === undefined ? undefined : { url: page.url, title: page.title, revision: 1 }}
                        enabled ownerKey={page.owner} invalid={false} onEdit={() => {}}
                        onOpen={() => {}} showAddressMenu={async selected => {
                            fixture.menus.push(selected); return { ok: true };
                        }} />
                    <input aria-label="Other input" />
                </div>;
            }
            createRoot(document.getElementById('fixture')).render(<Fixture />);
        ` },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    });
    script = bundle.outputFiles[0].text;
});

test('trusted keyboard and native-command Copy preserve rich payloads and selection fallbacks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="fixture"></div>');
    await page.addScriptTag({ content: script });
    const address = page.getByRole('textbox', { name: 'Address', exact: true });
    await address.focus();
    await address.press('ControlOrMeta+a');
    const chord = process.platform === 'darwin' ? 'Meta+c' : 'Control+c';
    await address.press(chord);
    let copies = await page.evaluate(() => window.addressCopyFixture.copies);
    expect(copies).toEqual([{
        trusted: true, handled: true, payload: {
            'text/plain': 'https://example.test/Case?one=1&two=2#Part',
            'text/html': '<a href="https://example.test/Case?one=1&amp;two=2#Part">Fixture &lt;Page&gt; &amp; &quot;Title&quot;</a>',
        },
    }]);
    await address.click({ button: 'right' });
    expect(await page.evaluate(() => window.addressCopyFixture.menus)).toEqual([true]);
    await page.evaluate(() => window.addressCopyFixture.commandCopy());
    copies = await page.evaluate(() => window.addressCopyFixture.copies);
    expect(copies[1]).toEqual(copies[0]);

    await address.evaluate((input: HTMLInputElement) => input.setSelectionRange(8, 15));
    await address.press(chord);
    expect(await page.evaluate(() => window.addressCopyFixture.copies.at(-1)))
        .toMatchObject({ handled: false, payload: {} });
    await address.fill('https://draft.test/');
    await address.press('ControlOrMeta+a');
    await address.press(chord);
    expect(await page.evaluate(() => window.addressCopyFixture.copies.at(-1)))
        .toMatchObject({ handled: false, payload: {} });

    await page.evaluate(() => window.addressCopyFixture.setPage('https://second.test/', '', 'workspace-b:view-b'));
    await expect(address).toHaveValue('https://second.test/');
    await address.press('ControlOrMeta+a');
    await address.press(chord);
    expect(await page.evaluate(() => window.addressCopyFixture.copies.at(-1)?.payload)).toEqual({
        'text/plain': 'https://second.test/',
        'text/html': '<a href="https://second.test/">https://second.test/</a>',
    });
    await page.evaluate(() => window.addressCopyFixture.setPage('https://pending.test/'));
    await expect(address).toHaveValue('https://pending.test/');
    await address.press('ControlOrMeta+a');
    await address.press(chord);
    expect(await page.evaluate(() => window.addressCopyFixture.copies.at(-1)))
        .toMatchObject({ handled: false, payload: {} });
    expect(errors).toEqual([]);
});
