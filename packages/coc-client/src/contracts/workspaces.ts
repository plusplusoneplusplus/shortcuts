import type { ChatProvider, ReasoningEffort } from './common';
import type { ForEachChildMode, ForEachItem } from './for-each';
import type { MapReduceProcessContext } from './map-reduce';
import type { EffortTierKey } from './queue';
import type { WorktreeMetadata } from './worktree';

/**
 * Marker set by the server on a workspace whose checkout lives inside WSL.
 * Absent means the checkout is not WSL-hosted.
 */
export interface WorkspaceWslInfo {
  /** Distro name when the server could determine it, otherwise `null`. */
  distro: string | null;
}

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
  /** Present only when the checkout lives inside WSL. */
  wsl?: WorkspaceWslInfo;
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
  /**
   * Per-repo allow-list of enabled tools, keyed by server name. Allow-list
   * semantics: a server with no entry has all tools enabled; an entry lists the
   * tool names that remain enabled (any tool not listed — including newly
   * discovered ones — is disabled). `null`/absent means no allow-list at all.
   */
  enabledMcpTools?: Record<string, string[]> | null;
}

/**
 * A PARTIAL patch of a workspace's MCP policy. The two fields have separate
 * persistence owners (the workspace record vs. the per-repo preference file),
 * so each is patched independently:
 *
 *   - omit a field  → leave it unchanged
 *   - `null`        → clear it (no allow-list: everything enabled)
 *   - a value       → replace it
 *
 * A caller mutating only tools must NOT have to send a server-list snapshot;
 * doing so is what let a stale snapshot revert a newer server toggle.
 * At least one field must be present.
 */
export interface UpdateWorkspaceMcpConfigRequest {
  enabledMcpServers?: string[] | null;
  enabledMcpTools?: Record<string, string[]> | null;
}

/**
 * The canonical MCP policy AFTER the patch was applied, so a client can adopt
 * the server's view rather than re-deriving it from its own optimistic state.
 */
export interface UpdateWorkspaceMcpConfigResponse {
  workspace: WorkspaceInfo;
  enabledMcpServers: string[] | null;
  enabledMcpTools: Record<string, string[]> | null;
}

/** A single tool reported by an MCP server's live `tools/list`. */
export interface McpDiscoveredTool {
  name: string;
  description?: string;
  /** JSON Schema describing the tool's input (display-only). */
  inputSchema?: unknown;
}

/** Per-server result of live MCP tool discovery. */
export interface McpServerToolsResult {
  status: 'ok' | 'error';
  tools: McpDiscoveredTool[];
  /** Present when `status === 'error'`. */
  error?: string;
  /** Server's self-reported name, when known. */
  serverName?: string;
}

