import type {
  GlobalPreferences,
  EnDevEligibilityStatus,
  LlmToolsConfig,
  LlmToolsConfigUpdate,
  PerRepoPreferences,
  SkillUsageListResponse,
  SkillUsageQuery,
  SkillUsageResponse,
  TaskSettings,
  TaskSettingsUpdate,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function repoPreferencesPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/preferences${suffix}`;
}

function workspacePath(workspaceId: string, suffix: string): string {
  return `/workspaces/${encodePathSegment(workspaceId)}${suffix}`;
}

function serializeSkillUsageQuery(query?: SkillUsageQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    skillName: query.skillName,
    since: query.since,
  };
}

export class PreferencesClient {
  constructor(private readonly transport: RequestAdapter) {}

  getGlobal(): Promise<GlobalPreferences> {
    return this.transport.request<GlobalPreferences>('/preferences');
  }

  replaceGlobal(preferences: GlobalPreferences): Promise<GlobalPreferences> {
    return this.transport.request<GlobalPreferences>('/preferences', { method: 'PUT', body: { ...preferences } });
  }

  patchGlobal(preferences: GlobalPreferences): Promise<GlobalPreferences> {
    return this.updateGlobal(preferences);
  }

  updateGlobal(preferences: GlobalPreferences): Promise<GlobalPreferences> {
    return this.transport.request<GlobalPreferences>('/preferences', { method: 'PATCH', body: { ...preferences } });
  }

  getRepo(workspaceId: string): Promise<PerRepoPreferences> {
    return this.transport.request<PerRepoPreferences>(repoPreferencesPath(workspaceId));
  }

  replaceRepo(workspaceId: string, preferences: PerRepoPreferences): Promise<PerRepoPreferences> {
    return this.transport.request<PerRepoPreferences>(repoPreferencesPath(workspaceId), {
      method: 'PUT',
      body: { ...preferences },
    });
  }

  patchRepo(workspaceId: string, preferences: PerRepoPreferences): Promise<PerRepoPreferences> {
    return this.updateRepo(workspaceId, preferences);
  }

  updateRepo(workspaceId: string, preferences: PerRepoPreferences): Promise<PerRepoPreferences> {
    return this.transport.request<PerRepoPreferences>(repoPreferencesPath(workspaceId), {
      method: 'PATCH',
      body: { ...preferences },
    });
  }

  recordSkillUsage(workspaceId: string, skillName: string): Promise<SkillUsageResponse> {
    return this.transport.request<SkillUsageResponse>(repoPreferencesPath(workspaceId, '/skill-usage'), {
      method: 'PATCH',
      body: { skillName },
    });
  }

  recordCommitSkillUsage(workspaceId: string, skillName: string): Promise<SkillUsageResponse> {
    return this.transport.request<SkillUsageResponse>(repoPreferencesPath(workspaceId, '/commit-skill-usage'), {
      method: 'PATCH',
      body: { skillName },
    });
  }

  getSkillUsage(workspaceId: string, query?: SkillUsageQuery): Promise<SkillUsageListResponse> {
    return this.transport.request<SkillUsageListResponse>(repoPreferencesPath(workspaceId, '/skill-usage'), {
      query: serializeSkillUsageQuery(query),
    });
  }

  getCommitSkillUsage(workspaceId: string, query?: SkillUsageQuery): Promise<SkillUsageListResponse> {
    return this.transport.request<SkillUsageListResponse>(repoPreferencesPath(workspaceId, '/commit-skill-usage'), {
      query: serializeSkillUsageQuery(query),
    });
  }

  getTaskSettings(workspaceId: string): Promise<TaskSettings> {
    return this.transport.request<TaskSettings>(workspacePath(workspaceId, '/tasks/settings'));
  }

  updateTaskSettings(workspaceId: string, settings: TaskSettingsUpdate): Promise<TaskSettings> {
    return this.transport.request<TaskSettings>(workspacePath(workspaceId, '/tasks/settings'), {
      method: 'PATCH',
      body: { folderPaths: [...settings.folderPaths] },
    });
  }

  getLlmToolsConfig(workspaceId: string): Promise<LlmToolsConfig> {
    return this.transport.request<LlmToolsConfig>(workspacePath(workspaceId, '/llm-tools-config'));
  }

  updateLlmToolsConfig(workspaceId: string, config: LlmToolsConfigUpdate): Promise<LlmToolsConfig> {
    return this.transport.request<LlmToolsConfig>(workspacePath(workspaceId, '/llm-tools-config'), {
      method: 'PUT',
      body: { disabledLlmTools: [...config.disabledLlmTools] },
    });
  }

  getEnDevStatus(workspaceId: string, options?: { refresh?: boolean }): Promise<EnDevEligibilityStatus> {
    return this.transport.request<EnDevEligibilityStatus>(workspacePath(workspaceId, '/endev/status'), {
      query: options?.refresh ? { refresh: 'true' } : undefined,
    });
  }

  revalidateEnDev(workspaceId: string): Promise<EnDevEligibilityStatus> {
    return this.transport.request<EnDevEligibilityStatus>(workspacePath(workspaceId, '/endev/revalidate'), {
      method: 'POST',
    });
  }
}
