import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { WEBVIEW2_BINARY_NAME, webview2BinaryCandidates } from '../src/webview2';
// @ts-expect-error -- build scripts have no type declarations.
import { supportsWebView2 } from '../scripts/build-webview2.mjs';
// @ts-expect-error -- build scripts have no type declarations.
import { builtBinaryPaths } from '../scripts/ensure-native.mjs';
// @ts-expect-error -- build scripts have no type declarations.
import { isStageableBinary, tripleFromBinaryName } from '../../../scripts/stage-native-binaries.mjs';

const activationHelper = path.resolve('rust', 'target', 'debug', 'coc-webview2.exe');

describe('desktop native WebView2 packaging contract', () => {
    it.skipIf(process.platform !== 'win32' || process.arch !== 'x64' || !existsSync(activationHelper))('probes the installed ClickOnce handler and rejects invalid input without activating anything', () => {
        const probe = spawnSync(activationHelper, ['--clickonce-check'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
        expect(probe.status).toBe(0);
        expect(['available', 'missing-handler']).toContain(JSON.parse(probe.stdout).status);
        for (const input of ['{"url":"file:///synthetic.application?value=private"}', '{"url":"https://fixture.test/app.application","executable":"synthetic.exe"}', '{invalid']) {
            const rejected = spawnSync(activationHelper, ['--clickonce'], { input, encoding: 'utf8', timeout: 10_000, windowsHide: true });
            expect(rejected.status).toBe(0);
            expect(JSON.parse(rejected.stdout)).toEqual({ status: 'invalid' });
            expect(rejected.stderr).toBe('');
        }
    });
    it('builds and ensures the helper only for Windows x64', () => {
        expect(supportsWebView2('win32', 'x64')).toBe(true);
        for (const [platform, arch] of [['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'arm64']]) {
            expect(supportsWebView2(platform, arch)).toBe(false);
            expect(builtBinaryPaths('package', platform, arch).some((file: string) => path.basename(file) === WEBVIEW2_BINARY_NAME)).toBe(false);
        }
        expect(builtBinaryPaths('package', 'win32', 'x64')).toContain(path.join('package', WEBVIEW2_BINARY_NAME));
    });

    it('resolves executable artifacts outside ASAR and from staged prebuilts', () => {
        const root = path.join('resources', 'app.asar', 'node_modules', 'native');
        const unpacked = path.join('resources', 'app.asar.unpacked', 'node_modules', 'native');
        expect(webview2BinaryCandidates(root)).toEqual([
            path.join(unpacked, WEBVIEW2_BINARY_NAME),
            path.join(unpacked, 'prebuilt', 'win32-x64-msvc', WEBVIEW2_BINARY_NAME),
        ]);
    });

    it('stages the Windows helper under its exact supported target', () => {
        expect(isStageableBinary(WEBVIEW2_BINARY_NAME)).toBe(true);
        expect(tripleFromBinaryName(WEBVIEW2_BINARY_NAME)).toBe('win32-x64-msvc');
        expect(tripleFromBinaryName('coc-webview2.win32-arm64-msvc.exe')).toBeNull();
    });
});
