/**
 * useGroupFolders — the `"<type>:<groupId>" -> folderId` map for a workspace,
 * plus the write that files a whole chat group into a folder (AC-01/AC-03).
 *
 * Group membership is stored server-side in a sidecar keyed on the group, not
 * on its children, so this map is a single small fetch rather than something
 * derivable from the process summaries. Like `useChatFolderMembership` it must
 * read through the clone registry: a remote SSH clone's groups only exist on
 * the server that owns the workspace.
 *
 * Read and write live in one hook on purpose — a rollback has to restore the
 * exact folder the group came from, which only this map knows.
 *
 * There are no WebSocket events for folder changes (by decision), so writes are
 * applied optimistically and reconciled by `refresh()`.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { buildGroupFolderMap, getGroupFolderKey } from '../group-folder-key';
import type { ProcessGroupFolderType } from '@plusplusoneplusplus/coc-client';

export interface UseGroupFoldersOptions {
    /** Surfaces failures; the list itself never blanks on an error. */
    onError?: (message: string) => void;
}

export interface UseGroupFoldersResult {
    /** `"<type>:<groupId>" -> folderId`, optimistic overrides layered on the last fetch. */
    groupFolderMap: ReadonlyMap<string, string>;
    /** Re-fetch from the server; a completed fetch reconciles the overrides. */
    refresh: () => void;
    /** Apply an optimistic move (`null` unfiles) ahead of the server round-trip. */
    applyOverride: (type: ProcessGroupFolderType, groupId: string, folderId: string | null) => void;
    /**
     * File a group into `folderId`, or unfile it with `null`. A no-op when the
     * group is already there; rolls the row back to its previous folder if the
     * request fails.
     */
    moveGroupToFolder: (
        type: ProcessGroupFolderType,
        groupId: string,
        folderId: string | null,
    ) => Promise<void>;
}

const EMPTY_MAP: ReadonlyMap<string, string> = new Map();
const EMPTY_OVERRIDES: ReadonlyMap<string, string | null> = new Map();

export function useGroupFolders(
    workspaceId: string | undefined,
    enabled: boolean,
    options: UseGroupFoldersOptions = {},
): UseGroupFoldersResult {
    const { onError } = options;
    const [baseMap, setBaseMap] = useState<ReadonlyMap<string, string>>(EMPTY_MAP);
    // `null` means "optimistically unfiled" — it must mask a base entry, which a
    // plain merged map could not express.
    const [overrides, setOverrides] = useState<ReadonlyMap<string, string | null>>(EMPTY_OVERRIDES);
    const mountedRef = useRef(true);
    // Bumped on every override; a fetch only clears the overrides it can vouch
    // for, so a move landed mid-flight survives the stale response.
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
        const client = getCocClientForWorkspace(workspaceId) as any;
        if (typeof client?.processes?.listGroupFolders !== 'function') {
            setBaseMap(EMPTY_MAP);
            setOverrides(EMPTY_OVERRIDES);
            return;
        }
        const epochAtFetch = overrideEpochRef.current;
        client.processes.listGroupFolders(workspaceId)
            .then((res: { groups?: Record<string, string> }) => {
                if (!mountedRef.current) {return;}
                setBaseMap(buildGroupFolderMap(res?.groups));
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

    const applyOverride = useCallback((
        type: ProcessGroupFolderType,
        groupId: string,
        folderId: string | null,
    ) => {
        if (!groupId) {return;}
        overrideEpochRef.current += 1;
        setOverrides(prev => {
            const next = new Map(prev);
            next.set(getGroupFolderKey(type, groupId), folderId);
            return next;
        });
    }, []);

    const groupFolderMap = useMemo(() => {
        if (overrides.size === 0) {return baseMap;}
        const merged = new Map(baseMap);
        for (const [key, folderId] of overrides) {
            if (folderId === null) {merged.delete(key);} else {merged.set(key, folderId);}
        }
        return merged;
    }, [baseMap, overrides]);

    // Read membership at click time, not render time — a background refresh
    // between opening the menu and picking a folder must not stale the diff.
    const mapRef = useRef(groupFolderMap);
    mapRef.current = groupFolderMap;

    const moveGroupToFolder = useCallback(async (
        type: ProcessGroupFolderType,
        groupId: string,
        folderId: string | null,
    ): Promise<void> => {
        if (!groupId) {return;}
        const previous = mapRef.current.get(getGroupFolderKey(type, groupId)) ?? null;
        if (previous === folderId) {return;}
        const client = getCocClientForWorkspace(workspaceId) as any;
        const api = client?.processes;
        if (typeof api?.setGroupFolder !== 'function' || !workspaceId) {return;}

        applyOverride(type, groupId, folderId);
        try {
            await api.setGroupFolder(workspaceId, type, groupId, folderId);
        } catch {
            applyOverride(type, groupId, previous);
            onError?.(folderId === null ? 'Could not remove from folder' : 'Could not move to folder');
        }
    }, [workspaceId, applyOverride, onError]);

    return { groupFolderMap, refresh, applyOverride, moveGroupToFolder };
}
