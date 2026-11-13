import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import * as readline from 'node:readline';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
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
            // Background control keeps rendering in place, invisible and click-through, without focus.
            await send({ op: 'background', viewId: 'v1', enabled: true });
            expect(await state()).toMatchObject({ mode: 'background', visible: true, transparent: true, key: false, frame: moved });
            await send({ op: 'background', viewId: 'v1', enabled: false });
            await send({ op: 'parent', viewId: 'v1', visible: true });
            expect(await state()).toMatchObject({ mode: 'shown', transparent: false, key: false, frame: moved });
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
            expect(await send({ op: 'tab-shortcuts', viewId: 'v1', tabShortcuts: true })).toMatchObject({ ok: true });
            expect(await send({ op: 'tab-shortcuts', viewId: 'v1', tabShortcuts: false })).toMatchObject({ ok: true });
            expect(await send({ op: 'tab-shortcuts', viewId: 'v1' })).toMatchObject({ ok: false, reason: 'invalid' });
            // Turning shortcuts off without a reported hold sends no release.
            expect(events.some(event => event.event === 'tab-modifier')).toBe(false);

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

    it.skipIf(!supportedMacos || !helper)('hosts page-opened popups under their root tab and closes them with it', async () => {
        const pages: Record<string, string> = {
            '/opener': '<title>Opener</title>',
            '/popup': '<title>Popup</title>',
        };
        const server = http.createServer((request, response) => {
            const page = pages[request.url ?? ''];
            response.writeHead(page ? 200 : 404, { 'content-type': 'text/html' });
            response.end(page ?? 'missing');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const helperRun = runHelper(`coc-wkwebview-popup-${process.pid}`);
        const { events, send, waitFor } = helperRun;
        try {
            await helperRun.ready;
            await send({ op: 'open', viewId: 'v1', url: `${origin}/opener` });
            await waitFor(event => event.event === 'visited' && event.viewId === 'v1');
            expect(await send({ op: 'evaluate', viewId: 'v1', expression: '({ title: document.title, n: 1 + 1 })' }))
                .toEqual({ id: 2, ok: true, result: { value: { title: 'Opener', n: 2 } } });
            expect(await send({ op: 'evaluate', viewId: 'v1', expression: 'undefined' })).toMatchObject({ ok: true, result: { value: null } });
            expect(await send({ op: 'evaluate', viewId: 'v1', expression: 'throw new Error("boom")' }))
                .toMatchObject({ ok: false, reason: 'evaluation-failed', message: expect.stringContaining('boom') });

            // A window without features is a tab request for main; nothing is hosted.
            await send({ op: 'evaluate', viewId: 'v1', expression: 'String(window.open("/popup"))' });
            expect(await waitFor(event => event.event === 'new-tab')).toEqual({ event: 'new-tab', viewId: 'v1', url: `${origin}/popup` });

            await send({ op: 'evaluate', viewId: 'v1', expression: 'window.open("/popup", "p", "width=320,height=240") ? "opened" : "blocked"' });
            const opened = await waitFor(event => event.event === 'popup-opened');
            expect(opened).toEqual({ event: 'popup-opened', viewId: expect.stringMatching(/^v1:popup:[1-9]\d*$/), rootId: 'v1', url: `${origin}/popup` });
            const popupId = opened.viewId as string;
            // History is recorded against the root tab, with the popup as the source.
            expect(await waitFor(event => event.event === 'visited' && event.sourceViewId === popupId))
                .toMatchObject({ viewId: 'v1', url: `${origin}/popup` });
            await waitFor(event => event.event === 'state' && event.viewId === popupId && event.state.title === 'Popup' && !event.state.loading);
            const popupState = (await send({ op: 'view-state', viewId: popupId })).result;
            expect(popupState).toMatchObject({ mode: 'popup', visible: true, page: { url: `${origin}/popup`, title: 'Popup' } });
            expect(popupState.frame).toMatchObject({ width: 320 });
            // Background work opened the popup, so it appears without taking the keyboard.
            expect(popupState.key).toBe(false);

            // The page closing its own window closes the popup.
            await send({ op: 'evaluate', viewId: popupId, expression: 'window.close()' });
            expect(await waitFor(event => event.event === 'popup-closed')).toEqual({ event: 'popup-closed', viewId: popupId, rootId: 'v1' });
            expect(await send({ op: 'view-state', viewId: popupId })).toMatchObject({ ok: false, reason: 'not-found' });

            // Closing the root tab closes its remaining popups.
            await send({ op: 'evaluate', viewId: 'v1', expression: 'window.open("/popup", "q", "left=10,top=20") ? "opened" : "blocked"' });
            const second = await waitFor(event => event.event === 'popup-opened' && event.viewId !== popupId);
            await send({ op: 'close', viewId: 'v1' });
            expect(await waitFor(event => event.event === 'popup-closed' && event.viewId === second.viewId)).toMatchObject({ rootId: 'v1' });
            expect(await send({ op: 'view-state', viewId: second.viewId })).toMatchObject({ ok: false, reason: 'not-found' });
            await send({ op: 'quit' });
        } finally {
            helperRun.child.kill();
            server.close();
        }
    }, 30_000);

    it.skipIf(!supportedMacos || !helper)('drives background views with synthesized input, content worlds and screenshots', async () => {
        const page = `<title>Control</title><style>
            body { margin: 0; height: 3000px; }
            #red, #blue { position: absolute; top: 0; width: 100px; height: 100px; }
            #red { left: 0; background: #f00; } #blue { left: 100px; background: #00f; }
            #field { position: absolute; left: 20px; top: 150px; width: 200px; height: 30px; }
            #button { position: absolute; left: 20px; top: 200px; width: 100px; height: 40px; }
            #pane { position: absolute; left: 300px; top: 300px; width: 200px; height: 100px; overflow: auto; }
            </style><div id="red"></div><div id="blue"></div><input id="field"><button id="button">Go</button>
            <div id="pane"><div style="height: 2000px"></div></div>
            <script>
            window.log = [];
            button.addEventListener('click', event => log.push(['click', event.isTrusted, event.clientX, event.clientY]));
            field.addEventListener('keydown', event => log.push(['keydown', event.key, event.isTrusted]));
            document.addEventListener('wheel', event => log.push(['wheel', event.deltaY, event.clientX, event.clientY, event.isTrusted]));
            </script>`;
        const server = http.createServer((_request, response) => {
            response.writeHead(200, { 'content-type': 'text/html' });
            response.end(page);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const helperRun = runHelper(`coc-wkwebview-control-${process.pid}`);
        const { send, waitFor } = helperRun;
        const evaluate = async (expression: string, world = 'page') => {
            const reply = await send({ op: 'evaluate', viewId: 'v1', expression, world });
            expect(reply).toMatchObject({ ok: true });
            return reply.result.value;
        };
        const until = async (expression: string) => {
            for (let attempt = 0; attempt < 50 && !await evaluate(expression); attempt++) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            return evaluate(expression);
        };
        const mouse = (input: Record<string, unknown>) => send({ op: 'input', viewId: 'v1', input: { kind: 'mouse', ...input } });
        const key = (input: Record<string, unknown>) => send({ op: 'input', viewId: 'v1', input: { kind: 'key', ...input } });
        const text = (value: string) => send({ op: 'input', viewId: 'v1', input: { kind: 'text', text: value } });
        try {
            await helperRun.ready;
            // Hidden parent + background control: the page renders off-screen, never key.
            await send({ op: 'open', viewId: 'v1', url: `${origin}/control`, bounds: { x: 40, y: 60, width: 640, height: 480 }, visible: false });
            await send({ op: 'background', viewId: 'v1', enabled: true });
            await waitFor(event => event.event === 'state' && event.state.title === 'Control' && !event.state.loading);

            // WebKit throttles windows that are off-screen or occluded; background panels keep animation frames.
            expect(await evaluate(`Promise.race([
                new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve('frame')))),
                new Promise(resolve => setTimeout(() => resolve('throttled'), 2000))])`)).toBe('frame');

            // The page world sees page globals; isolated worlds do not, and named worlds keep theirs.
            expect(await evaluate('typeof window.log')).toBe('object');
            expect(await evaluate('typeof window.log', 'coc-test')).toBe('undefined');
            await evaluate('globalThis.mark = 7', 'coc-test');
            expect(await evaluate('globalThis.mark', 'coc-test')).toBe(7);
            expect(await evaluate('typeof globalThis.mark')).toBe('undefined');
            expect(await send({ op: 'evaluate', viewId: 'v1', expression: '1', world: 'not a world' })).toMatchObject({ ok: false, reason: 'invalid' });

            // Trusted click at viewport CSS coordinates.
            for (const type of ['move', 'down', 'up']) {
                expect(await mouse({ type, x: 70, y: 220, clickCount: 1 })).toMatchObject({ ok: true });
            }
            expect(await until('log.some(entry => entry[0] === "click")')).toBe(true);
            expect(await evaluate('log.find(entry => entry[0] === "click")')).toEqual(['click', true, 70, 220]);

            // Click focuses the field; keys and text insertion edit it.
            for (const type of ['move', 'down', 'up']) {await mouse({ type, x: 120, y: 165, clickCount: 1 });}
            expect(await until('document.activeElement === field')).toBe(true);
            await key({ type: 'down', key: 'a', code: 'KeyA', text: 'a', unmodifiedText: 'a' });
            await key({ type: 'up', key: 'a', code: 'KeyA' });
            expect(await until('field.value === "a"')).toBe(true);
            expect(await evaluate('log.find(entry => entry[0] === "keydown")')).toEqual(['keydown', 'a', true]);
            await text('hello');
            expect(await until('field.value === "ahello"')).toBe(true);
            await key({ type: 'down', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
            await key({ type: 'up', key: 'a', code: 'KeyA', modifiers: 4 });
            await text('X');
            expect(await until('field.value === "X"')).toBe(true);
            await key({ type: 'down', key: 'Backspace', code: 'Backspace' });
            await key({ type: 'up', key: 'Backspace', code: 'Backspace' });
            expect(await until('field.value === ""')).toBe(true);
            expect(await key({ type: 'down', key: 'a', commands: ['terminate'] })).toMatchObject({ ok: false, reason: 'invalid' });
            // Agent keys reach the page only; they never become browser chords.
            await send({ op: 'tab-shortcuts', viewId: 'v1', tabShortcuts: true });
            for (const [code, k] of [['KeyW', 'w'], ['Digit1', '1']]) {
                await key({ type: 'down', key: k, code, modifiers: 4 });
                await key({ type: 'up', key: k, code, modifiers: 4 });
            }
            expect(await until('log.filter(entry => entry[0] === "keydown").length >= 5')).toBe(true);
            expect(helperRun.events.filter(event => /requested|tab-modifier/.test(event.event))).toEqual([]);

            // Wheel scrolls what is under the point: the inner pane, then the page.
            expect(await mouse({ type: 'wheel', x: 400, y: 350, deltaX: 0, deltaY: 300 })).toMatchObject({ ok: true });
            expect(await until('pane.scrollTop > 0')).toBe(true);
            expect(await until('log.some(entry => entry[0] === "wheel")')).toBe(true);
            expect(await evaluate('log.find(entry => entry[0] === "wheel")')).toEqual(['wheel', 300, 400, 350, true]);
            expect(await evaluate('window.scrollY')).toBe(0);
            expect(await mouse({ type: 'wheel', x: 600, y: 100, deltaX: 0, deltaY: 600 })).toMatchObject({ ok: true });
            expect(await until('window.scrollY > 0')).toBe(true);
            await evaluate('window.scrollTo(0, 0)');
            expect(await mouse({ type: 'wheel', x: Number.MAX_VALUE, y: 0 })).toMatchObject({ ok: false });

            // Points stay in CSS pixels under page zoom.
            await send({ op: 'page-zoom', viewId: 'v1', pageZoomPercent: 150 });
            await evaluate('log.length = 0');
            for (const type of ['move', 'down', 'up']) {await mouse({ type, x: 70, y: 220, clickCount: 1 });}
            expect(await until('log.some(entry => entry[0] === "click")')).toBe(true);
            expect(await evaluate('log.find(entry => entry[0] === "click")')).toEqual(['click', true, 70, 220]);

            // Screenshots cover a viewport rect at device pixels times scale.
            const ratio = await evaluate('window.devicePixelRatio') as number;
            const red = await send({ op: 'screenshot', viewId: 'v1', rect: { x: 0, y: 0, width: 100, height: 100 }, format: 'png' });
            expect(red).toMatchObject({ ok: true });
            expect(pngSize(red.result.data)).toEqual({ width: Math.round(100 * ratio), height: Math.round(100 * ratio) });
            const [r, g, b] = pngFirstPixel(red.result.data);
            expect(r).toBeGreaterThan(200); expect(g).toBeLessThan(80); expect(b).toBeLessThan(80);
            const blue = await send({ op: 'screenshot', viewId: 'v1', rect: { x: 100, y: 0, width: 100, height: 100 }, format: 'png', scale: 0.5 });
            expect(pngSize(blue.result.data)).toEqual({ width: Math.round(50 * ratio), height: Math.round(50 * ratio) });
            const [br, , bb] = pngFirstPixel(blue.result.data);
            expect(bb).toBeGreaterThan(200); expect(br).toBeLessThan(80);
            const jpeg = await send({ op: 'screenshot', viewId: 'v1', rect: { x: 0, y: 0, width: 640, height: 480 }, format: 'jpeg', quality: 75 });
            expect(jpeg.result.data.startsWith('/9j/')).toBe(true);
            expect(await send({ op: 'screenshot', viewId: 'v1', rect: { x: 0, y: 0, width: 0, height: 10 } })).toMatchObject({ ok: false, reason: 'invalid' });
            expect(await send({ op: 'screenshot', viewId: 'v1', rect: { x: 0, y: 0, width: 10, height: 10 }, format: 'gif' })).toMatchObject({ ok: false, reason: 'invalid' });

            // None of it showed the panel or took the keyboard.
            expect((await send({ op: 'view-state', viewId: 'v1' })).result).toMatchObject({ mode: 'background', transparent: true, key: false });
            await send({ op: 'quit' });
        } finally {
            helperRun.child.kill();
            server.close();
        }
    }, 30_000);
});

function pngSize(base64: string): { width: number; height: number } {
    const data = Buffer.from(base64, 'base64');
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Row 0's first pixel is stored unfiltered under every PNG filter type. */
function pngFirstPixel(base64: string): number[] {
    const data = Buffer.from(base64, 'base64');
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < data.length;) {
        const length = data.readUInt32BE(offset);
        if (data.toString('latin1', offset + 4, offset + 8) === 'IDAT') {chunks.push(data.subarray(offset + 8, offset + 8 + length));}
        offset += length + 12;
    }
    const raw = zlib.inflateSync(Buffer.concat(chunks));
    return [raw[1], raw[2], raw[3]];
}

function runHelper(name: string) {
    const child = spawn(helper, [path.join(os.tmpdir(), name)], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = readline.createInterface({ input: child.stdout });
    const pending = new Map<number, (reply: any) => void>();
    const events: any[] = [];
    const waiters: Array<{ match: (event: any) => boolean; resolve: (event: any) => void }> = [];
    let isReady!: () => void;
    const ready = new Promise<void>(resolve => { isReady = resolve; });
    lines.on('line', line => {
        const message = JSON.parse(line);
        if (message.event === 'ready') { isReady(); return; }
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
    return { child, events, ready, send, waitFor };
}
