/**
 * Workspace-scoped controller for the MCP servers panel.
 *
 * `McpServersPanel` is reused across workspace-scoped repo surfaces, so every
 * cache (detail, discovery, allow-list, OAuth flow) and the expanded-row / tab
 * UI state must belong to exactly one workspace. This hook owns all of that
 * state and, on a `workspaceId` change, discards it and re-discovers tools for
 * the new workspace.
 *
 * A monotonically-increasing generation token guards each async flow: a slow
 * discovery, detail read, allow-list save, or OAuth poll that resolves after
 * the workspace switched is dropped rather than written into the fresh state.
 * This keeps same-named servers in different repos from ever sharing detail,
 * tool counts, allow-list toggles, or OAuth results.
 *
 * Every request is routed to the server that OWNS the workspace: the MCP routes
 * read/write the host machine's disk via `ws.rootPath`, so a remote clone's calls
 * must go to its own CoC server rather than the local one. A local workspace
 * resolves to the same default client, so local behavior is unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { getCocClientForWorkspace, cloneApiBase } from '../../repos/cloneRegistry';
import type {
    McpServerDetail as ClientMcpServerDetail,
    McpConfigScope,
    McpServerToolsResult,
    McpServerCreateRequest,
    McpServerUpdateRequest,
} from '@plusplusoneplusplus/coc-client';
import {
    applyMcpToolToggle,
    enableAllMcpTools,
    disableAllMcpTools,
    type EnabledMcpToolsMap,
} from './mcpToolsAllowList';
import { McpOAuthFlowController } from './mcpOAuthFlowController';
import type { DiscoveryState, InspectorTab, McpAuthFlowState } from './mcp-server-list-model';

export interface McpInspectorControllerOptions {
    /**
     * Canonical per-repo enabled-tools allow-list (server → enabled tool names),
     * owned by `useWorkspaceMcpConfigController`. This controller renders and
     * optimistically edits it but does not persist it.
     */
    enabledMcpTools?: Record<string, string[]> | null;
    /**
     * Field-specific tool command from the policy owner. It patches ONLY
     * `enabledMcpTools`, so a tool save can never carry — and therefore never
     * revert — a stale `enabledMcpServers` snapshot. Rollback on failure belongs
     * to the owner and arrives back through `enabledMcpTools`.
     */
    onSaveTools?: (next: EnabledMcpToolsMap) => void;
    /** Whether the policy owner has a write queued or in flight. */
    toolsSaving?: boolean;
    /** Called after an OAuth flow completes or a mutation lands. */
    onRefresh?: () => void;
    /** Called after a server is added or deleted so the parent can refresh. */
    onMutate?: () => void;
}

export interface McpInspectorController {
    // Inspector UI state
    expandedServer: string | null;
    inspectorTab: InspectorTab;
    setInspectorTab: (tab: InspectorTab) => void;
    toggleExpand: (name: string) => void;

    // Detail cache
    getDetail: (name: string) => ClientMcpServerDetail | null | 'loading';

    // Live tool discovery
    discovery: Record<string, McpServerToolsResult>;
    discoveryState: DiscoveryState;
    discoveryError: string | null;
    refetchTools: (forceReload?: boolean) => void;

    // Per-tool allow-list
    toolsAllowList: EnabledMcpToolsMap;
    toolsSaving: boolean;
    toggleTool: (serverName: string, toolName: string, on: boolean) => void;
    enableAllTools: (serverName: string) => void;
    disableAllTools: (serverName: string) => void;

    // OAuth flow
    authFlow: Record<string, McpAuthFlowState>;
    authenticate: (serverName: string, force?: boolean) => void;

    // Config mutations (preserve the existing REST payloads)
    updateServer: (serverName: string, request: McpServerUpdateRequest) => Promise<void>;
    migrateServer: (serverName: string, targetScope: McpConfigScope) => Promise<void>;
    deleteServer: (serverName: string) => Promise<void>;
    addServer: (request: McpServerCreateRequest) => Promise<void>;
}

type DetailCache = Record<string, ClientMcpServerDetail | null | 'loading'>;

