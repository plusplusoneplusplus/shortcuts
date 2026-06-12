import type {
  ListTaskGroupsQuery,
  ListTaskGroupsResponse,
  TaskGroupResponse,
  TaskGroupSummary,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function groupsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/task-groups${suffix}`;
}

export class TaskGroupsClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string, query?: ListTaskGroupsQuery): Promise<TaskGroupSummary[]> {
    const params = new URLSearchParams();
    if (query?.type) params.set('type', query.type);
    if (query?.includeHidden) params.set('includeHidden', 'true');
    const queryString = params.toString();
    const response = await this.transport.request<ListTaskGroupsResponse>(
      groupsPath(workspaceId, queryString ? `?${queryString}` : ''),
    );
    return response.groups ?? [];
  }

  async get(workspaceId: string, groupId: string): Promise<TaskGroupSummary> {
    const response = await this.transport.request<TaskGroupResponse>(
      groupsPath(workspaceId, `/${encodePathSegment(groupId)}`),
    );
    return response.group;
  }
}
