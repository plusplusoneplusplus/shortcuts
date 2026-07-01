export type SkillSource = 'global' | 'repo' | 'bundled' | 'linked-repo' | 'extra-folder';

export interface SkillInfo {
  name: string;
  description?: string;
  version?: string;
  variables?: string[];
  output?: string[];
  promptBody?: string;
  references?: string[];
  scripts?: string[];
  relativePath?: string;
  source?: SkillSource;
  sourceRepoId?: string;
  folderPath?: string;
  folderLabel?: string;
}

export interface DiscoveredSkill {
  name: string;
  description?: string;
  path: string;
  alreadyExists?: boolean;
}

export interface ListSkillsResponse {
  skills: SkillInfo[];
}

export interface ListBundledSkillsResponse {
  skills: DiscoveredSkill[];
}

export interface SkillDetailResponse {
  skill: SkillInfo;
}

export interface ScanSkillsRequest {
  url: string;
}

export interface ScanSkillsResponse {
  success: boolean;
  error?: string;
  skills: DiscoveredSkill[];
}

export interface InstallSkillsRequest {
  source?: 'bundled' | 'github' | 'local' | 'clawhub';
  url?: string;
  skills?: string[];
  skillsToInstall?: DiscoveredSkill[];
  replace?: boolean;
}

export interface InstallSkillDetail {
  name: string;
  success: boolean;
  reason?: string;
  action: 'installed' | 'replaced' | 'skipped' | 'failed';
}

export interface InstallSkillsResponse {
  installed: number;
  skipped: number;
  failed: number;
  details: InstallSkillDetail[];
}

export interface GlobalSkillsConfig {
  globalDisabledSkills: string[];
  globalSkillsDir: string;
  /**
   * Configured global extra skill-source folders (`skills.globalExtraFolders`).
   * Read-only sources applied across all workspaces; CoC never installs/deletes
   * into them. Absolute paths or `~`-prefixed home paths.
   */
  globalExtraFolders: string[];
  /**
   * Whether default skill-folder auto-detection (OneDrive/CloudStorage) is
   * enabled (`skills.autoDetectDefaultFolders`). Defaults to true.
   */
  autoDetectDefaultFolders: boolean;
}

export interface UpdateGlobalSkillsConfigRequest {
  globalDisabledSkills: string[];
  /** When provided, replaces the configured global extra skill folders. */
  globalExtraFolders?: string[];
  /** When provided, toggles default skill-folder auto-detection. */
  autoDetectDefaultFolders?: boolean;
}

export interface MergedSkillsResponse {
  global: SkillInfo[];
  repo: SkillInfo[];
  merged: SkillInfo[];
}

export interface WorkspaceSkillsPathResponse {
  path: string;
  skillCount: number;
  accessible: boolean;
}

export interface WorkspaceSkillsConfig {
  disabledSkills: string[];
  extraSkillFolders: string[];
}

export interface UpdateWorkspaceSkillsConfigRequest {
  disabledSkills: string[];
  extraSkillFolders?: string[];
}

export interface SkillFileResponse {
  path: string;
  content: string;
  size: number;
}
