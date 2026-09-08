/**
 * useWorkspaceRemoteUrl — resolves a chat workspace's git remote URL from every
 * source the SPA has, not just the local server's workspace list.
 *
 * Origin-scoped chrome (the composer PR chips / PR status card) is gated on this
 * value: `undefined` means "remote identity not known yet" and the consumer stays
 * idle, so a workspace this resolver cannot see renders no PR chrome at all — no
 * request, no error. `appState.workspaces` only ever holds the LOCAL server's
 * workspaces (`ReposContext` dispatches `WORKSPACES_LOADED` from `listWorkspaces()`
 * and keeps the aggregated REMOTE rows in `repos` alone), so a chat owned by a
 * remote clone is missing from it and never resolves an origin.
 *
 * Resolution order, each step only consulted when the previous one is UNKNOWN:
 *   1. the local workspace list ({@link resolveWorkspaceRemoteUrl}),
 *   2. the repos list, which carries the aggregated remote rows and their
 *      git-info ({@link resolveRepoListRemoteUrl}),
 *   3. a one-shot `git-info` fetch against the server that OWNS the workspace
 *      (routed through {@link getCocClientForWorkspace}), for remote clones the
 *      repos list has not aggregated (or a window mounted without them).
 *
 * The tri-state is preserved end to end: `undefined` = unknown, `null` = known to
 * have no remote, `string` = the remote URL.
 */
import { useEffect, useMemo, useState } from 'react';
import { getCocClientForWorkspace } from './cloneRegistry';
import { resolveWorkspaceRemoteUrl } from './originScope';
import type { RepoData } from './repoGrouping';

/**
 * Reads a workspace's remote URL out of the repos list (which includes the
 * aggregated remote-server rows). Returns `undefined` when the workspace is
 * absent, or present but its git-info has not resolved yet — both are "unknown",
 * not "no remote".
 */
export function resolveRepoListRemoteUrl(
    repos: ReadonlyArray<RepoData> | undefined,
    workspaceId: string | undefined,
): string | null | undefined {
    if (!workspaceId || !repos || repos.length === 0) return undefined;
    const repo = repos.find(candidate => candidate?.workspace?.id === workspaceId);
    if (!repo) return undefined;
    const remoteUrl = repo.gitInfo?.remoteUrl ?? (repo.workspace as { remoteUrl?: unknown } | undefined)?.remoteUrl;
    if (typeof remoteUrl === 'string') return remoteUrl;
    // git-info still in flight → the missing remote is not evidence of no remote.
    return repo.gitInfoLoading ? undefined : null;
}

/**
 * Session cache of the fallback git-info probe, keyed by workspace id. A repo's
 * remote URL does not change while the tab is open, and several chats share a
 * workspace, so one fetch per workspace is enough. Failures are evicted so a
 * later mount retries.
 */
const remoteUrlProbeCache = new Map<string, Promise<string | null>>();

/** Test seam — drops the memoized git-info probes. */
export function clearWorkspaceRemoteUrlProbeCache(): void {
    remoteUrlProbeCache.clear();
}

function probeRemoteUrl(workspaceId: string): Promise<string | null> {
    const cached = remoteUrlProbeCache.get(workspaceId);
    if (cached) return cached;
    const pending = getCocClientForWorkspace(workspaceId)
        .workspaces.gitInfo(workspaceId)
        .then(info => (typeof info?.remoteUrl === 'string' ? info.remoteUrl : null))
        .catch((err: unknown) => {
            remoteUrlProbeCache.delete(workspaceId);
            throw err;
        });
    remoteUrlProbeCache.set(workspaceId, pending);
    return pending;
}

export function useWorkspaceRemoteUrl(
    workspaces: ReadonlyArray<{ id?: string; remoteUrl?: unknown }> | undefined,
    repos: ReadonlyArray<RepoData> | undefined,
    workspaceId: string | undefined,
): string | null | undefined {
    const fromWorkspaces = useMemo(
        () => resolveWorkspaceRemoteUrl(workspaces, workspaceId),
        [workspaces, workspaceId],
    );
    const fromRepos = useMemo(() => resolveRepoListRemoteUrl(repos, workspaceId), [repos, workspaceId]);
    const known = fromWorkspaces !== undefined ? fromWorkspaces : fromRepos;

    // Probe result, tagged with the workspace it belongs to so a workspace switch
    // never shows the previous workspace's remote.
    const [probed, setProbed] = useState<{ workspaceId: string; remoteUrl: string | null } | null>(null);

    // Only probe once the local list has LOADED and still does not contain the id:
    // that is exactly the remote-clone case. During the pre-load window the list is
    // empty and every workspace is legitimately unknown, so probing there would add
    // a request per chat open for local workspaces that resolve a moment later.
    const shouldProbe = known === undefined && !!workspaceId && (workspaces?.length ?? 0) > 0;

    useEffect(() => {
        if (!shouldProbe || !workspaceId) return undefined;
        let cancelled = false;
        probeRemoteUrl(workspaceId)
            .then(remoteUrl => {
                if (!cancelled) setProbed({ workspaceId, remoteUrl });
            })
            .catch(() => {
                /* unknown stays unknown — the caller simply renders no PR chrome */
            });
        return () => {
            cancelled = true;
        };
    }, [shouldProbe, workspaceId]);

    if (known !== undefined) return known;
    return probed && probed.workspaceId === workspaceId ? probed.remoteUrl : undefined;
}
