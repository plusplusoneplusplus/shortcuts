import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { WEBVIEW2_BINARY_NAME, webview2BinaryCandidates } from '../src/webview2';
// @ts-expect-error -- build scripts have no type declarations.
import { supportsWebView2 } from '../scripts/build-webview2.mjs';
// @ts-expect-error -- build scripts have no type declarations.
import { builtBinaryPaths } from '../scripts/ensure-native.mjs';
// @ts-expect-error -- build scripts have no type declarations.
import { isStageableBinary, tripleFromBinaryName } from '../../../scripts/stage-native-binaries.mjs';

describe('desktop native WebView2 packaging contract', () => {
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
