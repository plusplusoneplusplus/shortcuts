/**
 * Pure path + workspace resolution for the docked source-file canvas (AC-06).
 *
 * Given a clicked file reference and the known workspaces, decide which
 * workspace to fetch from and which path to fetch:
 *  - relative paths are resolved against the directory of `sourceFilePath`;
 *  - workspace-relative paths are resolved against the selected workspace root,
 *    except repo-group refs, which stay relative for ordered server probing;
 *  - the workspace is chosen by longest-prefix `rootPath` match (mirroring
 *    `FilePreview` and the App-level md-link handler), unless an explicit
 *    `wsId` hint owns the resolved path, and falls back to the first workspace.
 *
 * Returns either a resolvable `{ wsId, path }` target or an error carrying the
 * path we attempted — so the canvas can still open with a clear
 * "couldn't load <path>" message when nothing resolves.
 */
import {
    deriveHomeDirFromWorkspaces,
    expandTildePath,
    isAbsolutePath,
    resolveRelativePath,
} from '../../../utils/path-resolution';
import {
    getWslUncRoot,
    toForwardSlashes,
    trimTrailingPathSeparators,
} from '@plusplusoneplusplus/forge/utils/path-utils';
import { parseFilePathRef } from '../../../shared/file-path-utils';
import type { SourceCanvasFileRef } from './types';

export interface SourceCanvasWorkspace {
    id: string;
    rootPath?: string | null;
}

export interface SourceCanvasTarget {
    /** Workspace id to fetch from. */
    wsId: string;
    /** Path to fetch through the preview API (relative only for repo-group probing). */
    path: string;
}

export interface SourceCanvasResolveError {
    /** Human-readable reason resolution failed. */
    error: string;
    /** The path we attempted to resolve — shown in the canvas error state. */
    attemptedPath: string;
}

function normalize(p: string): string {
    return toForwardSlashes(p);
}

function trimTrailingSlashes(p: string): string {
    return normalize(trimTrailingPathSeparators(p));
}

/** Directory portion of a (possibly Windows) path, normalized to `/`. */
function dirOf(p: string): string {
    const n = normalize(p);
    const idx = n.lastIndexOf('/');
    return idx >= 0 ? n.slice(0, idx) : '';
}

function findWorkspaceById(
    id: string | undefined,
    workspaces: ReadonlyArray<SourceCanvasWorkspace>,
): SourceCanvasWorkspace | undefined {
    return id ? workspaces.find((ws) => ws.id === id) : undefined;
}

function isSameOrWithinRoot(filePath: string, rootPath: string): boolean {
    const normalizedFile = trimTrailingSlashes(filePath).toLowerCase();
    const normalizedRoot = trimTrailingSlashes(rootPath).toLowerCase();
    const rootPrefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
    return !!normalizedRoot && (
        normalizedFile === normalizedRoot ||
        normalizedFile.startsWith(rootPrefix)
    );
}

export function getSourceCanvasDisplayPath(
    fullPath: string,
    workspaceRootPath?: string | null,
): string {
    const relativePath = getRelativePathInsideWorkspace(fullPath, workspaceRootPath);
    return relativePath === null ? fullPath : relativePath || fullPath;
}

/** API path for repo tree/blob endpoints: workspace-relative, with root as ".". */
export function getSourceCanvasWorkspaceRelativePath(
    fullPath: string,
    workspaceRootPath?: string | null,
): string {
    const relativePath = getRelativePathInsideWorkspace(fullPath, workspaceRootPath);
    return relativePath === null ? fullPath : relativePath || '.';
}

function getRelativePathInsideWorkspace(
    fullPath: string,
    workspaceRootPath?: string | null,
): string | null {
    const rootPath = typeof workspaceRootPath === 'string' ? workspaceRootPath.trim() : '';
    if (!rootPath || !isSameOrWithinRoot(fullPath, rootPath)) {
        return null;
    }

    const normalizedFile = trimTrailingSlashes(fullPath);
    const normalizedRoot = trimTrailingSlashes(rootPath);
    return normalizedFile.slice(normalizedRoot.length).replace(/^\/+/, '');
}

/**
 * Map a Linux absolute path (what a WSL-hosted agent writes into chat, e.g.
 * `/home/u/repo/src/foo.ts`) onto the WSL UNC root of a workspace that contains
 * it (`//wsl$/Ubuntu-24.04/home/u/repo/src/foo.ts`), so prefix matching finds
 * the workspace and the preview API gets a path the Windows host can open.
 *
 * Returns `null` unless the rewritten path actually lands inside a WSL
 * workspace root, so plain Linux hosts are untouched.
 */
