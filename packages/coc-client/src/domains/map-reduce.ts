import type {
  CreateMapReduceRunRequest,
  GenerateMapReduceRunRequest,
  ListMapReduceRunsResponse,
  MapReduceRun,
  MapReduceRunResponse,
  MapReduceRunSummary,
  UpdateMapReducePlanRequest,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function runsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/map-reduce-runs${suffix}`;
}

function runPath(workspaceId: string, runId: string, suffix = ''): string {
  return runsPath(workspaceId, `/${encodePathSegment(runId)}${suffix}`);
}

export class MapReduceClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string): Promise<MapReduceRunSummary[]> {
    const response = await this.transport.request<ListMapReduceRunsResponse>(runsPath(workspaceId));
    return response.runs ?? [];
  }

  async generate(workspaceId: string, request: GenerateMapReduceRunRequest): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runsPath(workspaceId, '/generate'), {
      method: 'POST',
      body: request,
    });
    return response.run;
  }

  async create(workspaceId: string, request: CreateMapReduceRunRequest): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runsPath(workspaceId), {
      method: 'POST',
      body: request,
    });
    return response.run;
  }

  async get(workspaceId: string, runId: string): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runPath(workspaceId, runId));
    return response.run;
  }

  async updatePlan(workspaceId: string, runId: string, request: UpdateMapReducePlanRequest): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runPath(workspaceId, runId, '/plan'), {
      method: 'PUT',
      body: request,
    });
    return response.run;
  }

  async approve(workspaceId: string, runId: string): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runPath(workspaceId, runId, '/approve'), {
      method: 'POST',
    });
    return response.run;
  }

  async start(workspaceId: string, runId: string): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runPath(workspaceId, runId, '/start'), {
      method: 'POST',
    });
    return response.run;
  }

  async continue(workspaceId: string, runId: string): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runPath(workspaceId, runId, '/continue'), {
      method: 'POST',
    });
    return response.run;
  }

  async retryItem(workspaceId: string, runId: string, itemId: string): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(
      runPath(workspaceId, runId, `/items/${encodePathSegment(itemId)}/retry`),
      { method: 'POST' },
    );
    return response.run;
  }

  async skipItem(workspaceId: string, runId: string, itemId: string): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(
      runPath(workspaceId, runId, `/items/${encodePathSegment(itemId)}/skip`),
      { method: 'POST' },
    );
    return response.run;
  }

  async retryReduce(workspaceId: string, runId: string): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runPath(workspaceId, runId, '/reduce/retry'), {
      method: 'POST',
    });
    return response.run;
  }

  async cancel(workspaceId: string, runId: string): Promise<MapReduceRun> {
    const response = await this.transport.request<MapReduceRunResponse>(runPath(workspaceId, runId, '/cancel'), {
      method: 'POST',
    });
    return response.run;
  }
}
