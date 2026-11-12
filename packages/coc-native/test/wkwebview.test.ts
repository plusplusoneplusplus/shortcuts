import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
        if (!supportedMacos) return;
        const profile = path.join(os.tmpdir(), `coc-wkwebview-test-${process.pid}`);
        const run = spawnSync(helper, [profile], { input: '{"id":1,"op":"quit"}\n', encoding: 'utf8', timeout: 10_000 });
        expect(run.status).toBe(0);
        expect(run.stdout.trim().split('\n').map(line => JSON.parse(line))).toEqual([{ event: 'ready' }, { id: 1, ok: true }]);
    });
});
