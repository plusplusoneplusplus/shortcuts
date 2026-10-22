import type {
  SentinelScheduledJob,
  SentinelScheduledJobGateTest,
  SentinelScheduledJobInput,
  SentinelScheduledJobRun,
  SentinelTodoTagLibrary,
  WriteSentinelTodoTagRequest,
  DeleteSentinelTodoTagRequest,
  SuggestSentinelTodoTagsRequest,
  SentinelScrubberResponse,
  SentinelPrOutcomesResponse,
  SentinelPrOutcomeControlRequest,
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
  BindSentinelTodoPrRequest,
  AcceptSentinelTodoArtifactRequest,
  SentinelTodoDependencyEvaluation,
  CreateSentinelTodoRequest,
  SentinelTodoLedgerResponse,
  SetSentinelTodoDependenciesRequest,
  SentinelTodoWriteResponse,
  UpdateSentinelTodoRequest,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { buildQueryString, encodePathSegment } from '../url';

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
  readonly jobs: SentinelScheduledJobsClient;

  constructor(private readonly transport: RequestAdapter) {
    this.scrubber = new SentinelScrubberClient(transport);
    this.jobs = new SentinelScheduledJobsClient(transport);
  }

  getTags(workspaceId: string, processId: string, options?: { signal?: AbortSignal }): Promise<SentinelTodoTagLibrary> {
    return this.transport.request(ledgerPath(workspaceId, processId, '/tags'), options);
  }

  createTag(workspaceId: string, processId: string, request: WriteSentinelTodoTagRequest): Promise<SentinelTodoTagLibrary> {
    return this.transport.request(ledgerPath(workspaceId, processId, '/tags'), { method: 'POST', body: request });
  }

  updateTag(workspaceId: string, processId: string, tagId: string, request: WriteSentinelTodoTagRequest): Promise<SentinelTodoTagLibrary> {
    return this.transport.request(ledgerPath(workspaceId, processId, `/tags/${encodePathSegment(tagId)}`), { method: 'PATCH', body: request });
  }

  deleteTag(workspaceId: string, processId: string, tagId: string, request: DeleteSentinelTodoTagRequest): Promise<SentinelTodoTagLibrary> {
    return this.transport.request(ledgerPath(workspaceId, processId, `/tags/${encodePathSegment(tagId)}`), { method: 'DELETE', body: request });
  }

  suggestTags(workspaceId: string, processId: string, itemId: string, request: SuggestSentinelTodoTagsRequest): Promise<SentinelTodoWriteResponse> {
    return this.transport.request(ledgerPath(workspaceId, processId, `/items/${encodePathSegment(itemId)}/suggest-tags`), { method: 'POST', body: request });
  }

  listPrOutcomes(workspaceId: string, processId: string, itemId: string, options?: { signal?: AbortSignal }): Promise<SentinelPrOutcomesResponse> {
    return this.transport.request(this.prOutcomesPath(workspaceId, processId, itemId), options);
  }

  pausePrOutcomes(workspaceId: string, processId: string, itemId: string, request: SentinelPrOutcomeControlRequest, options?: { signal?: AbortSignal }): Promise<SentinelPrOutcomesResponse> {
    return this.transport.request(this.prOutcomesPath(workspaceId, processId, itemId) + '/pause', { ...options, method: 'POST', body: request });
  }

  resumePrOutcomes(workspaceId: string, processId: string, itemId: string, request: SentinelPrOutcomeControlRequest, options?: { signal?: AbortSignal }): Promise<SentinelPrOutcomesResponse> {
    return this.transport.request(this.prOutcomesPath(workspaceId, processId, itemId) + '/resume', { ...options, method: 'POST', body: request });
  }

  checkPrOutcomes(workspaceId: string, processId: string, itemId: string, request: SentinelPrOutcomeControlRequest, options?: { signal?: AbortSignal }): Promise<SentinelPrOutcomesResponse> {
    return this.transport.request(this.prOutcomesPath(workspaceId, processId, itemId) + '/check', { ...options, method: 'POST', body: request });
  }

  private prOutcomesPath(workspaceId: string, processId: string, itemId: string): string {
    return ledgerPath(workspaceId, processId, `/items/${encodePathSegment(itemId)}/pr-outcomes`);
  }

  get(workspaceId: string, processId: string, options?: {
    signal?: AbortSignal;
    limit?: number;
    offset?: number;
    itemId?: string;
    /** Complete snapshot for dependency authoring, triggers and assessment projections. */
    full?: boolean;
  }): Promise<SentinelTodoLedgerResponse> {
    const { signal, limit, offset, itemId, full } = options ?? {};
    const query = buildQueryString({ limit, offset, itemId, full });
    return this.transport.request<SentinelTodoLedgerResponse>(
      ledgerPath(workspaceId, processId) + query, signal ? { signal } : undefined,
    );
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

  setDependencies(
    workspaceId: string, processId: string, itemId: string, request: SetSentinelTodoDependenciesRequest,
  ): Promise<SentinelTodoWriteResponse> {
    return this.transport.request<SentinelTodoWriteResponse>(
      ledgerPath(workspaceId, processId, `/items/${encodePathSegment(itemId)}/dependencies`),
      { method: 'PUT', body: request },
    );
  }

  bindPrOutput(workspaceId: string, processId: string, itemId: string, request: BindSentinelTodoPrRequest): Promise<SentinelTodoWriteResponse> {
    return this.transport.request(ledgerPath(workspaceId, processId, `/items/${encodePathSegment(itemId)}/pr-output`),
      { method: 'POST', body: request });
  }

  acceptArtifact(workspaceId: string, processId: string, itemId: string, request: AcceptSentinelTodoArtifactRequest): Promise<SentinelTodoWriteResponse> {
    return this.transport.request(ledgerPath(workspaceId, processId, `/items/${encodePathSegment(itemId)}/artifact-acceptance`),
      { method: 'POST', body: request });
  }

  evaluateDependencies(workspaceId: string, processId: string, itemId: string, options?: { signal?: AbortSignal }): Promise<SentinelTodoDependencyEvaluation> {
    return this.transport.request(ledgerPath(workspaceId, processId, `/items/${encodePathSegment(itemId)}/readiness`),
      { ...options, method: 'POST', body: {} });
  }
}

/** Resolve the owner client before accessing jobs (including remote workspaces). */
export class SentinelScheduledJobsClient {
  constructor(private readonly transport: RequestAdapter) {}

  private path(workspaceId: string, processId: string, jobId?: string): string {
    return ledgerPath(workspaceId, processId, '/jobs' + (jobId ? `/${encodePathSegment(jobId)}` : ''));
  }

  list(workspaceId: string, processId: string, options?: { signal?: AbortSignal }): Promise<{ jobs: SentinelScheduledJob[] }> {
    return this.transport.request(this.path(workspaceId, processId), options);
  }

  create(workspaceId: string, processId: string, input: SentinelScheduledJobInput): Promise<SentinelScheduledJob> {
    return this.transport.request(this.path(workspaceId, processId), { method: 'POST', body: input });
  }

  update(workspaceId: string, processId: string, jobId: string,
    input: Partial<SentinelScheduledJobInput> & { expectedRevision: number }): Promise<SentinelScheduledJob> {
    return this.transport.request(this.path(workspaceId, processId, jobId), { method: 'PATCH', body: input });
  }

  delete(workspaceId: string, processId: string, jobId: string, input: { expectedRevision: number }): Promise<void> {
    return this.transport.request(this.path(workspaceId, processId, jobId), { method: 'DELETE', body: input });
  }

  start(workspaceId: string, processId: string, jobId: string): Promise<SentinelScheduledJobRun> {
    return this.transport.request(this.path(workspaceId, processId, jobId) + '/runs', { method: 'POST' });
  }

  cancel(workspaceId: string, processId: string, jobId: string, runId: string): Promise<SentinelScheduledJobRun> {
    return this.transport.request(this.path(workspaceId, processId, jobId) + `/runs/${encodePathSegment(runId)}/cancel`, { method: 'POST' });
  }

  /** Runs the gate once with its saved state; starts no run and saves nothing. */
  testGate(workspaceId: string, processId: string, jobId: string,
    options?: { signal?: AbortSignal }): Promise<SentinelScheduledJobGateTest> {
    return this.transport.request(this.path(workspaceId, processId, jobId) + '/gate/test', { ...options, method: 'POST' });
  }

  /** Clears a paused gate and its failure count. */
  resumeGate(workspaceId: string, processId: string, jobId: string): Promise<SentinelScheduledJob> {
    return this.transport.request(this.path(workspaceId, processId, jobId) + '/gate/resume', { method: 'POST' });
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
