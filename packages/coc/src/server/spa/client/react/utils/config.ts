/**
 * Dashboard config — reads server-provided configuration
 * from the global window.__DASHBOARD_CONFIG__ set by the HTML template.
 */

import { openRelayIfNeeded } from './agent-relay';

interface DashboardConfig {
    apiBasePath: string;
    wsPath: string;
    hostname?: string;
    terminalEnabled?: boolean;
    notesEnabled?: boolean;
    myWorkEnabled?: boolean;
    myLifeEnabled?: boolean;
    scratchpadEnabled?: boolean;
    scratchpadLayout?: 'horizontal' | 'vertical';
    workflowsEnabled?: boolean;
    pullRequestsEnabled?: boolean;
    serversEnabled?: boolean;
    ralphEnabled?: boolean;
    vimNavigationEnabled?: boolean;
    containerMode?: boolean;
    loopsEnabled?: boolean;
}

function getConfig(): DashboardConfig {
    const config = (window as any).__DASHBOARD_CONFIG__;
    if (!config) {
        return { apiBasePath: '/api', wsPath: '/ws' };
    }
    return config;
}

/**
 * Module-level current agent ID for container mode API routing.
 * Set by AppContext when the selected workspace changes.
 * When set, getApiBase() returns `/api/agent/:agentId` so all API calls
 * are routed through the container's agent proxy.
 */
let _currentAgentId: string | null = null;

/** Called by AppContext when selected workspace changes. */
export function setCurrentAgentId(agentId: string | null): void {
    _currentAgentId = agentId;
}

export function getCurrentAgentId(): string | null {
    return _currentAgentId;
}

export function getApiBase(): string {
    const base = getConfig().apiBasePath;
    if (isContainerMode() && _currentAgentId) {
        return base + '/agent/' + encodeURIComponent(_currentAgentId);
    }
    return base;
}

/** Returns the raw API base path without agent prefix. Use for container-level endpoints. */
export function getRawApiBase(): string {
    return getConfig().apiBasePath;
}

export function getWsPath(): string {
    return getConfig().wsPath;
}

export function getHostname(): string | undefined {
    return getConfig().hostname;
}

export function isTerminalEnabled(): boolean {
    return getConfig().terminalEnabled !== false;
}

export function isNotesEnabled(): boolean {
    return getConfig().notesEnabled === true;
}

export function isMyWorkEnabled(): boolean {
    return getConfig().myWorkEnabled === true;
}

export function isMyLifeEnabled(): boolean {
    return getConfig().myLifeEnabled === true;
}

export function isScratchpadEnabled(): boolean {
    return getConfig().scratchpadEnabled === true;
}

export function getScratchpadLayout(): 'horizontal' | 'vertical' {
    return getConfig().scratchpadLayout === 'horizontal' ? 'horizontal' : 'vertical';
}

export function isWorkflowsEnabled(): boolean {
    return getConfig().workflowsEnabled === true;
}

export function isPullRequestsEnabled(): boolean {
    return getConfig().pullRequestsEnabled === true;
}

export function isServersEnabled(): boolean {
    return getConfig().serversEnabled === true;
}

export function isRalphEnabled(): boolean {
    return getConfig().ralphEnabled === true;
}

export function isVimNavigationEnabled(): boolean {
    return getConfig().vimNavigationEnabled === true;
}

export function isContainerMode(): boolean {
    return getConfig().containerMode === true;
}

export function isLoopsEnabled(): boolean {
    return getConfig().loopsEnabled === true;
}

// ── Authenticated agent cache ───────────────────────────

const STORAGE_KEY = 'coc-authenticated-agents';

/**
 * Tracks agents whose devtunnel auth has been completed in the browser.
 * After a browse-helper popup succeeds, the agent is marked authenticated
 * so subsequent API calls can go directly to the agent URL with credentials.
 *
 * Persisted to localStorage so auth survives page refreshes — the devtunnel
 * cookie remains valid in the browser, we just need to remember to use it.
 */
const _authenticatedAgents = new Map<string, string>(loadPersistedAgents());

function loadPersistedAgents(): [string, string][] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
    } catch { /* corrupt or unavailable — start fresh */ }
    return [];
}

function persistAgents(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(_authenticatedAgents.entries())));
    } catch { /* localStorage full or unavailable — non-critical */ }
}

export function markAgentAuthenticated(agentId: string, address: string): void {
    _authenticatedAgents.set(agentId, address);
    persistAgents();
    // Only pre-open the relay popup if the agent doesn't have server-side auth
    if (!hasServerSideAuth(agentId)) {
        openRelayIfNeeded(address);
    }
}

export function getAuthenticatedAgentAddress(agentId: string): string | undefined {
    return _authenticatedAgents.get(agentId);
}

export function isAgentAuthenticated(agentId: string): boolean {
    return _authenticatedAgents.has(agentId);
}

/** Remove a single agent's cached auth (e.g. on explicit disconnect or auth failure). */
export function clearAgentAuth(agentId: string): void {
    _authenticatedAgents.delete(agentId);
    persistAgents();
}

/** Clear all cached agent auth (e.g. full logout). */
export function clearAllAgentAuth(): void {
    _authenticatedAgents.clear();
    persistAgents();
}

// ── Server-side auth registry ───────────────────────────

const SERVER_AUTH_KEY = 'coc-server-auth-agents';

/**
 * Tracks agents that have server-side tunnel authentication configured.
 * When an agent has a tunnelId, the container proxy injects the token header,
 * so client-side relay popups are unnecessary.
 * Persisted to localStorage so it's available immediately on page load.
 */
const _serverAuthAgents = new Set<string>(loadServerAuthAgents());

function loadServerAuthAgents(): string[] {
    try {
        const raw = localStorage.getItem(SERVER_AUTH_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
    } catch { /* start fresh */ }
    return [];
}

function persistServerAuthAgents(): void {
    try {
        localStorage.setItem(SERVER_AUTH_KEY, JSON.stringify(Array.from(_serverAuthAgents)));
    } catch { /* non-critical */ }
}

/** Mark an agent as having server-side tunnel auth (has tunnelId). */
export function markAgentHasServerAuth(agentId: string): void {
    _serverAuthAgents.add(agentId);
    persistServerAuthAgents();
}

/** Unmark an agent's server-side auth. */
export function unmarkAgentServerAuth(agentId: string): void {
    _serverAuthAgents.delete(agentId);
    persistServerAuthAgents();
}

/** Check if an agent uses server-side tunnel auth (skip relay popup). */
export function hasServerSideAuth(agentId: string): boolean {
    return _serverAuthAgents.has(agentId);
}

/** Bulk-set which agents have server-side auth (called when agent list refreshes). */
export function setServerAuthAgents(agentIds: string[]): void {
    _serverAuthAgents.clear();
    for (const id of agentIds) _serverAuthAgents.add(id);
    persistServerAuthAgents();
}
