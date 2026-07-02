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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { getApiBase } from '../../utils/config';
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
    normalizeEnabledMcpTools,
    type EnabledMcpToolsMap,
} from './mcpToolsAllowList';
import { McpOAuthFlowController } from './mcpOAuthFlowController';
import type { DiscoveryState, InspectorTab, McpAuthFlowState } from './mcp-server-list-model';

export interface McpInspectorControllerOptions {
    /**
     * Raw enabled-server allow-list. Sent alongside per-tool toggles through the
     * same `PUT /mcp-config` call so tool saves never clobber the server list.
     */
    enabledMcpServers?: string[] | null;
    /** Per-repo enabled-tools allow-list (server → enabled tool names). */
    enabledMcpTools?: Record<string, string[]> | null;
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
    authenticate: (serverName: string) => void;

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
    const { enabledMcpServers, enabledMcpTools, onRefresh, onMutate } = options;

    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
    const [detailCache, setDetailCache] = useState<DetailCache>({});

    const [discovery, setDiscovery] = useState<Record<string, McpServerToolsResult>>({});
    const [discoveryState, setDiscoveryState] = useState<DiscoveryState>('idle');
    const [discoveryError, setDiscoveryError] = useState<string | null>(null);

    const [toolsAllowList, setToolsAllowList] = useState<EnabledMcpToolsMap>(() => ({ ...(enabledMcpTools ?? {}) }));
    const [toolsSaving, setToolsSaving] = useState(false);

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
            const resp = await getSpaCocClient().workspaces.discoverMcpTools(
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
        setToolsSaving(false);
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

    const persistToolsAllowList = useCallback(async (nextMap: EnabledMcpToolsMap) => {
        if (!workspaceId) return;
        const gen = genRef.current;
        let prev: EnabledMcpToolsMap = {};
        setToolsAllowList(curr => { prev = curr; return nextMap; }); // optimistic
        setToolsSaving(true);
        try {
            await getSpaCocClient().workspaces.updateMcpConfig(workspaceId, {
                enabledMcpServers: enabledMcpServers ?? null,
                enabledMcpTools: normalizeEnabledMcpTools(nextMap),
            });
        } catch (e) {
            if (genRef.current === gen) {
                setToolsAllowList(prev); // revert only within the same workspace
                setDiscoveryError(getSpaCocClientErrorMessage(e, 'Failed to save tool settings'));
            }
        } finally {
            setToolsSaving(false);
        }
    }, [workspaceId, enabledMcpServers]);

    const discoveredToolNames = useCallback((serverName: string): string[] => {
        const r = discovery[serverName];
        return r && r.status === 'ok' ? r.tools.map(t => t.name) : [];
    }, [discovery]);

    const toggleTool = useCallback((serverName: string, toolName: string, on: boolean) => {
        void persistToolsAllowList(
            applyMcpToolToggle(toolsAllowList, serverName, discoveredToolNames(serverName), toolName, on),
        );
    }, [persistToolsAllowList, toolsAllowList, discoveredToolNames]);

    const enableAllTools = useCallback((serverName: string) => {
        void persistToolsAllowList(enableAllMcpTools(toolsAllowList, serverName));
    }, [persistToolsAllowList, toolsAllowList]);

    const disableAllTools = useCallback((serverName: string) => {
        void persistToolsAllowList(disableAllMcpTools(toolsAllowList, serverName));
    }, [persistToolsAllowList, toolsAllowList]);

    // ── Detail cache ─────────────────────────────────────────────────────────
    const fetchDetail = useCallback(async (name: string) => {
        if (!workspaceId || detailCache[name] !== undefined) return; // already loading/cached
        const gen = genRef.current;
        setDetailCache(prev => ({ ...prev, [name]: 'loading' }));
        try {
            const detail = await getSpaCocClient().workspaces.getMcpServerDetail(workspaceId, name);
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

    const authenticate = useCallback(async (serverName: string) => {
        const gen = genRef.current;
        const startedWs = workspaceId;
        setFlow(serverName, { phase: 'starting' });
        try {
            const r = await fetch(`${getApiBase()}/mcp-oauth/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverName, workspaceId: startedWs || undefined }),
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
                    apiBase: getApiBase(),
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
        await getSpaCocClient().workspaces.updateMcpServer(workspaceId, serverName, request);
        invalidateDetail(serverName);
    }, [workspaceId, invalidateDetail]);

    const migrateServer = useCallback(async (serverName: string, targetScope: McpConfigScope) => {
        if (!workspaceId) return;
        await getSpaCocClient().workspaces.migrateMcpServer(workspaceId, serverName, targetScope);
        invalidateDetail(serverName);
    }, [workspaceId, invalidateDetail]);

    const deleteServer = useCallback(async (serverName: string) => {
        if (!workspaceId) return;
        await getSpaCocClient().workspaces.deleteMcpServer(workspaceId, serverName);
        handleServerDeleted();
    }, [workspaceId, handleServerDeleted]);

    const addServer = useCallback(async (request: McpServerCreateRequest) => {
        if (!workspaceId) return;
        await getSpaCocClient().workspaces.addMcpServer(workspaceId, request);
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
        authenticate: (serverName: string) => { void authenticate(serverName); },
        updateServer,
        migrateServer,
        deleteServer,
        addServer,
    };
}
