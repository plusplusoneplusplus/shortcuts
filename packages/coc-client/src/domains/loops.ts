import type { ListLoopsResponse, LoopDeleteResponse, LoopEntry, LoopMutationResponse } from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function loopsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/loops${suffix}`;
}

function loopPath(workspaceId: string, loopId: string, suffix = ''): string {
  return loopsPath(workspaceId, `/${encodePathSegment(loopId)}${suffix}`);
}

export class LoopsClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string): Promise<LoopEntry[]> {
    const response = await this.transport.request<ListLoopsResponse>(loopsPath(workspaceId));
    return response.loops ?? [];
  }

  async listAll(): Promise<LoopEntry[]> {
    const response = await this.transport.request<ListLoopsResponse>('/loops');
    return response.loops ?? [];
  }

  async get(workspaceId: string, loopId: string): Promise<LoopEntry> {
    const response = await this.transport.request<{ loop: LoopEntry }>(loopPath(workspaceId, loopId));
    return response.loop;
  }

  patch(workspaceId: string, loopId: string, fields: Partial<Pick<LoopEntry, 'description' | 'prompt' | 'intervalMs' | 'model'>>): Promise<LoopMutationResponse> {
    return this.transport.request<LoopMutationResponse>(loopPath(workspaceId, loopId), {
      method: 'PATCH',
      body: { ...fields },
    });
  }

  delete(workspaceId: string, loopId: string): Promise<LoopDeleteResponse> {
    return this.transport.request<LoopDeleteResponse>(loopPath(workspaceId, loopId), {
      method: 'DELETE',
    });
  }

  pause(workspaceId: string, loopId: string, reason?: string): Promise<LoopMutationResponse> {
    return this.transport.request<LoopMutationResponse>(loopPath(workspaceId, loopId, '/pause'), {
      method: 'POST',
      body: { reason },
    });
  }

  resume(workspaceId: string, loopId: string): Promise<LoopMutationResponse> {
    return this.transport.request<LoopMutationResponse>(loopPath(workspaceId, loopId, '/resume'), {
      method: 'POST',
    });
  }
}
