/** User jobs belong to one Sentinel on the workspace's owning server. */
export interface SentinelScheduledJobInput {
  name: string;
  instructions: string;
  provider: string;
  /** Explicit model; required unless `effortTier` is set. */
  model?: string;
  /** Reasoning effort: low, medium, high or xhigh. Empty string clears it on update. */
  effort?: string;
  /**
   * Shared effort tier (very-low, low, medium, high), resolved to a model and
   * reasoning effort by the owning server at each run. When set, `model` and
   * `effort` are dropped. Empty string clears it on update.
   */
  effortTier?: string;
  mode?: 'ask' | 'autopilot';
  cron?: string;
  enabled?: boolean;
  /** Absolute context-token threshold, not a percentage. */
  autoCompactThreshold?: number;
}

export interface SentinelScheduledJobRun {
  id: string;
  runNumber: number;
  trigger: 'manual' | 'schedule';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'skipped';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  turnIndex?: number;
  jobTurnHref?: string;
  sentinelFollowUpHref?: string;
  error?: string;
  skipReason?: 'overlap';
}

export interface SentinelScheduledJob extends Omit<SentinelScheduledJobInput, 'mode' | 'enabled' | 'autoCompactThreshold'> {
  id: string;
  mode: 'ask' | 'autopilot';
  enabled: boolean;
  autoCompactThreshold: number;
  revision: number;
  processId?: string;
  nextRunAt?: string;
  activeRun?: SentinelScheduledJobRun;
  runs: SentinelScheduledJobRun[];
}
