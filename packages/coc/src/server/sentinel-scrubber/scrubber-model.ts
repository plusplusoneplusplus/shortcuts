import { createHash } from 'node:crypto';
import { z } from 'zod';
import { nextCronTime, parseCron } from '../schedule/cron-utils';

/** Most open items one run assesses; the rest are deferred to the next run. */
export const MAX_SCRUB_ITEMS = 50;
/** Runs (and their snapshot files) kept per ledger. */
export const MAX_SCRUB_RUNS = 20;
/** Consecutive failed/timed-out runs that pause the schedule. */
export const SCRUB_FAILURE_PAUSE_THRESHOLD = 3;
export const SCRUB_TIMEOUT_MS = 20 * 60_000;
export const SCRUB_MIN_INTERVAL_MS = 60 * 60_000;
export const SCRUB_DEFAULT_CRON = '0 9 * * *';
export const SCRUB_CRON_PRESETS = [
    { label: 'Every 6h', cron: '0 */6 * * *' },
    { label: 'Every 12h', cron: '0 */12 * * *' },
    { label: 'Every 24h', cron: SCRUB_DEFAULT_CRON },
] as const;

const id = z.string().min(1).max(200);
export const scrubVerdictSchema = z.enum(['done', 'obsolete', 'in_progress', 'needs_attention', 'unchanged', 'unverified']);
export const scrubConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const scrubEvidenceSchema = z.object({
    kind: z.enum(['pr', 'commit', 'job', 'reference', 'other']),
    ref: z.string().trim().min(1).max(2_000),
    state: z.enum(['merged', 'open', 'closed', 'on_default_branch', 'succeeded', 'failed', 'other']),
    observedAt: z.iso.datetime().optional(),
    checkedAt: z.iso.datetime(),
}).strict();
/** One item assessment as returned through `submit_scrub_findings`. */
export const scrubFindingInputSchema = z.object({
    itemId: id,
    verdict: scrubVerdictSchema,
    confidence: scrubConfidenceSchema,
    autoApply: z.boolean().default(false),
    summary: z.string().trim().min(1).max(300),
    rationale: z.string().max(2_000).default(''),
    unverifiedReason: z.string().trim().min(1).max(2_000).optional(),
    evidence: z.array(scrubEvidenceSchema).max(20).default([]),
}).strict().superRefine((finding, ctx) => {
    if (finding.verdict !== 'unchanged' && finding.verdict !== 'unverified' && finding.evidence.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['evidence'], message: `verdict ${finding.verdict} needs at least one evidence entry` });
    }
    if (finding.autoApply && finding.verdict !== 'done') {
        ctx.addIssue({ code: 'custom', path: ['autoApply'], message: 'autoApply is only valid on done' });
    }
    if (finding.verdict === 'unverified' && !finding.unverifiedReason) {
        ctx.addIssue({ code: 'custom', path: ['unverifiedReason'], message: 'unverified findings need a reason' });
    }
});

export type ScrubVerdict = z.infer<typeof scrubVerdictSchema>;
export type ScrubConfidence = z.infer<typeof scrubConfidenceSchema>;
export type ScrubEvidence = z.infer<typeof scrubEvidenceSchema>;
export type ScrubFindingInput = z.infer<typeof scrubFindingInputSchema>;

/**
 * Identity of the evidence behind a finding: sha256 over the sorted
 * `(kind, ref, state)` tuples. Check times never change it, so re-observing
 * the same artifacts keeps a dismissal in force.
 */
export function evidenceFingerprint(evidence: readonly Pick<ScrubEvidence, 'kind' | 'ref' | 'state'>[]): string {
    const tuples = evidence.map(entry => [entry.kind, entry.ref.trim(), entry.state])
        .sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')));
    return createHash('sha256').update(JSON.stringify(tuples)).digest('hex');
}

/**
 * Returns an error message when `cron` is not a valid 5-field expression or
 * can fire more often than once an hour; `undefined` when it is acceptable.
 */
export function validateScrubCron(cron: string, now: Date = new Date()): string | undefined {
    const expr = cron.trim();
    try {
        const fields = parseCron(expr);
        const ranges: Array<[Set<number>, number, number]> = [
            [fields.minutes, 0, 59], [fields.hours, 0, 23], [fields.daysOfMonth, 1, 31],
            [fields.months, 1, 12], [fields.daysOfWeek, 0, 6],
        ];
        if (ranges.some(([values, min, max]) => values.size === 0
            || [...values].some(value => !Number.isInteger(value) || value < min || value > max))) {
            return 'Invalid cron expression: a field is out of range';
        }
    } catch (error) {
        return error instanceof Error ? error.message : 'Invalid cron expression';
    }
    // Scan a week of firings: the tightest gap must be at least an hour.
    let previous = nextCronTime(expr, now);
    if (!previous) return 'This schedule never runs';
    const horizon = now.getTime() + 8 * 24 * 60 * 60_000;
    while (previous.getTime() < horizon) {
        const next = nextCronTime(expr, previous);
        if (!next) break;
        if (next.getTime() - previous.getTime() < SCRUB_MIN_INTERVAL_MS) return 'The schedule must run at most once an hour';
        previous = next;
    }
    return undefined;
}
