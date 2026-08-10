/**
 * Path resolution utilities for md-link click handling.
 *
 * Used by the App-level event handler to resolve relative file references
 * (e.g. `./other-file.md`, `../sibling.md`) against the currently viewed file.
 */

/**
 * Check whether a path is absolute: Unix `/...`, Windows `C:/...` / `C:\...`,
 * or a UNC share (`//wsl$/Ubuntu/...`, `\\wsl$\Ubuntu\...`).
 */
export function isAbsolutePath(p: string): boolean {
    if (p.startsWith('/') || p.startsWith('\\\\')) return true;
    return /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * Leading UNC prefix of a `/`-normalized path (`//server`), which must survive
 * segment-based resolution — collapsing it to a single `/` turns a WSL path
 * like `//wsl$/Ubuntu/home/u/repo` into the nonexistent `/wsl$/Ubuntu/...`.
 */
const UNC_PREFIX_RE = /^\/\/[^/]+/;

/** Full UNC share prefix (`//wsl$/Ubuntu-24.04`), which precedes the path proper. */
const UNC_SHARE_PREFIX_RE = /^\/\/[^/]+\/[^/]+/;

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
    const normalized = absolutePath.replace(/\\/g, '/');
    // A WSL/UNC workspace root carries the home dir behind its share prefix
    // (`//wsl$/Ubuntu-24.04` + `/home/u`); match the remainder and put it back.
    const unc = normalized.match(UNC_SHARE_PREFIX_RE)?.[0] ?? '';
    const m = normalized.slice(unc.length).match(HOME_DIR_PREFIX_RE);
    return m ? `${unc}${m[1]}` : null;
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
    // Preserve the leading slash for absolute Unix paths, and both slashes for
    // UNC roots (`//wsl$/Ubuntu/...`).
    const prefix = UNC_PREFIX_RE.test(dir) ? '//' : dir.startsWith('/') ? '/' : '';
    return prefix + resolved.join('/');
}
