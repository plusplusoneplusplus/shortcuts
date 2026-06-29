export type AdminOutputFormat = 'table' | 'json' | 'csv' | 'markdown';
export type AdminImportMode = 'replace' | 'merge';
export type AdminStorageBackend = 'file' | 'sqlite';
export type AdminConcreteAgentProvider = 'copilot' | 'codex' | 'claude' | 'opencode';
export type AdminDefaultProvider = AdminConcreteAgentProvider;

export interface AdminAutoProviderRoutingRule {
  provider: AdminConcreteAgentProvider;
  enabled?: boolean;
  minimumRemainingPercent?: number;
  weeklyGuard?: {
    enabled?: boolean;
    minimumRemainingPercent?: number;
  };
}

export interface AdminAutoProviderRoutingConfig {
  rules?: AdminAutoProviderRoutingRule[];
  fallbackProvider?: AdminConcreteAgentProvider;
}

export interface AdminTokenResponse {
  token: string;
  expiresIn: number;
}

export interface AdminDataStatsQuery {
  includeWikis?: boolean;
}

export interface AdminDataStatsResponse {
  processCount?: number;
  processes?: number;
  wikiCount?: number;
  wikis?: number;
  totalBytes?: number;
  diskUsage?: number;
  deletedProcesses?: number;
  deletedWorkspaces?: number;
  deletedWikis?: number;
  deletedQueues?: number;
  deletedSchedules?: number;
  deletedGitOps?: number;
  deletedRepoPreferences?: number;
  deletedPreferences?: boolean;
  deletedWikiDirs?: string[];
  preservedFiles?: string[];
  errors?: string[];
  [key: string]: unknown;
}

export interface AdminResolvedConfig {
  model?: string;
  parallel?: number;
  timeout?: number | null;
  output?: AdminOutputFormat;
  showReportIntent?: boolean;
  toolCompactness?: 0 | 1 | 2 | 3;
  taskCardDensity?: 'compact' | 'dense';
  historyGrouping?: boolean;
  groupSingleLineMessages?: boolean;
  chat?: {
    followUpSuggestions?: {
      enabled?: boolean;
      count?: number;
    };
    askUser?: {
      enabled?: boolean;
    };
    /** Admin-configured global system prompt injected into user-facing agent sessions. */
    globalSystemPrompt?: string;
  };
  serve?: {
    serverName?: string;
  };
  terminal?: { enabled?: boolean };
  notes?: { enabled?: boolean };
  myWork?: { enabled?: boolean };
  myLife?: { enabled?: boolean };
  scratchpad?: {
    enabled?: boolean;
    layout?: 'horizontal' | 'vertical';
  };
  workflows?: { enabled?: boolean };
  pullRequests?: { enabled?: boolean; suggestions?: boolean; autoClassifyTeam?: boolean };
  servers?: { enabled?: boolean };
  forEach?: { enabled?: boolean };
  mapReduce?: { enabled?: boolean };
  dreams?: {
    enabled?: boolean;
    provider?: AdminDefaultProvider;
    model?: string;
    idleCheckIntervalMs?: number;
    minIdleMs?: number;
    confidenceThreshold?: number;
    maxCandidates?: number;
    conversationLimit?: number;
    timeoutMs?: number;
  };
  excalidraw?: { enabled?: boolean };
  codex?: { enabled?: boolean };
  claude?: { enabled?: boolean };
  opencode?: { enabled?: boolean };
  defaultProvider?: AdminDefaultProvider;
  agentProviderRouting?: {
    auto?: AdminAutoProviderRoutingConfig;
  };
  mcpOauth?: {
    enabled?: boolean;
    autoRefresh?: {
      enabled?: boolean;
    };
  };
  features?: {
    autoMemoryPromotion?: boolean;
    focusedDiff?: boolean;
    gitCommitLookup?: boolean;
    gitCrossCloneCherryPick?: boolean;
    sessionContextAttachments?: boolean;
    commitChatLens?: boolean;
    commitChatLensDormantMode?: 'ghost' | 'pill';
    autoAgentProviderRouting?: boolean;
    ralphMultiAgentGrill?: boolean;
    nativeCliSessions?: boolean;
  };
  workItems?: { hierarchy?: { enabled?: boolean }; sync?: { enabled?: boolean }; aiAuthoring?: { enabled?: boolean }; workflow?: { enabled?: boolean } };
  effortLevels?: { enabled?: boolean };
  [key: string]: unknown;
}

