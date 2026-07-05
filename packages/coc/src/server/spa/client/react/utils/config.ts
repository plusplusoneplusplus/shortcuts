/**
 * Dashboard config — reads server-provided configuration.
 *
 * Bootstrap config comes from window.__DASHBOARD_CONFIG__ (set by the HTML
 * template).  Feature flags are refreshed at page load from the
 * GET /api/config/runtime endpoint so that admin config changes take effect
 * on refresh without a server restart.
 */

interface DashboardConfig {
    apiBasePath: string;
    wsPath: string;
    hostname?: string;
    /**
     * Raw feature-flag map as embedded by the server / returned by
     * GET /api/config/runtime. Flags are flattened onto this object on read,
     * so new registry-driven flags need no per-flag plumbing here — read them
     * with isFeatureEnabled()/getFeatureValue() or add a typed accessor below.
     */
    features?: Record<string, unknown>;
    terminalEnabled?: boolean;
    notesEnabled?: boolean;
    myWorkEnabled?: boolean;
    myLifeEnabled?: boolean;
    scratchpadEnabled?: boolean;
    scratchpadLayout?: 'horizontal' | 'vertical';
    workflowsEnabled?: boolean;
    pullRequestsEnabled?: boolean;
    pullRequestsSuggestionsEnabled?: boolean;
    pullRequestsAutoClassifyTeamEnabled?: boolean;
    serversEnabled?: boolean;
    ralphEnabled?: boolean;
    forEachEnabled?: boolean;
    mapReduceEnabled?: boolean;
    vimNavigationEnabled?: boolean;
    containerMode?: boolean;
    loopsEnabled?: boolean;
    triggersEnabled?: boolean;
    dreamsEnabled?: boolean;
    excalidrawEnabled?: boolean;
    canvasEnabled?: boolean;
    mcpOauthEnabled?: boolean;
    focusedDiffEnabled?: boolean;
    sessionContextAttachmentsEnabled?: boolean;
    commitChatLensEnabled?: boolean;
    commitChatLensDormantMode?: 'ghost' | 'pill';
    ralphMultiAgentGrillEnabled?: boolean;
    containerDefaultAgentEnabled?: boolean;
    bindAddress?: string;
    /** Whether the Codex SDK provider is enabled (feature flag). */
    codexEnabled?: boolean;
    /** Whether the OpenCode SDK provider is enabled (feature flag). */
    opencodeEnabled?: boolean;
    /** Concrete default AI provider when Auto routing is disabled. */
    defaultProvider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    /** Whether Auto agent provider routing is enabled. */
    autoAgentProviderRoutingEnabled?: boolean;
    /** Whether the Work Items hierarchy board is enabled (feature flag). */
    workItemsHierarchyEnabled?: boolean;
    /** Whether remote Work Items provider integration is enabled (requires hierarchy). */
    workItemsSyncEnabled?: boolean;
    /** Whether the AI-assisted work item authoring composer is enabled (feature flag). */
    workItemsAiAuthoringEnabled?: boolean;
    /** Whether the durable Work Items/Goals workflow command center is enabled (feature flag). */
    workItemsWorkflowEnabled?: boolean;
    /** Whether direct commit SHA lookup in the Git tab is enabled (feature flag). */
    gitCommitLookupEnabled?: boolean;
    /** Whether cross-clone cherry-pick transfer in the Git tab is enabled (feature flag). */
    gitCrossCloneCherryPickEnabled?: boolean;
    /** Whether the Effort Tiers selector (Low/Medium/High) is enabled in the composer. Disabled by default. */
    effortLevelsEnabled?: boolean;
    /** Whether the read-only native CLI sessions tab is enabled (feature flag). */
    nativeCliSessionsEnabled?: boolean;
    /** Whether the deprecated Plans (Dep.) / Tasks (Dep.) sub-tab is shown. Default false (hidden). */
    showPlanDepTab?: boolean;
    /** Whether the remote-first dashboard shell is enabled (feature flag). */
    remoteShellEnabled?: boolean;
    /** Whether the split "Workspace" left panel (chat top / git bottom + shared detail pane) is enabled. */
    splitWorkspacePanelEnabled?: boolean;
    /** Typing-driven client prewarm debounce (ms), resolved from env on the server. */
    prewarmDebounceMs?: number;
    /** Warm-client idle TTL (ms), resolved from env on the server. `0` means warming is disabled. */
    warmClientTtlMs?: number;
}

