/**
 * useSourceCanvasTree — lazy, expandable-tree state for the docked source-canvas
 * folder explorer. Resolves the root folder ref with the same multi-repo logic
 * the flat listing used (`resolveSourceCanvasTarget` + remote-workspace folding),
 * lists the root's immediate children through the workspace-routed
 * `explorer.tree`, and then lazily fetches each *expanded* folder's children on
 * demand — keyed by the folder's repo-relative path in a `childrenMap`,
 * mirroring the repo-detail FileTree's lazy expansion but routed through the
 * clone registry so remote-clone conversations browse their own server's files.
 *
 * Read-only: files are never fetched here (the viewer loads them on click); this
 * hook only walks folders. Every fetch goes through
 * `getCocClientForWorkspace(wsId)` so a remote workspace's tree comes from its
 * own server; local ids fall through to the default client.
 *
 * Exposes root loading / success / error just like the flat listing did (empty
 * folder = `success` with no entries; `truncated` mirrors the API flag), plus
 * per-folder `expanded` / `loadingPaths` / `errorPaths` sets so the body can
 * render chevrons, spinners, and inline per-folder failures without re-fetching.
 * A root change (new ref) resets the expansion; a generation guard drops any
 * in-flight child fetch whose root has since changed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExplorerTreeEntry } from '@plusplusoneplusplus/coc-client';
import { useApp } from '../../../contexts/AppContext';
import { useReposOptional } from '../../../contexts/ReposContext';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { isRemoteWorkspace } from '../../../repos/remoteWorkspaceAggregation';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import {
    resolveSourceCanvasTarget,
    isSourceCanvasResolveError,
    getSourceCanvasWorkspaceRelativePath,
} from './resolve';
import type { SourceCanvasFileRef } from './types';

export type SourceCanvasTreeStatus = 'loading' | 'success' | 'error';

export interface SourceCanvasTreeState {
    /** Root-folder load status (its immediate children). */
    status: SourceCanvasTreeStatus;
    /** Immediate children of the root folder (API order preserved). */
    rootEntries: ExplorerTreeEntry[];
    /** The absolute path resolved for the root — shown in the header + error. */
    resolvedPath: string;
    /** The workspace-relative path of the root folder. */
    relativePath: string;
    /** The workspace id the tree is fetched from (routes navigation + expansion). */
    wsId: string;
    /** True when the API capped the root listing (`truncated: true`). */
    truncated: boolean;
    /** Root failure reason (error). */
    error: string;
    /** Cached children per expanded folder, keyed by repo-relative path. */
    childrenMap: Map<string, ExplorerTreeEntry[]>;
    /** Currently-expanded folder paths (repo-relative). */
    expanded: Set<string>;
    /** Folders whose children are being fetched (repo-relative). */
    loadingPaths: Set<string>;
    /** Per-folder fetch errors, keyed by repo-relative path. */
    errorPaths: Map<string, string>;
    /** Expand/collapse a folder in place, lazily fetching children on expand. */
    toggle: (path: string) => void;
}

interface RootState {
    status: SourceCanvasTreeStatus;
    rootEntries: ExplorerTreeEntry[];
    resolvedPath: string;
    relativePath: string;
    wsId: string;
    truncated: boolean;
    error: string;
}

const LOADING_ROOT: RootState = {
    status: 'loading',
    rootEntries: [],
    resolvedPath: '',
    relativePath: '',
    wsId: '',
    truncated: false,
    error: '',
};