export type AdminConfigFieldRuntime = 'live' | 'reloadable' | 'restartRequired';

export interface AdminConfigFieldMeta {
  runtime: AdminConfigFieldRuntime;
}

export interface AdminConfigChangeEffect {
  field: string;
  runtime: AdminConfigFieldRuntime;
  requiresRestart: boolean;
}

export interface AdminConfigResponse {
  config?: Record<string, unknown>;
  resolved?: AdminResolvedConfig;
  sources?: Record<string, string>;
  /** Default values for all tracked config keys (dot-notation, same keys as `sources`). */
  defaults?: Record<string, unknown>;
  revision?: number;
  fieldMetadata?: Record<string, AdminConfigFieldMeta>;
  effects?: AdminConfigChangeEffect[];
  [key: string]: unknown;
}

export interface AdminConfigUpdate {
  model?: string;
  parallel?: number;
  timeout?: number | null;
  output?: AdminOutputFormat | string;
  showReportIntent?: boolean;
  toolCompactness?: 0 | 1 | 2 | 3;
  taskCardDensity?: 'compact' | 'dense';
  historyGrouping?: boolean;
  groupSingleLineMessages?: boolean;
  'chat.followUpSuggestions.enabled'?: boolean;
  'chat.followUpSuggestions.count'?: number;
  'chat.askUser.enabled'?: boolean;
  /** null clears the stored value; '' also clears it. */
  'chat.globalSystemPrompt'?: string | null;
  'serve.serverName'?: string | null;
  'terminal.enabled'?: boolean;
  'notes.enabled'?: boolean;
  'myWork.enabled'?: boolean;
  'myLife.enabled'?: boolean;
  'scratchpad.enabled'?: boolean;
  'scratchpad.layout'?: 'horizontal' | 'vertical';
  'workflows.enabled'?: boolean;
  'pullRequests.enabled'?: boolean;
  'pullRequests.suggestions'?: boolean;
  'pullRequests.autoClassifyTeam'?: boolean;
  'servers.enabled'?: boolean;
  'forEach.enabled'?: boolean;
  'mapReduce.enabled'?: boolean;
  'dreams.enabled'?: boolean;
  'dreams.provider'?: AdminDefaultProvider | null;
  'dreams.model'?: string | null;
  'dreams.idleCheckIntervalMs'?: number;
  'dreams.timeoutMs'?: number;
  'excalidraw.enabled'?: boolean;
  'mcpOauth.enabled'?: boolean;
  'mcpOauth.autoRefresh.enabled'?: boolean;
  'codex.enabled'?: boolean;
  'claude.enabled'?: boolean;
  'opencode.enabled'?: boolean;
  defaultProvider?: AdminDefaultProvider;
  'agentProviderRouting.auto'?: AdminAutoProviderRoutingConfig;
  'workItems.hierarchy.enabled'?: boolean;
  'workItems.sync.enabled'?: boolean;
  'workItems.aiAuthoring.enabled'?: boolean;
  'workItems.workflow.enabled'?: boolean;
  'features.gitCrossCloneCherryPick'?: boolean;
  'features.sessionContextAttachments'?: boolean;
  'features.ralphMultiAgentGrill'?: boolean;
  'features.commitChatLens'?: boolean;
  'features.commitChatLensDormantMode'?: 'ghost' | 'pill';
  'features.autoAgentProviderRouting'?: boolean;
  'features.nativeCliSessions'?: boolean;
  'effortLevels.enabled'?: boolean;
  [key: string]: unknown;
}

/**
 * Response from GET /api/config/runtime.
 * Contains current feature flags and revision for the SPA to consume
 * without relying on stale HTML-embedded config.
 */