/** Cached runtime config loaded from the API. */
let _runtimeConfig: DashboardConfig | null = null;
let _runtimeConfigPromise: Promise<void> | null = null;

export const DASHBOARD_CONFIG_UPDATED_EVENT = 'coc-dashboard-config-updated';

function getBootstrapConfig(): DashboardConfig {
    const config = (window as any).__DASHBOARD_CONFIG__;
    if (!config) {
        return { apiBasePath: '/api', wsPath: '/ws' };
    }
    // Flatten the embedded feature map so flags are readable as top-level
    // config fields (legacy flat embeds keep working unchanged).
    if (config.features && typeof config.features === 'object') {
        return { ...config, ...config.features };
    }
    return config;
}

function getConfig(): DashboardConfig {
    if (_runtimeConfig) return _runtimeConfig;
    return getBootstrapConfig();
}

export function applyRuntimeConfigPatch(patch: Record<string, unknown>): void {
    const current = getConfig();
    const nextFeatures = {
        ...(current.features ?? {}),
        ...patch,
    };
    _runtimeConfig = {
        ...current,
        ...patch,
        features: nextFeatures,
    };
    window.dispatchEvent(new CustomEvent(DASHBOARD_CONFIG_UPDATED_EVENT, {
        detail: { patch, config: _runtimeConfig },
    }));
}

/**
 * Generic read of a boolean runtime feature flag by its
 * RuntimeDashboardConfig.features name (e.g. 'serversEnabled').
 * Prefer this (or a typed accessor below) for new registry-driven flags.
 */
export function isFeatureEnabled(flag: string): boolean {
    return (getConfig() as unknown as Record<string, unknown>)[flag] === true;
}

/** Generic read of a non-boolean runtime feature value (e.g. 'scratchpadLayout'). */
export function getFeatureValue(flag: string): unknown {
    return (getConfig() as unknown as Record<string, unknown>)[flag];
}

/**
 * Fetch fresh feature flags from GET /api/config/runtime and merge them
 * into the active config.  Called once on page load from App initialization.
 * Non-fatal: if the endpoint fails, the SPA falls back to bootstrap config.
 */
export async function loadRuntimeConfig(): Promise<void> {
    if (_runtimeConfigPromise) return _runtimeConfigPromise;
    _runtimeConfigPromise = _doLoadRuntimeConfig();
    return _runtimeConfigPromise;
}

async function _doLoadRuntimeConfig(): Promise<void> {
    await _fetchAndApplyRuntimeConfig(getBootstrapConfig().apiBasePath);
}

/**
 * Fetch runtime config from a given API base and merge into active config.
 * Shared between initial page load and container-mode agent switches.
 */
async function _fetchAndApplyRuntimeConfig(apiBase: string): Promise<void> {
    try {
        const bootstrap = getBootstrapConfig();
        const resp = await fetch(`${apiBase}/config/runtime`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data || typeof data !== 'object' || !data.features) return;

        // Merge runtime features into the active config, preserving
        // bootstrap-only fields. Flags are spread flat so every flag in
        // RuntimeDashboardConfig.features lands on the config without
        // per-flag plumbing.
        _runtimeConfig = {
            ...bootstrap,
            ...data.features,
            features: data.features,
            hostname: data.hostname ?? bootstrap.hostname,
            bindAddress: data.bindAddress ?? bootstrap.bindAddress,
        };
    } catch {
        // Non-fatal — fall back to bootstrap config
    }
}

