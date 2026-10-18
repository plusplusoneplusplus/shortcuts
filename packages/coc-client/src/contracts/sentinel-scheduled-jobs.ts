/** User jobs belong to one Sentinel on the workspace's owning server. */
export interface SentinelScheduledJobInput {
  name: string;
  instructions: string;
  provider: string;
  model: string;
  effort?: string;
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
