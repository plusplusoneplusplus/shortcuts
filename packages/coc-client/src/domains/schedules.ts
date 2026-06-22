import type {
  CreateScheduleRequest,
  DeleteScheduleResponse,
  ListSchedulesResponse,
  MoveScheduleRequest,
  RefineScheduleInstructionsRequest,
  RefineScheduleInstructionsResponse,
  RunScheduleResponse,
  Schedule,
  ScheduleHistoryResponse,
  ScheduleMutationResponse,
  ScheduleStatus,
  UpdateScheduleRequest,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function schedulesPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/schedules${suffix}`;
}

function schedulePath(workspaceId: string, scheduleId: string, suffix = ''): string {
  return schedulesPath(workspaceId, `/${encodePathSegment(scheduleId)}${suffix}`);
}

export class SchedulesClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string): Promise<Schedule[]> {
    const response = await this.transport.request<ListSchedulesResponse>(schedulesPath(workspaceId));
    return response.schedules ?? [];
  }

  create(workspaceId: string, request: CreateScheduleRequest): Promise<ScheduleMutationResponse> {
    return this.transport.request<ScheduleMutationResponse>(schedulesPath(workspaceId), {
      method: 'POST',
      body: { ...request },
    });
  }

  update(workspaceId: string, scheduleId: string, request: UpdateScheduleRequest): Promise<ScheduleMutationResponse> {
    return this.transport.request<ScheduleMutationResponse>(schedulePath(workspaceId, scheduleId), {
      method: 'PATCH',
      body: { ...request },
    });
  }

  setStatus(workspaceId: string, scheduleId: string, status: ScheduleStatus): Promise<ScheduleMutationResponse> {
    return this.update(workspaceId, scheduleId, { status });
  }

  enable(workspaceId: string, scheduleId: string): Promise<ScheduleMutationResponse> {
    return this.setStatus(workspaceId, scheduleId, 'active');
  }

  disable(workspaceId: string, scheduleId: string): Promise<ScheduleMutationResponse> {
    return this.setStatus(workspaceId, scheduleId, 'paused');
  }

  delete(workspaceId: string, scheduleId: string): Promise<DeleteScheduleResponse> {
    return this.transport.request<DeleteScheduleResponse>(schedulePath(workspaceId, scheduleId), {
      method: 'DELETE',
    });
  }

  move(workspaceId: string, scheduleId: string, destination: MoveScheduleRequest['destination']): Promise<ScheduleMutationResponse> {
    return this.transport.request<ScheduleMutationResponse>(schedulePath(workspaceId, scheduleId, '/move'), {
      method: 'POST',
      body: { destination },
    });
  }

  /**
   * Ask AI to refine a prompt routine's free-text instructions into a clearer,
   * well-structured prompt. Scoped per workspace; abortable via `options.signal`.
   */
  refine(
    workspaceId: string,
    request: RefineScheduleInstructionsRequest,
    options: Pick<CocRequestOptions, 'signal' | 'timeoutMs'> = {},
  ): Promise<RefineScheduleInstructionsResponse> {
    return this.transport.request<RefineScheduleInstructionsResponse>(schedulesPath(workspaceId, '/refine'), {
      method: 'POST',
      body: {
        instructions: request.instructions,
        hint: request.hint,
        model: request.model,
      },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  run(workspaceId: string, scheduleId: string): Promise<RunScheduleResponse> {
    return this.transport.request<RunScheduleResponse>(schedulePath(workspaceId, scheduleId, '/run'), {
      method: 'POST',
    });
  }

  async history(workspaceId: string, scheduleId: string): Promise<ScheduleHistoryResponse['history']> {
    const response = await this.transport.request<ScheduleHistoryResponse>(schedulePath(workspaceId, scheduleId, '/history'));
    return response.history ?? [];
  }
}
