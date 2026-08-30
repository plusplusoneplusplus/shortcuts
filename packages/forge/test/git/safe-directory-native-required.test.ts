/**
 * The native addon is a hard dependency of the async `safe.directory` ensure.
 *
 * Two failure modes are worth pinning. The check answers *every* git failure
 * with "not configured", so a swallowed load error there would append a
 * duplicate entry to the user's global config on every start instead of saying
 * what is wrong. And `execGitAsync` runs the ensure inside the try/catch that
 * renders a failure as `git <args> failed:` — which would bury the rebuild
 * instruction, and bury it on the WSL path, which otherwise never touches the
 * addon at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REBUILD = 'npm run build:native -w packages/coc-native';

// Spreading `actual` keeps `NativeAddonLoadError` a real class: `execGitAsync`
// narrows on it, and a stub module would leave that check comparing against
// `undefined`.
vi.mock('@plusplusoneplusplus/coc-native', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>();
    return {
        ...actual,
        loadNativeGit: () => {
            throw new actual.NativeAddonLoadError(
                'coc-native.node loaded but does not export the git capability.\n' +
                    `The binary predates the git capability, or a part of it — rebuild it with \`${REBUILD}\`.`,
            );
        },
    };
});

import { execGitAsync } from '../../src/git/exec';
import { clearGitSafeDirectoryCache, ensureGitSafeDirectoryAsync } from '../../src/git/safe-directory';

const REPO_ROOT = '\\\\wsl$\\Ubuntu-24.04\\home\\me\\repo';

let originalPlatform: PropertyDescriptor | undefined;

beforeEach(() => {
    clearGitSafeDirectoryCache();
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});

afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    clearGitSafeDirectoryCache();
});

describe('the safe.directory ensure without a usable addon', () => {
    it('rejects instead of reporting the entry unconfigured', async () => {
        await expect(ensureGitSafeDirectoryAsync(REPO_ROOT)).rejects.toThrow(REBUILD);
    });

    it('reaches execGitAsync callers with the rebuild instruction intact', async () => {
        const failure = execGitAsync(['status'], REPO_ROOT);

        await expect(failure).rejects.toThrow(REBUILD);
        await expect(failure).rejects.not.toThrow(/^git status failed: /);
    });

    it('never loads the addon on a host with no entry to resolve', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        await expect(ensureGitSafeDirectoryAsync(REPO_ROOT)).resolves.toBeUndefined();
    });
});
