import { RalphGrillingStore } from './grilling-state';

/** The actual local (workspace, session) owning a tracked Ralph delegation's execution. */
export interface RalphExecutionOwner {
    workspaceId: string;
    sessionId: string;
}

/**
 * Resolves the durable execution owner for a delegated child that carries a
 * Ralph `sessionId`. An accepted grill can admit the goal under a different
 * local owner (same-server cross-workspace) — the grilling store's `start.execution`
 * pointer, when present, is authoritative over the child's recorded identity.
 * Returns `undefined` when the resolved owner is remote: remote execution keeps
 * the explicit "unavailable" boundary rather than being treated as a local owner.
 *
 * Callers are responsible for skipping child identities with a `serverId`
 * (cross-server origin) before calling this — it only disambiguates same-server
 * cross-workspace execution pointers, not cross-server routing.
 */
export async function resolveRalphExecutionOwner(
    dataDir: string | undefined,
    child: { workspaceId: string; sessionId?: string },
): Promise<RalphExecutionOwner | undefined> {
    if (!child.sessionId) return undefined;
    if (dataDir) {
        const state = await new RalphGrillingStore(dataDir).read(child.workspaceId, child.sessionId);
        if (state?.start?.execution) return state.start.execution.remote ? undefined : state.start.execution;
    }
    return { workspaceId: child.workspaceId, sessionId: child.sessionId };
}
