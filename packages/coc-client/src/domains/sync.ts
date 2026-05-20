import type { RequestAdapter } from '../types';

export interface SyncStatus {
  enabled: boolean;
  inProgress: boolean;
  lastSyncTime: string | null;
  lastError: string | null;
}

export class SyncClient {
  constructor(private readonly transport: RequestAdapter) {}

  getStatus(): Promise<SyncStatus> {
    return this.transport.request<SyncStatus>('/sync/status');
  }

  trigger(): Promise<SyncStatus> {
    return this.transport.request<SyncStatus>('/sync/trigger', { method: 'POST' });
  }
}
