/**
 * Loader tests. These never need a compiled binary — the point is that a
 * missing or broken addon is a hard, well-explained failure, that there is no
 * environment switch that turns the addon off, and that resolution says nothing
 * about which capabilities the binary has.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    loadNativeAddon,
    NativeAddonLoadError,
    nativeAddonStatus,
    nativeBinaryCandidates,
    nativeBinaryName,
    nativeTriple,
    resetNativeAddonCache,
} from '../src/loader';

const ENV_KEYS = ['COC_NATIVE', 'COC_NATIVE_PATH'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    resetNativeAddonCache();
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
    resetNativeAddonCache();
});

/** Write a loadable JavaScript stand-in for the addon. */
function writeModule(source: string): { dir: string; file: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-loader-'));
    const file = path.join(dir, 'stub.js');
    fs.writeFileSync(file, source);
    return { dir, file };
}

describe('binary naming', () => {
    it('uses the ABI-qualified triple on linux and windows', () => {
        expect(nativeTriple('linux', 'x64')).toBe('linux-x64-gnu');
        expect(nativeTriple('linux', 'arm64')).toBe('linux-arm64-gnu');
        expect(nativeTriple('win32', 'x64')).toBe('win32-x64-msvc');
        expect(nativeTriple('darwin', 'arm64')).toBe('darwin-arm64');
        expect(nativeTriple('darwin', 'x64')).toBe('darwin-x64');
    });

    it('names binaries after the triple', () => {
        expect(nativeBinaryName('linux', 'x64')).toBe('coc-native.linux-x64-gnu.node');
        expect(nativeBinaryName('darwin', 'arm64')).toBe('coc-native.darwin-arm64.node');
    });

    it('prefers a locally built binary over a prebuilt one', () => {
        const candidates = nativeBinaryCandidates('/pkg', 'linux', 'x64');
        expect(candidates[0]).toBe(path.join('/pkg', 'coc-native.linux-x64-gnu.node'));
        expect(candidates[1]).toBe(
            path.join('/pkg', 'prebuilt', 'linux-x64-gnu', 'coc-native.linux-x64-gnu.node'),
        );
        expect(candidates[2]).toBe(path.join('/pkg', 'prebuilt', 'linux-x64-gnu', 'coc-native.node'));
    });
});

describe('loading', () => {
    // Regression: COC_NATIVE=0 used to short-circuit resolution and hand back
    // `null`, which is how a load failure could pass for a deliberate opt-out.
    it('ignores COC_NATIVE=0 — the addon has no opt-out', () => {
        const { dir, file } = writeModule('module.exports = { somethingElse: 1 };');
        try {
            process.env.COC_NATIVE = '0';
            process.env.COC_NATIVE_PATH = file;
            expect(loadNativeAddon()).toEqual({ somethingElse: 1 });
            expect(nativeAddonStatus()).toEqual({ loaded: true, binaryPath: file });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('still throws for a missing binary when COC_NATIVE=0 is set', () => {
        process.env.COC_NATIVE = '0';
        process.env.COC_NATIVE_PATH = path.join(os.tmpdir(), 'coc-native-absent.node');
        expect(() => loadNativeAddon()).toThrow(NativeAddonLoadError);
        expect(nativeAddonStatus().loaded).toBe(false);
    });

    it('throws when the override path does not exist', () => {
        const missing = path.join(os.tmpdir(), 'coc-native-absent.node');
        process.env.COC_NATIVE_PATH = missing;
        expect(() => loadNativeAddon()).toThrow(NativeAddonLoadError);
        // The override is the only path tried, so it is the only one named.
        expect(() => loadNativeAddon()).toThrow(missing);
    });

    it('throws when the binary exists but is not loadable, keeping the cause', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-loader-'));
        try {
            const broken = path.join(dir, 'broken.node');
            fs.writeFileSync(broken, 'not an addon');
            process.env.COC_NATIVE_PATH = broken;

            let caught: unknown;
            try {
                loadNativeAddon();
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(NativeAddonLoadError);
            expect((caught as Error).message).toContain(`failed to load ${broken}`);
            // The underlying require() failure survives, both as text and as a cause.
            expect((caught as Error).message).toContain('Caused by:');
            expect((caught as Error).cause).toBeInstanceOf(Error);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('throws a message naming the triple, the paths tried and the fix', () => {
        // No override and no binary in a scratch root: the default candidate list.
        process.env.COC_NATIVE_PATH = path.join(os.tmpdir(), 'coc-native-absent.node');
        let message = '';
        try {
            loadNativeAddon();
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain('@plusplusoneplusplus/coc-native');
        expect(message).toContain(nativeTriple());
        expect(message).toContain('npm run build:native -w packages/coc-native');
        // The opt-out is gone, so suggesting it would be a dead end.
        expect(message).not.toContain('COC_NATIVE=0');
    });

    it('rejects a module that is not an object', () => {
        const { dir, file } = writeModule('module.exports = function notAnAddon() {};');
        try {
            process.env.COC_NATIVE_PATH = file;
            expect(() => loadNativeAddon()).toThrow('is not a native addon module');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('loads a module without judging which capabilities it exports', () => {
        const { dir, file } = writeModule('module.exports = { somethingElse: 1 };');
        try {
            process.env.COC_NATIVE_PATH = file;
            expect(loadNativeAddon()).toEqual({ somethingElse: 1 });
            expect(nativeAddonStatus()).toEqual({ loaded: true, binaryPath: file });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('caches the resolution until it is reset', () => {
        const missing = path.join(os.tmpdir(), 'coc-native-absent.node');
        process.env.COC_NATIVE_PATH = missing;
        expect(nativeAddonStatus().reason).toContain('no native binary');
        const { dir, file } = writeModule('module.exports = { somethingElse: 1 };');
        try {
            process.env.COC_NATIVE_PATH = file;
            // Still cached — the environment is read once.
            expect(nativeAddonStatus().reason).toContain('no native binary');
            resetNativeAddonCache();
            expect(nativeAddonStatus()).toEqual({ loaded: true, binaryPath: file });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('raises the same failure on every call, not just the first', () => {
        process.env.COC_NATIVE_PATH = path.join(os.tmpdir(), 'coc-native-absent.node');
        const first = (() => {
            try {
                loadNativeAddon();
            } catch (err) {
                return err;
            }
        })();
        expect(() => loadNativeAddon()).toThrow(NativeAddonLoadError);
        // Cached, so it is literally the same error object.
        expect(() => loadNativeAddon()).toThrowError(first as Error);
    });
});

describe('status', () => {
    it('reports a failed load instead of throwing, so /api/health survives it', () => {
        const missing = path.join(os.tmpdir(), 'coc-native-absent.node');
        process.env.COC_NATIVE_PATH = missing;
        const status = nativeAddonStatus();
        expect(status.loaded).toBe(false);
        expect(status.reason).toContain('no native binary');
        expect(status.binaryPath).toBeUndefined();
    });

    it('reports the reason for an unloadable binary without throwing', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-loader-'));
        try {
            const broken = path.join(dir, 'broken.node');
            fs.writeFileSync(broken, 'not an addon');
            process.env.COC_NATIVE_PATH = broken;
            expect(nativeAddonStatus()).toEqual({
                loaded: false,
                reason: `failed to load ${broken}`,
            });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
