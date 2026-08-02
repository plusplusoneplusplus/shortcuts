import type { ListCronsResponse, CronDeleteResponse, CronEntry, CronMutationResponse } from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function cronsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/crons${suffix}`;
}

function cronPath(workspaceId: string, cronId: string, suffix = ''): string {
  return cronsPath(workspaceId, `/${encodePathSegment(cronId)}${suffix}`);
}

export class CronsClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string): Promise<CronEntry[]> {
    const response = await this.transport.request<ListCronsResponse>(cronsPath(workspaceId));
    return response.crons ?? [];
  }

  async listAll(): Promise<CronEntry[]> {
    const response = await this.transport.request<ListCronsResponse>('/crons');
    return response.crons ?? [];
  }

  async get(workspaceId: string, cronId: string): Promise<CronEntry> {
    const response = await this.transport.request<{ cron: CronEntry }>(cronPath(workspaceId, cronId));
    return response.cron;
  }

  patch(workspaceId: string, cronId: string, fields: Partial<Pick<CronEntry, 'description' | 'prompt' | 'intervalMs' | 'model'>>): Promise<CronMutationResponse> {
    return this.transport.request<CronMutationResponse>(cronPath(workspaceId, cronId), {
      method: 'PATCH',
      body: { ...fields },
    });
  }

  delete(workspaceId: string, cronId: string): Promise<CronDeleteResponse> {
    return this.transport.request<CronDeleteResponse>(cronPath(workspaceId, cronId), {
      method: 'DELETE',
    });
  }

  pause(workspaceId: string, cronId: string, reason?: string): Promise<CronMutationResponse> {
    return this.transport.request<CronMutationResponse>(cronPath(workspaceId, cronId, '/pause'), {
      method: 'POST',
      body: { reason },
    });
  }

  resume(workspaceId: string, cronId: string): Promise<CronMutationResponse> {
    return this.transport.request<CronMutationResponse>(cronPath(workspaceId, cronId, '/resume'), {
      method: 'POST',
    });
  }
}
