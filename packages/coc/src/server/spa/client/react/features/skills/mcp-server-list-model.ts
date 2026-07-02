/**
 * Pure read model for the MCP servers panel.
 *
 * All list-level derivation — status dots, source pills, descriptions, per-row
 * tool-count labels, the filter/search predicate, and the toolbar counts — lives
 * here as framework-free functions so it can be unit-tested without rendering
 * the panel. `buildMcpServerListModel` assembles the whole view model in one
 * call from the raw config plus the controller's async caches.
 *
 * These helpers only ever read list-level fields (`McpServerEntry`). Detail-only
 * metadata (env key names, raw JSON, args) is deliberately kept out so the list
 * read model can never depend on the secrets-exposing detail response.
 */

import type {
    McpServerAuthStatus,
    McpServerToolsResult,
} from '@plusplusoneplusplus/coc-client';
import { isMcpToolEnabled, type EnabledMcpToolsMap } from './mcpToolsAllowList';

export type DiscoveryState = 'idle' | 'loading' | 'loaded' | 'error';

export type McpServerSource = 'global' | 'workspace';

export type McpServerEntry = {
    name: string;
    type: string;
    url?: string;
    command?: string;
    source?: McpServerSource;
    effective?: boolean;
    overriddenBy?: McpServerSource;
    /** Derived status from the server response. */
    status?: 'ok' | 'auth' | 'off' | 'err';
    /** Auth state for remote servers (absent on stdio). */
    authStatus?: McpServerAuthStatus;
    /** Token expiry (epoch seconds), when known. */
    authExpiresAt?: number;
    /** User-provided description from config file. */
    description?: string;
};

export type McpServerSourceSection = {
    configPath: string;
    fileExists: boolean;
    success: boolean;
    error?: string;
    servers: McpServerEntry[];
};

export type McpServerSources = {
    global: McpServerSourceSection;
    workspace: McpServerSourceSection;
};

export type FilterTab = 'all' | 'active' | 'auth' | 'disabled';

export type InspectorTab = 'overview' | 'tools' | 'configuration' | 'source' | 'activity';

export type ServerStatus = 'ok' | 'auth' | 'off' | 'err';

/**
 * Local state for a server's OAuth flow. `starting` → `authorizing` → `completed`
 * (or `failed`). Stored only in the panel — server-side state lives in the
 * McpOauthManager and is fetched via `/api/mcp-oauth/pending/:id`.
 */
export type McpAuthFlowState =
    | { phase: 'starting' }
    | { phase: 'authorizing'; requestId: string; authorizationUrl?: string }
    | { phase: 'completed'; requestId: string }
    | { phase: 'failed'; requestId: string; error: string };

/**
 * Resolve the dot color for a row.
 *
 * Trust the server-derived `status` field when present — it already accounts
 * for cached OAuth tokens. The legacy fallback (treat any HTTP/SSE server as
 * "auth") is kept for older responses that pre-date authStatus.
 */
export function getServerStatus(server: McpServerEntry, isEnabled: boolean): ServerStatus {
    if (!isEnabled) return 'off';
    if (server.status) return server.status;
    if (server.type === 'http' || server.type === 'sse') return 'auth';
    return 'ok';
}

export function needsAuth(server: McpServerEntry): boolean {
    if (server.type !== 'http' && server.type !== 'sse') return false;
    if (!server.authStatus) return true; // legacy response — assume needs auth
    return server.authStatus === 'required' || server.authStatus === 'expired';
}

export function isRemote(server: McpServerEntry): boolean {
    return server.type === 'http' || server.type === 'sse';
}

export function getServerDescription(server: McpServerEntry, isEnabled: boolean): string {
    const base = server.description || server.url || server.command || '';
    if (!isEnabled) return `Disabled · ${base.toLowerCase()}`;
    return base;
}

export function getTransportPillClass(type: string): string {
    if (type === 'stdio') return 'accent';
    if (type === 'http' || type === 'sse') return 'done';
    return '';
}

export function getSourcePillInfo(server: McpServerEntry): { label: string; cls: string } {
    if (server.overriddenBy === 'workspace' || server.source === 'workspace') {
        return server.overriddenBy === 'workspace'
            ? { label: 'user override', cls: 'warn' }
            : { label: 'repo config', cls: 'muted' };
    }
    if (server.source === 'global') return { label: 'global', cls: 'muted' };
    return { label: 'repo config', cls: 'muted' };
}

/** Whether a server's inline "Authenticate" pill should be shown. */
export function shouldShowAuthButton(
    server: McpServerEntry,
    isEnabled: boolean,
    flow: McpAuthFlowState | undefined,
): boolean {
    return isRemote(server) && isEnabled && (needsAuth(server) || (!!flow && flow.phase !== 'completed'));
}

