import type {
  CreateScheduleRequest,
  DeleteScheduleResponse,
  ListSchedulesResponse,
  MoveScheduleRequest,
  RunScheduleResponse,
  Schedule,
  ScheduleHistoryResponse,
  ScheduleMutationResponse,
  ScheduleStatus,
  UpdateScheduleRequest,
} from '../contracts';
import type { RequestAdapter } from '../types';
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
