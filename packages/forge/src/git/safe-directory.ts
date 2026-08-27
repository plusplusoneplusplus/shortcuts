import { execFileSync } from 'child_process';
import { loadNativeGit, type NativeGitAddon } from '@plusplusoneplusplus/coc-native';
import { getDefaultWslDistro } from '../utils/workspace-execution';
import { isLinuxAbsolutePath, parseWslUncPath, toForwardSlashes, trimTrailingPathSeparators } from '../utils/path-utils';

/** The multi-valued global key Git for Windows checks before opening a repo. */
const SAFE_DIRECTORY_KEY = 'safe.directory';

const ensuredSafeDirectories = new Set<string>();
const inFlightSafeDirectoryEnsures = new Map<string, Promise<void>>();

function normalizeLinuxPath(linuxPath: string): string {
    const normalized = trimTrailingPathSeparators(toForwardSlashes(linuxPath));
    return normalized.length === 0 ? '/' : normalized;
}

function buildGitSafeDirectory(host: string, distro: string, linuxPath: string): string {
    return `%(prefix)///${host.toLowerCase()}/${distro}${normalizeLinuxPath(linuxPath)}`;
}

/**
 * Convert a Windows-hosted WSL repository path into the safe.directory entry
 * Git for Windows expects when the repo is accessed via the UNC WSL share.
 */
export function resolveGitSafeDirectory(repoRoot: string): string | undefined {
    if (process.platform !== 'win32') {
        return undefined;
    }

    const uncMatch = repoRoot.match(/^\\\\(wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i);
    if (uncMatch) {
        const host = uncMatch[1];
        const distro = uncMatch[2];
        const linuxPath = uncMatch[3] ? `/${toForwardSlashes(uncMatch[3])}` : '/';
        return buildGitSafeDirectory(host, distro, linuxPath);
    }

    if (isLinuxAbsolutePath(repoRoot)) {
        const distro = getDefaultWslDistro();
        if (!distro) {
            return undefined;
        }
        return buildGitSafeDirectory('wsl$', distro, repoRoot);
    }

    const unc = parseWslUncPath(repoRoot);
    if (!unc) {
        return undefined;
    }
    return buildGitSafeDirectory('wsl$', unc.distro, unc.linuxPath);
}

/**
 * Split `git config --get-all` output into the entries already approved.
 *
 * Only the sync path still needs this: the async path reads the list through
 * the native addon, which splits and trims in Rust. It goes when `execGit` does.
 */
function parseSafeDirectoryList(output: string): Set<string> {
    return new Set(
        output
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean),
    );
}

function isSafeDirectoryConfiguredSync(safeDirectory: string): boolean {
    try {
        const output = execFileSync('git', ['config', '--global', '--get-all', SAFE_DIRECTORY_KEY], {
            encoding: 'utf-8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return parseSafeDirectoryList(output).has(safeDirectory);
    } catch {
        return false;
    }
}

/**
 * Whether the entry is already in the user's global `safe.directory` list.
 *
 * Every failure reads as "not configured", because git exits non-zero both for
 * an unset key and for a global config file that does not exist yet, and the
 * caller's next move — appending the entry — is right in either case.
 */
async function isSafeDirectoryConfiguredAsync(
    addon: NativeGitAddon,
    safeDirectory: string,
): Promise<boolean> {
    try {
        const configured = await addon.gitGlobalConfigGetAll(SAFE_DIRECTORY_KEY);
        return configured.includes(safeDirectory);
    } catch {
        return false;
    }
}

export function clearGitSafeDirectoryCache(): void {
    ensuredSafeDirectories.clear();
    inFlightSafeDirectoryEnsures.clear();
}

export function ensureGitSafeDirectorySync(repoRoot: string): void {
    const safeDirectory = resolveGitSafeDirectory(repoRoot);
    if (!safeDirectory || ensuredSafeDirectories.has(safeDirectory)) {
        return;
    }

    if (!isSafeDirectoryConfiguredSync(safeDirectory)) {
        execFileSync('git', ['config', '--global', '--add', SAFE_DIRECTORY_KEY, safeDirectory], {
            encoding: 'utf-8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    }

    ensuredSafeDirectories.add(safeDirectory);
}

export async function ensureGitSafeDirectoryAsync(repoRoot: string): Promise<void> {
    const safeDirectory = resolveGitSafeDirectory(repoRoot);
    if (!safeDirectory || ensuredSafeDirectories.has(safeDirectory)) {
        return;
    }

    const inFlightEnsure = inFlightSafeDirectoryEnsures.get(safeDirectory);
    if (inFlightEnsure) {
        await inFlightEnsure;
        return;
    }

    // Outside the promise below, and after the two early returns: on any host
    // but Windows there is no entry to resolve and the addon is never touched,
    // while a stale binary here has to surface as the NativeAddonLoadError that
    // names the rebuild. The check answers every failure with "not configured",
    // so a swallowed load error would silently append a duplicate entry on
    // every start rather than say what is wrong.
    const addon = loadNativeGit();

    const ensurePromise = (async () => {
        if (!(await isSafeDirectoryConfiguredAsync(addon, safeDirectory))) {
            await addon.gitGlobalConfigAdd(SAFE_DIRECTORY_KEY, safeDirectory);
        }

        ensuredSafeDirectories.add(safeDirectory);
    })().finally(() => {
        inFlightSafeDirectoryEnsures.delete(safeDirectory);
    });

    inFlightSafeDirectoryEnsures.set(safeDirectory, ensurePromise);
    await ensurePromise;
}
