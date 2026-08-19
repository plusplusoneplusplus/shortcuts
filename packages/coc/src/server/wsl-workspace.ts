/**
 * WSL detection for workspace checkouts.
 *
 * A user can have both a native-Windows clone and a WSL clone of the same
 * remote; the dashboard's repo dropdown needs to tell them apart. The browser
 * cannot know where a checkout really lives, so the server decides and reports
 * a marker on the workspace payload.
 *
 * Detection is a pure predicate over the path string plus a small env snapshot
 * — no filesystem or shell calls, so it is safe to run for every workspace in
 * the listing hot path.
 */

/** Marker attached to a workspace whose checkout lives inside WSL. */
export interface WslWorkspaceMarker {
    /** Distro name when it can be determined, otherwise `null`. */
    distro: string | null;
}

/** Host facts the predicate needs; both default to "not WSL". */
export interface WslDetectionEnv {
    /** True when the CoC server process itself runs inside WSL. */
    isNativeWsl?: boolean;
    /** The host's `WSL_DISTRO_NAME`, when set. */
    wslDistro?: string;
}

/**
 * WSL UNC share roots, in the `/`-normalized form: `//wsl$/<distro>/...` and
 * `//wsl.localhost/<distro>/...`. The share prefix matches case-insensitively;
 * the distro segment is captured verbatim.
 */
const WSL_UNC_ROOT_RE = /^\/\/(?:wsl\$|wsl\.localhost)\/([^/]+)/i;

/**
 * Decide whether `rootPath` is a WSL-hosted checkout.
 *
 * Returns `null` for anything else — Windows drive paths, plain Linux/macOS
 * paths on a non-WSL host, and empty input.
 */
export function detectWslWorkspace(
    rootPath: string | null | undefined,
    env: WslDetectionEnv = {},
): WslWorkspaceMarker | null {
    if (!rootPath) {
        return null;
    }

    const normalized = rootPath.replace(/\\/g, '/');
    const unc = normalized.match(WSL_UNC_ROOT_RE);
    if (unc) {
        return { distro: unc[1] || null };
    }

    // A server running inside WSL sees its own checkouts as ordinary Linux
    // paths (`/home/u/repo`); those are WSL-hosted by definition. Windows drive
    // paths reachable from WSL (`C:/...`, and `/mnt/c/...` DrvFs mounts) are
    // not.
    if (env.isNativeWsl && normalized.startsWith('/') && !normalized.startsWith('//')
        && !/^\/mnt\/[a-z]\//i.test(normalized)) {
        return { distro: env.wslDistro || null };
    }

    return null;
}
