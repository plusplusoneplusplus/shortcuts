/** Capability loading for the required native Notes content index. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NativeAddonLoadError, resetNativeAddonCache } from '../src/loader';
import { loadNativeNotesIndex, nativeNotesIndexStatus } from '../src/notes-index';
import * as packageExports from '../src';

const ENV_KEYS = ['COC_NATIVE', 'COC_NATIVE_PATH'] as const;
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-capability-'));
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

function useAddon(source: string): string {
    const file = path.join(dir, 'stub.js');
    fs.writeFileSync(file, source);
    process.env.COC_NATIVE_PATH = file;
    return file;
}

it('exposes the capability when the addon provides it', async () => {
    useAddon(
        'module.exports = { buildNotesIndex: async () => ({ search: async () => ({ results: [], truncated: false }) }) };',
    );
    const api = loadNativeNotesIndex();
    const index = await api.buildNotesIndex('/notes');
    expect(await index.search('needle')).toEqual({ results: [], truncated: false });
    expect(nativeNotesIndexStatus().loaded).toBe(true);
});

it('exports the capability from the package root', () => {
    expect(packageExports.loadNativeNotesIndex).toBe(loadNativeNotesIndex);
    expect(packageExports.nativeNotesIndexStatus).toBe(nativeNotesIndexStatus);
});

describe('when the capability is missing', () => {
    it('throws even though the binary itself loaded', () => {
        const file = useAddon('module.exports = { buildFileIndex: async () => ({}) };');
        expect(() => loadNativeNotesIndex()).toThrow(NativeAddonLoadError);
        expect(() => loadNativeNotesIndex()).toThrow('does not export a Notes content index');
        expect(nativeNotesIndexStatus()).toEqual({
            loaded: false,
            binaryPath: file,
            reason: `${file} does not export a Notes content index`,
        });
    });

    it('is not fooled by a non-callable export of the right name', () => {
        useAddon('module.exports = { buildNotesIndex: true };');
        expect(() => loadNativeNotesIndex()).toThrow(NativeAddonLoadError);
        expect(nativeNotesIndexStatus().loaded).toBe(false);
    });
});

it('propagates missing and unloadable addon failures', () => {
    process.env.COC_NATIVE_PATH = path.join(dir, 'absent.node');
    expect(() => loadNativeNotesIndex()).toThrow(NativeAddonLoadError);
    expect(nativeNotesIndexStatus().loaded).toBe(false);
});

it('treats COC_NATIVE=0 as a fatal Notes capability error', () => {
    process.env.COC_NATIVE = '0';
    expect(() => loadNativeNotesIndex()).toThrow(NativeAddonLoadError);
    expect(() => loadNativeNotesIndex()).toThrow('disabled by COC_NATIVE=0');
    expect(nativeNotesIndexStatus()).toEqual({ loaded: false, reason: 'disabled by COC_NATIVE=0' });
});
