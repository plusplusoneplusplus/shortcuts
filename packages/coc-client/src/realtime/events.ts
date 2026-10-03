import type { AIProcess } from '../contracts/processes';
import type { QueueTaskSummary } from '../contracts/queue';

export interface ProcessEvent {
  type: string;
  workspaceId?: string;
  timestamp?: number;
  process?: Partial<AIProcess> & { id: string };
  queue?: {
    repoId?: string;
    queued: QueueTaskSummary[];
    running: QueueTaskSummary[];
    stats: { queued: number; running: number; total: number; isPaused: boolean; isDraining: boolean };
  };
  [key: string]: unknown;
}

export function isProcessEvent(value: unknown): value is ProcessEvent {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string';
}
