/**
 * Capability-layer tests: content search is one capability of the addon, so it
 * has to fail on its own terms when the addon is missing *or* when a loaded
 * binary predates the capability — without the loader knowing it exists.
 *
 * Both are hard failures with no opt-out, and the status accessor has to
 * describe every one of these states without throwing.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNativeContentSearch, nativeContentSearchStatus } from '../src/content-search';
import { NativeAddonLoadError, resetNativeAddonCache } from '../src/loader';

const ENV_KEYS = ['COC_NATIVE', 'COC_NATIVE_PATH'] as const;
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-content-capability-'));
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
    useAddon(
        'module.exports = { searchContent: async () => ({ matches: [], truncated: false }) };',
    );
    const api = loadNativeContentSearch();
    expect(await api.searchContent('/repo', 'q')).toEqual({ matches: [], truncated: false });
    expect(nativeContentSearchStatus().loaded).toBe(true);
});

// A binary can carry one capability and not the other, so the two accessors
// have to disagree rather than both keying off "the addon loaded".
it('is independent of the file-index capability', async () => {
    const file = useAddon('module.exports = { buildFileIndex: () => 1 };');
    expect(() => loadNativeContentSearch()).toThrow(NativeAddonLoadError);
    expect(nativeContentSearchStatus()).toEqual({
        loaded: false,
        binaryPath: file,
        reason: `${file} does not export content search`,
    });
});

describe('when the capability is missing', () => {
    it('throws even though the binary itself loaded', () => {
        const file = useAddon('module.exports = { someOtherCapability: () => 1 };');
        expect(() => loadNativeContentSearch()).toThrow(NativeAddonLoadError);
        expect(() => loadNativeContentSearch()).toThrow('does not export content search');
        // The status accessor still describes it, rather than throwing too.
        expect(nativeContentSearchStatus()).toEqual({
            loaded: false,
            binaryPath: file,
            reason: `${file} does not export content search`,
        });
    });

    it('names the binary and the fix', () => {
        const file = useAddon('module.exports = { someOtherCapability: () => 1 };');
        let message = '';
        try {
            loadNativeContentSearch();
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain(file);
        expect(message).toContain('npm run build:native -w packages/coc-native');
        // The opt-out is gone, so the rebuild is the only remedy worth naming.
        expect(message).not.toContain('COC_NATIVE=0');
    });

    it('is not fooled by a non-callable export of the right name', () => {
        useAddon('module.exports = { searchContent: "nope" };');
        expect(() => loadNativeContentSearch()).toThrow(NativeAddonLoadError);
        expect(nativeContentSearchStatus().loaded).toBe(false);
    });
});

describe('when no binary loaded', () => {
    it('propagates the loader failure rather than degrading', () => {
        process.env.COC_NATIVE_PATH = path.join(dir, 'absent.node');
        expect(() => loadNativeContentSearch()).toThrow(NativeAddonLoadError);
    });

    it('still reports a status, so /api/health keeps working', () => {
        process.env.COC_NATIVE_PATH = path.join(dir, 'absent.node');
        const status = nativeContentSearchStatus();
        expect(status.loaded).toBe(false);
        expect(typeof status.reason).toBe('string');
    });
});

// The opt-out this capability was written after is gone; it must never come
// back through a new module that forgot the rule.
it('never returns null — COC_NATIVE=0 is not an opt-out', () => {
    process.env.COC_NATIVE = '0';
    const file = useAddon('module.exports = { searchContent: () => 1 };');
    expect(loadNativeContentSearch()).not.toBeNull();
    expect(nativeContentSearchStatus()).toEqual({ loaded: true, binaryPath: file });
});
