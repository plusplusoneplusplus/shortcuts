/**
 * The addon is required, and what "required" means differs by module.
 *
 * `cache/git-utils.ts` answers every git failure with `null`/`false`, and the
 * four caches read an absent hash as "the repository changed" — so a binary
 * that failed to load would quietly re-run the entire wiki. Every function
 * there rethrows `NativeAddonLoadError` out of its catch.
 *
 * `utils/git-init.ts` is the deliberate exception: it reports failures to the
 * user as a warning carrying the message, so the load error already arrives
 * wearing the sentence that names the rebuild, and swallowing it into `false`
 * is the documented contract of that module rather than silence.
 *
 * Both mock the specifier the module under test actually imports —
 * `@plusplusoneplusplus/coc-native` for the discovery call, and the
 * `@plusplusoneplusplus/forge` root barrel for `execGitAsync` — and both keep
 * the real `NativeAddonLoadError` class, because the guards narrow with
 * `instanceof` and a look-alike would prove nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';

vi.mock('@plusplusoneplusplus/coc-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>();
    return { ...actual, loadNativeGit: vi.fn() };
});

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, execGitAsync: vi.fn() };
});

const { loadNativeGit } = await import('@plusplusoneplusplus/coc-native');
const { execGitAsync } = await import('@plusplusoneplusplus/forge');
const {
    getGitRoot,
    getRepoHeadHash,
    getFolderHeadHash,
    getChangedFiles,
    hasChanges,
    isGitAvailable,
    isGitRepo,
} = await import('../../src/cache/git-utils');
const { initGitRepo, initWikiGitRepo } = await import('../../src/utils/git-init');

const LOAD_MESSAGE =
    '@plusplusoneplusplus/coc-native: coc-native.linux-arm64-gnu.node is missing. Run npm run build:native.';

function loadError(): NativeAddonLoadError {
    return new NativeAddonLoadError(LOAD_MESSAGE);
}

/** The addon loads and answers; git itself fails. */
function armWorkingAddon(): void {
    vi.mocked(loadNativeGit).mockReturnValue({
        gitDiscoverRepoRoot: vi.fn().mockResolvedValue('/repo'),
    } as unknown as ReturnType<typeof loadNativeGit>);
    vi.mocked(execGitAsync).mockRejectedValue(new Error('git rev-parse HEAD failed: fatal: not a git repository'));
}

/** The binary is missing or stale; nothing ran. */
function armBrokenAddon(): void {
    vi.mocked(loadNativeGit).mockImplementation(() => { throw loadError(); });
    vi.mocked(execGitAsync).mockRejectedValue(loadError());
}

beforeEach(() => {
    vi.resetAllMocks();
});

// ============================================================================
// cache/git-utils — every function rethrows
// ============================================================================

describe('cache/git-utils rethrows a load failure', () => {
    it('getGitRoot and isGitRepo rethrow rather than reporting "not a repository"', async () => {
        armBrokenAddon();
        await expect(getGitRoot('/repo')).rejects.toThrow(NativeAddonLoadError);
        await expect(isGitRepo('/repo')).rejects.toThrow(LOAD_MESSAGE);
    });

    it('getRepoHeadHash rethrows rather than reporting "no hash"', async () => {
        armBrokenAddon();
        await expect(getRepoHeadHash('/repo')).rejects.toThrow(NativeAddonLoadError);
    });

    it('getFolderHeadHash rethrows from the discovery call', async () => {
        armBrokenAddon();
        await expect(getFolderHeadHash('/repo/src')).rejects.toThrow(NativeAddonLoadError);
    });

    it('getFolderHeadHash rethrows from the git log call too', async () => {
        // Discovery succeeds and the subfolder branch is the one that fails, so
        // the second catch in that function is the one under test.
        vi.mocked(loadNativeGit).mockReturnValue({
            gitDiscoverRepoRoot: vi.fn().mockResolvedValue('/repo'),
        } as unknown as ReturnType<typeof loadNativeGit>);
        vi.mocked(execGitAsync).mockRejectedValue(loadError());

        await expect(getFolderHeadHash('/repo/src')).rejects.toThrow(NativeAddonLoadError);
    });

    it('getChangedFiles and hasChanges rethrow rather than reporting "everything changed"', async () => {
        armBrokenAddon();
        await expect(getChangedFiles('/repo', 'abc123')).rejects.toThrow(NativeAddonLoadError);
        await expect(hasChanges('/repo', 'abc123')).rejects.toThrow(NativeAddonLoadError);
    });

    it('isGitAvailable rethrows rather than reporting "git is not installed"', async () => {
        armBrokenAddon();
        await expect(isGitAvailable()).rejects.toThrow(NativeAddonLoadError);
    });

    it('still answers a real git failure with an absent answer', async () => {
        // The guard has to be narrow, or the port would turn every repository
        // that is not a repository into a crash.
        armWorkingAddon();
        vi.mocked(loadNativeGit).mockReturnValue({
            gitDiscoverRepoRoot: vi.fn().mockResolvedValue(null),
        } as unknown as ReturnType<typeof loadNativeGit>);

        expect(await getGitRoot('/not-a-repo')).toBeNull();
        expect(await isGitRepo('/not-a-repo')).toBe(false);
        expect(await getRepoHeadHash('/not-a-repo')).toBeNull();
        expect(await getFolderHeadHash('/not-a-repo')).toBeNull();
        expect(await getChangedFiles('/not-a-repo', 'abc123')).toBeNull();
        expect(await hasChanges('/not-a-repo', 'abc123')).toBeNull();
        expect(await isGitAvailable()).toBe(false);
    });
});

// ============================================================================
// utils/git-init — reports the load failure instead of rethrowing it
// ============================================================================

describe('utils/git-init reports a load failure to the user', () => {
    it('warns with the message that names the rebuild and returns false', async () => {
        armBrokenAddon();
        const warnings: string[] = [];

        const result = await initGitRepo('/tmp/deep-wiki-load-error-probe', {
            warn: (msg) => warnings.push(msg),
        });

        expect(result).toBe(false);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('Could not initialize Git repository');
        expect(warnings[0]).toContain('npm run build:native');
    });

    it('does not throw out of initWikiGitRepo, which still writes the .gitignore', async () => {
        armBrokenAddon();
        const warnings: string[] = [];

        await expect(
            initWikiGitRepo('/tmp/deep-wiki-load-error-probe', {
                info: () => {},
                warn: (msg) => warnings.push(msg),
            }),
        ).resolves.toBeUndefined();

        expect(warnings.some(m => m.includes('npm run build:native'))).toBe(true);
    });
});
