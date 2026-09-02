/**
 * useChatFolderMembership — the `processId -> folderId` map for a workspace.
 *
 * Membership must be read from the server that owns the workspace, exactly like
 * the folder list in `useChatFolders`: a remote SSH clone's processes never
 * enter the page-origin summaries index, so deriving the map from
 * `AppContext.state.processes` leaves remote folders permanently empty. This
 * hook fetches `processes.summaries({ workspace })` through the clone registry
 * instead — a local id resolves to the default client, so the local path keeps
 * its existing origin.
 *
 * There are no WebSocket events for folder changes (by decision), so writes are
 * applied optimistically via `applyOverride` and reconciled by `refresh()`.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { buildFolderIdByProcess } from '../chat-folder-tree';

/**
 * Matches the page-load summaries fetch in `ReposContext`, which caps at 5000
 * across every workspace — scoped to one workspace this is strictly more
 * headroom than the map had before.
 */
const SUMMARY_LIMIT = 5000;

export interface UseChatFolderMembershipResult {
    /** `processId -> folderId`, optimistic overrides layered on the last fetch. */
    folderIdByProcess: ReadonlyMap<string, string>;
    /** Re-fetch from the server; a completed fetch reconciles the overrides. */
    refresh: () => void;
    /** Apply an optimistic move (`null` unfiles) ahead of the server round-trip. */
    applyOverride: (processIds: string[], folderId: string | null) => void;
}

const EMPTY_MAP: ReadonlyMap<string, string> = new Map();
const EMPTY_OVERRIDES: ReadonlyMap<string, string | null> = new Map();

export function useChatFolderMembership(workspaceId: string | undefined, enabled: boolean): UseChatFolderMembershipResult {
    const [baseMap, setBaseMap] = useState<ReadonlyMap<string, string>>(EMPTY_MAP);
    // `null` means "optimistically unfiled" — it must mask a base entry, which a
    // plain merged map could not express.
    const [overrides, setOverrides] = useState<ReadonlyMap<string, string | null>>(EMPTY_OVERRIDES);
    const mountedRef = useRef(true);
    // Bumped on every override; a fetch only clears the overrides it can vouch
    // for, so a drop landed mid-flight survives the stale response.
    const overrideEpochRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = useCallback(() => {
        if (!enabled || !workspaceId) {
            setBaseMap(EMPTY_MAP);
            setOverrides(EMPTY_OVERRIDES);
            return;
        }
        // Membership lives on the server that owns the workspace; a remote
        // clone's process ids do not exist on the page-origin server.
        const client = getCocClientForWorkspace(workspaceId) as any;
        if (typeof client?.processes?.summaries !== 'function') {
            setBaseMap(EMPTY_MAP);
            setOverrides(EMPTY_OVERRIDES);
            return;
        }
        const epochAtFetch = overrideEpochRef.current;
        client.processes.summaries({ workspace: workspaceId, limit: SUMMARY_LIMIT })
            .then((res: { summaries?: unknown[] }) => {
                if (!mountedRef.current) {return;}
                setBaseMap(buildFolderIdByProcess(res?.summaries as any[]));
                // Overrides written while this fetch was in flight are not in
                // the response yet; keep them layered until their own refresh.
                if (overrideEpochRef.current === epochAtFetch) {
                    setOverrides(EMPTY_OVERRIDES);
                }
            })
            .catch(() => {
                // A failed fetch must never blank the map; keep whatever we
                // last had and let the next refresh reconcile.
            });
    }, [enabled, workspaceId]);

    useEffect(() => { refresh(); }, [refresh]);

    const applyOverride = useCallback((processIds: string[], folderId: string | null) => {
        if (processIds.length === 0) {return;}
        overrideEpochRef.current += 1;
        setOverrides(prev => {
            const next = new Map(prev);
            for (const id of processIds) {next.set(id, folderId);}
            return next;
        });
    }, []);

    const folderIdByProcess = useMemo(() => {
        if (overrides.size === 0) {return baseMap;}
        const merged = new Map(baseMap);
        for (const [id, folderId] of overrides) {
            if (folderId === null) {merged.delete(id);} else {merged.set(id, folderId);}
        }
        return merged;
    }, [baseMap, overrides]);

    return { folderIdByProcess, refresh, applyOverride };
}
