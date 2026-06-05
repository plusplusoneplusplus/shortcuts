export interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  path?: string;
  alias?: string;
  tags?: string[];
  color?: string;
  remoteUrl?: string;
  description?: string;
  isGitRepo?: boolean;
  virtual?: boolean;
  [key: string]: unknown;
}

export type WorkspaceMcpServerSource = 'global' | 'workspace';
export type McpConfigScope = 'global' | 'workspace';
export type McpToolScope = 'all' | 'readonly' | 'allowlist';

/**
 * Authentication state for an MCP server.
 *
 * Set on `WorkspaceMcpServerEntry.authStatus` for HTTP/SSE servers; stdio
 * servers always report `not-required`. Drives the green/amber/red dot in the
 * MCP servers panel and decides whether the "Authenticate" button is shown.
 */
export type McpServerAuthStatus =
  | 'authenticated'
  | 'expired'
  | 'required'
  | 'not-required'
  | 'unknown';

export interface WorkspaceMcpServerEntry {
  name: string;
  type: string;
  url?: string;
  command?: string;
  source?: WorkspaceMcpServerSource;
  effective?: boolean;
  overriddenBy?: WorkspaceMcpServerSource;
  /** Derived server status included in availableServers. */
  status?: 'ok' | 'auth' | 'off' | 'err';
  /** Auth state for remote servers; absent on stdio servers. */
  authStatus?: McpServerAuthStatus;
  /** Wall-clock seconds at which the cached access token expires, if known. */
  authExpiresAt?: number;
  /** User-provided description from config file. */
  description?: string;
}

export interface McpServerDetail {
  description: string;
  envKeys: string[];
  args: string[];
  toolScope: McpToolScope;
  source: McpConfigScope;
  rawJson: Record<string, unknown>;
}

export interface McpServerCreateRequest {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
  toolScope?: McpToolScope;
  scope: McpConfigScope;
}

export interface McpServerUpdateRequest {
  description?: string;
  args?: string[];
  env?: Record<string, string>;
  toolScope?: McpToolScope;
}

export interface WorkspaceMcpSourceSection {
  configPath: string;
  fileExists: boolean;
  success: boolean;
  error?: string;
  servers: WorkspaceMcpServerEntry[];
}

export interface WorkspaceMcpSources {
  global: WorkspaceMcpSourceSection;
  workspace: WorkspaceMcpSourceSection;
}

export interface WorkspaceMcpConfigResponse {
  availableServers: WorkspaceMcpServerEntry[];
  enabledMcpServers: string[] | null;
  sources: WorkspaceMcpSources;
}

export interface UpdateWorkspaceMcpConfigRequest {
  enabledMcpServers: string[] | null;
}

export type WorkspaceInstructionMode = 'base' | 'ask' | 'autopilot';

export type WorkspaceInstructionsResponse = Record<WorkspaceInstructionMode, string | null>;

export interface WorkspaceInstructionResponse {
  mode: WorkspaceInstructionMode;
  content: string;
}

export interface UpdateWorkspaceInstructionRequest {
  content: string;
}

export interface WorkspacesResponse {
  workspaces: WorkspaceInfo[];
}

export interface BrowseWorkspaceEntry {
  name: string;
  type?: 'directory' | string;
  isGitRepo?: boolean;
}

export interface BrowseRoot {
  label: string;
  path: string;
}

export interface BrowseWorkspaceFoldersOptions {
  showHidden?: boolean;
}

export interface BrowseWorkspaceFoldersResponse {
  path: string;
  parent?: string | null;
  entries?: BrowseWorkspaceEntry[];
  drives?: string[];
  browseRoots?: BrowseRoot[];
}

export interface RegisterWorkspaceRequest {
  id?: string;
  name?: string;
  rootPath?: string;
  path?: string;
  alias?: string;
  tags?: string[];
  color?: string;
  remoteUrl?: string;
  description?: string;
}

export interface DeleteWorkspaceOptions {
  archive?: boolean;
}

export interface DeleteWorkspaceHistoryFilters {
  since?: string;
  until?: string;
}

export interface WorkspaceHistoryQuery {
  limit?: number;
  offset?: number;
}

export interface ProcessHistoryItem {
  id: string;
  type: string;
  status: string;
  title: string;
  promptPreview?: string;
  startTime: number;
  endTime?: number;
  error?: string;
  mode?: string;
  model?: string;
  workspaceId: string;
  planFilePath?: string;
  workItemId?: string;
  turnCount: number;
  lastActivityAt?: number;
  seenAt?: string;
  pinnedAt?: string;
  archived?: boolean;
  ralph?: {
    sessionId: string;
    phase?: 'grilling' | 'executing' | 'complete';
    currentIteration?: number;
  };
  forEach?: {
    kind?: 'child' | 'generation';
    workspaceId: string;
    runId?: string;
    itemId?: string;
    generationId?: string;
    childMode?: 'ask' | 'autopilot';
    originalRequest?: string;
    status?: 'draft' | 'approved';
    latestItemCount?: number;
    latestPlanTurnIndex?: number;
    lastPlanError?: string;
  };
}

