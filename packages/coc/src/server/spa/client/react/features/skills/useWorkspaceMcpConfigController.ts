/**
 * The single owner of a workspace's MCP *policy* — the enabled-server list and
 * the per-server enabled-tools allow-list.
 *
 * Both fields live behind one REST resource but have separate persistence
 * owners, and three surfaces used to mutate them independently: two parent
 * screens each with their own optimistic server-toggle state, plus the inspector
 * controller, which re-sent an `enabledMcpServers` snapshot captured in a React
 * callback closure every time a tool checkbox changed. A tool save that started
 * after a server toggle could therefore write back the PRE-toggle server list
 * and silently revert the user's configuration — in a multi-repo security
 * boundary, that quietly re-enables a server someone just turned off.
 *
 * This hook removes that class of bug structurally:
 *
 *   - **One owner.** Canonical `enabledMcpServers` / `enabledMcpTools` state and
 *     every write to them live here; callers issue field-specific commands.
 *   - **Partial writes.** A tool command sends only `enabledMcpTools`, so it can
 *     never carry a server-list snapshot at all.
 *   - **Serialized persistence.** Writes run through one promise chain, so no
 *     two policy requests are ever in flight and an older response cannot land
 *     after a newer one.
 *   - **Coalescing + revision guards.** Optimistic state applies immediately and
 *     bumps a revision; a queued flush reads the LATEST local state at send
 *     time, and a failure only rolls back when no newer mutation has happened.
 *   - **Workspace scoping.** A generation token is bumped on every `workspaceId`
 *     change; loads and saves captured under an older generation are dropped
 *     rather than written into the new workspace's state.
 *
 * Every request is routed through the injected `resolveClient`, so a remote
 * clone's writes reach the server that OWNS the repo (the MCP routes read and
 * write the host machine's disk via `ws.rootPath`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CocClient, UpdateWorkspaceMcpConfigRequest } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { normalizeEnabledMcpTools, type EnabledMcpToolsMap } from './mcpToolsAllowList';
import type { McpServerEntry, McpServerSources } from './mcp-server-list-model';

export type WorkspaceMcpClient = Pick<CocClient, 'workspaces'>;
export type WorkspaceMcpClientResolver = (workspaceId: string) => WorkspaceMcpClient;

export interface WorkspaceMcpConfigControllerOptions {
    workspaceId: string;
    /** Resolves the client that owns `workspaceId` (local → default singleton). */
    resolveClient: WorkspaceMcpClientResolver;
}

export interface WorkspaceMcpConfigController {
    loading: boolean;
    error: string | null;
    /** True while a policy write is queued or in flight. */
    saving: boolean;
    availableServers: McpServerEntry[];
    sources: McpServerSources | undefined;
    enabledMcpServers: string[] | null;
    enabledMcpTools: Record<string, string[]> | null;
    isEnabled: (name: string) => boolean;
    /** Field-specific command: patch ONLY the enabled-server list. */
    toggleServer: (serverName: string, checked: boolean) => void;
    /** Field-specific command: patch ONLY the enabled-tools allow-list. */
    saveEnabledMcpTools: (next: EnabledMcpToolsMap) => void;
    refresh: (forceReload?: boolean) => void;
}

interface McpPolicy {
    servers: string[] | null;
    tools: Record<string, string[]> | null;
}

interface DirtyFields {
    servers: boolean;
    tools: boolean;
}

const CLEAN: DirtyFields = { servers: false, tools: false };

