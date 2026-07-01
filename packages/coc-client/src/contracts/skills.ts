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

/** Origin of an effective skill-search-order path; drives the UI source badge. */
export type EffectiveSkillPathSource =
  | 'repo'
  | 'managed-global'
  | 'auto-detected'
  | 'configured'
  | 'repo-extra'
  | 'bundled';

/** Availability of an effective skill-search-order path; drives the UI status badge. */
export type EffectiveSkillPathStatus = 'available' | 'no-skills' | 'missing' | 'skipped';

/** Whether an effective skill-search-order path applies globally or per-workspace. */
export type EffectiveSkillPathScope = 'global' | 'workspace';

/**
 * A single directory in the agent's effective skill search order, annotated for
 * read-only diagnostic display. Missing/skipped declared sources are retained so
 * the UI can explain exactly what the agent will (and will not) use.
 */
export interface EffectiveSkillPath {
  source: EffectiveSkillPathSource;
  scope: EffectiveSkillPathScope;
  status: EffectiveSkillPathStatus;
  /** Absolute host-filesystem path (or the raw configured value when skipped). */
  path: string;
  /** Installed skill count found in the directory (present only when it exists). */
  skillCount?: number;
  /** Optional human-readable note (e.g. why a declared folder was skipped). */
  note?: string;
}

/**
 * Structured effective skill search order returned by `GET /api/skills/effective-paths`.
 * When `workspaceId` is set the list includes workspace-scoped paths (repo-local
 * and per-repo extra folders); otherwise it is global-only.
 */
export interface EffectiveSkillPathsResponse {
  /** Echoed active workspace id when the diagnostic is workspace-scoped. */
  workspaceId?: string;
  paths: EffectiveSkillPath[];
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
