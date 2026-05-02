import type { GlobalPreferences, PerRepoPreferences, SkillUsageResponse } from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

export class PreferencesClient {
  constructor(private readonly transport: RequestAdapter) {}

  getGlobal(): Promise<GlobalPreferences> {
    return this.transport.request<GlobalPreferences>('/preferences');
  }

  replaceGlobal(preferences: GlobalPreferences): Promise<GlobalPreferences> {
    return this.transport.request<GlobalPreferences>('/preferences', { method: 'PUT', body: { ...preferences } });
  }

  patchGlobal(preferences: GlobalPreferences): Promise<GlobalPreferences> {
    return this.transport.request<GlobalPreferences>('/preferences', { method: 'PATCH', body: { ...preferences } });
  }

  getRepo(workspaceId: string): Promise<PerRepoPreferences> {
    return this.transport.request<PerRepoPreferences>(`/workspaces/${encodePathSegment(workspaceId)}/preferences`);
  }

  replaceRepo(workspaceId: string, preferences: PerRepoPreferences): Promise<PerRepoPreferences> {
    return this.transport.request<PerRepoPreferences>(`/workspaces/${encodePathSegment(workspaceId)}/preferences`, {
      method: 'PUT',
      body: { ...preferences },
    });
  }

  patchRepo(workspaceId: string, preferences: PerRepoPreferences): Promise<PerRepoPreferences> {
    return this.transport.request<PerRepoPreferences>(`/workspaces/${encodePathSegment(workspaceId)}/preferences`, {
      method: 'PATCH',
      body: { ...preferences },
    });
  }

  recordSkillUsage(workspaceId: string, skillName: string): Promise<SkillUsageResponse> {
    return this.transport.request<SkillUsageResponse>(`/workspaces/${encodePathSegment(workspaceId)}/preferences/skill-usage`, {
      method: 'PATCH',
      body: { skillName },
    });
  }
}