/** Response of `GET /workspaces/:id/mcp-config/tools`. */
export interface WorkspaceMcpToolsResponse {
  servers: Record<string, McpServerToolsResult>;
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

export interface ActiveWorkspaceReportRequest {
  clientId: string;
  workspaceId: string | null;
}

export interface ActiveWorkspaceClientState {
  clientId: string;
  workspaceId: string;
  lastSeenAt: number;
}

export interface ActiveWorkspaceResponse {
  activeWorkspaceIds: string[];
  clients: ActiveWorkspaceClientState[];
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
    /** Confirmed goal spec, used to derive a concise chat-list title. */
    originalGoal?: string;
  };
  forEach?: {
    kind?: 'child' | 'generation';
    workspaceId: string;
    runId?: string;
    itemId?: string;
    generationId?: string;
    childMode?: ForEachChildMode;
    originalRequest?: string;
    status?: 'draft' | 'approved';
    latestItemCount?: number;
    latestPlanTurnIndex?: number;
    latestPlan?: {
      turnIndex: number;
      items: ForEachItem[];
      childMode: ForEachChildMode;
      sharedInstructions?: string;
      rawJson?: string;
      updatedAt?: string;
    };
    lastPlanError?: string;
    lastPlanErrorTurnIndex?: number;
  };
  mapReduce?: MapReduceProcessContext;
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

/**
 * One item in a My Work sync payload.
 *
 * A bare string is still the whole contract for a plain item — the object form
 * only exists to carry the metadata that makes an item actionable: a link back
 * to the mail/Teams thread it came from, a due date, and topic tags. Both
 * forms serialize to a single markdown checkbox line.
 */
export type MyWorkSyncItem =
  | string
  | {
      text: string;
      /** Link back to the source thread/document — rendered as a `↗` affordance. */
      sourceUrl?: string;
      /** ISO date (`YYYY-MM-DD`). */
      due?: string;
      /** Topic tags, with or without a leading `#`. */
      tags?: string[];
    };

export interface MyWorkSyncRequest {
  actionItems?: MyWorkSyncItem[];
  followUps?: Record<string, MyWorkSyncItem[]>;
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
  workspaceId: string;
  /** Lifecycle state; exited sessions are read-only and restartable */
  status?: 'running' | 'exited';
  exitedAt?: number;
  exitCode?: number;
  cwd?: string;
  title?: string;
  [key: string]: unknown;
}

export interface TerminalSessionsResponse {
  sessions?: TerminalSession[];
}

export interface TerminalRestartResponse {
  session: TerminalSession;
  /** True when the recorded cwd was gone and the workspace root was used */
  cwdFallback?: boolean;
  notice?: string;
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
  | 'MANUAL_VERIFICATION_ONLY'
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
  /**
   * HEAD SHA of the working directory when the session was created
   * (non-worktree sessions). Absent on legacy sessions.
   */
  baselineSha?: string;
  startedAt: string;
  completedAt?: string;
  terminalReason?: RalphTerminalReason;
  iterations: RalphIterationRecord[];
  /** Multi-loop history. Absent on pre-existing single-loop sessions. */
  loops?: RalphLoopRecord[];
  /** Final-check automation records. Absent on legacy sessions. */
  finalChecks?: RalphFinalCheckRecord[];
  /** PR-submit automation records. Absent on legacy sessions. */
  submits?: RalphSubmitRecord[];
  /**
   * Isolated Git worktree backing this session, when the launch opted into
   * worktree execution. Persisted by the target server so resume/continue and
   * the dashboard chip can recover the worktree checkout. Absent for
   * non-worktree sessions.
   */
  worktree?: WorktreeMetadata;
}

// ============================================================================
// Final-check types (AC-03, AC-06)
// ============================================================================

export type RalphFinalCheckStatus = 'queued' | 'running' | 'completed' | 'failed';

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

// ============================================================================
// PR-submit types
// ============================================================================

export type RalphSubmitStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Metadata record for one PR-submit run within a Ralph session. */
export interface RalphSubmitRecord {
  /** 1-based index of this submit within the session. */
  submitIndex: number;
  taskId?: string;
  processId?: string;
  startedAt: string;
  completedAt?: string;
  status: RalphSubmitStatus;
  /** URL of the created pull request; set on successful completion. */
  prUrl?: string;
  prNumber?: number;
  /** Commit SHAs included in the pull request, oldest first. */
  commitShas?: string[];
  /** Failure reason; set when status is 'failed'. */
  error?: string;
}

/** Response of `POST /workspaces/:id/ralph-sessions/:sessionId/submit-pr`. */
export interface RalphSubmitPrResponse {
  submitted: true;
  sessionId: string;
  taskId: string;
  submitIndex: number;
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

export interface RalphResumeAiDefaults {
  provider?: ChatProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  effortTier?: EffortTierKey;
  autoProviderRouting?: boolean;
}

export interface RalphSessionResponse {
  record: RalphSessionRecord;
  sections: ParsedProgressSection[];
  files: RalphSessionFile[];
  /**
   * True when a queued/running Ralph task still exists for this session.
   * Distinguishes a stuck `phase=executing` session (no in-flight task) from
   * a healthy in-progress one. Optional for backward compatibility with
   * servers that predate this field.
   */
  hasInFlightTask?: boolean;
  resumeDefaults?: RalphResumeAiDefaults;
}

export interface RalphContinueResponse {
  resumed: true;
  sessionId: string;
  workspaceId: string;
  taskId: string;
  nextIteration: number;
  newMaxIterations: number;
}

export interface RalphContinueRequest {
  additionalIterations?: number;
  provider?: ChatProvider;
  config?: {
    model?: string;
    reasoningEffort?: ReasoningEffort;
    effortTier?: EffortTierKey;
  };
  autoProviderRouting?: boolean;
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

export interface RalphResumeRequest {
  provider?: ChatProvider;
  config?: {
    model?: string;
    reasoningEffort?: ReasoningEffort;
    effortTier?: EffortTierKey;
  };
  autoProviderRouting?: boolean;
}
