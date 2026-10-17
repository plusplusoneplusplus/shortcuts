import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { getApiBase } from '../../utils/config';
import { toLegacyFetchInit, toSpaCocRequestOptions, translateSpaCocClientError } from '../../api/cocClient';
import { getCocClientForWorkspace, requestForWorkspace, resolveCloneRoute, subscribeCloneBaseUrl } from '../../repos/cloneRegistry';
import { getRepoSelectionId, parseRemoteCloneKey } from '../../repos/cloneIdentity';
import type { RepoData } from '../../repos/repoGrouping';
import { WorkspaceOwnerContext, useWorkspaceOwner } from '../../repos/workspaceOwnerContext';

export function createWorkspaceSettingsClient(selectionId: string): { client: CocClient; baseUrl?: string } {
    const remote = parseRemoteCloneKey(selectionId) !== null;
    const route = remote ? resolveCloneRoute(selectionId) : { kind: 'local' as const };
    if (route.kind === 'unresolved-remote') throw new Error('The Settings server is unavailable.');
    const baseUrl = route.kind === 'remote' ? route.baseUrl : undefined;
    const client = new CocClient({
        baseUrl: baseUrl ?? '',
        apiBasePath: baseUrl ? '/api' : getApiBase(),
        fetch: (input, init) => {
            if (remote) {
                const current = resolveCloneRoute(selectionId);
                if (current.kind !== 'remote' || current.baseUrl !== baseUrl) {
                    return Promise.reject(new Error('The Settings server connection changed. Reopen this workspace before saving.'));
                }
            }
            return fetch(input, toLegacyFetchInit(init));
        },
    });
    return { client, baseUrl };
}

export function WorkspaceSettingsApiProvider({ workspaceId, selectionId, children }: {
    workspaceId: string; selectionId: string; children: ReactNode;
}) {
    const subscribe = useCallback((listener: () => void) => subscribeCloneBaseUrl(selectionId, listener), [selectionId]);
    const remote = parseRemoteCloneKey(selectionId) !== null;
    const snapshot = () => {
        const route = remote ? resolveCloneRoute(selectionId) : { kind: 'local' as const };
        return route.kind === 'unresolved-remote' ? null : route.kind === 'remote' ? route.baseUrl : '';
    };
    const endpoint = useSyncExternalStore(subscribe, snapshot, snapshot);
    return <SettingsApiOwner key={selectionId} workspaceId={workspaceId} selectionId={selectionId} endpoint={endpoint}>
        {children}
    </SettingsApiOwner>;
}

function SettingsApiOwner({ workspaceId, selectionId, endpoint, children }: {
    workspaceId: string; selectionId: string; endpoint: string | null; children: ReactNode;
}) {
    const [source, setSource] = useState(() => endpoint === null ? null : createWorkspaceSettingsClient(selectionId));
    useEffect(() => {
        // An unmounted form can bind when its route resolves. A mounted draft
        // keeps its original client, even if a tunnel endpoint changes.
        if (source === null && endpoint !== null) setSource(createWorkspaceSettingsClient(selectionId));
    }, [source, endpoint, selectionId]);
    const owner = useMemo(() => source ? { workspaceId, selectionId, ...source } : null,
        [workspaceId, selectionId, source]);
    if (!owner) return <div role="alert" className="p-3 text-sm">
        The Settings server is unavailable.
    </div>;
    const unavailable = endpoint === null || endpoint !== (source?.baseUrl ?? '');
    return <WorkspaceOwnerContext.Provider value={owner}>
        {unavailable && <div role="alert" className="p-3 text-sm text-red-600 dark:text-red-400">
            The Settings server connection changed. Pending edits stay on their original server. Reopen this workspace before saving.
        </div>}
        {children}
    </WorkspaceOwnerContext.Provider>;
}

export function useWorkspaceSettingsClient(workspaceId: string): CocClient {
    const client = useWorkspaceOwner(workspaceId)?.client;
    return useMemo(() => client ?? getCocClientForWorkspace(workspaceId), [client, workspaceId]);
}

export function useWorkspaceSettingsClientResolver(workspaceId: string): (id: string) => CocClient {
    const client = useWorkspaceOwner(workspaceId)?.client;
    // Linked repo ids are raw ids on this same server, not routing aliases.
    return useCallback((id: string) => client ?? getCocClientForWorkspace(id), [client]);
}

export function useWorkspaceSettingsRequest(workspaceId: string) {
    const client = useWorkspaceOwner(workspaceId)?.client;
    return useCallback(<T,>(path: string, options?: RequestInit): Promise<T> => client
        ? client.request<T>(path, toSpaCocRequestOptions(options)).catch(translateSpaCocClientError)
        : requestForWorkspace<T>(workspaceId, path, options), [client, workspaceId]);
}

export function useWorkspaceSettingsRepos(workspaceId: string, repos: RepoData[] | undefined) {
    const selectionId = useWorkspaceOwner(workspaceId)?.selectionId;
    return useMemo(() => {
        if (!selectionId) return repos;
        const serverId = parseRemoteCloneKey(selectionId)?.serverId;
        return repos?.filter(repo => parseRemoteCloneKey(getRepoSelectionId(repo))?.serverId === serverId);
    }, [selectionId, repos]);
}
