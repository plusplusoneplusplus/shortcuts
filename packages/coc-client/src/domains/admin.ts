import type {
  AdminConfigResponse,
  AdminConfigUpdate,
  AdminDataStatsQuery,
  AdminDataStatsResponse,
  AdminImportMode,
  AdminImportPreviewResponse,
  AdminImportResponse,
  AdminPromptDeleteResponse,
  AdminPromptUpdateRequest,
  AdminPromptUpdateResponse,
  AdminPromptsResponse,
  AdminRestartResponse,
  AdminStorageCancelMigrationResponse,
  AdminStorageDirectoryImportStreamOptions,
  AdminStorageDirectoryMatchResult,
  AdminStorageMigrationStreamOptions,
  AdminStorageScanRequest,
  AdminStorageStatusResponse,
  AdminTokenResponse,
  AdminVersionResponse,
  AdminWipeResponse,
  AgentProvidersQuotaResponse,
} from '../contracts';
import type { CocRequestOptions, NormalizedCocClientOptions, QueryPrimitive, RequestAdapter } from '../types';
import { buildApiUrl } from '../url';

function serializeStatsQuery(query?: AdminDataStatsQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return { includeWikis: query.includeWikis };
}
function copyConfigUpdate(update: AdminConfigUpdate): AdminConfigUpdate {
  return { ...update };
}

export class AdminClient {
  constructor(
    private readonly transport: RequestAdapter,
    private readonly options: NormalizedCocClientOptions,
  ) {
  }

  getPrompts(): Promise<AdminPromptsResponse> {
    return this.transport.request<AdminPromptsResponse>('/admin/prompts');
  }

  updatePrompt(id: string, update: AdminPromptUpdateRequest): Promise<AdminPromptUpdateResponse> {
    return this.transport.request<AdminPromptUpdateResponse>(`/admin/prompts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: update,
    });
  }

  resetPromptOverride(id: string): Promise<AdminPromptDeleteResponse> {
    return this.transport.request<AdminPromptDeleteResponse>(`/admin/prompts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  getDataStats(query?: AdminDataStatsQuery, options: Pick<CocRequestOptions, 'signal' | 'timeoutMs'> = {}): Promise<AdminDataStatsResponse> {
    return this.transport.request<AdminDataStatsResponse>('/admin/data/stats', {
      query: serializeStatsQuery(query),
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  getConfig(): Promise<AdminConfigResponse> {
    return this.transport.request<AdminConfigResponse>('/admin/config');
  }

  updateConfig(update: AdminConfigUpdate): Promise<AdminConfigResponse> {
    return this.transport.request<AdminConfigResponse>('/admin/config', {
      method: 'PUT',
      body: copyConfigUpdate(update),
    });
  }

  getVersion(options?: Pick<CocRequestOptions, 'signal'>): Promise<AdminVersionResponse> {
    return this.transport.request<AdminVersionResponse>('/admin/version', options);
  }

  exportData(options?: Pick<CocRequestOptions, 'signal'>): Promise<Response> {
    return this.fetchRaw('/admin/export', { method: 'GET', signal: options?.signal });
  }

  previewImport(payload: unknown): Promise<AdminImportPreviewResponse> {
    return this.transport.request<AdminImportPreviewResponse>('/admin/import/preview', {
      method: 'POST',
      body: payload,
    });
  }

  getImportToken(): Promise<AdminTokenResponse> {
    return this.transport.request<AdminTokenResponse>('/admin/import-token');
  }

  importData(payload: unknown, options: { token: string; mode: AdminImportMode }): Promise<AdminImportResponse> {
    return this.transport.request<AdminImportResponse>('/admin/import', {
      method: 'POST',
      query: { confirm: options.token, mode: options.mode },
      body: payload,
    });
  }

  getWipeToken(): Promise<AdminTokenResponse> {
    return this.transport.request<AdminTokenResponse>('/admin/data/wipe-token');
  }

  wipeData(options: { token: string; includeWikis?: boolean }): Promise<AdminWipeResponse> {
    return this.transport.request<AdminWipeResponse>('/admin/data', {
      method: 'DELETE',
      query: { confirm: options.token, includeWikis: options.includeWikis },
    });
  }

  restart(): Promise<AdminRestartResponse> {
    return this.transport.request<AdminRestartResponse>('/admin/restart', { method: 'POST' });
  }

  getStorageStatus(): Promise<AdminStorageStatusResponse> {
    return this.transport.request<AdminStorageStatusResponse>('/admin/storage/status');
  }

  getStorageMigrateToken(): Promise<AdminTokenResponse> {
    return this.transport.request<AdminTokenResponse>('/admin/storage/migrate-token');
  }

  migrateStorageStream(options: AdminStorageMigrationStreamOptions): Promise<Response> {
    return this.fetchRaw('/admin/storage/migrate', {
      method: 'POST',
      query: {
        confirm: options.token,
        skipValidation: options.skipValidation ? '1' : undefined,
      },
      signal: options.signal,
    });
  }

  cancelStorageMigration(): Promise<AdminStorageCancelMigrationResponse> {
    return this.transport.request<AdminStorageCancelMigrationResponse>('/admin/storage/migrate/cancel', {
      method: 'POST',
    });
  }

  scanStorageDirectory(request: AdminStorageScanRequest): Promise<AdminStorageDirectoryMatchResult> {
    return this.transport.request<AdminStorageDirectoryMatchResult>('/admin/storage/scan-directory', {
      method: 'POST',
      body: { path: request.path },
    });
  }

  getStorageImportDirectoryToken(): Promise<AdminTokenResponse> {
    return this.transport.request<AdminTokenResponse>('/admin/storage/import-directory-token');
  }

  importStorageDirectoryStream(options: AdminStorageDirectoryImportStreamOptions): Promise<Response> {
    return this.fetchRaw('/admin/storage/import-directory', {
      method: 'POST',
      query: { confirm: options.token },
      body: { path: options.path },
      signal: options.signal,
    });
  }

  getAgentProvidersQuota(): Promise<AgentProvidersQuotaResponse> {
    return this.transport.request<AgentProvidersQuotaResponse>('/agent-providers/quota');
  }

  private fetchRaw(path: string, options: {
    method: string;
    query?: Record<string, QueryPrimitive | QueryPrimitive[]>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<Response> {
    const headers = new Headers(this.options.defaultHeaders);
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    return this.options.fetch(buildApiUrl(this.options.baseUrl, this.options.apiBasePath, path, options.query), {
      method: options.method,
      headers,
      body,
      signal: options.signal,
    });
  }
}
