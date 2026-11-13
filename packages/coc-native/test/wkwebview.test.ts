import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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
});
