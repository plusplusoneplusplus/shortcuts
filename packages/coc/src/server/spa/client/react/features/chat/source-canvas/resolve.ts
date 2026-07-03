/**
 * Pure path + workspace resolution for the docked source-file canvas (AC-06).
 *
 * Given a clicked file reference and the known workspaces, decide which
 * workspace to fetch from and which path to fetch:
 *  - relative paths are resolved against the directory of `sourceFilePath`;
 *  - workspace-relative paths are resolved against the selected workspace root;
 *  - the workspace is chosen by longest-prefix `rootPath` match (mirroring
 *    `FilePreview` and the App-level md-link handler), honoring an explicit
 *    `wsId` hint when present and falling back to the first workspace.
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
    /** Absolute path to fetch through the preview API. */
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

    // 2. Pick a workspace: explicit hint → longest rootPath prefix → first.
    const hintedWorkspace = findWorkspaceById(fileRef.wsId, workspaces);
    const matchedWorkspace = isAbsolutePath(path)
        ? findBestWorkspaceForPath(path, workspaces)
        : undefined;
    const fallbackWorkspace = fileRef.wsId ? undefined : workspaces[0];
    const workspace = hintedWorkspace ?? matchedWorkspace ?? fallbackWorkspace;
    const wsId = fileRef.wsId ?? workspace?.id;

    if (!wsId) {
        return { error: 'No workspace available', attemptedPath: path };
    }

    // 3. The preview API requires an absolute path; anchor workspace-relative
    // chat refs at the chosen workspace root before fetching.
    if (!isAbsolutePath(path)) {
        const root = workspace?.rootPath ? trimTrailingSlashes(workspace.rootPath) : '';
        if (!root) {
            return { error: 'No workspace root available', attemptedPath: path };
        }
        path = resolveRelativePath(root, path);
    }

    return { wsId, path };
}
