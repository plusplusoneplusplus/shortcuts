import type { EvaluationOutcome, EventEvaluator } from './trigger-manager';
import type { ScriptConditionEvent, Trigger } from './trigger-types';
import { canonicalizeScriptConditionResult } from './script-condition-result';

/** The owner-scoped runtime supplies tools, strict JSON validation and cancellation. */
export type ScriptConditionRunner = (trigger: Trigger, state: unknown) => Promise<unknown>;

/** Computes a repeating condition's next baseline without mutating the stored rule. */
export class ScriptConditionEvaluator implements EventEvaluator {
    constructor(private readonly run: ScriptConditionRunner) {}

    async evaluate(trigger: Trigger): Promise<EvaluationOutcome & { event: ScriptConditionEvent }> {
        const event = trigger.event;
        if (event.type !== 'script-condition') {
            throw new Error(`ScriptConditionEvaluator cannot evaluate event ${event.type}`);
        }
        if (trigger.status !== 'active' || event.paused) return { fire: false, event };

        const state: unknown = event.lastResult === undefined ? null : JSON.parse(event.lastResult);
        const result = canonicalizeScriptConditionResult(await this.run(trigger, state));
        const changed = result.hash !== event.lastResultHash;
        return {
            fire: event.lastResultHash !== undefined && changed,
            event: { ...event, lastResult: result.canonicalJson, lastResultHash: result.hash },
            changed,
        };
    }
}
