import type { AIProcess } from '../contracts/processes';
import type { QueueTaskSummary } from '../contracts/queue';
import type { BrowserCommandRequest, BrowserCommandReply } from '../browser-control';

export type BrowserControlServerEvent =
  | { type: 'browser-command'; request: BrowserCommandRequest }
  | { type: 'browser-command-cancel'; id: string }
  | { type: 'browser-turn-finished'; workspaceId: string; processId: string; turnId: string };
export type BrowserControlClientEvent =
  | { type: 'browser-capability'; workspaceId: string; focused: boolean; background?: string[] }
  | { type: 'browser-capability-clear'; background?: string[] }
  | { type: 'browser-command-result'; reply: BrowserCommandReply };

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
