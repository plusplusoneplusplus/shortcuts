export interface GlobalPreferences {
  theme?: 'light' | 'dark' | 'auto';
  reposSidebarCollapsed?: boolean;
  gitGroupOrder?: string[];
  hasSeenWelcome?: boolean;
  dismissedTips?: string[];
  uiLayoutMode?: 'classic' | 'dev-workflow';
  [key: string]: unknown;
}

export interface PerRepoPreferences {
  lastModel?: string;
  lastModels?: Record<string, string | undefined>;
  lastDepth?: 'deep' | 'normal';
  lastEffort?: 'low' | 'medium' | 'high';
  lastSkills?: Record<string, string[] | undefined>;
  skillUsageMap?: Record<string, string>;
  linkedRepoIds?: string[];
  disabledLlmTools?: string[];
  [key: string]: unknown;
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
