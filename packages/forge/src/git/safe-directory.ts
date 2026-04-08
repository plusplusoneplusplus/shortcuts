import { execFileSync } from 'child_process';
import { execFileAsync } from '../utils/exec-utils';
import { getDefaultWslDistro } from '../utils/workspace-execution';
import { isLinuxAbsolutePath, parseWslUncPath, toForwardSlashes, trimTrailingPathSeparators } from '../utils/path-utils';

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
        const output = execFileSync('git', ['config', '--global', '--get-all', 'safe.directory'], {
            encoding: 'utf-8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return parseSafeDirectoryList(output).has(safeDirectory);
    } catch {
        return false;
    }
}

async function isSafeDirectoryConfiguredAsync(safeDirectory: string): Promise<boolean> {
    try {
        const { stdout } = await execFileAsync('git', ['config', '--global', '--get-all', 'safe.directory'], {
            windowsHide: true,
        });
        return parseSafeDirectoryList(stdout).has(safeDirectory);
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
        execFileSync('git', ['config', '--global', '--add', 'safe.directory', safeDirectory], {
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

    const ensurePromise = (async () => {
        if (!(await isSafeDirectoryConfiguredAsync(safeDirectory))) {
            await execFileAsync('git', ['config', '--global', '--add', 'safe.directory', safeDirectory], {
                windowsHide: true,
            });
        }

        ensuredSafeDirectories.add(safeDirectory);
    })().finally(() => {
        inFlightSafeDirectoryEnsures.delete(safeDirectory);
    });

    inFlightSafeDirectoryEnsures.set(safeDirectory, ensurePromise);
    await ensurePromise;
}