export function useMcpServerInspectorController(
    workspaceId: string,
    options: McpInspectorControllerOptions,
): McpInspectorController {
    const { enabledMcpTools, onSaveTools, toolsSaving = false, onRefresh, onMutate } = options;

    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
    const [detailCache, setDetailCache] = useState<DetailCache>({});

    const [discovery, setDiscovery] = useState<Record<string, McpServerToolsResult>>({});
    const [discoveryState, setDiscoveryState] = useState<DiscoveryState>('idle');
    const [discoveryError, setDiscoveryError] = useState<string | null>(null);

    const [toolsAllowList, setToolsAllowList] = useState<EnabledMcpToolsMap>(() => ({ ...(enabledMcpTools ?? {}) }));

    const [authFlow, setAuthFlow] = useState<Record<string, McpAuthFlowState>>({});

    // Generation token — bumped on every workspace change. Async flows capture
    // it at start and drop their result when it no longer matches.
    const genRef = useRef(0);
    const oauthRef = useRef<McpOAuthFlowController | null>(null);
    if (oauthRef.current === null) oauthRef.current = new McpOAuthFlowController();

    // ── Live tool discovery ──────────────────────────────────────────────────
    const fetchTools = useCallback(async (forceReload = false) => {
        if (!workspaceId) return;
        const gen = genRef.current;
        setDiscoveryState('loading');
        setDiscoveryError(null);
        try {
            const resp = await getCocClientForWorkspace(workspaceId).workspaces.discoverMcpTools(
                workspaceId,
                forceReload ? { forceReload: true } : undefined,
            );
            if (genRef.current !== gen) return; // workspace switched mid-flight
            setDiscovery(resp.servers ?? {});
            setDiscoveryState('loaded');
        } catch (e) {
            if (genRef.current !== gen) return;
            setDiscoveryError(getSpaCocClientErrorMessage(e, 'Failed to discover tools'));
            setDiscoveryState('error');
        }
    }, [workspaceId]);

    // On workspace change (and mount): discard all scoped state, stop pollers,
    // then eagerly re-discover for the new workspace.
    useEffect(() => {
        genRef.current += 1;
        oauthRef.current?.stopAll();
        setDetailCache({});
        setDiscovery({});
        setDiscoveryState('idle');
        setDiscoveryError(null);
        setAuthFlow({});
        setExpandedServer(null);
        setInspectorTab('overview');
        void fetchTools();
    }, [workspaceId, fetchTools]);

    // Keep the local allow-list in sync with the parent config (and reset it on
    // workspace change, which also changes `enabledMcpTools`).
    useEffect(() => {
        setToolsAllowList({ ...(enabledMcpTools ?? {}) });
    }, [workspaceId, enabledMcpTools]);

    // Tear down pollers on unmount.
    useEffect(() => () => { oauthRef.current?.stopAll(); }, []);

    // Apply locally for an immediate render, then hand the write to the policy
    // owner. The owner serializes it, sends only `enabledMcpTools`, and pushes
    // the canonical (or rolled-back) map back through `enabledMcpTools`.
    const applyToolsAllowList = useCallback((nextMap: EnabledMcpToolsMap) => {
        if (!workspaceId) return;
        setToolsAllowList(nextMap);
        onSaveTools?.(nextMap);
    }, [workspaceId, onSaveTools]);

    const discoveredToolNames = useCallback((serverName: string): string[] => {
        const r = discovery[serverName];
        return r && r.status === 'ok' ? r.tools.map(t => t.name) : [];
    }, [discovery]);

    const toggleTool = useCallback((serverName: string, toolName: string, on: boolean) => {
        applyToolsAllowList(
            applyMcpToolToggle(toolsAllowList, serverName, discoveredToolNames(serverName), toolName, on),
        );
    }, [applyToolsAllowList, toolsAllowList, discoveredToolNames]);

    const enableAllTools = useCallback((serverName: string) => {
        applyToolsAllowList(enableAllMcpTools(toolsAllowList, serverName));
    }, [applyToolsAllowList, toolsAllowList]);

    const disableAllTools = useCallback((serverName: string) => {
        applyToolsAllowList(disableAllMcpTools(toolsAllowList, serverName));
    }, [applyToolsAllowList, toolsAllowList]);

    // ── Detail cache ─────────────────────────────────────────────────────────
    const fetchDetail = useCallback(async (name: string) => {
        if (!workspaceId || detailCache[name] !== undefined) return; // already loading/cached
        const gen = genRef.current;
        setDetailCache(prev => ({ ...prev, [name]: 'loading' }));
        try {
            const detail = await getCocClientForWorkspace(workspaceId).workspaces.getMcpServerDetail(workspaceId, name);
            if (genRef.current !== gen) return; // workspace switched mid-flight
            setDetailCache(prev => ({ ...prev, [name]: detail }));
        } catch {
            if (genRef.current !== gen) return;
            setDetailCache(prev => ({ ...prev, [name]: null }));
        }
    }, [workspaceId, detailCache]);

    const getDetail = useCallback(
        (name: string): ClientMcpServerDetail | null | 'loading' => detailCache[name] ?? null,
        [detailCache],
    );

    const invalidateDetail = useCallback((serverName: string) => {
        setDetailCache(prev => {
            if (!(serverName in prev)) return prev;
            const next = { ...prev };
            delete next[serverName];
            return next;
        });
    }, []);

    const toggleExpand = useCallback((name: string) => {
        if (expandedServer === name) {
            setExpandedServer(null);
        } else {
            setExpandedServer(name);
            setInspectorTab('overview');
            void fetchDetail(name);
        }
    }, [expandedServer, fetchDetail]);

    const handleServerDeleted = useCallback(() => {
        setExpandedServer(null);
        onMutate?.();
        onRefresh?.();
    }, [onMutate, onRefresh]);

    // ── OAuth flow ───────────────────────────────────────────────────────────
    const setFlow = useCallback((serverName: string, next: McpAuthFlowState | null) => {
        setAuthFlow(prev => {
            if (next === null) {
                if (!(serverName in prev)) return prev;
                const copy = { ...prev };
                delete copy[serverName];
                return copy;
            }
            return { ...prev, [serverName]: next };
        });
    }, []);

    const authenticate = useCallback(async (serverName: string, force = false) => {
        const gen = genRef.current;
        const startedWs = workspaceId;
        setFlow(serverName, { phase: 'starting' });
        try {
            // `mcp-oauth` is not workspace-guarded, so a remote id would not 404 —
            // it would silently resolve to no workspace root and stash the token in
            // the LOCAL credential store. Target the clone that owns the repo.
            const r = await fetch(`${cloneApiBase(startedWs)}/mcp-oauth/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverName, workspaceId: startedWs || undefined, force }),
            });
            if (!r.ok) {
                const text = await r.text().catch(() => '');
                throw new Error(text || `Failed to start OAuth flow (${r.status})`);
            }
            const result = await r.json() as {
                requestId?: string;
                authorizationUrl?: string;
                alreadyAuthenticated?: boolean;
            };
            if (genRef.current !== gen) return; // workspace switched during start

            if (result.alreadyAuthenticated) {
                setFlow(serverName, { phase: 'completed', requestId: '' });
                onRefresh?.();
                return;
            }
            if (!result.requestId) {
                throw new Error('Server did not return a request id');
            }

            if (result.authorizationUrl) {
                window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer');
            }
            const requestId = result.requestId;
            setFlow(serverName, {
                phase: 'authorizing',
                requestId,
                authorizationUrl: result.authorizationUrl,
            });
            oauthRef.current?.startPolling(
                {
                    key: serverName,
                    requestId,
                    apiBase: cloneApiBase(startedWs),
                    isStale: () => genRef.current !== gen,
                },
                {
                    onCompleted: () => {
                        setFlow(serverName, { phase: 'completed', requestId });
                        onRefresh?.();
                    },
                    onFailed: (error) => {
                        setFlow(serverName, { phase: 'failed', requestId, error });
                    },
                },
            );
        } catch (err) {
            if (genRef.current !== gen) return;
            setFlow(serverName, {
                phase: 'failed',
                requestId: '',
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }, [workspaceId, onRefresh, setFlow]);

    // ── Config mutations ─────────────────────────────────────────────────────
    const updateServer = useCallback(async (serverName: string, request: McpServerUpdateRequest) => {
        if (!workspaceId) return;
        await getCocClientForWorkspace(workspaceId).workspaces.updateMcpServer(workspaceId, serverName, request);
        invalidateDetail(serverName);
    }, [workspaceId, invalidateDetail]);

    const migrateServer = useCallback(async (serverName: string, targetScope: McpConfigScope) => {
        if (!workspaceId) return;
        await getCocClientForWorkspace(workspaceId).workspaces.migrateMcpServer(workspaceId, serverName, targetScope);
        invalidateDetail(serverName);
    }, [workspaceId, invalidateDetail]);

    const deleteServer = useCallback(async (serverName: string) => {
        if (!workspaceId) return;
        await getCocClientForWorkspace(workspaceId).workspaces.deleteMcpServer(workspaceId, serverName);
        handleServerDeleted();
    }, [workspaceId, handleServerDeleted]);

    const addServer = useCallback(async (request: McpServerCreateRequest) => {
        if (!workspaceId) return;
        await getCocClientForWorkspace(workspaceId).workspaces.addMcpServer(workspaceId, request);
        onMutate?.();
        onRefresh?.();
    }, [workspaceId, onMutate, onRefresh]);

    return {
        expandedServer,
        inspectorTab,
        setInspectorTab,
        toggleExpand,
        getDetail,
        discovery,
        discoveryState,
        discoveryError,
        refetchTools: (forceReload = false) => { void fetchTools(forceReload); },
        toolsAllowList,
        toolsSaving,
        toggleTool,
        enableAllTools,
        disableAllTools,
        authFlow,
        authenticate: (serverName: string, force = false) => { void authenticate(serverName, force); },
        updateServer,
        migrateServer,
        deleteServer,
        addServer,
    };
}
