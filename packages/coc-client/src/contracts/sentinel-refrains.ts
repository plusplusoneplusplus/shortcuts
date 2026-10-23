/** User jobs belong to one Sentinel on the workspace's owning server. */
export interface SentinelRefrainInput {
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
  /**
   * Optional gate: the body of an async JS function receiving `tools` and
   * `state` (the previous result). Scheduled runs and Run now evaluate it first; a non-empty
   * JSON result starts a run with that result in the prompt. Needs `cron`.
   * Empty string clears it on update.
   */
  gateScript?: string;
}

export interface SentinelRefrainRun {
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
  /**
   * Why admission started no run: `overlap` (a run was active), `gate-empty`
   * (the gate returned null, false, "", [] or {}) or `gate-unavailable`
   * (`features.toolScripting` was off, so the gate could not run).
   */
  skipReason?: 'overlap' | 'gate-empty' | 'gate-unavailable';
}

export interface SentinelRefrain extends Omit<SentinelRefrainInput, 'mode' | 'enabled' | 'autoCompactThreshold'> {
  id: string;
  mode: 'ask' | 'autopilot';
  enabled: boolean;
  autoCompactThreshold: number;
  /** Canonical JSON of the gate's last successful result. */
  gateLastResult?: string;
  gateConsecutiveFailures: number;
  gateLastError?: { message: string; at: string };
  /** Set after five gate failures in a row; scheduled runs and Run now are blocked until resumed. */
  gatePaused: boolean;
  revision: number;
  processId?: string;
  nextRunAt?: string;
  activeRun?: SentinelRefrainRun;
  runs: SentinelRefrainRun[];
}

/**
 * Test gate outcome: one gate evaluation with the saved `state`. It starts no
 * run and saves nothing, and it runs even while the gate is paused.
 */
export interface SentinelRefrainGateTest {
  ok: boolean;
  /** Canonical result JSON when `ok`. */
  result?: string;
  /** When `ok`: whether a tick would skip with this result (null, false, "", [] or {}). */
  empty?: boolean;
  /** Why the gate failed (throw, timeout, non-JSON or over 16 KiB) when not `ok`. */
  error?: string;
}
