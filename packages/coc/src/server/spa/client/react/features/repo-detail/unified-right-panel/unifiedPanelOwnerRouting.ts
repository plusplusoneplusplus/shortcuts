import { buildRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';

/**
 * Resolve a resource owner against the concrete server that owns the panel.
 * Repo-group members use plain workspace ids on that server, so a remote panel
 * route contributes its server id while a local panel explicitly stays local.
 */
export function routingRefForPanelOwner(
    panelRoutingRef: string | null | undefined,
    ownerWorkspaceId: string,
): string | null | undefined {
    if (panelRoutingRef === null) return null;
    const remote = parseRemoteCloneKey(panelRoutingRef);
    if (remote) return buildRemoteCloneKey(remote.serverId, ownerWorkspaceId);
    return undefined;
}
