/**
 * useSourceCanvasDirectory — loads a directory listing for the docked source
 * canvas folder explorer (AC-01). Resolves the workspace + path with the exact
 * same multi-repo logic the file viewer uses (`resolveSourceCanvasTarget`:
 * explicit `wsId` hint → longest-prefix `rootPath` match → first workspace,
 * relative paths against `sourceFilePath` or the workspace root), then lists the
 * folder's immediate children through the workspace-routed `explorer.tree`
 * endpoint — no new persisted canvas storage.
 *
 * The `explorer.tree` API takes a *repo-relative* path and returns repo-relative
 * entry paths, so the resolved absolute path is converted back to a
 * workspace-relative path (via `getSourceCanvasDisplayPath`) before the call.
 * That relative path is also what in-panel navigation re-opens against, so a
 * clicked subfolder/file resolves through the same chosen workspace.
 *
 * Exposes explicit loading / success / error states. An unresolvable path, a
 * missing workspace, or a server failure (e.g. the path is a file or escapes the
 * repo) all resolve to `error` so the canvas stays open with a clear message
 * rather than silently showing nothing. An empty folder is a `success` with no
 * entries; `truncated` mirrors the API's truncation flag.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ExplorerTreeEntry } from '@plusplusoneplusplus/coc-client';
import { useApp } from '../../../contexts/AppContext';
import { useReposOptional } from '../../../contexts/ReposContext';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { isRemoteWorkspace } from '../../../repos/remoteWorkspaceAggregation';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import {
    resolveSourceCanvasTarget,
    isSourceCanvasResolveError,
    getSourceCanvasDisplayPath,
} from './resolve';
import type { SourceCanvasFileRef } from './types';

export type SourceCanvasDirectoryStatus = 'loading' | 'success' | 'error';

export interface SourceCanvasDirectoryState {
    status: SourceCanvasDirectoryStatus;
    /** Immediate children of the listed folder (success); API order preserved. */
    entries: ExplorerTreeEntry[];
    /** The absolute path resolved — shown in the header + error message. */
    resolvedPath: string;
    /**
     * The workspace-relative path actually listed. In-panel navigation re-opens
     * entries against the resolved workspace, so this is the base entries extend.
     */
    relativePath: string;
    /** The workspace id the listing was fetched from (for routing navigation). */
    wsId: string;
    /** True when the API capped the listing (`truncated: true`). */
    truncated: boolean;
    /** Failure reason (error). */
    error: string;
}

const LOADING: SourceCanvasDirectoryState = {
    status: 'loading',
    entries: [],
    resolvedPath: '',
    relativePath: '',
    wsId: '',
    truncated: false,
    error: '',
};

export function useSourceCanvasDirectory(
    fileRef: SourceCanvasFileRef | null,
): SourceCanvasDirectoryState {
    const { state } = useApp();
    const repos = useReposOptional();
    const [dir, setDir] = useState<SourceCanvasDirectoryState>(LOADING);

    // Remote-server workspaces live in the repos list (clone-routed), not the
    // global `state.workspaces`, so fold them in for resolution — a folder link
    // clicked in a remote conversation carries that remote workspace id, and
    // without its `rootPath` a relative path can't be anchored. Mirrors
    // `useSourceCanvasContent`.
    const reposList = repos?.repos;
    const workspaces = useMemo(() => {
        const remote = (reposList ?? [])
            .map((r) => r.workspace)
            .filter(isRemoteWorkspace);
        return remote.length > 0 ? [...state.workspaces, ...remote] : state.workspaces;
    }, [state.workspaces, reposList]);

    const fullPath = fileRef?.fullPath;
    const sourceFilePath = fileRef?.sourceFilePath;
    const wsHint = fileRef?.wsId;

    useEffect(() => {
        if (!fileRef) {
            setDir(LOADING);
            return;
        }

        const resolved = resolveSourceCanvasTarget(fileRef, workspaces);
        if (isSourceCanvasResolveError(resolved)) {
            setDir({
                ...LOADING,
                status: 'error',
                resolvedPath: resolved.attemptedPath,
                error: resolved.error,
            });
            return;
        }

        // `explorer.tree` is repo-relative; convert the resolved absolute path
        // back to a workspace-relative path. When the path sits inside the chosen
        // workspace root this strips the prefix; otherwise it falls back to the
        // resolved path and the server's traversal guard surfaces a clear error.
        const workspace = workspaces.find((ws) => ws.id === resolved.wsId);
        const relativePath = getSourceCanvasDisplayPath(resolved.path, workspace?.rootPath);

        let cancelled = false;
        setDir({ ...LOADING, resolvedPath: resolved.path, relativePath, wsId: resolved.wsId });
        // Route through the clone registry so a remote workspace's tree is fetched
        // from its own server; local ids fall through to the default client.
        getCocClientForWorkspace(resolved.wsId)
            .explorer.tree(resolved.wsId, { path: relativePath })
            .then((res) => {
                if (cancelled) {
                    return;
                }
                setDir({
                    status: 'success',
                    entries: Array.isArray(res.entries) ? res.entries : [],
                    resolvedPath: resolved.path,
                    relativePath,
                    wsId: resolved.wsId,
                    truncated: res.truncated === true,
                    error: '',
                });
            })
            .catch((err) => {
                if (cancelled) {
                    return;
                }
                setDir({
                    ...LOADING,
                    status: 'error',
                    resolvedPath: resolved.path,
                    relativePath,
                    wsId: resolved.wsId,
                    error: getSpaCocClientErrorMessage(err, 'Failed to load folder'),
                });
            });

        return () => {
            cancelled = true;
        };
    }, [fullPath, sourceFilePath, wsHint, workspaces]);

    return dir;
}
