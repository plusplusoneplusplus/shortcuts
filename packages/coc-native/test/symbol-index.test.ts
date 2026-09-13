import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { loadNativeSymbolIndex, nativeSymbolIndexStatus } from '../src/symbol-index';
import { NativeAddonLoadError, resetNativeAddonCache } from '../src/loader';
import { removeDir } from './helpers';

const ENV_KEYS = ['COC_NATIVE', 'COC_NATIVE_PATH'] as const;
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-symbol-capability-'));
    resetNativeAddonCache();
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
    removeDir(dir);
    resetNativeAddonCache();
});

function useAddon(source: string): string {
    const file = path.join(dir, 'stub.js');
    fs.writeFileSync(file, source);
    process.env.COC_NATIVE_PATH = file;
    return file;
}

it('exposes the symbol-index capability independently', async () => {
    useAddon(
        'module.exports = { buildSymbolIndex: async () => ({ search: async () => [], refreshChanged: async () => {} }) };',
    );
    const api = loadNativeSymbolIndex();
    const index = await api.buildSymbolIndex('/repo', '/data/symbols.sqlite');
    expect(await index.search('name')).toEqual([]);
    await expect(index.refreshChanged(['src/name.cpp'])).resolves.toBeUndefined();
    expect(nativeSymbolIndexStatus().loaded).toBe(true);
});

it('rejects a loaded addon without the symbol-index export', () => {
    const file = useAddon('module.exports = { buildFileIndex: () => 1 };');
    expect(() => loadNativeSymbolIndex()).toThrow(NativeAddonLoadError);
    expect(nativeSymbolIndexStatus()).toEqual({
        loaded: false,
        binaryPath: file,
        reason: `${file} does not export a symbol index`,
    });
});

it('rejects a non-callable symbol-index export', () => {
    useAddon('module.exports = { buildSymbolIndex: "nope" };');
    expect(() => loadNativeSymbolIndex()).toThrow(NativeAddonLoadError);
});

it('reports a missing addon without throwing from status', () => {
    process.env.COC_NATIVE_PATH = path.join(dir, 'absent.node');
    expect(() => loadNativeSymbolIndex()).toThrow(NativeAddonLoadError);
    expect(nativeSymbolIndexStatus().loaded).toBe(false);
});
