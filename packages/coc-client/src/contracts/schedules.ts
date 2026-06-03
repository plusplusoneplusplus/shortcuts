export type ScheduleStatus = 'active' | 'paused' | 'stopped' | string;
export type ScheduleOnFailure = 'notify' | 'stop' | string;
export type ScheduleTargetType = 'prompt' | 'script';
export type ScheduleMode = 'ask' | 'autopilot';
export type ScheduleSource = 'user' | 'repo';

export interface Schedule {
  id: string;
  name: string;
  target: string;
  targetType?: ScheduleTargetType;
  cron: string;
  cronDescription: string;
  params: Record<string, string>;
  onFailure: ScheduleOnFailure;
  status: ScheduleStatus;
  isRunning: boolean;
  nextRun: string | null;
  createdAt: string;
  outputFolder?: string;
  model?: string;
  mode?: ScheduleMode;
  source?: ScheduleSource;
}

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  repoId?: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'missed' | string;
  error?: string;
  durationMs?: number;
  processId?: string;
  taskId?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface ListSchedulesResponse {
  schedules: Schedule[];
}

export interface ScheduleMutationResponse {
  schedule: Schedule;
}

export interface DeleteScheduleResponse {
  deleted: boolean;
}

export interface RunScheduleResponse {
  run: ScheduleRunRecord;
}

export interface ScheduleHistoryResponse {
  history: ScheduleRunRecord[];
}

export interface CreateScheduleRequest {
  name: string;
  target: string;
  cron: string;
  params?: Record<string, string>;
  onFailure?: ScheduleOnFailure;
  status?: ScheduleStatus;
  targetType?: ScheduleTargetType;
  outputFolder?: string;
  model?: string;
  mode?: ScheduleMode;
}

export interface UpdateScheduleRequest {
  name?: string;
  target?: string;
  cron?: string;
  params?: Record<string, string>;
  onFailure?: ScheduleOnFailure;
  status?: ScheduleStatus;
  targetType?: ScheduleTargetType;
  outputFolder?: string;
  model?: string;
  mode?: ScheduleMode;
}

export interface MoveScheduleRequest {
  destination: ScheduleSource;
}
