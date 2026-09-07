/**
 * Cross-platform path string utilities.
 *
 * Browser-safe — no Node.js dependencies.
 */

/**
 * Replace all backslashes with forward slashes.
 */
export function toForwardSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Return true when the path is a Windows drive path like `C:\repo` or `D:/repo`.
 */
export function isWindowsDrivePath(p: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * Return true when the path is an absolute Linux path like `/home/user/repo`.
 */
export function isLinuxAbsolutePath(p: string): boolean {
    return p.startsWith('/');
}

/**
 * Return true when the path points into the Windows WSL UNC namespace.
 */
export function isWslUncPath(p: string): boolean {
    return /^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+(?:\\.*)?$/i.test(p);
}

/**
 * Return the WSL UNC root of a path (`//wsl$/<distro>`, forward-slash form),
 * accepting either slash style, or `null` when the path is not a WSL UNC path.
 *
 * Unlike `isWslUncPath`/`parseWslUncPath` this tolerates the forward-slash form
 * that UI code produces after `toForwardSlashes`.
 */
export function getWslUncRoot(p: string): string | null {
    const match = toForwardSlashes(p).match(/^\/\/(wsl\$|wsl\.localhost)\/([^/]+)/i);
    return match ? `//${match[1]}/${match[2]}` : null;
}

/**
 * Parse a WSL UNC path into its distro and Linux path components.
 */
export function parseWslUncPath(p: string): { distro: string; linuxPath: string } | null {
    const match = p.match(/^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i);
    if (!match) {
        return null;
    }

    const remainder = match[2] ? toForwardSlashes(match[2]) : '';
    const linuxPath = remainder.length > 0 ? `/${remainder}` : '/';
    return {
        distro: match[1],
        linuxPath,
    };
}

/**
 * Remove trailing path separators while keeping root paths intact.
 */
export function trimTrailingPathSeparators(p: string): string {
    if (p === '/' || /^[A-Za-z]:[\\/]?$/.test(p) || /^\\\\[^\\]+\\[^\\]+[\\/]?$/.test(p)) {
        return p;
    }

    let trimmed = p;
    while (trimmed.length > 1 && /[\\/]/.test(trimmed[trimmed.length - 1])) {
        trimmed = trimmed.slice(0, -1);
    }
    return trimmed;
}

/**
 * Convert a Windows drive path to a WSL mount path.
 */
export function windowsPathToWslPath(p: string): string | null {
    const match = p.match(/^([A-Za-z]):[\\/](.*)$/);
    if (!match) {
        return null;
    }

    const drive = match[1].toLowerCase();
    const remainder = toForwardSlashes(match[2]);
    return remainder.length > 0 ? `/mnt/${drive}/${remainder}` : `/mnt/${drive}`;
}

/**
 * Normalize slashes to match the OS style detected from the path.
 * Windows paths (starting with drive letter) get backslashes; others get forward slashes.
 * Browser-safe — no Node.js dependencies.
 */
export function toNativePath(p: string): string {
    if (isWindowsDrivePath(p) || isWslUncPath(p)) {
        return p.replace(/\//g, '\\');
    }
    return toForwardSlashes(p);
}

/**
 * Convert a Linux absolute path into the Windows-reachable WSL UNC form
 * (`\\wsl.localhost\<distro>\home\user\repo`), so it can be pasted into
 * Windows apps such as Explorer.
 *
 * Returns the path unchanged when it cannot or should not be translated:
 * - `distro` is missing or blank (we have no namespace to point at),
 * - the path is already a WSL UNC path (no double translation),
 * - the path is not a Linux absolute path (Windows drive paths, relative paths).
 */
export function toWslUncPath(p: string, distro: string | undefined | null): string {
    const distroName = (distro ?? '').trim();
    if (!distroName || !p) {
        return p;
    }
    if (isWslUncPath(p) || getWslUncRoot(p)) {
        return p;
    }
    if (!isLinuxAbsolutePath(toForwardSlashes(p))) {
        return p;
    }

    const remainder = trimTrailingPathSeparators(toForwardSlashes(p))
        .replace(/^\/+/, '')
        .replace(/\//g, '\\');
    const root = `\\\\wsl.localhost\\${distroName}`;
    return remainder.length > 0 ? `${root}\\${remainder}` : root;
}
