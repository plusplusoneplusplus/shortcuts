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

export interface WorkspaceMcpServerEntry {
  name: string;
  type: string;
  url?: string;
  [key: string]: unknown;
}

export interface WorkspaceMcpConfigResponse {
  availableServers: WorkspaceMcpServerEntry[];
  enabledMcpServers: string[] | null;
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

export interface MyLifeSummaryResponse {
  generated: boolean;
  path: string;
  completedCount: number;
  inProgressCount: number;
  journalCount: number;
}