export function useWorkspaceMcpConfigController({
    workspaceId,
    resolveClient,
}: WorkspaceMcpConfigControllerOptions): WorkspaceMcpConfigController {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [availableServers, setAvailableServers] = useState<McpServerEntry[]>([]);
    const [sources, setSources] = useState<McpServerSources | undefined>(undefined);
    const [enabledMcpServers, setEnabledMcpServers] = useState<string[] | null>(null);
    const [enabledMcpTools, setEnabledMcpTools] = useState<Record<string, string[]> | null>(null);

    // Generation token — bumped on every workspace change. Async flows capture it
    // at start and drop their result when it no longer matches.
    const genRef = useRef(0);
    // Local optimistic policy, readable synchronously by a queued flush.
    const policyRef = useRef<McpPolicy>({ servers: null, tools: null });
    // Last policy the server is known to hold — the rollback target.
    const committedRef = useRef<McpPolicy>({ servers: null, tools: null });
    // Bumped by every optimistic mutation; guards stale rollbacks and stale loads.
    const revisionRef = useRef(0);
    const serversRef = useRef<McpServerEntry[]>([]);
    const dirtyRef = useRef<DirtyFields>({ ...CLEAN });
    const queuedRef = useRef(false);
    const chainRef = useRef<Promise<void>>(Promise.resolve());
    // Held in a ref so an inline resolver from a parent cannot re-trigger the
    // workspace-reset effect on every render.
    const resolveClientRef = useRef(resolveClient);
    resolveClientRef.current = resolveClient;

    const adoptPolicy = useCallback((next: McpPolicy) => {
        policyRef.current = next;
        committedRef.current = next;
        setEnabledMcpServers(next.servers);
        setEnabledMcpTools(next.tools);
    }, []);

    const load = useCallback((forceReload: boolean) => {
        const gen = genRef.current;
        const revision = revisionRef.current;
        setLoading(true);
        setError(null);
        setSources(undefined);
        resolveClientRef.current(workspaceId).workspaces
            .getMcpConfig(workspaceId, forceReload ? { forceReload: true } : undefined)
            .then((data) => {
                if (genRef.current !== gen) return; // workspace switched mid-flight
                const servers = data.availableServers ?? [];
                serversRef.current = servers as McpServerEntry[];
                setAvailableServers(servers as McpServerEntry[]);
                setSources(data.sources as McpServerSources | undefined);
                // A mutation raced this read: keep the newer optimistic policy and
                // adopt only the server catalog, which no local command owns.
                if (revisionRef.current !== revision) return;
                adoptPolicy({
                    servers: data.enabledMcpServers ?? null,
                    tools: data.enabledMcpTools ?? null,
                });
            })
            .catch((e: unknown) => {
                if (genRef.current !== gen) return;
                setError(getSpaCocClientErrorMessage(e, 'Failed to load MCP config'));
            })
            .finally(() => {
                if (genRef.current !== gen) return;
                setLoading(false);
            });
    }, [workspaceId, adoptPolicy]);

    // On workspace change (and mount): discard all scoped state, reset the write
    // queue, then load the new workspace's policy.
    useEffect(() => {
        genRef.current += 1;
        revisionRef.current = 0;
        dirtyRef.current = { ...CLEAN };
        queuedRef.current = false;
        chainRef.current = Promise.resolve();
        policyRef.current = { servers: null, tools: null };
        committedRef.current = { servers: null, tools: null };
        serversRef.current = [];
        setAvailableServers([]);
        setEnabledMcpServers(null);
        setEnabledMcpTools(null);
        setSaving(false);
        load(false);
    }, [load]);

    /**
     * Queue a persistence flush for the currently dirty fields. Only one flush is
     * ever queued: a second command before the queued one runs simply marks its
     * field dirty and is picked up by the same flush, which reads the latest
     * local policy. Writes are chained, so requests never overlap.
     */
    const schedule = useCallback(() => {
        if (queuedRef.current) return; // coalesced into the already-queued flush
        queuedRef.current = true;
        setSaving(true);
        const gen = genRef.current;
        chainRef.current = chainRef.current.then(async () => {
            queuedRef.current = false;
            const fields = dirtyRef.current;
            dirtyRef.current = { ...CLEAN };
            // A flush left over from the previous workspace, or with nothing to
            // write, still has to release `saving`.
            if (genRef.current !== gen || (!fields.servers && !fields.tools)) {
                if (genRef.current === gen && !queuedRef.current) setSaving(false);
                return;
            }

            const request: UpdateWorkspaceMcpConfigRequest = {};
            if (fields.servers) request.enabledMcpServers = policyRef.current.servers;
            if (fields.tools) request.enabledMcpTools = policyRef.current.tools;
            const sent: McpPolicy = { ...policyRef.current };
            const sentRevision = revisionRef.current;

            try {
                const result = await resolveClientRef.current(workspaceId).workspaces.updateMcpConfig(workspaceId, request);
                if (genRef.current !== gen) return;
                // Commit what we sent; a newer local mutation stays authoritative.
                committedRef.current = {
                    servers: fields.servers ? sent.servers : committedRef.current.servers,
                    tools: fields.tools ? sent.tools : committedRef.current.tools,
                };
                if (revisionRef.current !== sentRevision || !result) return;
                // Adopt the canonical post-write policy when nothing newer is pending.
                const next: McpPolicy = { ...policyRef.current };
                if (Object.prototype.hasOwnProperty.call(result, 'enabledMcpServers')) {
                    next.servers = result.enabledMcpServers ?? null;
                }
                if (Object.prototype.hasOwnProperty.call(result, 'enabledMcpTools')) {
                    next.tools = result.enabledMcpTools ?? null;
                }
                adoptPolicy(next);
            } catch (e) {
                if (genRef.current !== gen) return;
                setError(getSpaCocClientErrorMessage(e, 'Failed to save'));
                // A newer mutation already superseded this write — rolling back
                // here would clobber state the user just asked for.
                if (revisionRef.current !== sentRevision) return;
                adoptPolicy({ ...committedRef.current });
            } finally {
                if (genRef.current === gen && !queuedRef.current) setSaving(false);
            }
        });
    }, [workspaceId, adoptPolicy]);

    const mutate = useCallback((patch: Partial<McpPolicy>) => {
        const next: McpPolicy = { ...policyRef.current, ...patch };
        policyRef.current = next;
        revisionRef.current += 1;
        if (Object.prototype.hasOwnProperty.call(patch, 'servers')) {
            dirtyRef.current.servers = true;
            setEnabledMcpServers(next.servers);
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'tools')) {
            dirtyRef.current.tools = true;
            setEnabledMcpTools(next.tools);
        }
        schedule();
    }, [schedule]);

    const toggleServer = useCallback((serverName: string, checked: boolean) => {
        const allNames = serversRef.current.map(s => s.name);
        const currentList = policyRef.current.servers ?? allNames;
        const nextList = checked
            ? [...new Set([...currentList, serverName])]
            : currentList.filter(n => n !== serverName);
        // "Every server enabled" is stored as `null` so newly added servers
        // default to enabled.
        mutate({ servers: nextList.length === allNames.length ? null : nextList });
    }, [mutate]);

    const saveEnabledMcpTools = useCallback((next: EnabledMcpToolsMap) => {
        mutate({ tools: normalizeEnabledMcpTools(next) });
    }, [mutate]);

    const isEnabled = useCallback(
        (name: string) => enabledMcpServers === null || enabledMcpServers.includes(name),
        [enabledMcpServers],
    );

    const refresh = useCallback((forceReload = false) => { load(forceReload); }, [load]);

    return {
        loading,
        error,
        saving,
        availableServers,
        sources,
        enabledMcpServers,
        enabledMcpTools,
        isEnabled,
        toggleServer,
        saveEnabledMcpTools,
        refresh,
    };
}
