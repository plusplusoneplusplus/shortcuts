
export interface GlobalPreferences {
  theme?: 'light' | 'dark' | 'auto';
  reposSidebarCollapsed?: boolean;
  gitGroupOrder?: string[];
  repoTabOrder?: string[];
  recentRemotes?: string[];
  hasSeenWelcome?: boolean;
  dismissedTips?: string[];
  /** Engine for the working-tree file diff. Absent means `monaco`. */
  diffEngine?: 'legacy' | 'monaco';
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
  /** LLM tools that pause for user approval on interactive turns. Default `[]`. */
  approvalRequiredLlmTools?: string[];
  filesViewMode?: 'flat' | 'tree';
  /** Repo-wide default model used when no explicit model is provided. */
  defaultModel?: string;
  /** Per-mode default model overrides. Take precedence over defaultModel. */
  defaultModels?: Record<string, string | undefined>;
  /** Max iterations a Ralph loop runs before stopping. Range 1..200. */
  maxRalphIterations?: number;
  /** Last agent provider selected for new chats in this workspace. Persisted per-repo. */
  lastChatProvider?: 'copilot' | 'codex' | 'claude' | 'opencode' | 'auto';
  /** Git-based notes sync settings (only for my_work / my_life virtual workspaces). */
  sync?: {
    gitRemote?: string;
    intervalMinutes?: number;
  };
  /**
   * Opt-in per-repo auto-pull: while enabled, the GIT panel runs `git pull` on the
   * current branch every `intervalMinutes`. Off by default; only runs when enabled.
   */
  autoPull?: {
    enabled: boolean;
    intervalMinutes: number;
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
        /** Whether background Azure Boards→local polling is active for imported Azure Boards-backed Epics. Defaults to true. */
        pollingEnabled?: boolean;
        /** Background Azure Boards→local polling cadence in minutes. Defaults to 5. */
        pollIntervalMinutes?: number;
      };
    };
  };
  /** Workspace opt-in for reviewable dream cards. Global dreams.enabled must also be on. */
  dreams?: {
    enabled?: boolean;
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

/**
 * Compact, display-only description of a single LLM tool input parameter.
 * Derived from a tool's JSON-schema `parameters` for the settings UI; it never
 * affects tool execution or persisted preferences.
 */
export interface LlmToolParam {
  /** Parameter name as declared in the tool input schema. */
  name: string;
  /**
   * Compact type label: a JSON-schema primitive (`string`, `number`,
   * `boolean`, `integer`), `{...}` for nested objects, `[...]` for arrays,
   * `enum` for typeless enums, or `any` when the type cannot be determined.
   */
  type: string;
  /** Whether the parameter is required by the tool's input schema. */
  required: boolean;
}

export interface LlmToolMeta {
  name: string;
  label: string;
  description: string;
  enabledByDefault: boolean;
  /**
   * Optional, additive compact parameter summary derived from the tool's input
   * schema. Absent when no JSON-schema is available (render as "parameters
   * unavailable"); an empty array means the tool takes no parameters. Existing
   * clients that only read name/label/description/enabledByDefault ignore this.
   */
  params?: LlmToolParam[];
  /** Whether the tool can be marked "require approval" (false for ask_user / suggest_follow_ups). */
  approvalGateable?: boolean;
}

export interface LlmToolsConfig {
  tools: LlmToolMeta[];
  disabledLlmTools: string[];
  /** Tools that pause for user approval on interactive turns. */
  approvalRequiredLlmTools?: string[];
  /** True when the active process store can provide get_conversation/search_conversations. */
  conversationRetrievalAvailable: boolean;
}

/** At least one list must be provided; omitted lists are left unchanged. */
export interface LlmToolsConfigUpdate {
  disabledLlmTools?: string[];
  approvalRequiredLlmTools?: string[];
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
