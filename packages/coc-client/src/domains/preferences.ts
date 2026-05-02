import type {
  GlobalPreferences,
  PerRepoPreferences,
  SkillUsageListResponse,
  SkillUsageQuery,
  SkillUsageResponse,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function repoPreferencesPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/preferences${suffix}`;
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

  getSkillUsage(workspaceId: string, query?: SkillUsageQuery): Promise<SkillUsageListResponse> {
    return this.transport.request<SkillUsageListResponse>(repoPreferencesPath(workspaceId, '/skill-usage'), {
      query: serializeSkillUsageQuery(query),
    });
  }
}
