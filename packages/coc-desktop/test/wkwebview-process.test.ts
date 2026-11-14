import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserHostError } from '../src/browser-host-contract';
import { BROWSER_ANNOTATION_WORLD, BrowserAnnotationTab } from '../src/browser-annotation-tab';
import { BrowserControlPage } from '../src/browser-control-page';
import { WkWebViewBrowserControl } from '../src/wkwebview-browser-control';
import { WkWebViewProcess } from '../src/wkwebview-process';

// An explicit path, else `cargo build -p coc-wkwebview`, else the binary `build:native` stages (CI's artifact).
const binary = process.env.COC_WKWEBVIEW_PATH || [
    path.resolve(__dirname, '../../coc-native/rust/target/debug/coc-wkwebview'),
    path.resolve(__dirname, `../../coc-native/coc-wkwebview.darwin-${process.arch}`),
].find(file => fs.existsSync(file)) || '';
const available = process.platform === 'darwin' && fs.existsSync(binary);

describe.skipIf(!available)('WKWebView helper transport (real helper)', () => {
    const cleanup: (() => Promise<void> | void)[] = [];
    afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

    it('opens a view, streams its state and history, rejects unknown views and quits cleanly', async () => {
        const server = http.createServer((_request, response) => {
            response.setHeader('content-type', 'text/html');
            response.end('<title>Fixture</title><p>hello</p>');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wkwebview-process-'));
        cleanup.push(() => fs.rmSync(profile, { recursive: true, force: true }));
        const events: Record<string, unknown>[] = [];
        const failure = vi.fn<(error: BrowserHostError) => void>();
        const transport = new WkWebViewProcess(() => binary, profile, message => events.push(message), failure);
        cleanup.push(() => transport.dispose());

        await transport.request('open', { viewId: 'tab', url, visible: false });
        expect(transport.running).toBe(true);
        await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ event: 'visited', viewId: 'tab', url })), { timeout: 20_000 });
        await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
            event: 'state', viewId: 'tab', state: expect.objectContaining({ engine: 'wkwebview', url, loading: false }),
        })), { timeout: 20_000 });
        await expect(transport.request('evaluate', { viewId: 'tab', expression: 'document.title' })).resolves.toEqual({ value: 'Fixture' });
        await expect(transport.request('navigate', { viewId: 'missing', url })).rejects.toMatchObject({ reason: 'not-found' });
        await transport.request('close', { viewId: 'tab' });
        await transport.dispose();
        expect(transport.running).toBe(false);
        expect(failure).not.toHaveBeenCalled();
    }, 60_000);
});

