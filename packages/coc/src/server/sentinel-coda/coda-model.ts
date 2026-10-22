import { createHash } from 'node:crypto';
import { z } from 'zod';
export { validateScrubCron, SCRUB_MIN_INTERVAL_MS, SCRUB_DEFAULT_CRON, SCRUB_CRON_PRESETS } from '../schedule/scrub-cron';

/** Most open items one run assesses; the rest are deferred to the next run. */
export const MAX_CODA_ITEMS = 50;
/** Runs (and their snapshot files) kept per ledger. */
export const MAX_SCRUB_RUNS = 20;
/** Consecutive failed/timed-out runs that pause the schedule. */
export const SCRUB_FAILURE_PAUSE_THRESHOLD = 3;
export const CODA_TIMEOUT_MS = 20 * 60_000;
const id = z.string().min(1).max(200);
export const codaVerdictSchema = z.enum(['done', 'obsolete', 'in_progress', 'deferred', 'needs_attention', 'unchanged', 'unverified']);
export const codaConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const codaEvidenceSchema = z.object({
    kind: z.enum(['pr', 'commit', 'job', 'reference', 'other']),
    ref: z.string().trim().min(1).max(2_000),
    state: z.enum(['merged', 'open', 'closed', 'on_default_branch', 'succeeded', 'failed', 'other']),
    observedAt: z.iso.datetime().optional(),
    checkedAt: z.iso.datetime(),
}).strict();
/** One item assessment as returned through `submit_scrub_findings`. */
export const codaFindingInputSchema = z.object({
    itemId: id,
    verdict: codaVerdictSchema,
    confidence: codaConfidenceSchema,
    autoApply: z.boolean().default(false),
    summary: z.string().trim().min(1).max(300),
    rationale: z.string().max(2_000).default(''),
    unverifiedReason: z.string().trim().min(1).max(2_000).optional(),
    evidence: z.array(codaEvidenceSchema).max(20).default([]),
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

export type CodaVerdict = z.infer<typeof codaVerdictSchema>;
export type CodaConfidence = z.infer<typeof codaConfidenceSchema>;
export type CodaEvidence = z.infer<typeof codaEvidenceSchema>;
export type CodaFindingInput = z.infer<typeof codaFindingInputSchema>;

/**
 * Identity of the evidence behind a finding: sha256 over the sorted
 * `(kind, ref, state)` tuples. Check times never change it, so re-observing
 * the same artifacts keeps a dismissal in force.
 */
export function evidenceFingerprint(evidence: readonly Pick<CodaEvidence, 'kind' | 'ref' | 'state'>[]): string {
    const tuples = evidence.map(entry => [entry.kind, entry.ref.trim(), entry.state])
        .sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')));
    return createHash('sha256').update(JSON.stringify(tuples)).digest('hex');
}
