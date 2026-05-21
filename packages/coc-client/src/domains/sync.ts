import type { RequestAdapter } from '../types';

export interface SyncStatus {
  enabled: boolean;
  inProgress: boolean;
  lastSyncTime: string | null;
  lastError: string | null;
}

export class SyncClient {
  constructor(private readonly transport: RequestAdapter) {}

  getStatus(workspaceId: string): Promise<SyncStatus> {
    return this.transport.request<SyncStatus>(`/workspaces/${encodeURIComponent(workspaceId)}/sync/status`);
  }

  trigger(workspaceId: string): Promise<SyncStatus> {
    return this.transport.request<SyncStatus>(`/workspaces/${encodeURIComponent(workspaceId)}/sync/trigger`, { method: 'POST' });
  }
}
