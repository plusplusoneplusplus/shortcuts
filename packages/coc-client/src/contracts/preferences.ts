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
  [key: string]: unknown;
}

export interface PerRepoPreferences {
  lastModel?: string;
  lastModels?: Record<string, string | undefined>;
  lastDepth?: string;
  lastEffort?: string;
  lastSkills?: Record<string, string[] | undefined>;
  skillUsageMap?: Record<string, string>;
  linkedRepoIds?: string[];
  disabledLlmTools?: string[];
  filesViewMode?: 'flat' | 'tree';
  boundedMemory?: {
    enabled?: boolean;
    charLimit?: number;
    writeFrequency?: 'low' | 'medium' | 'high';
    autoPromote?: {
      mode: 'off' | 'threshold' | 'cron' | 'cron+threshold';
      cron?: string;
      timezone?: string;
      thresholdCount?: number;
      minIntervalMs?: number;
      gates?: {
        minScore?: number;
        minRecallCount?: number;
        minUniqueQueries?: number;
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
