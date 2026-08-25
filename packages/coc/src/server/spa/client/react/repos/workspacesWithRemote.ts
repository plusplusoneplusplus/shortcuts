/**
 * "Workspaces including remote clones" — the single place that folds
 * remote-server workspaces into the list used for PATH → WORKSPACE resolution.
 *
 * `ReposContext.fetchRepos` dispatches only the LOCAL `listWorkspaces()` result
 * into AppContext; remote-server workspaces are merged into the repos list only
 * (they are clone-routed, not part of the global workspace state). Any surface
 * that resolves a clicked file path — the docked source canvas, its tree, the
 * note editor, the floating markdown dialog — must therefore add the remote rows
 * back in, or a link clicked inside a remote conversation resolves to nothing
 * ("No matching workspace found").
 *
 * Two entry points, because the callers differ:
 *   • `useWorkspacesWithRemote()` for components inside `<ReposProvider>` — the
 *     reactive path, reading the live repos list.
 *   • `withRemoteWorkspaces()` for code ABOVE the provider (App.tsx's
 *     `coc-open-markdown-review` handler), which reads the module-level snapshot
 *     published by `aggregateRemoteWorkspaces`.
 *
 * With no remote workspaces present, both return the input array identity
 * unchanged, so the local flow (and memo identity) is unaffected.
 */
import { useMemo } from 'react';
import { useApp, useAppOptional } from '../contexts/AppContext';
import { useReposOptional } from '../contexts/ReposContext';
import { getRemoteWorkspacesSnapshot, isRemoteWorkspace } from './remoteWorkspaceAggregation';

/** The minimum a workspace needs to participate in path resolution. */
export interface ResolvableWorkspace {
    id: string;
    name?: string;
    rootPath?: string;
}

function merge<T extends ResolvableWorkspace>(local: T[], remote: T[]): T[] {
    return remote.length > 0 ? [...local, ...remote] : local;
}

/**
 * Add the last-known remote workspaces to `workspaces`. Non-hook: for call sites
 * that run outside `<ReposProvider>` or outside React entirely.
 */
export function withRemoteWorkspaces<T extends ResolvableWorkspace>(workspaces: T[]): T[] {
    return merge(workspaces, getRemoteWorkspacesSnapshot() as unknown as T[]);
}

/**
 * `state.workspaces` plus the remote-server workspaces from the repos list,
 * memoized. Falls back to the module snapshot when no ReposContext is mounted.
 */
export function useWorkspacesWithRemote(): ResolvableWorkspace[] {
    const { state } = useApp();
    const repos = useReposOptional();
    const reposList = repos?.repos;

    return useMemo(() => {
        const remote = reposList
            ? reposList.map((r) => r.workspace).filter(isRemoteWorkspace)
            : getRemoteWorkspacesSnapshot();
        return merge(state.workspaces as ResolvableWorkspace[], remote as ResolvableWorkspace[]);
    }, [state.workspaces, reposList]);
}

/**
 * Like `useWorkspacesWithRemote()`, but tolerates being rendered outside
 * `<AppProvider>` (returning just the remote snapshot) so presentational leaves
 * can look up workspace names without forcing every host to provide context.
 */
export function useWorkspacesWithRemoteOptional(): ResolvableWorkspace[] {
    const app = useAppOptional();
    const repos = useReposOptional();
    const reposList = repos?.repos;
    const localWorkspaces = app?.state.workspaces;

    return useMemo(() => {
        const remote = reposList
            ? reposList.map((r) => r.workspace).filter(isRemoteWorkspace)
            : getRemoteWorkspacesSnapshot();
        return merge(
            (localWorkspaces ?? []) as ResolvableWorkspace[],
            remote as ResolvableWorkspace[],
        );
    }, [localWorkspaces, reposList]);
}
