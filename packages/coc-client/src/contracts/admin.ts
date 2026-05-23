export type AdminOutputFormat = 'table' | 'json' | 'csv' | 'markdown';
export type AdminImportMode = 'replace' | 'merge';
export type AdminStorageBackend = 'file' | 'sqlite';

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
  pullRequests?: { enabled?: boolean; suggestions?: boolean };
  servers?: { enabled?: boolean };
  excalidraw?: { enabled?: boolean };
  codex?: { enabled?: boolean };
  activeProvider?: 'copilot' | 'codex';
  mcpOauth?: { enabled?: boolean };
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
  'servers.enabled'?: boolean;
  'excalidraw.enabled'?: boolean;
  'mcpOauth.enabled'?: boolean;
  'codex.enabled'?: boolean;
  activeProvider?: 'copilot' | 'codex';
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
    serversEnabled: boolean;
    ralphEnabled: boolean;
    vimNavigationEnabled: boolean;
    loopsEnabled: boolean;
    excalidrawEnabled: boolean;
    mcpOauthEnabled: boolean;
    focusedDiffEnabled: boolean;
    codexEnabled: boolean;
    activeProvider: 'copilot' | 'codex';
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