export interface RuntimeDashboardConfig {
  revision: number;
  features: {
    terminalEnabled: boolean;
    notesEnabled: boolean;
    myWorkEnabled: boolean;
    myLifeEnabled: boolean;
    scratchpadEnabled: boolean;
    scratchpadLayout: 'horizontal' | 'vertical';
    workflowsEnabled: boolean;
    pullRequestsEnabled: boolean;
    pullRequestsSuggestionsEnabled: boolean;
    pullRequestsAutoClassifyTeamEnabled: boolean;
    serversEnabled: boolean;
    ralphEnabled: boolean;
    forEachEnabled: boolean;
    mapReduceEnabled: boolean;
    vimNavigationEnabled: boolean;
    loopsEnabled: boolean;
    dreamsEnabled: boolean;
    excalidrawEnabled: boolean;
    mcpOauthEnabled: boolean;
    focusedDiffEnabled: boolean;
    containerDefaultAgentEnabled: boolean;
    codexEnabled: boolean;
    claudeEnabled: boolean;
    opencodeEnabled: boolean;
    defaultProvider: AdminDefaultProvider;
    autoAgentProviderRoutingEnabled: boolean;
    ralphMultiAgentGrillEnabled: boolean;
    workItemsHierarchyEnabled: boolean;
    workItemsSyncEnabled: boolean;
    workItemsAiAuthoringEnabled: boolean;
    workItemsWorkflowEnabled: boolean;
    gitCommitLookupEnabled: boolean;
    gitCrossCloneCherryPickEnabled: boolean;
    sessionContextAttachmentsEnabled: boolean;
    commitChatLensEnabled: boolean;
    commitChatLensDormantMode: 'ghost' | 'pill';
    effortLevelsEnabled: boolean;
    nativeCliSessionsEnabled: boolean;
    remoteShellEnabled: boolean;
    /** Typing-driven client prewarm debounce (ms), resolved from env on the server. */
    prewarmDebounceMs: number;
    /** Warm-client idle TTL (ms), resolved from env on the server. `0` means warming is disabled. */
    warmClientTtlMs: number;
  };
  hostname?: string;
  bindAddress?: string;
}

export interface AdminVersionResponse {
  version: string;
  commit: string;
}

export interface AdminImportPreviewResponse {
  valid: boolean;
  error?: string;
  preview?: {
    processCount?: number;
    workspaceCount?: number;
    wikiCount?: number;
    queueFileCount?: number;
    sampleProcessIds?: string[];
    [key: string]: unknown;
  };
}

export interface AdminImportResponse {
  importedProcesses: number;
  importedWorkspaces: number;
  importedWikis: number;
  importedQueueFiles: number;
  importedBlobFiles: number;
  importedScheduleFiles: number;
  importedRepoPreferenceFiles: number;
  errors: string[];
  [key: string]: unknown;
}

export interface AdminWipeResponse {
  deletedProcesses: number;
  deletedWorkspaces: number;
  deletedWikis: number;
  deletedQueues: number;
  deletedSchedules: number;
  deletedGitOps: number;
  deletedRepoPreferences: number;
  deletedPreferences: boolean;
  deletedWikiDirs: string[];
  preservedFiles: string[];
  errors: string[];
  [key: string]: unknown;
}

export interface AdminRestartResponse {
  message: string;
}

export interface AdminStorageStatusResponse {
  backend: AdminStorageBackend;
  stats: {
    processes: number;
    workspaces: number;
  };
  dbPath?: string;
}

export interface AdminStorageScanRequest {
  path: string;
}

export interface AdminStorageMatchedWorkspace {
  workspaceId: string;
  activeCount: number;
  archivedCount: number;
  archivedBuckets: string[];
  registeredName: string;
  registeredRootPath: string;
}

export interface AdminStorageUnmatchedWorkspace {
  workspaceId: string;
  activeCount: number;
  archivedCount: number;
}

export interface AdminStorageDirectoryMatchResult {
  matched: AdminStorageMatchedWorkspace[];
  unmatched: AdminStorageUnmatchedWorkspace[];
  totalProcesses: number;
  totalMatchedProcesses: number;
}

