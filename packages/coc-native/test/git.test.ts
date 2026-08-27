/**
 * Capability-layer tests: git is one capability of the addon, so it has to fail
 * on its own terms when the addon is missing *or* when a loaded binary predates
 * the capability — without the loader knowing it exists.
 *
 * Both are hard failures with no opt-out, and the status accessor has to
 * describe every one of these states without throwing, because `/api/health`
 * reports it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNativeGit, nativeGitStatus } from '../src/git';
import { NativeAddonLoadError, resetNativeAddonCache } from '../src/loader';

const ENV_KEYS = ['COC_NATIVE', 'COC_NATIVE_PATH'] as const;
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-git-capability-'));
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

/** A stand-in exporting the whole git capability. */
const COMPLETE_ADDON =
    "module.exports = { execGit: async () => 'main', gitStatusEntries: async () => [], " +
    'parseGitStatusPorcelain: async () => [] };';

/** Point the loader at a JavaScript stand-in for the addon. */
function useAddon(source: string): string {
    const file = path.join(dir, 'stub.js');
    fs.writeFileSync(file, source);
    process.env.COC_NATIVE_PATH = file;
    return file;
}

it('exposes the capability when the addon provides it', async () => {
    useAddon(COMPLETE_ADDON);
    const api = loadNativeGit();
    expect(await api.execGit(['branch', '--show-current'], '/repo')).toBe('main');
    expect(await api.gitStatusEntries('/repo')).toEqual([]);
    expect(await api.parseGitStatusPorcelain('')).toEqual([]);
    expect(nativeGitStatus().loaded).toBe(true);
});

// A binary can carry one capability and not the other, so the accessors have to
// disagree rather than both keying off "the addon loaded".
it('is independent of the file-index capability', () => {
    const file = useAddon('module.exports = { buildFileIndex: () => 1 };');
    expect(() => loadNativeGit()).toThrow(NativeAddonLoadError);
    expect(nativeGitStatus()).toEqual({
        loaded: false,
        binaryPath: file,
        reason: `${file} does not export the git capability`,
    });
});

describe('when the capability is missing', () => {
    it('throws even though the binary itself loaded', () => {
        const file = useAddon('module.exports = { someOtherCapability: () => 1 };');
        expect(() => loadNativeGit()).toThrow(NativeAddonLoadError);
        expect(() => loadNativeGit()).toThrow('does not export the git capability');
        // The status accessor still describes it, rather than throwing too.
        expect(nativeGitStatus()).toEqual({
            loaded: false,
            binaryPath: file,
            reason: `${file} does not export the git capability`,
        });
    });

    it('names the binary and the fix', () => {
        const file = useAddon('module.exports = { someOtherCapability: () => 1 };');
        let message = '';
        try {
            loadNativeGit();
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain(file);
        expect(message).toContain('npm run build:native -w packages/coc-native');
        expect(message).not.toContain('COC_NATIVE=0');
    });

    it('is not fooled by a non-callable export of the right name', () => {
        useAddon("module.exports = { execGit: 'nope' };");
        expect(() => loadNativeGit()).toThrow(NativeAddonLoadError);
        expect(nativeGitStatus().loaded).toBe(false);
    });

    // A binary from before a later slice carries some of the capability and not
    // the rest. Half a capability has to fail at load with a rebuild
    // instruction, not at the first call with `undefined is not a function`.
    it('rejects a binary carrying only part of the capability', () => {
        const file = useAddon("module.exports = { execGit: async () => 'main' };");
        expect(() => loadNativeGit()).toThrow('does not export the git capability');
        expect(nativeGitStatus()).toEqual({
            loaded: false,
            binaryPath: file,
            reason: `${file} does not export the git capability`,
        });
    });
});

describe('when no binary loaded', () => {
    it('propagates the loader failure rather than degrading', () => {
        process.env.COC_NATIVE_PATH = path.join(dir, 'absent.node');
        expect(() => loadNativeGit()).toThrow(NativeAddonLoadError);
    });

    it('still reports a status, so /api/health keeps working', () => {
        process.env.COC_NATIVE_PATH = path.join(dir, 'absent.node');
        const status = nativeGitStatus();
        expect(status.loaded).toBe(false);
        expect(typeof status.reason).toBe('string');
    });
});

// There is no TypeScript fallback for git, so an opt-out would silently restore
// the child-process path this capability exists to remove.
it('never returns null — COC_NATIVE=0 is not an opt-out', () => {
    process.env.COC_NATIVE = '0';
    const file = useAddon(COMPLETE_ADDON);
    expect(loadNativeGit()).not.toBeNull();
    expect(nativeGitStatus()).toEqual({ loaded: true, binaryPath: file });
});
