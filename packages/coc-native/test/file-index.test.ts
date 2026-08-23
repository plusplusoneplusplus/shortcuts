/**
 * Capability-layer tests: the file index is one capability of the addon, so it
 * has to report itself unavailable when the addon is missing *or* when a loaded
 * binary predates the capability — without the loader knowing it exists.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNativeFileIndex, nativeFileIndexStatus } from '../src/file-index';
import { resetNativeAddonCache } from '../src/loader';

const ENV_KEYS = ['COC_NATIVE', 'COC_NATIVE_PATH'] as const;
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-capability-'));
    resetNativeAddonCache();
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
    resetNativeAddonCache();
});

/** Point the loader at a JavaScript stand-in for the addon. */
function useAddon(source: string): string {
    const file = path.join(dir, 'stub.js');
    fs.writeFileSync(file, source);
    process.env.COC_NATIVE_PATH = file;
    return file;
}

it('exposes the capability when the addon provides it', async () => {
    useAddon('module.exports = { buildFileIndex: async () => ({ len: () => 7 }) };');
    const api = loadNativeFileIndex();
    expect(api).not.toBeNull();
    expect((await api!.buildFileIndex('/repo')).len()).toBe(7);
    expect(nativeFileIndexStatus().loaded).toBe(true);
});

describe('when the capability is missing', () => {
    it('returns null even though the binary itself loaded', () => {
        const file = useAddon('module.exports = { someOtherCapability: () => 1 };');
        expect(loadNativeFileIndex()).toBeNull();
        expect(nativeFileIndexStatus()).toEqual({
            loaded: false,
            binaryPath: file,
            reason: `${file} does not export a file index`,
        });
    });

    it('is not fooled by a non-callable export of the right name', () => {
        useAddon('module.exports = { buildFileIndex: "nope" };');
        expect(loadNativeFileIndex()).toBeNull();
        expect(nativeFileIndexStatus().loaded).toBe(false);
    });
});

it('passes the addon-level reason through when nothing loaded', () => {
    process.env.COC_NATIVE = '0';
    expect(loadNativeFileIndex()).toBeNull();
    expect(nativeFileIndexStatus()).toEqual({ loaded: false, reason: 'disabled by COC_NATIVE=0' });
});