describe.skipIf(!available)('WKWebView native browser control (real helper)', () => {
    const cleanup: (() => Promise<void> | void)[] = [];
    afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

    it('drives a background view through the shared control page with frames enabled', async () => {
        const server = http.createServer((request, response) => {
            response.setHeader('content-type', 'text/html');
            response.end(request.url === '/next'
                ? '<title>Next</title><p>moved</p>'
                : `<title>Form</title><input id="name" aria-label="Name"><button id="go" onclick="document.title='clicked:'+document.getElementById('name').value">Go</button>
                   <div style="height:3000px"></div>`);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wkwebview-control-'));
        cleanup.push(() => fs.rmSync(profile, { recursive: true, force: true }));
        let control: WkWebViewBrowserControl | undefined;
        const states: Record<string, unknown>[] = [];
        const transport = new WkWebViewProcess(() => binary, profile, message => {
            if (message.event !== 'state' || message.viewId !== 'tab') return;
            const state = message.state as { loading: boolean; url: string };
            states.push(state);
            control?.stateChanged(state);
        }, () => {});
        cleanup.push(() => transport.dispose());
        control = new WkWebViewBrowserControl((op, payload) => transport.request(op as 'evaluate', { ...payload, viewId: 'tab' }));

        await transport.request('open', { viewId: 'tab', url, visible: true, bounds: { x: 40, y: 40, width: 640, height: 480 } });
        await transport.request('background', { viewId: 'tab', enabled: true });
        await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ url, loading: false }), { timeout: 20_000 });

        // The manager emulates focus for background control; the panel itself never becomes key.
        await control.setFocusEmulation(true);
        expect(await transport.request('view-state', { viewId: 'tab' })).toMatchObject({ key: false });
        const page = new BrowserControlPage(control, 'darwin');
        await page.configureFrames(true);
        const snapshot = await page.snapshot();
        expect(snapshot).toMatchObject({ title: 'Form', url });
        const input = snapshot.elements.find(element => element.name === 'Name')!;
        const button = snapshot.elements.find(element => element.name === 'Go')!;
        expect(input && button).toBeTruthy();
        expect(page.frameMetadata().frames).toEqual([expect.objectContaining({ origin: url.slice(0, -1), status: 'ready', depth: 0 })]);

        await page.type(input.ref, 'WebKit');
        await page.click(button.ref);
        await vi.waitFor(async () => expect(await page.evaluate('document.title')).toBe('clicked:WebKit'));

        await page.scroll('down');
        // WebKit applies wheel scrolling asynchronously.
        await vi.waitFor(async () => expect(await page.evaluate('scrollY')).toBeGreaterThan(0));
        const shot = await page.screenshot(undefined, 'png');
        const png = Buffer.from(shot.data, 'base64');
        expect(png.subarray(1, 4).toString()).toBe('PNG');
        expect(png.readUInt32BE(16)).toBeGreaterThan(0);

        // A new document retires the old frame handle and its context.
        const before = page.frameMetadata().frames![0]!;
        await transport.request('navigate', { viewId: 'tab', url: `${url}next` });
        await vi.waitFor(() => expect(page.frameMetadata().frames?.[0]?.document).not.toBe(before.document), { timeout: 20_000 });
        await vi.waitFor(async () => expect((await page.snapshot()).title).toBe('Next'), { timeout: 20_000 });
        expect(await page.evaluate('document.hasFocus()')).toBe(true);
        await control.setFocusEmulation(false);
        await vi.waitFor(async () => expect(await page.evaluate('document.hasFocus()')).toBe(false));
        await page.configureFrames(false);
        await transport.request('close', { viewId: 'tab' });
    }, 90_000);

    it('clicks in a hidden view, where WebKit runs no animation frames', async () => {
        const server = http.createServer((_request, response) => {
            response.setHeader('content-type', 'text/html');
            response.end(`<title>Hidden</title><button id="go" onclick="document.title='clicked'">Go</button>`);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wkwebview-hidden-'));
        cleanup.push(() => fs.rmSync(profile, { recursive: true, force: true }));
        let control: WkWebViewBrowserControl | undefined;
        let loaded = false;
        const transport = new WkWebViewProcess(() => binary, profile, message => {
            if (message.event !== 'state' || message.viewId !== 'hidden') return;
            const state = message.state as { loading: boolean; url: string };
            loaded = !state.loading && state.url === url;
            control?.stateChanged(state);
        }, () => {});
        cleanup.push(() => transport.dispose());
        control = new WkWebViewBrowserControl((op, payload) => transport.request(op as 'evaluate', { ...payload, viewId: 'hidden' }));

        await transport.request('open', { viewId: 'hidden', url, visible: false, bounds: { x: 40, y: 40, width: 640, height: 480 } });
        await vi.waitFor(() => expect(loaded).toBe(true), { timeout: 20_000 });
        const page = new BrowserControlPage(control, 'darwin');
        await page.configureFrames(true);
        const button = (await page.snapshot()).elements.find(element => element.name === 'Go')!;
        // Frame-aware targeting waits for frames to settle; without frames it must not wait for the command deadline.
        const started = Date.now();
        await page.click(button.ref);
        expect(Date.now() - started).toBeLessThan(10_000);
        await vi.waitFor(async () => expect(await page.evaluate('document.title')).toBe('clicked'));
        await page.configureFrames(false);
        await transport.request('close', { viewId: 'hidden' });
    }, 60_000);

    it('runs the shared annotation overlay in its own world and ends it on navigation', async () => {
        const server = http.createServer((request, response) => {
            response.setHeader('content-type', 'text/html');
            response.end(`<title>${request.url === '/next' ? 'Next' : 'Notes'}</title><p>annotate me</p>`);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wkwebview-annotation-'));
        cleanup.push(() => fs.rmSync(profile, { recursive: true, force: true }));
        let control: WkWebViewBrowserControl | undefined;
        const states: Record<string, unknown>[] = [];
        const transport = new WkWebViewProcess(() => binary, profile, message => {
            if (message.viewId !== 'tab') return;
            if (message.event === 'frame-navigated' || message.event === 'frame-detached') {
                control?.frameEvent(message as never, message);
                return;
            }
            if (message.event !== 'state') return;
            const state = message.state as { loading: boolean; url: string };
            states.push(state);
            control?.stateChanged(state);
        }, () => {});
        cleanup.push(() => transport.dispose());
        control = new WkWebViewBrowserControl((op, payload) => transport.request(op as 'evaluate', { ...payload, viewId: 'tab' }));
        await transport.request('open', { viewId: 'tab', url, visible: false });
        await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ url, loading: false }), { timeout: 20_000 });
        const overlays = async () => (await transport.request('evaluate', {
            viewId: 'tab', world: 'page', expression: `document.querySelectorAll('iframe[title="Page annotation"]').length`,
        }) as { value: number }).value;

        const first = { events: vi.fn(), ended: vi.fn() };
        const tab = new BrowserAnnotationTab({ control }, first, 50);
        await expect(tab.start()).resolves.toBe(true);
        expect(await overlays()).toBe(1);
        // The overlay's state lives only in the annotation world, never in the page world.
        const mode = `typeof window.__cocBrowserAnnotation`;
        expect(await transport.request('evaluate', { viewId: 'tab', world: BROWSER_ANNOTATION_WORLD, expression: mode })).toEqual({ value: 'object' });
        expect(await transport.request('evaluate', { viewId: 'tab', world: 'page', expression: mode })).toEqual({ value: 'undefined' });
        await tab.stop();
        expect(first.ended).toHaveBeenCalledExactlyOnceWith('stop', undefined);
        expect(await overlays()).toBe(0);

        const second = { events: vi.fn(), ended: vi.fn() };
        await expect(new BrowserAnnotationTab({ control }, second, 50).start()).resolves.toBe(true);
        expect(await overlays()).toBe(1);
        await transport.request('navigate', { viewId: 'tab', url: `${url}next` });
        await vi.waitFor(() => expect(second.ended).toHaveBeenCalledExactlyOnceWith('navigation', undefined), { timeout: 20_000 });
        await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ url: `${url}next`, loading: false }), { timeout: 20_000 });
        expect(await overlays()).toBe(0);
        await transport.request('close', { viewId: 'tab' });
    }, 90_000);
});
