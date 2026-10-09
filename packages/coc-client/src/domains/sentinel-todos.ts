import type {
  CreateSentinelTodoRequest,
  SentinelTodoLedgerResponse,
  SentinelTodoWriteResponse,
  UpdateSentinelTodoRequest,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function ledgerPath(workspaceId: string, processId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/sentinel-todos/${encodePathSegment(processId)}${suffix}`;
}

/**
 * The Sentinel to-do ledger of one chat. A stale `update` rejects with a
 * `CocApiError` whose `code` is `conflict` and whose `body.current` is the
 * server's item.
 */
export class SentinelTodosClient {
  constructor(private readonly transport: RequestAdapter) {}

  get(workspaceId: string, processId: string, options?: { signal?: AbortSignal }): Promise<SentinelTodoLedgerResponse> {
    return this.transport.request<SentinelTodoLedgerResponse>(ledgerPath(workspaceId, processId), options);
  }

  create(workspaceId: string, processId: string, request: CreateSentinelTodoRequest): Promise<SentinelTodoWriteResponse> {
    return this.transport.request<SentinelTodoWriteResponse>(
      ledgerPath(workspaceId, processId, '/items'),
      { method: 'POST', body: request },
    );
  }

  update(workspaceId: string, processId: string, itemId: string, request: UpdateSentinelTodoRequest): Promise<SentinelTodoWriteResponse> {
    return this.transport.request<SentinelTodoWriteResponse>(
      ledgerPath(workspaceId, processId, `/items/${encodePathSegment(itemId)}`),
      { method: 'PATCH', body: request },
    );
  }
}
