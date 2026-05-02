import type {
  CreateWorkflowRequest,
  CreateWorkflowResponse,
  DeleteWorkflowResponse,
  GenerateWorkflowRequest,
  GenerateWorkflowResponse,
  RefineWorkflowRequest,
  RefineWorkflowResponse,
  RunWorkflowRequest,
  RunWorkflowResponse,
  SaveWorkflowContentResponse,
  WorkflowContentResponse,
  WorkflowDefinition,
  WorkflowListOptions,
  WorkflowPathOptions,
  WorkflowRunHistoryOptions,
  WorkflowRunHistoryResponse,
  WorkflowSummaryResponse,
} from '../contracts';
import type { CocRequestOptions, QueryPrimitive, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function serializeWorkflowListOptions(options?: WorkflowListOptions): CocRequestOptions['query'] {
  if (!options) return undefined;
  return {
    folder: options.folder,
    showArchived: options.showArchived,
  };
}

function serializeWorkflowPathOptions(options?: WorkflowPathOptions): CocRequestOptions['query'] {
  if (!options) return undefined;
  return { folder: options.folder };
}

function serializeRunHistoryOptions(
  workspaceId: string,
  pipelineName: string,
  options?: WorkflowRunHistoryOptions,
): CocRequestOptions['query'] {
  return {
    repoId: workspaceId,
    pipelineName,
    limit: options?.limit,
  } satisfies Record<string, QueryPrimitive>;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export class WorkflowClient {
  constructor(private readonly transport: RequestAdapter) {}

  summary(workspaceId: string, options?: WorkflowListOptions): Promise<WorkflowSummaryResponse> {
    return this.transport.request<WorkflowSummaryResponse>(`/workspaces/${encodePathSegment(workspaceId)}/summary`, {
      query: serializeWorkflowListOptions(options),
    });
  }

  async list(workspaceId: string, options?: WorkflowListOptions): Promise<WorkflowDefinition[]> {
    const response = await this.summary(workspaceId, options);
    return response.workflows;
  }

  content(workspaceId: string, pipelineName: string, options?: WorkflowPathOptions): Promise<WorkflowContentResponse> {
    return this.transport.request<WorkflowContentResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/workflows/${encodePathSegment(pipelineName)}/content`,
      { query: serializeWorkflowPathOptions(options) },
    );
  }

  saveContent(workspaceId: string, pipelineName: string, content: string, options?: WorkflowPathOptions): Promise<SaveWorkflowContentResponse> {
    return this.transport.request<SaveWorkflowContentResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/workflows/${encodePathSegment(pipelineName)}/content`,
      {
        method: 'PATCH',
        query: serializeWorkflowPathOptions(options),
        body: { content },
      },
    );
  }

  create(workspaceId: string, request: CreateWorkflowRequest, options?: WorkflowPathOptions): Promise<CreateWorkflowResponse> {
    return this.transport.request<CreateWorkflowResponse>(`/workspaces/${encodePathSegment(workspaceId)}/workflows`, {
      method: 'POST',
      query: serializeWorkflowPathOptions(options),
      body: omitUndefined({
        name: request.name,
        template: request.template,
        content: request.content,
      }),
    });
  }

  delete(workspaceId: string, pipelineName: string, options?: WorkflowPathOptions): Promise<DeleteWorkflowResponse> {
    return this.transport.request<DeleteWorkflowResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/workflows/${encodePathSegment(pipelineName)}`,
      {
        method: 'DELETE',
        query: serializeWorkflowPathOptions(options),
      },
    );
  }

  generate(workspaceId: string, request: GenerateWorkflowRequest, options: Pick<CocRequestOptions, 'signal' | 'timeoutMs'> = {}): Promise<GenerateWorkflowResponse> {
    return this.transport.request<GenerateWorkflowResponse>(`/workspaces/${encodePathSegment(workspaceId)}/workflows/generate`, {
      method: 'POST',
      body: omitUndefined({
        name: request.name,
        description: request.description,
        model: request.model,
      }),
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  refine(workspaceId: string, request: RefineWorkflowRequest, options: Pick<CocRequestOptions, 'signal' | 'timeoutMs'> = {}): Promise<RefineWorkflowResponse> {
    return this.transport.request<RefineWorkflowResponse>(`/workspaces/${encodePathSegment(workspaceId)}/workflows/refine`, {
      method: 'POST',
      body: omitUndefined({
        instruction: request.instruction,
        currentYaml: request.currentYaml,
        model: request.model,
      }),
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  run(workspaceId: string, pipelineName: string, request: RunWorkflowRequest = {}, options?: WorkflowPathOptions): Promise<RunWorkflowResponse> {
    return this.transport.request<RunWorkflowResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/workflows/${encodePathSegment(pipelineName)}/run`,
      {
        method: 'POST',
        query: serializeWorkflowPathOptions(options),
        body: omitUndefined({
          model: request.model,
          params: request.params,
          priority: request.priority,
        }),
      },
    );
  }

  runHistory(workspaceId: string, pipelineName: string, options?: WorkflowRunHistoryOptions): Promise<WorkflowRunHistoryResponse> {
    return this.transport.request<WorkflowRunHistoryResponse>('/queue/history', {
      query: serializeRunHistoryOptions(workspaceId, pipelineName, options),
    });
  }
}