/**
 * Reset the runtime config cache.  Exposed for testing only.
 * @internal
 */
export function _resetRuntimeConfig(): void {
    _runtimeConfig = null;
    _runtimeConfigPromise = null;
}

/**
 * Module-level current agent ID for container mode API routing.
 * Set by AppContext when the selected workspace changes.
 * When set, getApiBase() returns `/api/agent/:agentId` so all API calls
 * are routed through the container's agent proxy.
 */
let _currentAgentId: string | null = null;

/** Called by AppContext when selected workspace changes.
 * In container mode, re-fetches runtime config from the agent so feature
 * flags (ralph, loops, etc.) reflect the agent's actual config.
 */
export function setCurrentAgentId(agentId: string | null): void {
    const prev = _currentAgentId;
    _currentAgentId = agentId;
    if (agentId && agentId !== prev && isContainerMode()) {
        const base = getBootstrapConfig().apiBasePath + '/agent/' + encodeURIComponent(agentId);
        _runtimeConfigPromise = _fetchAndApplyRuntimeConfig(base);
    }
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

/**
 * Typing-driven client prewarm debounce (ms), resolved from env on the server
 * (COC_WARM_PREWARM_DEBOUNCE_MS) and surfaced via runtime config. Falls back to
 * the 500ms default when the value is missing or invalid.
 */
export function getPrewarmDebounceMs(): number {
    const raw = (getConfig() as unknown as Record<string, unknown>).prewarmDebounceMs;
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 500;
}

/**
 * Warm-client idle TTL (ms), resolved from env on the server
 * (COC_WARM_CLIENT_TTL_MS) and surfaced via runtime config. Falls back to the
 * 300000ms (5 minute) default when the value is missing or invalid. A surfaced
 * value of `0` means warming is disabled and is returned as-is.
 */
export function getWarmClientTtlMs(): number {
    const raw = (getConfig() as unknown as Record<string, unknown>).warmClientTtlMs;
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 300000;
}

export function isWorkflowsEnabled(): boolean {
    return getConfig().workflowsEnabled === true;
}

export function isPullRequestsEnabled(): boolean {
    return getConfig().pullRequestsEnabled === true;
}

export function isPullRequestsSuggestionsEnabled(): boolean {
    return getConfig().pullRequestsSuggestionsEnabled === true;
}

export function isPullRequestsAutoClassifyTeamEnabled(): boolean {
    return getConfig().pullRequestsAutoClassifyTeamEnabled === true;
}

export function isServersEnabled(): boolean {
    return getConfig().serversEnabled === true;
}

export function isRalphEnabled(): boolean {
    return getConfig().ralphEnabled === true;
}

export function isRalphMultiAgentGrillEnabled(): boolean {
    return getConfig().ralphMultiAgentGrillEnabled === true;
}

export function isForEachEnabled(): boolean {
    return getConfig().forEachEnabled === true;
}

export function isMapReduceEnabled(): boolean {
    return getConfig().mapReduceEnabled === true;
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

export function isTriggersEnabled(): boolean {
    return getConfig().triggersEnabled === true;
}

export function isDreamsEnabled(): boolean {
    return getConfig().dreamsEnabled === true;
}

export function isNativeCliSessionsEnabled(): boolean {
    return getConfig().nativeCliSessionsEnabled === true;
}

/** Returns true when the deprecated Plans (Dep.) / Tasks (Dep.) sub-tab should be shown. */
export function isShowPlanDepTab(): boolean {
    return getConfig().showPlanDepTab === true;
}

/** Returns true when the remote-first dashboard shell is enabled. */
export function isRemoteShellEnabled(): boolean {
    return getConfig().remoteShellEnabled === true;
}

/** Returns true when the split "Workspace" left panel (chat top / git bottom + shared detail pane) is enabled. */
export function isSplitWorkspacePanelEnabled(): boolean {
    return getConfig().splitWorkspacePanelEnabled === true;
}

export function isExcalidrawEnabled(): boolean {
    return getConfig().excalidrawEnabled === true;
}

/** Returns true when the chat canvas side panel is enabled. */
export function isCanvasEnabled(): boolean {
    return getConfig().canvasEnabled === true;
}

export function isMcpOauthEnabled(): boolean {
    return getConfig().mcpOauthEnabled === true;
}

export function isFocusedDiffEnabled(): boolean {
    return getConfig().focusedDiffEnabled === true;
}

/** Returns true when drag/drop session-context attachments are enabled. */
export function isSessionContextAttachmentsEnabled(): boolean {
    return getConfig().sessionContextAttachmentsEnabled === true;
}

/** Returns true when commit chat lens placement is enabled. */
export function isCommitChatLensEnabled(): boolean {
    return getConfig().commitChatLensEnabled === true;
}

/** Returns the dormant mode for the lens: 'ghost' (fade) or 'pill' (collapse). */
export function getCommitChatLensDormantMode(): 'ghost' | 'pill' {
    return getConfig().commitChatLensDormantMode === 'pill' ? 'pill' : 'ghost';
}

export function isContainerDefaultAgentEnabled(): boolean {
    return getConfig().containerDefaultAgentEnabled === true;
}

/** Returns true when the Codex SDK provider feature flag is enabled. */
export function isCodexEnabled(): boolean {
    return getConfig().codexEnabled === true;
}

/** Returns true when Auto provider routing is enabled. */
export function isAutoAgentProviderRoutingEnabled(): boolean {
    return getConfig().autoAgentProviderRoutingEnabled === true;
}

/** Returns true when the Work Items hierarchy board feature flag is enabled. */
export function isWorkItemsHierarchyEnabled(): boolean {
    return getConfig().workItemsHierarchyEnabled === true;
}

/** Returns true when remote Work Items provider integration is enabled and hierarchy mode is enabled. */
export function isWorkItemsSyncEnabled(): boolean {
    const config = getConfig();
    return config.workItemsHierarchyEnabled === true && config.workItemsSyncEnabled === true;
}

/** Returns true when the AI-assisted work item authoring composer feature flag is enabled. */
export function isWorkItemsAiAuthoringEnabled(): boolean {
    return getConfig().workItemsAiAuthoringEnabled === true;
}

/** Returns true when the durable Work Items/Goals workflow feature flag is enabled. */
export function isWorkItemsWorkflowEnabled(): boolean {
    return getConfig().workItemsWorkflowEnabled === true;
}

/** Returns true when direct commit SHA lookup in the Git tab is enabled. */
export function isGitCommitLookupEnabled(): boolean {
    return getConfig().gitCommitLookupEnabled === true;
}

/** Returns true when cross-clone cherry-pick transfer in the Git tab is enabled. */
export function isGitCrossCloneCherryPickEnabled(): boolean {
    return getConfig().gitCrossCloneCherryPickEnabled === true;
}

/** Returns true when the Effort Tiers selector is enabled (replaces model picker + effort pill). */
export function isEffortLevelsEnabled(): boolean {
    return getConfig().effortLevelsEnabled === true;
}

/** Returns the configured concrete default AI provider. */
export function getConfiguredDefaultProvider(): 'copilot' | 'codex' | 'claude' | 'opencode' {
    return getConfig().defaultProvider ?? 'copilot';
}

/** Returns the concrete default AI provider for UI surfaces that require an SDK provider. */
export function getDefaultProvider(): 'copilot' | 'codex' | 'claude' | 'opencode' {
    return getConfiguredDefaultProvider();
}

/** Returns the currently active provider (alias for getDefaultProvider). */
export function getActiveProvider(): 'copilot' | 'codex' | 'claude' | 'opencode' {
    return getDefaultProvider();
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
