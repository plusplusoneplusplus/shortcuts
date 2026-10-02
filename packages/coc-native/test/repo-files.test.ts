/**
 * Capability-layer tests: repo files is one capability of the addon, so it
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

import { loadNativeRepoFiles, nativeRepoFilesStatus } from '../src/repo-files';
import { NativeAddonLoadError, resetNativeAddonCache } from '../src/loader';

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

/** A stand-in exposing the whole capability; `drop` omits one method. */
function stubSource(drop?: string): string {
    const methods = ['readBlob', 'writeBlob', 'listDirectory', 'listFiles', 'replaceContent',
        'indexFiles', 'searchFiles', 'searchFilesRanked', 'invalidate', 'dispose']
        .filter(m => m !== drop)
        .map(m => `${m}() { return 7; }`)
        .join(' ');
    return `class RepoFiles { ${methods} }\n` +
        'module.exports = { RepoFiles, openRepoFiles: () => new RepoFiles() };';
}

/** Point the loader at a JavaScript stand-in for the addon. */
function useAddon(source: string): string {
    const file = path.join(dir, 'stub.js');
    fs.writeFileSync(file, source);
    process.env.COC_NATIVE_PATH = file;
    return file;
}

it('exposes the capability when the addon provides it', () => {
    useAddon(stubSource());
    const api = loadNativeRepoFiles();
    expect(api.openRepoFiles('/repo').dispose()).toBe(7);
    expect(nativeRepoFilesStatus().loaded).toBe(true);
});

describe('when the capability is missing', () => {
    it('throws even though the binary itself loaded', () => {
        const file = useAddon('module.exports = { someOtherCapability: () => 1 };');
        expect(() => loadNativeRepoFiles()).toThrow(NativeAddonLoadError);
        expect(() => loadNativeRepoFiles()).toThrow('does not export repo files');
        // The status accessor still describes it, rather than throwing too.
        expect(nativeRepoFilesStatus()).toEqual({
            loaded: false,
            binaryPath: file,
            reason: `${file} does not export repo files`,
        });
    });

    it('names the binary and the fix', () => {
        const file = useAddon('module.exports = { someOtherCapability: () => 1 };');
        let message = '';
        try {
            loadNativeRepoFiles();
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain(file);
        expect(message).toContain('npm run build:native -w packages/coc-native');
        // The opt-out is gone, so the rebuild is the only remedy worth naming.
        expect(message).not.toContain('COC_NATIVE=0');
    });

    it('is not fooled by a non-callable export of the right name', () => {
        useAddon('module.exports = { openRepoFiles: "nope" };');
        expect(() => loadNativeRepoFiles()).toThrow(NativeAddonLoadError);
        expect(nativeRepoFilesStatus().loaded).toBe(false);
    });

    it('rejects a binary whose handle predates one of the methods', () => {
        useAddon(stubSource('searchFilesRanked'));
        expect(() => loadNativeRepoFiles()).toThrow('does not export repo files');
        expect(nativeRepoFilesStatus().loaded).toBe(false);
    });
});

describe('when no binary loaded', () => {
    it('propagates the loader failure rather than degrading', () => {
        process.env.COC_NATIVE_PATH = path.join(dir, 'absent.node');
        expect(() => loadNativeRepoFiles()).toThrow(NativeAddonLoadError);
    });

    it('still reports a status, so /api/health keeps working', () => {
        process.env.COC_NATIVE_PATH = path.join(dir, 'absent.node');
        const status = nativeRepoFilesStatus();
        expect(status.loaded).toBe(false);
        expect(typeof status.reason).toBe('string');
    });
});

// Regression: this capability used to return `null` under COC_NATIVE=0, which
// is what let RepoTreeService silently serve a different implementation.
it('never returns null — COC_NATIVE=0 is not an opt-out', () => {
    process.env.COC_NATIVE = '0';
    const file = useAddon(stubSource());
    expect(loadNativeRepoFiles()).not.toBeNull();
    expect(nativeRepoFilesStatus()).toEqual({ loaded: true, binaryPath: file });
});
