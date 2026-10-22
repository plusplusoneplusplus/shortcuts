import type { AIProcess } from '../contracts/processes';
import type { QueueTaskSummary } from '../contracts/queue';
import type { BrowserCommandRequest, BrowserCommandReply, BrowserNavigationAnswer, BrowserNavigationPrompt } from '../browser-control';

export type BrowserControlServerEvent =
  | { type: 'browser-command'; request: BrowserCommandRequest }
  | { type: 'browser-command-cancel'; id: string }
  | { type: 'browser-turn-finished'; workspaceId: string; processId: string; turnId: string }
  /** Resumes (`allow`) or blocks the held navigation `checkId`. */
  | { type: 'browser-navigation-decision'; checkId: string; allow: boolean }
  | { type: 'browser-navigation-prompt'; prompt: BrowserNavigationPrompt }
  | { type: 'browser-navigation-prompt-cleared'; checkId: string };
export type BrowserControlClientEvent =
  | { type: 'browser-capability'; workspaceId: string; focused: boolean; background?: string[] }
  | { type: 'browser-capability-clear'; background?: string[] }
  | { type: 'browser-command-result'; reply: BrowserCommandReply }
  /** A background action is waiting on the Switch back notice; the owning server pauses its 60s limit. */
  | { type: 'browser-command-waiting'; id: string; waiting: boolean }
  /** The desktop host holds an agent-driven top-level navigation of an active turn until the owning server decides. */
  | { type: 'browser-navigation-check'; checkId: string; workspaceId: string; processId: string; turnId: string; url: string }
  | { type: 'browser-navigation-answer'; checkId: string; answer: BrowserNavigationAnswer };

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
