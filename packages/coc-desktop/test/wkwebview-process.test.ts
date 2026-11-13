import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserHostError } from '../src/browser-host-contract';
import { WkWebViewProcess } from '../src/wkwebview-process';

// Built by `cargo build -p coc-wkwebview` in packages/coc-native/rust.
const binary = path.resolve(__dirname, '../../coc-native/rust/target/debug/coc-wkwebview');
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
