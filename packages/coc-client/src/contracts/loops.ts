/**
 * Loop API contract types — mirrors server-side LoopEntry serialization.
 */

export type LoopStatus = 'active' | 'paused' | 'cancelled' | 'expired';

export interface LoopEntry {
  id: string;
  processId: string;
  description: string;
  intervalMs: number;
  status: LoopStatus;
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

export interface ListLoopsResponse {
  loops: LoopEntry[];
}

export interface LoopMutationResponse {
  loop: LoopEntry;
}

export interface LoopDeleteResponse {
  deleted: boolean;
  loop: LoopEntry;
}
