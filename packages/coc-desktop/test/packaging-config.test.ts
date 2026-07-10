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
    files?: string[];
    asarUnpack?: string[];
    mac?: { target?: string[]; files?: string[] };
    win?: { files?: string[] };
};

function buildConfig(): Build {
    const file = path.resolve(__dirname, '../package.json');
    return (JSON.parse(fs.readFileSync(file, 'utf8')).build ?? {}) as Build;
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
});
