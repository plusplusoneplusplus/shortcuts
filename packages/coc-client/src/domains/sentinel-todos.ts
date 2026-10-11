import type {
  SentinelScrubberResponse,
  SentinelScrubberConfig,
  UpdateSentinelScrubberConfigRequest,
  StartSentinelScrubRequest,
  StartSentinelScrubResponse,
  SentinelScrubRun,
  SentinelScrubRunDetail,
  SentinelScrubFindingActionRequest,
  SentinelScrubFindingWriteResponse,
  SentinelScrubFindingDismissResponse,
  AttachSentinelTodoReferenceRequest,
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
  readonly scrubber: SentinelScrubberClient;

  constructor(private readonly transport: RequestAdapter) {
    this.scrubber = new SentinelScrubberClient(transport);
  }

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

  attachReference(
    workspaceId: string, processId: string, itemId: string, request: AttachSentinelTodoReferenceRequest,
  ): Promise<SentinelTodoWriteResponse> {
    return this.transport.request<SentinelTodoWriteResponse>(
      ledgerPath(workspaceId, processId, `/items/${encodePathSegment(itemId)}/references`),
      { method: 'POST', body: request },
    );
  }
}

/** Resolve the client from the owner workspace before accessing this resource. */
export class SentinelScrubberClient {
  constructor(private readonly transport: RequestAdapter) {}

  get(workspaceId: string, processId: string, options?: { signal?: AbortSignal }): Promise<SentinelScrubberResponse> {
    return this.transport.request(ledgerPath(workspaceId, processId, '/scrubber'), options);
  }

  updateConfig(workspaceId: string, processId: string, request: UpdateSentinelScrubberConfigRequest): Promise<SentinelScrubberConfig> {
    return this.transport.request(ledgerPath(workspaceId, processId, '/scrubber/config'), { method: 'PUT', body: request });
  }

  start(workspaceId: string, processId: string, request: StartSentinelScrubRequest = {}): Promise<StartSentinelScrubResponse> {
    return this.transport.request(ledgerPath(workspaceId, processId, '/scrubber/runs'), { method: 'POST', body: request });
  }

  getRun(workspaceId: string, processId: string, runId: string, options?: { signal?: AbortSignal }): Promise<SentinelScrubRunDetail> {
    return this.transport.request(this.runPath(workspaceId, processId, runId), options);
  }

  cancel(workspaceId: string, processId: string, runId: string): Promise<SentinelScrubRun> {
    return this.transport.request(this.runPath(workspaceId, processId, runId) + '/cancel', { method: 'POST' });
  }

  accept(workspaceId: string, processId: string, runId: string, itemId: string, request: SentinelScrubFindingActionRequest): Promise<SentinelScrubFindingWriteResponse> {
    return this.action(workspaceId, processId, runId, itemId, 'accept', request);
  }

  dismiss(workspaceId: string, processId: string, runId: string, itemId: string, request: SentinelScrubFindingActionRequest): Promise<SentinelScrubFindingDismissResponse> {
    return this.action(workspaceId, processId, runId, itemId, 'dismiss', request);
  }

  undo(workspaceId: string, processId: string, runId: string, itemId: string, request: SentinelScrubFindingActionRequest): Promise<SentinelScrubFindingWriteResponse> {
    return this.action(workspaceId, processId, runId, itemId, 'undo', request);
  }

  private runPath(workspaceId: string, processId: string, runId: string): string {
    return ledgerPath(workspaceId, processId, `/scrubber/runs/${encodePathSegment(runId)}`);
  }

  private action<T>(workspaceId: string, processId: string, runId: string, itemId: string,
    action: 'accept' | 'dismiss' | 'undo', request: SentinelScrubFindingActionRequest): Promise<T> {
    return this.transport.request(
      this.runPath(workspaceId, processId, runId) + `/findings/${encodePathSegment(itemId)}/${action}`,
      { method: 'POST', body: request },
    );
  }
}
