import { readFileSync } from 'node:fs';
import { EventEmitter, once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { validateBrowserCommandRequest } from '../src/browser-control-command';

it('runs the approval fixture with valid commands when open returns before the scripted POST', async () => {
    const source = readFileSync(new URL('./e2e/webview2-approval-runner.cjs', import.meta.url), 'utf8');
    const server = Object.assign(new EventEmitter(), {
        listen: (_port: number, _host: string, ready: () => void) => ready(),
        address: () => ({ port: 12345 }),
        close: vi.fn(),
    });
    const tab = 't1:fixture';
    const requests: ReturnType<typeof validateBrowserCommandRequest>[] = [];
    const output: string[] = [];
    let serve!: (req: unknown, res: unknown) => void;
    let decide!: () => void;
    let finished!: (code: number) => void;
    const exited = new Promise<number>(resolve => { finished = resolve; });
    const destroy = vi.fn();
    const dispose = vi.fn();
    const manager = class {
        private send: (owner: number, channel: string, event: { checkId: string }) => void;
        constructor(options: { send: typeof this.send }) { this.send = options.send; }
        bindControlScope() {}
        finishControl() {}
        dispose = dispose;
        decideNavigation() { decide(); }
        async executeControl(_owner: number, input: unknown) {
            const request = validateBrowserCommandRequest(input);
            requests.push(request);
            if (request.id === 'open' || request.id === 'next') {
                for (let i = 0; i < (request.id === 'open' ? 2 : 1); i++) {
                    const decision = new Promise<void>(resolve => { decide = resolve; });
                    this.send(1, '', { checkId: String(i) });
                    await decision;
                }
            }
            if (request.id === 'open') {
                // Complete the POST after open returns, as WKWebView can do.
                setImmediate(() => {
                    const req = Object.assign(new EventEmitter(), { url: '/return', method: 'POST' });
                    serve(req, { writeHead() {}, end() {} });
                    req.emit('data', 'assertion=synthetic-value');
                    req.emit('end');
                    serve({ url: '/destination' }, { setHeader() {}, end() {} });
                });
                return { tab, title: '', url: 'http://localhost:12345/login' };
            }
            return { tab, title: 'Approved destination', url: 'http://127.0.0.1:12345/destination' };
        }
    };
    runInNewContext(source, {
        require: (name: string) => {
            if (name === 'electron') return {
                app: { setPath() {}, whenReady: () => Promise.resolve(), exit: finished },
                BrowserWindow: class { webContents = { id: 1 }; destroy = destroy; },
            };
            if (name === 'node:http') return { createServer: (handler: typeof serve) => { serve = handler; return server; } };
            if (name === '../../dist/browser-host-manager') return { BrowserHostManager: manager };
            if (name.includes('webview2-browser-host')) return { WebView2BrowserHost: class {} };
            if (name === 'node:events') return { once };
            if (name === 'node:path') return { join: (...parts: string[]) => parts.join('/') };
            throw new Error(`Unexpected fixture import: ${name}`);
        },
        process: { env: { COC_APPROVAL_TEST_DATA: '/fixture' } },
        AbortController, setTimeout, clearTimeout,
        console: { log: (line: string) => output.push(line), error: (error: unknown) => output.push(String(error)) },
    });
    expect(await exited, output.join('\n')).toBe(0);
    expect(requests.map(request => request.id)).toEqual(['open', 'destination', 'next']);
    expect(requests[1].command).toEqual({ action: 'select', tab });
    expect(JSON.parse(output[0].slice(5))).toMatchObject({ checks: 2, postPreserved: true, approvalRevoked: true });
    expect(dispose).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
});

