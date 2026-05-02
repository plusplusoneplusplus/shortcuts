import type {
  CreateWorkItemRequest,
  ExecuteWorkItemRequest,
  UpdateWorkItemRequest,
  WorkItem,
  WorkItemFilter,
  WorkItemGroupedResponse,
  WorkItemListResponse,
  WorkItemPlanVersion,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function path(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/work-items${suffix}`;
}

function serializeFilter(filter?: WorkItemFilter): Record<string, string | number | undefined> | undefined {
  if (!filter) return undefined;
  return {
    ...filter,
    status: Array.isArray(filter.status) ? filter.status.join(',') : filter.status,
    tags: filter.tags?.join(','),
  };
}

export class WorkItemsClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(workspaceId: string, filter?: WorkItemFilter): Promise<WorkItemListResponse> {
    return this.transport.request<WorkItemListResponse>(path(workspaceId), { query: serializeFilter(filter) });
  }

  grouped(workspaceId: string, filter?: Omit<WorkItemFilter, 'status' | 'offset'>): Promise<WorkItemGroupedResponse> {
    return this.transport.request<WorkItemGroupedResponse>(path(workspaceId, '/grouped'), { query: serializeFilter(filter) });
  }

  create(workspaceId: string, request: CreateWorkItemRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId), { method: 'POST', body: { ...request } });
  }

  get(workspaceId: string, workItemId: string): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}`));
  }

  update(workspaceId: string, workItemId: string, request: UpdateWorkItemRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}`), {
      method: 'PATCH',
      body: { ...request },
    });
  }

  delete(workspaceId: string, workItemId: string): Promise<void> {
    return this.transport.request<void>(path(workspaceId, `/${encodePathSegment(workItemId)}`), { method: 'DELETE' });
  }

  getPlan(workspaceId: string, workItemId: string): Promise<{ plan: unknown; versions: number }> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/plan`));
  }

  updatePlan(workspaceId: string, workItemId: string, content: string, options?: { resolvedBy?: string; summary?: string }): Promise<{ plan: WorkItemPlanVersion; version: number }> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/plan`), {
      method: 'PUT',
      body: { content, ...options },
    });
  }

  planVersions(workspaceId: string, workItemId: string): Promise<WorkItemPlanVersion[]> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/plan/versions`));
  }

  execute(workspaceId: string, workItemId: string, request: ExecuteWorkItemRequest = {}): Promise<unknown> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/execute`), {
      method: 'POST',
      body: { ...request },
    });
  }
}
