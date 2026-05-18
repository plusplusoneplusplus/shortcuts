/**
 * Dashboard config — reads server-provided configuration
 * from the global window.__DASHBOARD_CONFIG__ set by the HTML template.
 */

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
    excalidrawEnabled?: boolean;
    mcpOauthEnabled?: boolean;
    focusedDiffEnabled?: boolean;
    bindAddress?: string;
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

export function isExcalidrawEnabled(): boolean {
    return getConfig().excalidrawEnabled === true;
}

export function isMcpOauthEnabled(): boolean {
    return getConfig().mcpOauthEnabled === true;
}

export function isFocusedDiffEnabled(): boolean {
    return getConfig().focusedDiffEnabled === true;
}

/** Returns the raw bind address the server is listening on (e.g., '0.0.0.0'), if known. */
export function getBindAddress(): string | undefined {
    return getConfig().bindAddress;
}

/**
 * Returns true when the server is bound to an address that exposes it on all
 * network interfaces. Currently matches IPv4 wildcard '0.0.0.0' and the IPv6
 * wildcard '::' (and the equivalent '[::]' display form).
 */
export function isExposedBinding(): boolean {
    const addr = getConfig().bindAddress;
    if (!addr) return false;
    return addr === '0.0.0.0' || addr === '::' || addr === '[::]';
}