export interface ProcessHistoryResponse {
  history: ProcessHistoryItem[];
  hasMore: boolean;
  offset: number;
  limit: number;
}

export interface DiscoverWorkspacesResponse {
  repos: Array<{ path: string; name: string }>;
}

export interface GitInfoResponse {
  branch: string | null;
  dirty: boolean;
  ahead?: number;
  behind?: number;
  isGitRepo: boolean;
  remoteUrl: string | null;
}

export interface GitInfoBatchResponse {
  results: Record<string, GitInfoResponse | null>;
}

export interface WorkspaceSummaryOptions {
  folder?: string;
  showArchived?: boolean;
}

export interface WorkspaceSummaryResponse {
  workflows: unknown[];
  tasks: unknown;
}

export interface MyWorkSyncRequest {
  actionItems?: string[];
  followUps?: Record<string, string[]>;
}

export interface MyWorkSyncResponse {
  synced: boolean;
  date: string;
  actionItemCount: number;
  followUpCount: number;
}

export interface MyLifeSyncRequest {
  goals?: string[];
  entries?: Record<string, string[]>;
}

export interface MyLifeSyncResponse {
  synced: boolean;
  date: string;
  goalCount: number;
  entryCount: number;
}

export interface MyWorkSummaryResponse {
  generated: boolean;
  path: string;
  completedCount: number;
  inProgressCount: number;
  waitingOnCount: number;
}

export interface TerminalSession {
  id: string;
  pinned: boolean;
  workspaceId: string;
  [key: string]: unknown;
}

export interface TerminalSessionsResponse {
  sessions?: TerminalSession[];
}

export interface TerminalPinResponse {
  sessionId: string;
  pinned: boolean;
}

export interface MyLifeSummaryResponse {
  generated: boolean;
  path: string;
  completedCount: number;
  inProgressCount: number;
  journalCount: number;
}

// ============================================================================
// Ralph session journal
// ============================================================================

export type RalphExitSignal = 'RALPH_NEXT' | 'RALPH_COMPLETE' | 'NONE';

export type RalphSessionPhase = 'grilling' | 'executing' | 'complete';

export type RalphTerminalReason =
  | 'RALPH_COMPLETE'
  | 'CAP_REACHED'
  | 'CANCELLED'
  | 'NO_SIGNAL';

export interface RalphIterationRecord {
  iteration: number;
  /** 1-based index of the loop this iteration belongs to. */
  loopIndex: number;
  taskId: string;
  processId: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitSignal?: RalphExitSignal;
}

/** Metadata for a single goal-phase (loop) within a Ralph session. */
export interface RalphLoopRecord {
  /** 1-based loop index. */
  loopIndex: number;
  goal: string;
  startIteration: number;
  endIteration?: number;
  terminalReason?: RalphTerminalReason;
  startedAt: string;
  completedAt?: string;
}

export interface RalphSessionRecord {
  sessionId: string;
  workspaceId: string;
  originalGoal: string;
  maxIterations: number;
  currentIteration: number;
  phase: RalphSessionPhase;
  startedAt: string;
  completedAt?: string;
  terminalReason?: RalphTerminalReason;
  iterations: RalphIterationRecord[];
  /** Multi-loop history. Absent on pre-existing single-loop sessions. */
  loops?: RalphLoopRecord[];
  /** Final-check automation records. Absent on legacy sessions. */
  finalChecks?: RalphFinalCheckRecord[];
}

// ============================================================================
// Final-check types (AC-03, AC-06)
// ============================================================================

export type RalphFinalCheckStatus = 'running' | 'completed' | 'failed';

/** Metadata record for one final-check run within a Ralph session. */
export interface RalphFinalCheckRecord {
  /** 1-based index of this check within the session. */
  checkIndex: number;
  /** The loop index that triggered this check. */
  loopIndex: number;
  /** The iteration number of the last iteration in the triggering loop. */
  sourceIteration: number;
  taskId?: string;
  processId?: string;
  startedAt: string;
  completedAt?: string;
  status: RalphFinalCheckStatus;
  hasGaps?: boolean;
  gapCount?: number;
  gapLoopStarted?: boolean;
  gapLoopIndex?: number;
  capReached?: boolean;
  goalSynthesized?: boolean;
}

export interface ParsedProgressSection {
  iteration: number;
  signal: RalphExitSignal;
  timestamp: string;
  body: string;
}

export interface RalphSessionFile {
  name: string;
  content: string;
}

export interface RalphSessionResponse {
  record: RalphSessionRecord;
  sections: ParsedProgressSection[];
  files: RalphSessionFile[];
}

export interface RalphContinueResponse {
  resumed: true;
  sessionId: string;
  workspaceId: string;
  taskId: string;
  nextIteration: number;
  newMaxIterations: number;
}

export interface RalphNewLoopResponse {
  resumed: true;
  sessionId: string;
  workspaceId: string;
  loopIndex: number;
  taskId: string;
  nextIteration: number;
  newMaxIterations: number;
}

export interface RalphResumeResponse {
  resumed: true;
  sessionId: string;
  workspaceId: string;
  taskId: string;
  nextIteration: number;
  maxIterations: number;
}
