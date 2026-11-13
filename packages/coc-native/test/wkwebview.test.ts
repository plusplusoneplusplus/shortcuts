import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import * as readline from 'node:readline';
import * as os from 'node:os';
import * as path from 'node:path';
import { wkWebViewBinaryCandidates, wkWebViewBinaryName } from '../src/wkwebview';
// @ts-expect-error -- build scripts have no type declarations.
import { supportsWkWebView, wkWebViewBinaryName as scriptBinaryName } from '../scripts/build-wkwebview.mjs';
// @ts-expect-error -- build scripts have no type declarations.
import { builtBinaryPaths } from '../scripts/ensure-native.mjs';
// @ts-expect-error -- build scripts have no type declarations.
import { isStageableBinary, tripleFromBinaryName } from '../../../scripts/stage-native-binaries.mjs';

const helper = [
    path.resolve('rust', 'target', `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`, 'debug', 'coc-wkwebview'),
    path.resolve('rust', 'target', 'debug', 'coc-wkwebview'),
].find(existsSync) ?? '';

// Darwin 23 is macOS 14, the first release the helper supports.
const supportedMacos = process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 23;

describe('desktop native WKWebView packaging contract', () => {
    it('builds and ensures the helper only for macOS arm64 and x64', () => {
        for (const arch of ['arm64', 'x64']) {
            expect(supportsWkWebView('darwin', arch)).toBe(true);
            expect(builtBinaryPaths('package', 'darwin', arch)).toContain(path.join('package', `coc-wkwebview.darwin-${arch}`));
        }
        for (const [platform, arch] of [['linux', 'x64'], ['win32', 'x64'], ['darwin', 'ia32']]) {
            expect(supportsWkWebView(platform, arch)).toBe(false);
            expect(builtBinaryPaths('package', platform, arch).some((file: string) => path.basename(file).startsWith('coc-wkwebview'))).toBe(false);
        }
    });

    it('names binaries identically in the build script and the resolver', () => {
        for (const arch of ['arm64', 'x64']) {
            expect(scriptBinaryName(arch)).toBe(wkWebViewBinaryName(arch));
        }
    });

    it('resolves executable artifacts outside ASAR and from staged prebuilts', () => {
        const root = path.join('resources', 'app.asar', 'node_modules', 'native');
        const unpacked = path.join('resources', 'app.asar.unpacked', 'node_modules', 'native');
        expect(wkWebViewBinaryCandidates(root, 'arm64')).toEqual([
            path.join(unpacked, 'coc-wkwebview.darwin-arm64'),
            path.join(unpacked, 'prebuilt', 'darwin-arm64', 'coc-wkwebview.darwin-arm64'),
        ]);
    });

    it('stages both darwin helpers under their exact targets', () => {
        for (const arch of ['arm64', 'x64']) {
            expect(isStageableBinary(`coc-wkwebview.darwin-${arch}`)).toBe(true);
            expect(tripleFromBinaryName(`coc-wkwebview.darwin-${arch}`)).toBe(`darwin-${arch}`);
        }
        expect(tripleFromBinaryName('coc-wkwebview.linux-x64-gnu')).toBeNull();
    });

    it.skipIf(process.platform !== 'darwin' || !helper)('reports availability and answers the stdio handshake', () => {
        const check = spawnSync(helper, ['--check'], { encoding: 'utf8', timeout: 10_000 });
        expect(check.status).toBe(0);
        expect(JSON.parse(check.stdout)).toEqual(supportedMacos
            ? { available: true }
            : expect.objectContaining({ available: false, reason: 'unsupported-platform' }));
        if (!supportedMacos) {return;}
        const profile = path.join(os.tmpdir(), `coc-wkwebview-test-${process.pid}`);
        const run = spawnSync(helper, [profile], { input: '{"id":1,"op":"quit"}\n', encoding: 'utf8', timeout: 10_000 });
        expect(run.status).toBe(0);
        expect(run.stdout.trim().split('\n').map(line => JSON.parse(line))).toEqual([{ event: 'ready' }, { id: 1, ok: true }]);
    });

    it.skipIf(!supportedMacos || !helper)('places overlay panels from main-pushed bounds, parent state and background control', async () => {
        const profile = path.join(os.tmpdir(), `coc-wkwebview-overlay-${process.pid}`);
        const child = spawn(helper, [profile], { stdio: ['pipe', 'pipe', 'inherit'] });
        const lines = readline.createInterface({ input: child.stdout });
        const pending = new Map<number, (reply: any) => void>();
        let ready!: () => void;
        const isReady = new Promise<void>(resolve => { ready = resolve; });
        lines.on('line', line => {
            const message = JSON.parse(line);
            if (message.event === 'ready') {ready();}
            else {pending.get(message.id)?.(message);}
        });
        let nextId = 1;
        const send = (command: Record<string, unknown>) => new Promise<any>(resolve => {
            const id = nextId++;
            pending.set(id, resolve);
            child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
        });
        const state = async () => (await send({ op: 'view-state', viewId: 'v1' })).result;
        try {
            await isReady;
            const bounds = { x: 40, y: 60, width: 320, height: 240 };
            expect(await send({ op: 'open', viewId: 'v1', url: 'http://127.0.0.1:9/', bounds, visible: true })).toEqual({ id: 1, ok: true });
            expect(await state()).toMatchObject({ mode: 'shown', visible: true, key: false, frame: bounds });
            // Move/resize follow main-pushed bounds.
            const moved = { x: 90, y: 110, width: 400, height: 300 };
            await send({ op: 'bounds', viewId: 'v1', bounds: moved });
            expect(await state()).toMatchObject({ mode: 'shown', frame: moved });
            // Only an explicit focus makes the panel key; hiding drops it.
            expect(await send({ op: 'focus', viewId: 'v1' })).toMatchObject({ ok: true });
            expect(await state()).toMatchObject({ key: true });
            // A minimized/hidden parent hides the panel.
            await send({ op: 'parent', viewId: 'v1', visible: false });
            expect(await state()).toMatchObject({ mode: 'hidden', visible: false });
            // Background control renders off-screen at the last size without focus.
            await send({ op: 'background', viewId: 'v1', enabled: true });
            const background = await state();
            expect(background).toMatchObject({ mode: 'background', visible: true, key: false, frame: { width: 400, height: 300 } });
            expect(background.frame.x).toBeLessThan(-90_000);
            await send({ op: 'background', viewId: 'v1', enabled: false });
            await send({ op: 'parent', viewId: 'v1', visible: true });
            expect(await state()).toMatchObject({ mode: 'shown', key: false, frame: moved });
            // An unplaced view hides; a parent missing from the active Space hides too.
            await send({ op: 'bounds', viewId: 'v1' });
            expect(await send({ op: 'focus', viewId: 'v1' })).toMatchObject({ ok: false });
            expect(await state()).toMatchObject({ mode: 'hidden', visible: false });
            await send({ op: 'bounds', viewId: 'v1', bounds });
            await send({ op: 'parent', viewId: 'v1', visible: true, parentWindow: 2_000_000_000 });
            expect(await state()).toMatchObject({ mode: 'hidden', parentOnActiveSpace: false });
            expect(await send({ op: 'bounds', viewId: 'v1', bounds: { x: 0, y: 0, width: 0, height: 10 } })).toMatchObject({ ok: false });
            expect(await send({ op: 'view-state', viewId: 'missing' })).toMatchObject({ ok: false, reason: 'not-found' });
            await send({ op: 'close', viewId: 'v1' });
            expect(await send({ op: 'view-state', viewId: 'v1' })).toMatchObject({ ok: false });
            await send({ op: 'quit' });
        } finally {
            child.kill();
        }
    }, 30_000);

    it.skipIf(!supportedMacos || !helper)('navigates and reports state, visits and titles like WebView2', async () => {
        const pages: Record<string, string> = {
            '/a': '<title>Page A</title><a id="hash" href="#section">x</a>',
            '/b': '<title>Page B</title><script>setTimeout(() => { document.title = "Page B2"; }, 300)</script>',
        };
        const server = http.createServer((request, response) => {
            const page = pages[request.url ?? ''];
            response.writeHead(page ? 200 : 404, { 'content-type': 'text/html' });
            response.end(page ?? 'missing');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const profile = path.join(os.tmpdir(), `coc-wkwebview-nav-${process.pid}`);
        const child = spawn(helper, [profile], { stdio: ['pipe', 'pipe', 'inherit'] });
        const lines = readline.createInterface({ input: child.stdout });
        const pending = new Map<number, (reply: any) => void>();
        const events: any[] = [];
        const waiters: Array<{ match: (event: any) => boolean; resolve: (event: any) => void }> = [];
        let ready!: () => void;
        const isReady = new Promise<void>(resolve => { ready = resolve; });
        lines.on('line', line => {
            const message = JSON.parse(line);
            if (message.event === 'ready') { ready(); return; }
            if (message.event) {
                events.push(message);
                for (const waiter of waiters.splice(0)) {
                    if (waiter.match(message)) { waiter.resolve(message); } else { waiters.push(waiter); }
                }
                return;
            }
            pending.get(message.id)?.(message);
        });
        const waitFor = (match: (event: any) => boolean, from = 0) => new Promise<any>(resolve => {
            const found = events.slice(from).find(match);
            if (found) { resolve(found); } else { waiters.push({ match, resolve }); }
        });
        let nextId = 1;
        const send = (command: Record<string, unknown>) => new Promise<any>(resolve => {
            const id = nextId++;
            pending.set(id, resolve);
            child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
        });
        try {
            await isReady;
            expect(await send({ op: 'open', viewId: 'v1', url: `${origin}/a`, pageZoomPercent: 125 })).toEqual({ id: 1, ok: true });
            // The request is published as loading before WebKit starts the navigation.
            expect(events[0]).toMatchObject({ event: 'state', viewId: 'v1', state: { engine: 'wkwebview', url: `${origin}/a`, loading: true } });
            expect(await waitFor(event => event.event === 'visited')).toMatchObject({ event: 'visited', viewId: 'v1', sourceViewId: 'v1', url: `${origin}/a` });
            // WebKit publishes the title after didFinishNavigation; it only updates the visit.
            expect(await waitFor(event => event.event === 'title-updated')).toMatchObject({ url: `${origin}/a`, title: 'Page A' });
            expect((await waitFor(event => event.event === 'state' && event.state.title === 'Page A')).state).toMatchObject({ loading: false, canGoBack: false });

            expect(await send({ op: 'navigate', viewId: 'v1', url: `${origin}/b` })).toMatchObject({ ok: true });
            await waitFor(event => event.event === 'visited' && event.url === `${origin}/b`);
            // A title change after load updates the entry without creating a visit.
            expect(await waitFor(event => event.event === 'title-updated' && event.title === 'Page B2')).toMatchObject({ url: `${origin}/b` });
            expect(events.filter(event => event.event === 'visited')).toHaveLength(2);
            // Repeated KVO/delegate callbacks never resend an unchanged state.
            const states = events.filter(event => event.event === 'state').map(event => JSON.stringify(event.state));
            expect(states.every((state, index) => index === 0 || state !== states[index - 1])).toBe(true);

            const beforeBack = events.length;
            await send({ op: 'nav', viewId: 'v1', action: 'back' });
            await waitFor(event => event.event === 'visited' && event.url === `${origin}/a`, beforeBack);
            await waitFor(event => event.event === 'state' && event.state.url === `${origin}/a` && !event.state.loading && event.state.canGoForward, beforeBack);
            expect(events.filter(event => event.event === 'visited')).toHaveLength(3);

            expect(await send({ op: 'navigate', viewId: 'v1', url: 'file:///etc/passwd' })).toMatchObject({ ok: false, reason: 'invalid' });
            expect(await send({ op: 'nav', viewId: 'v1', action: 'sideways' })).toMatchObject({ ok: false });
            expect(await send({ op: 'page-zoom', viewId: 'v1', pageZoomPercent: 101 })).toMatchObject({ ok: false });
            expect(await send({ op: 'page-zoom', viewId: 'v1', pageZoomPercent: 150 })).toMatchObject({ ok: true });

            // A refused connection is a page error; reload retries the requested URL.
            // A just-closed port refuses the connection (port 9 is on WebKit's blocked list).
            const probe = net.createServer();
            await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
            const dead = `http://127.0.0.1:${(probe.address() as AddressInfo).port}/`;
            await new Promise(resolve => probe.close(resolve));
            const beforeDead = events.length;
            await send({ op: 'navigate', viewId: 'v1', url: dead });
            expect((await waitFor(event => event.event === 'state' && event.state.errorCode === 'navigation-failed', beforeDead)).state)
                .toMatchObject({ url: dead, title: '', loading: false });
            expect(events.some(event => event.event === 'visited' && event.url === dead)).toBe(false);
            await send({ op: 'nav', viewId: 'v1', action: 'reload' });
            expect((await send({ op: 'view-state', viewId: 'v1' })).result.page).toMatchObject({ url: dead, loading: true });
            await send({ op: 'nav', viewId: 'v1', action: 'stop' });
            expect((await send({ op: 'view-state', viewId: 'v1' })).result.page).toMatchObject({ loading: false });

            await send({ op: 'close', viewId: 'v1' });
            const count = events.length;
            await send({ op: 'quit' });
            expect(events.slice(count)).toEqual([]);
        } finally {
            child.kill();
            server.close();
        }
    }, 30_000);
});
