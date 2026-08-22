/**
 * Contract tests for the electron-builder packaging config in package.json.
 *
 * These pin the image-size guardrails so a future edit can't silently re-bloat
 * the desktop build:
 *   1. macOS ships a single `dmg` (no duplicate `zip`) — the `coc-mac` CI
 *      artifact otherwise carries two copies of the same app.
 *   2. The output dir is excluded from the file glob, so a local rebuild can't
 *      pack a previous run's `release/` artifacts into the new asar.
 *   3. Only the host platform's @github/copilot binaries are bundled — the
 *      package ships prebuilds/ripgrep/tgrep for every OS/arch, ~150MB+ of which
 *      a single-platform build can never execute.
 *   4. Copilot's JS launcher and native platform package are unpacked, because
 *      packaged desktop runs the launcher with system Node rather than Electron.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

type Build = {
    appId?: string;
    productName?: string;
    artifactName?: string;
    extraMetadata?: { main?: string };
    files?: string[];
    asarUnpack?: string[];
    mac?: { target?: string[]; files?: string[] };
    win?: { files?: string[] };
    nsis?: { shortcutName?: string };
};

function buildConfig(): Build {
    const file = path.resolve(__dirname, '../package.json');
    return (JSON.parse(fs.readFileSync(file, 'utf8')).build ?? {}) as Build;
}

function containerBuildConfig(): Build {
    const file = path.resolve(__dirname, '../electron-builder.container.cjs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(file) as Build;
}

describe('electron-builder packaging config', () => {
    it('ships a single macOS dmg (no duplicate zip artifact)', () => {
        expect(buildConfig().mac?.target).toEqual(['dmg']);
    });

    it('excludes the release/ output dir from the file glob', () => {
        // Regression: `files: ["**/*"]` recursively packs `release/` itself, so a
        // local rebuild slurps the prior run's dmg/zip/exe/win-unpacked into the
        // new asar (multi-GB). The negation keeps the output dir out.
        expect(buildConfig().files).toContain('!release/**');
    });

    it('unpacks Copilot launcher files and platform binaries for packaged desktop', () => {
        const asarUnpack = buildConfig().asarUnpack ?? [];
        expect(asarUnpack).toContain('**/@github/copilot/**');
        expect(asarUnpack).toContain('**/@github/copilot-*-*/**');
    });

    describe('cross-platform @github/copilot binary pruning', () => {
        it('drops linux/linuxmusl prebuilds and the linux-only mxc-bin everywhere', () => {
            const files = buildConfig().files ?? [];
            expect(files).toContain('!**/@github/copilot/**/{linux,linuxmusl}-*/**');
            expect(files).toContain('!**/@github/copilot/mxc-bin/**');
        });

        it('drops win32 and the non-host darwin-x64 binaries from the mac build', () => {
            const macFiles = buildConfig().mac?.files ?? [];
            expect(macFiles).toContain('!**/@github/copilot/**/win32-*/**');
            expect(macFiles).toContain('!**/@github/copilot/**/darwin-x64/**');
        });

        it('drops darwin binaries from the windows build', () => {
            const winFiles = buildConfig().win?.files ?? [];
            expect(winFiles).toContain('!**/@github/copilot/**/darwin-*/**');
        });
    });

    describe('esbuild ships with the packaged server', () => {
        // The v3.4.x-alpha.16 release refused to start on every platform:
        // `canvas-jsx` → `canvas-tools` → `prompt-builder` is a static chain the
        // server walks at boot, so requiring esbuild there while it sat in
        // devDependencies meant electron-builder pruned it out of the asar and
        // the forked server died with MODULE_NOT_FOUND.
        function cocPackage(): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
            const file = path.resolve(__dirname, '../../coc/package.json');
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }

        it('declares esbuild as a production dependency of @plusplusoneplusplus/coc', () => {
            const pkg = cocPackage();
            expect(pkg.dependencies?.esbuild).toBeTruthy();
            expect(pkg.devDependencies?.esbuild).toBeUndefined();
        });

        it('unpacks the @esbuild native binaries from the asar', () => {
            // esbuild spawns its platform binary (`@esbuild/win32-x64/esbuild.exe`,
            // `@esbuild/darwin-arm64/bin/esbuild`) as a child process, and you
            // cannot exec a file that lives inside an asar archive.
            expect(buildConfig().asarUnpack ?? []).toContain('**/@esbuild/**');
        });

    describe('native file index ships with the packaged server', () => {
        it('packs the loader and the prebuilt N-API binaries', () => {
            const files = buildConfig().files ?? [];
            expect(files).toContain('node_modules/@plusplusoneplusplus/coc-native/dist/**/*');
            expect(files).toContain('node_modules/@plusplusoneplusplus/coc-native/prebuilt/**/*');
        });

        it('unpacks .node binaries from the asar so they can be dlopened', () => {
            // require() cannot load a native module from inside an asar archive.
            expect(buildConfig().asarUnpack ?? []).toContain('**/*.node');
        });

        it('declares coc-native as a production dependency of the server package', () => {
            const cocPkg = JSON.parse(
                fs.readFileSync(path.resolve(__dirname, '../../coc/package.json'), 'utf8'),
            );
            expect(cocPkg.dependencies['@plusplusoneplusplus/coc-native']).toBeTruthy();
        });
    });

        describe('CoCContainer Windows product', () => {
            it('has a distinct application identity and installer name', () => {
                const config = containerBuildConfig();
                expect(config.appId).toBe('com.plusplusoneplusplus.coccontainer');
                expect(config.productName).toBe('CoCContainer');
                expect(config.artifactName).toBe('CoCContainer.Setup.${version}.${ext}');
                expect(config.nsis?.shortcutName).toBe('CoCContainer');
            });

            it('boots the container entry and bundles the container server', () => {
                const config = containerBuildConfig();
                expect(config.extraMetadata?.main).toBe('dist/container-main.js');
                expect(config.files).toContain('node_modules/@plusplusoneplusplus/coccontainer/dist/**/*');
                // CoCContainer resolves CoC's generated dashboard HTML and SPA bundle
                // at runtime, so the inherited CoC dist entries are required too.
                expect(config.files).toContain('node_modules/@plusplusoneplusplus/coc/dist/**/*');
                expect(config.files).toContain('!release/**');
                expect(config.asarUnpack).toContain('**/*.node');
            });

            it('declares the container server as a production dependency', () => {
                const pkg = JSON.parse(
                    fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
                ) as { dependencies?: Record<string, string> };
                expect(pkg.dependencies?.['@plusplusoneplusplus/coccontainer']).toBeTruthy();
            });
        });
    });
});
