/**
 * Cron API contract types — mirrors server-side CronEntry serialization.
 */

export type CronStatus = 'active' | 'paused' | 'cancelled' | 'expired';

export interface CronEntry {
  id: string;
  processId: string;
  description: string;
  intervalMs: number;
  status: CronStatus;
  createdAt: string;
  lastTickAt: string | null;
  nextTickAt: string | null;
  tickCount: number;
  consecutiveFailures: number;
  expiresAt: string;
  pausedReason: string | null;
  prompt: string;
  model: string | null;
}

export interface ListCronsResponse {
  crons: CronEntry[];
}

export interface CronMutationResponse {
  cron: CronEntry;
}

export interface CronDeleteResponse {
  deleted: boolean;
  cron: CronEntry;
}