function toWslUncPathForWorkspaces(
    linuxPath: string,
    workspaces: ReadonlyArray<SourceCanvasWorkspace>,
    preferred?: SourceCanvasWorkspace,
): string | null {
    if (!linuxPath.startsWith('/') || linuxPath.startsWith('//')) return null;
    const ordered = preferred ? [preferred, ...workspaces] : workspaces;
    for (const ws of ordered) {
        const root = ws.rootPath ? trimTrailingSlashes(ws.rootPath) : '';
        const wslRoot = root ? getWslUncRoot(root) : null;
        if (!wslRoot) continue;
        const candidate = `${wslRoot}${linuxPath}`;
        if (isSameOrWithinRoot(candidate, root)) return candidate;
    }
    return null;
}

function findBestWorkspaceForPath(
    filePath: string,
    workspaces: ReadonlyArray<SourceCanvasWorkspace>,
): SourceCanvasWorkspace | undefined {
    let best: SourceCanvasWorkspace | undefined;
    for (const ws of workspaces) {
        const root = ws.rootPath ? trimTrailingSlashes(ws.rootPath) : '';
        if (root && isSameOrWithinRoot(filePath, root)) {
            if (!best || root.length > trimTrailingSlashes(best.rootPath || '').length) {
                best = ws;
            }
        }
    }
    return best;
}

/** Type guard: the resolution failed (no resolvable workspace). */
export function isSourceCanvasResolveError(
    r: SourceCanvasTarget | SourceCanvasResolveError,
): r is SourceCanvasResolveError {
    return (r as SourceCanvasResolveError).error !== undefined;
}

export function resolveSourceCanvasTarget(
    fileRef: SourceCanvasFileRef,
    workspaces: ReadonlyArray<SourceCanvasWorkspace>,
): SourceCanvasTarget | SourceCanvasResolveError {
    // 0. Expand `~`-prefixed CoC note hrefs (e.g. `~/.coc/repos/<wsId>/...`) to
    // an absolute path through the hinted workspace's home, so they resolve
    // instead of being treated as workspace-relative.
    let path = parseFilePathRef(fileRef.fullPath).path;
    if (path.startsWith('~')) {
        path = expandTildePath(path, deriveHomeDirFromWorkspaces(fileRef.wsId, workspaces));
    }

    // 1. Resolve relative refs against the directory of the source file.
    if (!isAbsolutePath(path)) {
        path = normalize(path);
    }
    if (!isAbsolutePath(path) && fileRef.sourceFilePath) {
        path = resolveRelativePath(dirOf(fileRef.sourceFilePath), path);
    }

    const hintedWorkspace = findWorkspaceById(fileRef.wsId, workspaces);

    // 1b. A Linux absolute path names the same file as a WSL workspace's
    // `//wsl$/<distro>/...` root — rewrite it so it matches and stays openable.
    if (isAbsolutePath(path)) {
        path = toWslUncPathForWorkspaces(path, workspaces, hintedWorkspace) ?? path;
    }

    // 2. Pick a workspace. An explicit hint remains authoritative when its root
    // contains the resolved path. When it does not, prefer the longest matching
    // known root (notably a live member repo beneath a repo-group chat hint).
    // If nothing matches, preserve the hinted/fallback behavior.
    const matchedWorkspace = isAbsolutePath(path)
        ? findBestWorkspaceForPath(path, workspaces)
        : undefined;
    const fallbackWorkspace = fileRef.wsId ? undefined : workspaces[0];
    const hintedWorkspaceOwnsPath = !!(
        hintedWorkspace?.rootPath
        && isAbsolutePath(path)
        && isSameOrWithinRoot(path, hintedWorkspace.rootPath)
    );
    const reroutedWorkspace = (
        hintedWorkspace
        && matchedWorkspace
        && !hintedWorkspaceOwnsPath
    ) ? matchedWorkspace : undefined;
    const workspace = reroutedWorkspace
        ?? hintedWorkspace
        ?? matchedWorkspace
        ?? fallbackWorkspace;
    const wsId = reroutedWorkspace?.id ?? fileRef.wsId ?? workspace?.id;

    if (!wsId) {
        return { error: 'No workspace available', attemptedPath: path };
    }

    // 3. Anchor ordinary workspace-relative refs at the chosen workspace root.
    // Repo-group refs deliberately stay relative: only the server can probe the
    // live members in stored order and report which workspace owns the result.
    if (!isAbsolutePath(path)) {
        if (fileRef.wsId?.startsWith('group-')) {
            return { wsId, path };
        }
        const root = workspace?.rootPath ? trimTrailingSlashes(workspace.rootPath) : '';
        if (!root) {
            return { error: 'No workspace root available', attemptedPath: path };
        }
        path = resolveRelativePath(root, path);
    }

    return { wsId, path };
}