/**
 * Row-level tool count label, e.g. "12", "8/12", "…", "!", or "—".
 *
 * A disabled or overridden server shows "—". A discovered-but-unreached server
 * shows "!" (with the error as a tooltip). Before discovery resolves the label
 * is "…" while loading and "—" once discovery has settled without a result.
 */
export function getToolCountLabel(input: {
    enabled: boolean;
    effective: boolean;
    result: McpServerToolsResult | undefined;
    discoveryState: DiscoveryState;
    allowEntry: string[] | undefined;
}): { text: string; title?: string } {
    const { enabled, effective, result, discoveryState, allowEntry } = input;
    if (!enabled || !effective) return { text: '—' };
    if (!result) {
        return discoveryState === 'loading' || discoveryState === 'idle'
            ? { text: '…' }
            : { text: '—' };
    }
    if (result.status === 'error') return { text: '!', title: result.error };
    const total = result.tools.length;
    const enabledCount = result.tools.filter(t => isMcpToolEnabled(allowEntry, t.name)).length;
    return {
        text: enabledCount === total ? String(total) : `${enabledCount}/${total}`,
        title: `${enabledCount} of ${total} tools enabled`,
    };
}

export interface McpServerCounts {
    all: number;
    active: number;
    auth: number;
    disabled: number;
}

/** Toolbar filter counts, computed over the full (unfiltered) server list. */
export function computeServerCounts(
    servers: McpServerEntry[],
    isEnabled: (name: string) => boolean,
): McpServerCounts {
    const active = servers.filter(s => isEnabled(s.name) && s.effective !== false && getServerStatus(s, true) === 'ok').length;
    const auth = servers.filter(s => getServerStatus(s, isEnabled(s.name)) === 'auth').length;
    const disabled = servers.filter(s => !isEnabled(s.name) || s.effective === false).length;
    return { all: servers.length, active, auth, disabled };
}

/** Apply the active filter tab + search query to the server list. */
export function filterServers(
    servers: McpServerEntry[],
    opts: { filterTab: FilterTab; searchQuery: string; isEnabled: (name: string) => boolean },
): McpServerEntry[] {
    const { filterTab, searchQuery, isEnabled } = opts;
    let list = servers;

    if (filterTab === 'active') {
        list = list.filter(s => isEnabled(s.name) && s.effective !== false && getServerStatus(s, true) === 'ok');
    } else if (filterTab === 'auth') {
        list = list.filter(s => getServerStatus(s, isEnabled(s.name)) === 'auth');
    } else if (filterTab === 'disabled') {
        list = list.filter(s => !isEnabled(s.name) || s.effective === false);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
        list = list.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.description ?? '').toLowerCase().includes(q),
        );
    }

    return list;
}

/** Fully-derived display data for one server row. */
export interface McpServerRowModel {
    server: McpServerEntry;
    enabled: boolean;
    isOverridden: boolean;
    status: ServerStatus;
    description: string;
    transportCls: string;
    sourcePill: { label: string; cls: string };
    toolCount: { text: string; title?: string };
    flow: McpAuthFlowState | undefined;
    showAuthBtn: boolean;
}

export interface McpServerListModelInput {
    servers: McpServerEntry[];
    isEnabled: (name: string) => boolean;
    filterTab: FilterTab;
    searchQuery: string;
    discovery: Record<string, McpServerToolsResult>;
    discoveryState: DiscoveryState;
    toolsAllowList: EnabledMcpToolsMap;
    authFlow: Record<string, McpAuthFlowState>;
}

export interface McpServerListModel {
    counts: McpServerCounts;
    rows: McpServerRowModel[];
}

/**
 * Build the complete list view model: toolbar counts (over all servers) plus a
 * fully-derived row for each server passing the current filter/search.
 */
export function buildMcpServerListModel(input: McpServerListModelInput): McpServerListModel {
    const { servers, isEnabled, filterTab, searchQuery, discovery, discoveryState, toolsAllowList, authFlow } = input;

    const counts = computeServerCounts(servers, isEnabled);
    const filtered = filterServers(servers, { filterTab, searchQuery, isEnabled });

    const rows: McpServerRowModel[] = filtered.map(server => {
        const enabled = isEnabled(server.name);
        const isOverridden = server.effective === false;
        const flow = authFlow[server.name];
        return {
            server,
            enabled,
            isOverridden,
            status: getServerStatus(server, enabled),
            description: getServerDescription(server, enabled),
            transportCls: getTransportPillClass(server.type),
            sourcePill: getSourcePillInfo(server),
            toolCount: getToolCountLabel({
                enabled,
                effective: server.effective !== false,
                result: discovery[server.name],
                discoveryState,
                allowEntry: toolsAllowList[server.name],
            }),
            flow,
            showAuthBtn: shouldShowAuthButton(server, enabled, flow),
        };
    });

    return { counts, rows };
}
