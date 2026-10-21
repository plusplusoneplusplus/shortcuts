import type { EvaluationOptions, EvaluationOutcome, EventEvaluator } from './trigger-manager';
import type { ScriptConditionEvent, Trigger } from './trigger-types';
import { canonicalizeJobGateResult } from '../sentinel-jobs/job-gate-result';

/** The owner-scoped runtime supplies tools, strict JSON validation and cancellation. */
export type ScriptConditionRunner = (trigger: Trigger, state: unknown, signal?: AbortSignal) => Promise<unknown>;

/** Computes a repeating condition's next baseline without mutating the stored rule. */
export class ScriptConditionEvaluator implements EventEvaluator {
    constructor(
        private readonly run: ScriptConditionRunner,
        private readonly now: () => number = Date.now,
    ) {}

    async evaluate(trigger: Trigger, options?: EvaluationOptions): Promise<EvaluationOutcome & { event: ScriptConditionEvent }> {
        const event = trigger.event;
        if (event.type !== 'script-condition') {
            throw new Error(`ScriptConditionEvaluator cannot evaluate event ${event.type}`);
        }
        const signal = options?.signal;
        signal?.throwIfAborted();
        const manual = options?.manualScript === true && trigger.status === 'paused' && event.paused;
        if (!manual && (trigger.status !== 'active' || event.paused)) return { fire: false, event };

        try {
            const state: unknown = event.lastResult === undefined ? null : JSON.parse(event.lastResult);
            const value = await this.run(trigger, state, signal);
            signal?.throwIfAborted();
            const result = canonicalizeJobGateResult(value);
            const changed = result.hash !== event.lastResultHash;
            const { lastError: _cleared, ...rest } = event;
            return {
                fire: event.lastResultHash !== undefined && changed,
                event: { ...rest, lastResult: result.canonicalJson, lastResultHash: result.hash, consecutiveFailures: 0 },
                changed: changed || event.consecutiveFailures !== 0 || event.lastError !== undefined,
            };
        } catch (error) {
            // Revocation is not a failed script; the trigger-only deadline still is.
            signal?.throwIfAborted();
            const consecutiveFailures = event.consecutiveFailures + 1;
            return {
                fire: false,
                event: {
                    ...event,
                    consecutiveFailures,
                    lastError: { message: errorMessage(error), at: new Date(this.now()).toISOString() },
                    paused: event.paused || consecutiveFailures >= 5,
                },
                changed: true,
            };
        }
    }
}

/** Shared scheduler cadence: double per failure, with at most one hour of backoff. */
export function getScriptConditionPollDelay(event: ScriptConditionEvent): number {
    if (event.consecutiveFailures <= 0) return event.intervalMs;
    return Math.min(event.intervalMs * 2 ** Math.min(event.consecutiveFailures, 16), Math.max(3_600_000, event.intervalMs));
}

function errorMessage(error: unknown): string {
    try {
        return (error instanceof Error ? error.message : String(error)).slice(0, 500) || 'Unknown error';
    } catch {
        return 'Unknown error';
    }
}
