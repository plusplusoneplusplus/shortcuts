export interface GlobalPreferences {
  theme?: 'light' | 'dark' | 'auto';
  reposSidebarCollapsed?: boolean;
  gitGroupOrder?: string[];
  repoTabOrder?: string[];
  hasSeenWelcome?: boolean;
  dismissedTips?: string[];
  uiLayoutMode?: 'classic' | 'dev-workflow';
  htmlEmbed?: {
    enabled?: boolean;
  };
  promptAutocomplete?: {
    enabled?: boolean;
    ai?: {
      enabled?: boolean;
      debounceMs?: number;
      timeoutMs?: number;
      maxHistoryItems?: number;
      maxCompletionChars?: number;
      includeGlobalHistory?: boolean;
    };
  };
  /** Global Memory V2 settings — independent of any workspace. */
  memoryV2?: {
    enabled?: boolean;
    frozenSnapshotLimit?: number;
    recallLimit?: number;
  };
  [key: string]: unknown;
}

export interface PerRepoPreferences {
  lastModel?: string;
  lastModels?: Record<string, string | undefined>;
  lastDepth?: string;
  lastEffort?: string;
  lastSkills?: Record<string, string[] | undefined>;
  skillUsageMap?: Record<string, string>;
  /** Commit-scoped skill usage timestamps for the Git tab context menu (skillName → ISO timestamp). */
  commitSkillUsageMap?: Record<string, string>;
  linkedRepoIds?: string[];
  disabledLlmTools?: string[];
  filesViewMode?: 'flat' | 'tree';
  /** Repo-wide default model used when no explicit model is provided. */
  defaultModel?: string;
  /** Per-mode default model overrides. Take precedence over defaultModel. */
  defaultModels?: Record<string, string | undefined>;
  /** Max iterations a Ralph loop runs before stopping. Range 1..200. */
  maxRalphIterations?: number;
  /** Last agent provider selected for new chats in this workspace. Persisted per-repo. */
  lastChatProvider?: 'copilot' | 'codex' | 'claude';
  /** Git-based notes sync settings (only for my_work / my_life virtual workspaces). */
  sync?: {
    gitRemote?: string;
    intervalMinutes?: number;
  };
  /** Work-item feature preferences scoped to this workspace. Never stores credentials. */
  workItems?: {
    sync?: {
      github?: {
        /** Optional non-secret owner override when origin cannot identify the GitHub repo. */
        owner?: string;
        /** Optional non-secret repository-name override when origin cannot identify the GitHub repo. */
        repo?: string;
        /** Whether background GitHub→local polling is active for imported GitHub-backed Epics. Defaults to true. */
        pollingEnabled?: boolean;
        /** Background GitHub→local polling cadence in minutes. Defaults to 5. */
        pollIntervalMinutes?: number;
      };
      azureBoards?: {
        /** Azure Boards project name for this workspace. Organization URL is global provider config. */
        project?: string;
      };
    };
  };
  [key: string]: unknown;
}

export interface TaskSettings {
  folderPath?: string;
  taskRootPath: string;
  folderPaths: string[];
  hasDefaultFolderPaths?: boolean;
  [key: string]: unknown;
}

export interface TaskSettingsUpdate {
  folderPaths: string[];
}

export interface LlmToolMeta {
  name: string;
  label: string;
  description: string;
  enabledByDefault: boolean;
}

export interface LlmToolsConfig {
  tools: LlmToolMeta[];
  disabledLlmTools: string[];
  /** True when the active process store can provide get_conversation/search_conversations. */
  conversationRetrievalAvailable: boolean;
}

export interface LlmToolsConfigUpdate {
  disabledLlmTools: string[];
}

export interface SkillUsageEntry {
  skillName: string;
  timestamp: string;
}

export interface SkillUsageResponse {
  skillName: string;
  timestamp: string;
}

export interface SkillUsageQuery {
  skillName?: string;
  since?: string;
}

export interface SkillUsageListResponse {
  usage: SkillUsageEntry[];
}

export interface EnDevDoctorResult {
  ok: boolean;
  timedOut?: boolean;
  exitCode?: number | string;
  signal?: string;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface EnDevEligibilityStatus {
  workspaceId: string;
  workspaceRoot: string;
  eligible: boolean;
  reason: 'eligible' | 'not-native-wsl' | 'not-xdpu-workspace' | 'missing-setup-files' | 'doctor-failed';
  nativeWsl: boolean;
  xDpuWorkspace: boolean;
  hasSetupFiles: boolean;
  setupFiles: string[];
  doctor?: EnDevDoctorResult;
  pluginSkillFolder?: string;
  checkedAt: string;
  cached: boolean;
}
