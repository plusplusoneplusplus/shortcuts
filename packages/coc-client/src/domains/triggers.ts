import type {
  CreateTriggerRequest,
  ListTriggersResponse,
  Trigger,
  TriggerDeleteResponse,
  TriggerMutationResponse,
  TriggerStatus,
  CreateSentinelTodoTriggerRequest,
  EditSentinelTodoTriggerRequest,
  PrTriggerPreview,
  SentinelTodoTriggerCapabilities,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function triggersPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/triggers${suffix}`;
}

function triggerPath(workspaceId: string, triggerId: string, suffix = ''): string {
  return triggersPath(workspaceId, `/${encodePathSegment(triggerId)}${suffix}`);
}

function sentinelPath(workspaceId: string, processId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/sentinel-todos/${encodePathSegment(processId)}/triggers${suffix}`;
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

  /** One manual CI repair, serialized with automatic PR repairs; does not arm polling. */
  async repairCi(workspaceId: string, request: CreateTriggerRequest): Promise<Trigger> {
    const response = await this.transport.request<TriggerMutationResponse>(triggersPath(workspaceId, '/repair'), {
      method: 'POST', body: { ...request },
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

  async listSentinelTodo(workspaceId: string, processId: string): Promise<Trigger[]> {
    const result = await this.transport.request<ListTriggersResponse>(sentinelPath(workspaceId, processId));
    return result.triggers;
  }

  sentinelTodoCapabilities(workspaceId: string, processId: string): Promise<SentinelTodoTriggerCapabilities> {
    return this.transport.request(sentinelPath(workspaceId, processId, '/capabilities'));
  }

  previewSentinelTodo(workspaceId: string, processId: string, input: { prUrl: string }): Promise<PrTriggerPreview> {
    return this.transport.request<PrTriggerPreview>(sentinelPath(workspaceId, processId, '/preview'), {
      method: 'POST', body: { ...input },
    });
  }

  async createSentinelTodo(workspaceId: string, processId: string, input: CreateSentinelTodoTriggerRequest): Promise<Trigger> {
    const result = await this.transport.request<TriggerMutationResponse>(sentinelPath(workspaceId, processId), {
      method: 'POST', body: { ...input },
    });
    return result.trigger;
  }

  async editSentinelTodo(workspaceId: string, processId: string, triggerId: string, input: EditSentinelTodoTriggerRequest): Promise<Trigger> {
    const result = await this.transport.request<TriggerMutationResponse>(
      sentinelPath(workspaceId, processId, `/${encodePathSegment(triggerId)}`),
      { method: 'PATCH', body: { ...input } },
    );
    return result.trigger;
  }

  pauseSentinelTodo(workspaceId: string, processId: string, triggerId: string, expectedRevision: number): Promise<Trigger> {
    return this.sentinelAction(workspaceId, processId, triggerId, '/pause', { expectedRevision });
  }

  resumeSentinelTodo(workspaceId: string, processId: string, triggerId: string, expectedRevision: number, confirmed?: true): Promise<Trigger> {
    return this.sentinelAction(workspaceId, processId, triggerId, '/resume', { expectedRevision, ...(confirmed ? { confirmed } : {}) });
  }

  removeSentinelTodo(workspaceId: string, processId: string, triggerId: string, expectedRevision: number): Promise<TriggerDeleteResponse> {
    return this.transport.request<TriggerDeleteResponse>(
      sentinelPath(workspaceId, processId, `/${encodePathSegment(triggerId)}`),
      { method: 'DELETE', body: { expectedRevision } },
    );
  }

  runSentinelTodoNow(workspaceId: string, processId: string, triggerId: string, expectedRevision: number): Promise<Trigger> {
    return this.sentinelAction(workspaceId, processId, triggerId, '/run-now', { expectedRevision, confirmed: true });
  }

  private async sentinelAction(
    workspaceId: string, processId: string, triggerId: string, suffix: string, body: Record<string, unknown>,
  ): Promise<Trigger> {
    const result = await this.transport.request<TriggerMutationResponse>(
      sentinelPath(workspaceId, processId, `/${encodePathSegment(triggerId)}${suffix}`), { method: 'POST', body },
    );
    return result.trigger;
  }
}
