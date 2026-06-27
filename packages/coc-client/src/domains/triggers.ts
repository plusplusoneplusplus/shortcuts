import type {
  CreateTriggerRequest,
  ListTriggersResponse,
  Trigger,
  TriggerDeleteResponse,
  TriggerMutationResponse,
  TriggerStatus,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function triggersPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/triggers${suffix}`;
}

function triggerPath(workspaceId: string, triggerId: string, suffix = ''): string {
  return triggersPath(workspaceId, `/${encodePathSegment(triggerId)}${suffix}`);
}

export class TriggersClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string): Promise<Trigger[]> {
    const response = await this.transport.request<ListTriggersResponse>(triggersPath(workspaceId));
    return response.triggers ?? [];
  }

  async listAll(): Promise<Trigger[]> {
    const response = await this.transport.request<ListTriggersResponse>('/triggers');
    return response.triggers ?? [];
  }

  async get(workspaceId: string, triggerId: string): Promise<Trigger> {
    const response = await this.transport.request<{ trigger: Trigger }>(triggerPath(workspaceId, triggerId));
    return response.trigger;
  }

  async create(workspaceId: string, request: CreateTriggerRequest): Promise<Trigger> {
    const response = await this.transport.request<TriggerMutationResponse>(triggersPath(workspaceId), {
      method: 'POST',
      body: { ...request },
    });
    return response.trigger;
  }

  patchStatus(workspaceId: string, triggerId: string, status: TriggerStatus): Promise<TriggerMutationResponse> {
    return this.transport.request<TriggerMutationResponse>(triggerPath(workspaceId, triggerId), {
      method: 'PATCH',
      body: { status },
    });
  }

  pause(workspaceId: string, triggerId: string): Promise<TriggerMutationResponse> {
    return this.patchStatus(workspaceId, triggerId, 'paused');
  }

  resume(workspaceId: string, triggerId: string): Promise<TriggerMutationResponse> {
    return this.patchStatus(workspaceId, triggerId, 'active');
  }

  delete(workspaceId: string, triggerId: string): Promise<TriggerDeleteResponse> {
    return this.transport.request<TriggerDeleteResponse>(triggerPath(workspaceId, triggerId), {
      method: 'DELETE',
    });
  }
}
