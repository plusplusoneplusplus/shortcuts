import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { CanvasExtensionHost, type CanvasExtensionHostOptions } from '../../../src/server/canvas-extensions/extension-host';
import { discoverCanvasExtensions } from '../../../src/server/canvas-extensions/discovery';

// The repository's own .github/extensions/coc-log-tail, run through the real SDK host.
const repoRoot = path.resolve(__dirname, '../../../../..');
const extensionPath = path.join(repoRoot, '.github', 'extensions', 'coc-log-tail', 'extension.mjs');

interface Row { id: number; source: string; level: string; store: string; msg: string }

const pino = (level: number, msg: string, extra: Record<string, unknown> = {}) => JSON.stringify({
    level, time: Date.now(), pid: 1, hostname: 'h', store: 'coc-service', msg, ...extra,
});

describe('coc-log-tail canvas extension', () => {
    let root: string;
    let logDir: string;
    let serverLog: string;
    let desktopLog: string;
    let options: CanvasExtensionHostOptions;
    const hosts: CanvasExtensionHost[] = [];
    const instance = { canvasId: 'log-tail', instanceId: 'instance-1' };

    beforeEach(async () => {
        root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'coc log tail ')));
        const dataDir = path.join(root, 'data');
        logDir = path.join(dataDir, 'logs');
        await fs.mkdir(logDir, { recursive: true });
        serverLog = path.join(logDir, 'coc-service.ndjson');
        desktopLog = path.join(logDir, 'coc-desktop.log');
        vi.stubEnv('COC_LOG_TAIL_POLL_MS', '25');
        options = {
            config: { canvasExtensions: { enabled: true } },
            extension: { extensionKey: 'ws:coc-log-tail', name: 'coc-log-tail', ownerWorkspaceId: 'ws',
                extensionPath, cwd: repoRoot, contentHash: 'test' },
            processId: 'conversation-1', dataDir, log: vi.fn(),
            send: vi.fn(async () => ({ messageId: 'message-1' })),
            ephemeralQuery: vi.fn(async () => ({ answer: '' })), timeoutMs: 10_000,
        };
    });

    afterEach(async () => {
        await Promise.all(hosts.splice(0).map(host => host.dispose()));
        await fs.rm(root, { recursive: true, force: true });
        vi.unstubAllEnvs();
    });

    async function start() {
        const host = await CanvasExtensionHost.start(options);
        hosts.push(host);
        return host;
    }

    const search = (host: CanvasExtensionHost, query: string, extra: Record<string, unknown> = {}) =>
        host.invoke({ ...instance, actionName: 'search', input: { query, ...extra } } as never) as Promise<Row[]>;

    it('is discovered from the repository with its package description', async () => {
        const store = { getWorkspaces: async () => [{ id: 'ws', name: 'repo', rootPath: repoRoot }] };
        const found = await discoverCanvasExtensions({
            config: { canvasExtensions: { enabled: true } }, store: store as never, dataDir: options.dataDir, workspaceId: 'ws',
        });
        expect(found).toEqual(expect.arrayContaining([expect.objectContaining({
            extensionKey: 'ws:coc-log-tail', extensionPath, cwd: repoRoot,
            description: expect.stringContaining('CoC server and desktop logs'),
        })]));
    });

    it('declares the canvas and serves a page whose script parses', async () => {
        const host = await start();
        expect(host.declarations).toEqual([expect.objectContaining({
            id: 'log-tail',
            actions: expect.arrayContaining(['recent_errors', 'search', 'excerpt', 'set_filter']
                .map(name => expect.objectContaining({ name }))),
        })]);
        const opened = await host.open(instance);
        expect(new URL(opened.url!).hostname).toBe('127.0.0.1');
        const html = await (await fetch(opened.url!)).text();
        const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
        expect(() => new vm.Script(script)).not.toThrow();
        await host.close(instance);
        await expect(fetch(opened.url!)).rejects.toThrow();
    });

    it('reads the backlog from the data dir, parses levels and drops desktop echoes of server lines', async () => {
        await fs.writeFile(serverLog, [
            pino(30, 'server info'), pino(40, 'server warn'),
            pino(50, 'Route handler error', { err: { message: 'pin mismatch' } }), '',
        ].join('\n'));
        await fs.writeFile(desktopLog, [
            '[coc-desktop] server started', '[coc-desktop] Uncaught error in renderer',
            pino(50, 'echoed server error'), '',
        ].join('\n'));
        const host = await start();
        await host.open(instance);
        const errors = await host.invoke({ ...instance, actionName: 'recent_errors' }) as Row[];
        // The two files are read concurrently, so their lines can interleave in either order.
        expect(errors.map(row => [row.source, row.level, row.msg]).sort()).toEqual([
            ['desktop', 'error', '[coc-desktop] Uncaught error in renderer'],
            ['server', 'error', 'Route handler error: pin mismatch'],
        ]);
        expect(await search(host, 'echoed')).toEqual([]);
        expect((await search(host, '', { level: 40, source: 'server' })).map(row => row.msg))
            .toEqual(['server warn', 'Route handler error: pin mismatch']);
    });

    it('follows appends, waits for partial lines and recovers from rotation and truncation', async () => {
        const host = await start();
        // Files that do not exist yet are picked up once they appear.
        await host.open(instance);
        await fs.writeFile(serverLog, `${pino(30, 'first')}\n${pino(30, 'half').slice(0, 20)}`);
        await vi.waitFor(async () => expect((await search(host, 'first')).length).toBe(1));
        expect(await search(host, 'half')).toEqual([]);
        await fs.writeFile(serverLog, `${pino(30, 'first')}\n${pino(30, 'half')}\n`);
        await vi.waitFor(async () => expect((await search(host, 'half')).length).toBe(1));

        await fs.writeFile(desktopLog, '[coc-desktop] before rotation\n');
        await vi.waitFor(async () => expect((await search(host, 'before rotation')).length).toBe(1));
        await fs.rename(desktopLog, `${desktopLog}.1`);
        await fs.writeFile(desktopLog, '[coc-desktop] after rotation\n');
        await vi.waitFor(async () => expect((await search(host, 'after rotation')).length).toBe(1));

        await fs.writeFile(serverLog, `${pino(30, 'after truncate')}\n`);
        await vi.waitFor(async () => expect((await search(host, 'after truncate')).length).toBe(1));
    });

    it('starts large files near the end without a torn first line', async () => {
        const filler = Array.from({ length: 4000 }, (_, i) => pino(30, `filler ${i} ${'x'.repeat(60)}`));
        await fs.writeFile(serverLog, `${pino(30, 'oldest')}\n${filler.join('\n')}\n${pino(30, 'newest')}\n`);
        const host = await start();
        await host.open(instance);
        expect(await search(host, 'oldest')).toEqual([]);
        expect((await search(host, 'newest')).length).toBe(1);
        const rows = await search(host, '', { limit: 500 });
        expect(rows.every(row => row.store === 'coc-service')).toBe(true);
    });

    it('supports regex search and reports invalid patterns', async () => {
        await fs.writeFile(serverLog, `${pino(30, 'GET /api/a')}\n${pino(30, 'POST /api/b')}\n`);
        const host = await start();
        await host.open(instance);
        expect((await search(host, '/^POST/i', { source: 'all' })).length).toBe(0);
        expect((await search(host, '/"msg":"post/i')).map(row => row.msg)).toEqual(['POST /api/b']);
        await expect(search(host, '/[/')).rejects.toMatchObject({ data: { code: 'bad_query' } });
    });

    it('previews and sends an excerpt with nearby lines, rejecting non-JSON posts', async () => {
        const lines = Array.from({ length: 20 }, (_, i) => pino(30, `line ${i}`));
        lines.splice(12, 0, pino(50, 'the failure'));
        await fs.writeFile(serverLog, `${lines.join('\n')}\n`);
        const host = await start();
        const opened = await host.open(instance);
        const [target] = await host.invoke({ ...instance, actionName: 'recent_errors' }) as Row[];

        const { text } = await (await fetch(`${opened.url!}excerpt?id=${target.id}`)).json() as { text: string };
        expect(text).toMatch(/^CoC log excerpt \(coc-service\.ndjson, \d{4}-\d\d-\d\dT/);
        expect(text).toContain('>>> {');
        expect(text).toContain('"msg":"line 2"');
        expect(text).not.toContain('"msg":"line 1"');
        expect(text).toContain('"msg":"line 16"');
        expect(text).not.toContain('"msg":"line 17"');
        expect(await host.invoke({ ...instance, actionName: 'excerpt', input: { id: target.id } } as never)).toBe(text);

        const plain = await fetch(`${opened.url!}send`, { method: 'POST', body: JSON.stringify({ id: target.id }) });
        expect(plain.status).toBe(415);
        expect(options.send).not.toHaveBeenCalled();

        const sent = await fetch(`${opened.url!}send`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id }),
        });
        expect(await sent.json()).toEqual({ messageId: 'message-1' });
        expect(options.send).toHaveBeenCalledExactlyOnceWith(text);

        const missing = await fetch(`${opened.url!}excerpt?id=999999`);
        expect(missing.status).toBe(404);
    });

    it('caps excerpts with long lines', async () => {
        const lines = Array.from({ length: 8 }, (_, i) => pino(30, `big ${i} ${'y'.repeat(3000)}`));
        lines.push(pino(50, 'capped failure'));
        await fs.writeFile(serverLog, `${lines.join('\n')}\n`);
        const host = await start();
        await host.open(instance);
        const [target] = await host.invoke({ ...instance, actionName: 'recent_errors' }) as Row[];
        const text = await host.invoke({ ...instance, actionName: 'excerpt', input: { id: target.id } } as never) as string;
        expect(text.length).toBeLessThanOrEqual(8 * 1024);
        expect(text).toContain('capped failure');
    });

    it('streams new lines and filter changes over SSE', async () => {
        await fs.writeFile(serverLog, `${pino(30, 'backlog line')}\n`);
        const host = await start();
        const opened = await host.open({ ...instance, input: { level: 40 } } as never);
        const controller = new AbortController();
        const response = await fetch(`${opened.url!}events`, { signal: controller.signal });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let received = '';
        const readUntil = async (needle: string) => {
            while (!received.includes(needle)) {
                const { value, done } = await reader.read();
                if (done) throw new Error(`stream ended before ${needle}`);
                received += decoder.decode(value, { stream: true });
            }
        };
        try {
            await readUntil('backlog line');
            expect(received).toContain('"level":40');
            await fs.appendFile(serverLog, `${pino(50, 'live line')}\n`);
            await readUntil('live line');
            expect(await host.invoke({ ...instance, actionName: 'set_filter', input: { query: 'live' } } as never))
                .toEqual({ level: 40, query: 'live', source: 'server', store: 'all' });
            await readUntil('"query":"live"');
        } finally {
            controller.abort();
        }
        await expect(host.invoke({ canvasId: 'log-tail', instanceId: 'other', actionName: 'set_filter', input: {} } as never))
            .rejects.toMatchObject({ data: { code: 'not_open' } });
    });
});
