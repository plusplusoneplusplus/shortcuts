/**
 * Path resolution utilities for md-link click handling.
 *
 * Used by the App-level event handler to resolve relative file references
 * (e.g. `./other-file.md`, `../sibling.md`) against the currently viewed file.
 */

/** Check whether a path is absolute (Unix `/...` or Windows `C:/...` / `C:\...`). */
export function isAbsolutePath(p: string): boolean {
    if (p.startsWith('/')) return true;
    return /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * Match an absolute home-directory prefix (`/Users/<u>`, `/home/<u>`, or
 * Windows `C:/Users/<u>`) at the start of a `/`-normalized path — the inverse
 * of `shortenFilePath`'s home → `~` collapsing.
 */
const HOME_DIR_PREFIX_RE = /^([A-Za-z]:\/Users\/[^/]+|\/Users\/[^/]+|\/home\/[^/]+)(?=\/|$)/;

/**
 * Derive the absolute home-directory prefix from a known absolute path that
 * lives under it (typically a workspace `rootPath`), or `null` when the path is
 * not home-rooted. Used to expand `~`-style CoC note hrefs through the same
 * workspace they are hinted to, so multi-repo / remote-clone homes resolve
 * correctly.
 */
export function deriveHomeDir(absolutePath: string | null | undefined): string | null {
    if (!absolutePath) return null;
    const m = absolutePath.replace(/\\/g, '/').match(HOME_DIR_PREFIX_RE);
    return m ? m[1] : null;
}

/**
 * Derive a home directory for tilde expansion from a set of workspaces,
 * preferring the workspace matching `wsIdHint` (its `rootPath` carries the home
 * that an `~/.coc/repos/<wsId>/...` href belongs to — important for remote
 * clones whose home differs from the local one), then any home-rooted
 * workspace. Returns `null` when none is home-rooted.
 */
export function deriveHomeDirFromWorkspaces(
    wsIdHint: string | undefined,
    workspaces: ReadonlyArray<{ id: string; rootPath?: string | null }>,
): string | null {
    const hinted = wsIdHint ? workspaces.find((ws) => ws.id === wsIdHint) : undefined;
    const fromHint = deriveHomeDir(hinted?.rootPath);
    if (fromHint) return fromHint;
    for (const ws of workspaces) {
        const home = deriveHomeDir(ws?.rootPath);
        if (home) return home;
    }
    return null;
}

/**
 * Expand a leading `~` / `~/` (home shortcut) to an absolute path using a known
 * home dir. No-op for non-tilde paths or when `homeDir` is unknown.
 */
export function expandTildePath(p: string, homeDir: string | null | undefined): string {
    if (!homeDir || !p) return p;
    if (p === '~') return homeDir;
    if (p[0] === '~' && (p[1] === '/' || p[1] === '\\')) {
        return `${homeDir.replace(/\/+$/, '')}/${p.slice(2)}`;
    }
    return p;
}

/** Resolve a relative path (e.g. `./foo.md`, `../bar.md`) against a directory. */
export function resolveRelativePath(dir: string, rel: string): string {
    const parts = dir.split('/').concat(rel.split('/'));
    const resolved: string[] = [];
    for (const segment of parts) {
        if (segment === '.' || segment === '') continue;
        if (segment === '..') {
            resolved.pop();
        } else {
            resolved.push(segment);
        }
    }
    // Preserve leading slash for absolute Unix paths
    const prefix = dir.startsWith('/') ? '/' : '';
    return prefix + resolved.join('/');
}
