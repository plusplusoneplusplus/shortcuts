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

export interface WorkspaceMcpServerEntry {
  name: string;
  type: string;
  url?: string;
  command?: string;
  source?: WorkspaceMcpServerSource;
  effective?: boolean;
  overriddenBy?: WorkspaceMcpServerSource;
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

export type WorkspaceInstructionMode = 'base' | 'ask' | 'plan' | 'autopilot';

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
  taskId: string;
  processId: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitSignal?: RalphExitSignal;
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
}

export interface ParsedProgressSection {
  iteration: number;
  signal: RalphExitSignal;
  timestamp: string;
  body: string;
}

export interface RalphSessionResponse {
  record: RalphSessionRecord;
  sections: ParsedProgressSection[];
}

export interface RalphContinueResponse {
  resumed: true;
  sessionId: string;
  workspaceId: string;
  taskId: string;
  nextIteration: number;
  newMaxIterations: number;
}
