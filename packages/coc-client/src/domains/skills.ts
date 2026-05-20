import type {
  DiscoveredSkill,
  GlobalSkillsConfig,
  InstallSkillsRequest,
  InstallSkillsResponse,
  ListBundledSkillsResponse,
  ListSkillsResponse,
  MergedSkillsResponse,
  ScanSkillsRequest,
  ScanSkillsResponse,
  SkillDetailResponse,
  SkillFileResponse,
  SkillInfo,
  SkillUsageListResponse,
  SkillUsageQuery,
  SkillUsageResponse,
  UpdateGlobalSkillsConfigRequest,
  UpdateWorkspaceSkillsConfigRequest,
  WorkspaceSkillsConfig,
  WorkspaceSkillsPathResponse,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function skillsPath(suffix = ''): string {
  return `/skills${suffix}`;
}

function workspaceSkillsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/skills${suffix}`;
}

function workspacePreferencesPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/preferences${suffix}`;
}

function serializeSkillUsageQuery(query?: SkillUsageQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    skillName: query.skillName,
    since: query.since,
  };
}

export class SkillsClient {
  constructor(private readonly transport: RequestAdapter) {}

  async listGlobal(): Promise<SkillInfo[]> {
    const response = await this.transport.request<ListSkillsResponse>(skillsPath());
    return response.skills ?? [];
  }

  async listBundledGlobal(): Promise<DiscoveredSkill[]> {
    const response = await this.transport.request<ListBundledSkillsResponse>(skillsPath('/bundled'));
    return response.skills ?? [];
  }

  detailGlobal(skillName: string): Promise<SkillDetailResponse> {
    return this.transport.request<SkillDetailResponse>(skillsPath(`/${encodePathSegment(skillName)}`));
  }

  scanGlobal(request: ScanSkillsRequest): Promise<ScanSkillsResponse> {
    return this.transport.request<ScanSkillsResponse>(skillsPath('/scan'), {
      method: 'POST',
      body: { ...request },
    });
  }

  installGlobal(request: InstallSkillsRequest): Promise<InstallSkillsResponse> {
    return this.transport.request<InstallSkillsResponse>(skillsPath('/install'), {
      method: 'POST',
      body: { ...request },
    });
  }

  getGlobalConfig(): Promise<GlobalSkillsConfig> {
    return this.transport.request<GlobalSkillsConfig>(skillsPath('/config'));
  }

  updateGlobalConfig(request: UpdateGlobalSkillsConfigRequest): Promise<GlobalSkillsConfig> {
    return this.transport.request<GlobalSkillsConfig>(skillsPath('/config'), {
      method: 'PUT',
      body: { ...request },
    });
  }

  deleteGlobal(skillName: string): Promise<void> {
    return this.transport.request<void>(skillsPath(`/${encodePathSegment(skillName)}`), {
      method: 'DELETE',
    });
  }

  async listWorkspace(workspaceId: string): Promise<SkillInfo[]> {
    const response = await this.transport.request<ListSkillsResponse>(workspaceSkillsPath(workspaceId));
    return response.skills ?? [];
  }

  async listBundledWorkspace(workspaceId: string): Promise<DiscoveredSkill[]> {
    const response = await this.transport.request<ListBundledSkillsResponse>(workspaceSkillsPath(workspaceId, '/bundled'));
    return response.skills ?? [];
  }

  listAllWorkspace(workspaceId: string): Promise<MergedSkillsResponse> {
    return this.transport.request<MergedSkillsResponse>(workspaceSkillsPath(workspaceId, '/all'));
  }

  scanWorkspace(workspaceId: string, request: ScanSkillsRequest): Promise<ScanSkillsResponse> {
    return this.transport.request<ScanSkillsResponse>(workspaceSkillsPath(workspaceId, '/scan'), {
      method: 'POST',
      body: { ...request },
    });
  }

  getWorkspacePath(workspaceId: string): Promise<WorkspaceSkillsPathResponse> {
    return this.transport.request<WorkspaceSkillsPathResponse>(`/workspaces/${encodePathSegment(workspaceId)}/skills-path`);
  }

  getWorkspaceConfig(workspaceId: string): Promise<WorkspaceSkillsConfig> {
    return this.transport.request<WorkspaceSkillsConfig>(`/workspaces/${encodePathSegment(workspaceId)}/skills-config`);
  }

  updateWorkspaceConfig(workspaceId: string, request: UpdateWorkspaceSkillsConfigRequest): Promise<{ workspace: unknown }> {
    return this.transport.request<{ workspace: unknown }>(`/workspaces/${encodePathSegment(workspaceId)}/skills-config`, {
      method: 'PUT',
      body: {
        disabledSkills: [...request.disabledSkills],
        ...(request.extraSkillFolders ? { extraSkillFolders: [...request.extraSkillFolders] } : {}),
      },
    });
  }

  installWorkspace(workspaceId: string, request: InstallSkillsRequest): Promise<InstallSkillsResponse> {
    return this.transport.request<InstallSkillsResponse>(workspaceSkillsPath(workspaceId, '/install'), {
      method: 'POST',
      body: { ...request },
    });
  }

  detailWorkspace(workspaceId: string, skillName: string): Promise<SkillDetailResponse> {
    return this.transport.request<SkillDetailResponse>(workspaceSkillsPath(workspaceId, `/${encodePathSegment(skillName)}`));
  }

  readWorkspaceSkillFile(
    workspaceId: string,
    skillName: string,
    filePath: string,
  ): Promise<SkillFileResponse> {
    return this.transport.request<SkillFileResponse>(
      workspaceSkillsPath(workspaceId, `/${encodePathSegment(skillName)}/file`),
      { query: { path: filePath } },
    );
  }

  deleteWorkspace(workspaceId: string, skillName: string): Promise<void> {
    return this.transport.request<void>(workspaceSkillsPath(workspaceId, `/${encodePathSegment(skillName)}`), {
      method: 'DELETE',
    });
  }

  recordUsage(workspaceId: string, skillName: string): Promise<SkillUsageResponse> {
    return this.transport.request<SkillUsageResponse>(workspacePreferencesPath(workspaceId, '/skill-usage'), {
      method: 'PATCH',
      body: { skillName },
    });
  }

  getUsage(workspaceId: string, query?: SkillUsageQuery): Promise<SkillUsageListResponse> {
    return this.transport.request<SkillUsageListResponse>(workspacePreferencesPath(workspaceId, '/skill-usage'), {
      query: serializeSkillUsageQuery(query),
    });
  }
}