export interface AdminStorageMigrationStreamOptions {
  token: string;
  skipValidation?: boolean;
  signal?: AbortSignal;
}

export interface AdminStorageDirectoryImportStreamOptions {
  token: string;
  path: string;
  signal?: AbortSignal;
}

export interface AdminStorageDirectoryImportSummary {
  imported: number;
  skipped: number;
  failed: number;
  perWorkspace: Array<{
    workspaceId: string;
    name: string;
    imported: number;
    skipped: number;
  }>;
}

export interface AdminStorageCancelMigrationResponse {
  success: boolean;
}

// ── Agent Providers types ──────────────────────────────────────────

/** Wire-format identifier for an AI agent provider. */
export type AgentProviderId = 'copilot' | 'codex' | 'claude' | 'opencode';

/** SDK package install status for optional providers (Codex, Claude). */
export type ProviderInstallStatus = 'not-installed' | 'installing' | 'installed' | 'install-failed';

/** Status of a single agent provider as returned by GET /api/agent-providers. */
export interface AgentProviderStatus {
  /** Provider identifier. */
  id: AgentProviderId;
  /** Human-readable name shown in the UI. */
  label: string;
  /** Whether the provider is enabled by admin config. Copilot is always true. */
  enabled: boolean;
  /** Whether the provider is actually usable right now (enabled + SDK available). */
  available: boolean;
  /** When true the provider cannot be disabled by the admin. Copilot only. */
  locked?: boolean;
  /** Human-readable reason when enabled but not available. */
  reason?: string;
  /**
   * SDK package install status for optional providers (codex, claude).
   * Absent for Copilot (always bundled). Populated by the server using
   * in-memory install state or runtime require.resolve detection.
   */
  installStatus?: ProviderInstallStatus;
}

/** Response from GET /api/agent-providers. */
export interface AgentProvidersResponse {
  providers: AgentProviderStatus[];
}

// ── Built-in Prompts types ──────────────────────────────────────────

export interface BuiltInPrompt {
  id: string;
  title: string;
  group: string;
  source: string;
  description: string;
  /** Built-in default text. */
  text: string;
  /** Whether this prompt supports admin overrides. */
  editable?: boolean;
  /** Required template variable names that must appear in any override (e.g. "${hint}"). */
  templateVars?: string[];
  /** Active override text, if set. */
  overrideText?: string;
  /** True when an override is currently active. */
  hasOverride?: boolean;
}

export type AdminPromptsResponse = Record<string, BuiltInPrompt>;

export interface AdminPromptUpdateRequest {
  text: string;
}

export interface AdminPromptUpdateResponse extends BuiltInPrompt {
  saved: true;
}

export interface AdminPromptDeleteResponse {
  id: string;
  reset: true;
}

// ── Agent Providers Quota types ──────────────────────────────────────────

/** A single quota-type snapshot for an agent provider. */
export interface ProviderQuotaType {
  /** Quota category name, e.g. "chat", "completions". */
  type: string;
  isUnlimitedEntitlement: boolean;
  usedRequests: number;
  entitlementRequests: number;
  /** 0.0–1.0, percentage of quota remaining. */
  remainingPercentage: number;
  usageAllowedWithExhaustedQuota: boolean;
  overage: number;
  /** ISO 8601 reset date, if known. */
  resetDate?: string;
}

/** Quota information for one provider returned by GET /api/agent-providers/quota. */
export interface ProviderQuotaResult {
  id: AgentProviderId;
  quotaTypes: ProviderQuotaType[];
  /** Set when the provider quota could not be fetched. */
  error?: string;
}

/** Response from GET /api/agent-providers/quota. */
export interface AgentProvidersQuotaResponse {
  providers: ProviderQuotaResult[];
  /** ISO 8601 timestamp for the cache refresh that produced this response, or null before any refresh. */
  lastUpdated: string | null;
}

/** Query options for GET /api/agent-providers/quota. */
export interface AgentProvidersQuotaOptions {
  /** Force a live provider refresh and update the server cache. */
  force?: boolean;
}
