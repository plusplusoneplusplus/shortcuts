import type {
  ForEachRun,
  ForEachRunResponse,
  ForEachRunSummary,
  GenerateForEachRunRequest,
  ListForEachRunsResponse,
  UpdateForEachPlanRequest,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function runsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/for-each-runs${suffix}`;
}

function runPath(workspaceId: string, runId: string, suffix = ''): string {
  return runsPath(workspaceId, `/${encodePathSegment(runId)}${suffix}`);
}

export class ForEachClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string): Promise<ForEachRunSummary[]> {
    const response = await this.transport.request<ListForEachRunsResponse>(runsPath(workspaceId));
    return response.runs ?? [];
  }

  async generate(workspaceId: string, request: GenerateForEachRunRequest): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(runsPath(workspaceId, '/generate'), {
      method: 'POST',
      body: request,
    });
    return response.run;
  }

  async get(workspaceId: string, runId: string): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(runPath(workspaceId, runId));
    return response.run;
  }

  async updatePlan(workspaceId: string, runId: string, request: UpdateForEachPlanRequest): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(runPath(workspaceId, runId, '/plan'), {
      method: 'PUT',
      body: request,
    });
    return response.run;
  }

  async approve(workspaceId: string, runId: string): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(runPath(workspaceId, runId, '/approve'), {
      method: 'POST',
    });
    return response.run;
  }

  async start(workspaceId: string, runId: string): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(runPath(workspaceId, runId, '/start'), {
      method: 'POST',
    });
    return response.run;
  }

  async continue(workspaceId: string, runId: string): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(runPath(workspaceId, runId, '/continue'), {
      method: 'POST',
    });
    return response.run;
  }

  async retryItem(workspaceId: string, runId: string, itemId: string): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(
      runPath(workspaceId, runId, `/items/${encodePathSegment(itemId)}/retry`),
      { method: 'POST' },
    );
    return response.run;
  }

  async skipItem(workspaceId: string, runId: string, itemId: string): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(
      runPath(workspaceId, runId, `/items/${encodePathSegment(itemId)}/skip`),
      { method: 'POST' },
    );
    return response.run;
  }

  async cancel(workspaceId: string, runId: string): Promise<ForEachRun> {
    const response = await this.transport.request<ForEachRunResponse>(runPath(workspaceId, runId, '/cancel'), {
      method: 'POST',
    });
    return response.run;
  }
}