export function useSourceCanvasTree(
    rootRef: SourceCanvasFileRef | null,
): SourceCanvasTreeState {
    const { state } = useApp();
    const repos = useReposOptional();

    // Remote-server workspaces live in the repos list (clone-routed), not the
    // global `state.workspaces`, so fold them in for resolution — a folder ref
    // in a remote conversation carries that remote workspace id, and without its
    // `rootPath` a relative path can't be anchored. Mirrors `useSourceCanvasContent`.
    const reposList = repos?.repos;
    const workspaces = useMemo(() => {
        const remote = (reposList ?? [])
            .map((r) => r.workspace)
            .filter(isRemoteWorkspace);
        return remote.length > 0 ? [...state.workspaces, ...remote] : state.workspaces;
    }, [state.workspaces, reposList]);

    const [root, setRoot] = useState<RootState>(LOADING_ROOT);
    const [childrenMap, setChildrenMap] = useState<Map<string, ExplorerTreeEntry[]>>(new Map());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
    const [errorPaths, setErrorPaths] = useState<Map<string, string>>(new Map());

    // Refs let the stable `toggle`/`fetchChildren` read current values without
    // re-creating themselves and without threading state through deps.
    const wsIdRef = useRef('');
    wsIdRef.current = root.wsId;
    const expandedRef = useRef(expanded);
    expandedRef.current = expanded;
    const childrenRef = useRef(childrenMap);
    childrenRef.current = childrenMap;
    const loadingRef = useRef(loadingPaths);
    loadingRef.current = loadingPaths;
    // Bumped on every root (re)resolution so a late child fetch from a previous
    // root can't write into the reset maps.
    const genRef = useRef(0);

    const fullPath = rootRef?.fullPath;
    const sourceFilePath = rootRef?.sourceFilePath;
    const wsHint = rootRef?.wsId;

    useEffect(() => {
        genRef.current += 1;
        const gen = genRef.current;
        // A new root invalidates all cached expansion.
        setChildrenMap(new Map());
        setExpanded(new Set());
        setLoadingPaths(new Set());
        setErrorPaths(new Map());

        if (!rootRef) {
            setRoot(LOADING_ROOT);
            return;
        }

        const resolved = resolveSourceCanvasTarget(rootRef, workspaces);
        if (isSourceCanvasResolveError(resolved)) {
            setRoot({
                ...LOADING_ROOT,
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
        const relativePath = getSourceCanvasWorkspaceRelativePath(resolved.path, workspace?.rootPath);

        setRoot({
            ...LOADING_ROOT,
            resolvedPath: resolved.path,
            relativePath,
            wsId: resolved.wsId,
        });

        // Route through the clone registry so a remote workspace's tree is fetched
        // from its own server; local ids fall through to the default client.
        getCocClientForWorkspace(resolved.wsId)
            .explorer.tree(resolved.wsId, { path: relativePath })
            .then((res) => {
                if (gen !== genRef.current) {
                    return;
                }
                setRoot({
                    status: 'success',
                    rootEntries: Array.isArray(res.entries) ? res.entries : [],
                    resolvedPath: resolved.path,
                    relativePath,
                    wsId: resolved.wsId,
                    truncated: res.truncated === true,
                    error: '',
                });
            })
            .catch((err) => {
                if (gen !== genRef.current) {
                    return;
                }
                setRoot({
                    ...LOADING_ROOT,
                    status: 'error',
                    resolvedPath: resolved.path,
                    relativePath,
                    wsId: resolved.wsId,
                    error: getSpaCocClientErrorMessage(err, 'Failed to load folder'),
                });
            });
    }, [fullPath, sourceFilePath, wsHint, workspaces]);

    const fetchChildren = useCallback((path: string) => {
        const wsId = wsIdRef.current;
        if (!wsId) {
            return;
        }
        if (childrenRef.current.has(path) || loadingRef.current.has(path)) {
            return;
        }
        const gen = genRef.current;
        setLoadingPaths((prev) => {
            const next = new Set(prev);
            next.add(path);
            return next;
        });
        setErrorPaths((prev) => {
            if (!prev.has(path)) {
                return prev;
            }
            const next = new Map(prev);
            next.delete(path);
            return next;
        });
        getCocClientForWorkspace(wsId)
            .explorer.tree(wsId, { path })
            .then((res) => {
                if (gen !== genRef.current) {
                    return;
                }
                setChildrenMap((prev) => {
                    const next = new Map(prev);
                    next.set(path, Array.isArray(res.entries) ? res.entries : []);
                    return next;
                });
            })
            .catch((err) => {
                if (gen !== genRef.current) {
                    return;
                }
                setErrorPaths((prev) => {
                    const next = new Map(prev);
                    next.set(path, getSpaCocClientErrorMessage(err, 'Failed to load folder'));
                    return next;
                });
            })
            .finally(() => {
                if (gen !== genRef.current) {
                    return;
                }
                setLoadingPaths((prev) => {
                    if (!prev.has(path)) {
                        return prev;
                    }
                    const next = new Set(prev);
                    next.delete(path);
                    return next;
                });
            });
    }, []);

    const toggle = useCallback((path: string) => {
        const wasExpanded = expandedRef.current.has(path);
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
        // Expanding a folder we haven't cached yet triggers a lazy fetch.
        if (!wasExpanded) {
            fetchChildren(path);
        }
    }, [fetchChildren]);

    return {
        status: root.status,
        rootEntries: root.rootEntries,
        resolvedPath: root.resolvedPath,
        relativePath: root.relativePath,
        wsId: root.wsId,
        truncated: root.truncated,
        error: root.error,
        childrenMap,
        expanded,
        loadingPaths,
        errorPaths,
        toggle,
    };
}
