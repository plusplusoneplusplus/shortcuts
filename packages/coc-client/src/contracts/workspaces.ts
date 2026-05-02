export interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  color?: string;
  remoteUrl?: string;
  description?: string;
  isGitRepo?: boolean;
  virtual?: boolean;
  [key: string]: unknown;
}

export interface WorkspacesResponse {
  workspaces: WorkspaceInfo[];
}

export interface RegisterWorkspaceRequest {
  id: string;
  name: string;
  rootPath: string;
  color?: string;
  remoteUrl?: string;
  description?: string;
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
