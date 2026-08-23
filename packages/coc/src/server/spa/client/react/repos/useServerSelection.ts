/**
 * useServerSelection — the "Server" dropdown state shared by the add-repository
 * dialogs (`AddRepoDialog`, `AddFolderDialog`).
 *
 * A dialog can target the dashboard's own registry ("Local") or any ONLINE
 * remote CoC server. The option list is the same one repo groups use
 * (`listRepoGroupServerOptions`) so there is a single source of truth for what
 * "a server you can add repos to" means; a failing `/api/servers` degrades to
 * Local-only rather than blocking the dialog.
 *
 * The selected option's `baseUrl` is the routing key: `undefined` for Local
 * (page origin), the remote's `effectiveUrl` otherwise. It is passed straight
 * to `browseWorkspaceFolders` / `discoverWorkspaces` / `registerWorkspace`, so
 * browsing, scanning, and registering all happen on the selected box's own
 * filesystem and registry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    listRepoGroupServerOptions,
    LOCAL_REPO_GROUP_SERVER,
    LOCAL_REPO_GROUP_SERVER_ID,
    type RepoGroupServerOption,
} from './repoGroupService';

export interface ServerSelection {
    /** Options to render in the dropdown, in display order. */
    choices: RepoGroupServerOption[];
    /** Currently selected server id (`local` or a remote registry id). */
    serverId: string;
    /** The selected option — `baseUrl` is absent for Local. */
    selected: RepoGroupServerOption;
    /** Look up any option by id; unknown ids resolve to Local. */
    resolveServer: (serverId: string) => RepoGroupServerOption;
    /** Select a server. Callers reset their own server-scoped state. */
    selectServer: (serverId: string) => void;
}

/**
 * @param open           dialog visibility — the list is refetched per open so a
 *                       server that went offline meanwhile is not offered.
 * @param preferredServerId  server to pre-select (e.g. the remote the picker was
 *                       opened from); falsy means Local.
 * @param preferredBaseUrl   that server's base URL, used until the fetched list
 *                       arrives and if the server is missing from it.
 */
export function useServerSelection(
    open: boolean,
    preferredServerId?: string,
    preferredBaseUrl?: string,
): ServerSelection {
    const [servers, setServers] = useState<RepoGroupServerOption[]>([LOCAL_REPO_GROUP_SERVER]);
    const [serverId, setServerId] = useState<string>(preferredServerId || LOCAL_REPO_GROUP_SERVER_ID);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        listRepoGroupServerOptions()
            .then(options => { if (!cancelled) setServers(options); })
            .catch(() => { if (!cancelled) setServers([LOCAL_REPO_GROUP_SERVER]); });
        return () => { cancelled = true; };
    }, [open]);

    // Every open re-pins the dropdown to the launching context's server, so a
    // dialog reopened from a different remote never inherits the last pick.
    useEffect(() => {
        if (!open) return;
        setServerId(preferredServerId || LOCAL_REPO_GROUP_SERVER_ID);
    }, [open, preferredServerId]);

    // The preferred server may be missing from the fetched list (still loading,
    // or it went offline). Offer it anyway rather than silently falling back to
    // Local, which would register the repo on the wrong box.
    const choices = useMemo<RepoGroupServerOption[]>(() => {
        if (!preferredServerId || preferredServerId === LOCAL_REPO_GROUP_SERVER_ID) return servers;
        if (servers.some(s => s.id === preferredServerId)) return servers;
        return [...servers, { id: preferredServerId, label: preferredServerId, baseUrl: preferredBaseUrl }];
    }, [servers, preferredServerId, preferredBaseUrl]);

    const resolveServer = useCallback(
        (id: string) => choices.find(s => s.id === id) ?? LOCAL_REPO_GROUP_SERVER,
        [choices],
    );

    return {
        choices,
        serverId,
        selected: resolveServer(serverId),
        resolveServer,
        selectServer: setServerId,
    };
}

/**
 * Name the server in a failure message when it is a remote one, so a remote
 * failure is never read as a local one. Local messages stay verbatim.
 */
export function describeServerFailure(message: string, server: RepoGroupServerOption): string {
    return server.baseUrl ? `${message} on ${server.label}` : message;
}
