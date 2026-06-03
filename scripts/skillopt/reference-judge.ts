/**
 * Reference-based similarity scoring (generic, no domain logic).
 *
 * Compares a candidate's structured output against an ideal/reference structured
 * output and returns a similarity score in [0, 1]. Nothing here knows about commits,
 * files, or any specific skill — it only compares lists of "points", so the same
 * scorer is reusable for any skill that has a reference answer.
 *
 * The score blends two generic signals:
 *
 *   1. Point-overlap F1 (primary) — an LLM matches candidate points to ideal points
 *      by MEANING (not wording). From the match count we compute precision/recall/F1.
 *      Using discrete matches is far more stable than asking for a raw 0–1 float.
 *
 *   2. Holistic reference similarity (secondary) — a single LLM judgment of how well
 *      the candidate matches the reference in substance and intent.
 *
 *   referenceScore = sw1·pointF1 + sw2·holisticScore   (defaults sw1=0.7, sw2=0.3)
 */

import { runCopilotCli, CopilotCliOptions } from './cli-driver';
import { StructuredOutput } from './extract';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReferenceWeights {
    /** Weight for point-overlap F1 (default 0.7). */
    pointF1Weight: number;
    /** Weight for holistic reference similarity (default 0.3). */
    holisticWeight: number;
}

export const DEFAULT_REFERENCE_WEIGHTS: ReferenceWeights = {
    pointF1Weight: 0.7,
    holisticWeight: 0.3,
};

export interface ReferenceScore {
    /** Blended reference similarity ∈ [0, 1]. */
    score: number;
    pointF1: number;
    holisticScore: number;
    precision: number;
    recall: number;
    matched: number;
    candidateCount: number;
    idealCount: number;
}

// ─── Pure math ────────────────────────────────────────────────────────────────

/** Computes precision/recall/F1 from match counts. Guards against division by zero. */
export function computeF1(
    matched: number,
    candidateCount: number,
    idealCount: number
): { precision: number; recall: number; f1: number } {
    const precision = candidateCount > 0 ? matched / candidateCount : 0;
    const recall = idealCount > 0 ? matched / idealCount : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { precision, recall, f1 };
}

/** Blends the two generic similarity components, normalising the weights to [0, 1]. */
export function blendReferenceScore(
    pointF1: number,
    holisticScore: number,
    weights: ReferenceWeights = DEFAULT_REFERENCE_WEIGHTS
): number {
    const total = weights.pointF1Weight + weights.holisticWeight;
    if (total === 0) return 0;
    return (weights.pointF1Weight * pointF1 + weights.holisticWeight * holisticScore) / total;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function renderPoints(label: string, out: StructuredOutput): string {
    const lines = out.points.map(p => {
        const group = p.group ? ` [group: ${p.group}]` : '';
        return `${p.id}. ${p.text}${group}`;
    });
    return `${label}:\n${lines.join('\n') || '(none)'}`;
}

export function buildMatchPrompt(candidate: StructuredOutput, ideal: StructuredOutput): string {
    return [
        'You are comparing a CANDIDATE list of points to a REFERENCE list of points for',
        'the same task. Match each REFERENCE point to a CANDIDATE point that expresses the',
        'SAME substance/decision (semantically, ignoring wording). Each reference point may',
        'match at most one candidate point and vice versa.',
        '',
        renderPoints('REFERENCE', ideal),
        '',
        renderPoints('CANDIDATE', candidate),
        '',
        'Output ONLY a single JSON object in a ```json code block:',
        '```json',
        '{ "matchedCount": <integer number of reference points with a semantic match> }',
        '```',
    ].join('\n');
}

export function buildHolisticPrompt(candidate: StructuredOutput, ideal: StructuredOutput): string {
    return [
        'Score from 0 to 1 how well the CANDIDATE answer matches the REFERENCE answer in',
        'substance and intent (NOT wording). 1.0 = same conclusions, structure, and key',
        'decisions; 0.0 = unrelated or contradictory. Penalize missing or extra points.',
        '',
        renderPoints('REFERENCE', ideal),
        '',
        renderPoints('CANDIDATE', candidate),
        '',
        'Output ONLY a single decimal number between 0 and 1, nothing else.',
    ].join('\n');
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

export function parseMatchedCount(raw: string, max: number): number {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1] : raw;
    try {
        const obj = JSON.parse(jsonText.slice(jsonText.indexOf('{'), jsonText.lastIndexOf('}') + 1));
        const n = (obj as { matchedCount?: unknown }).matchedCount;
        if (typeof n === 'number' && isFinite(n)) {
            return Math.max(0, Math.min(max, Math.round(n)));
        }
    } catch {
        /* fall through */
    }
    // Fallback: first integer in the output.
    const m = raw.match(/\d+/);
    if (m) return Math.max(0, Math.min(max, parseInt(m[0], 10)));
    return 0;
}

export function parseHolisticScore(raw: string): number {
    const match = raw.trim().match(/\b(0(?:\.\d+)?|1(?:\.0*)?)\b/);
    if (match) {
        return Math.max(0, Math.min(1, parseFloat(match[1])));
    }
    return 0.5;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Computes the generic reference-similarity score between a candidate and an ideal
 * structured output using two headless Copilot calls (point-matching + holistic).
 *
 * Both calls fail safe: a failed match call yields 0 matched points; a failed
 * holistic call yields 0.5.
 */
export async function referenceSimilarity(
    candidate: StructuredOutput,
    ideal: StructuredOutput,
    judgeModel: string,
    judgeWorkdir: string,
    weights: ReferenceWeights = DEFAULT_REFERENCE_WEIGHTS,
    options: CopilotCliOptions = {}
): Promise<ReferenceScore> {
    const candidateCount = candidate.points.length;
    const idealCount = ideal.points.length;

    // Degenerate cases: no work for the LLM.
    if (idealCount === 0) {
        return {
            score: candidateCount === 0 ? 1 : 0,
            pointF1: candidateCount === 0 ? 1 : 0,
            holisticScore: candidateCount === 0 ? 1 : 0,
            precision: 0, recall: 0, matched: 0, candidateCount, idealCount,
        };
    }
    if (candidateCount === 0) {
        return {
            score: 0, pointF1: 0, holisticScore: 0,
            precision: 0, recall: 0, matched: 0, candidateCount, idealCount,
        };
    }

    // 1. Point-match → F1
    let matched = 0;
    try {
        const res = await runCopilotCli(buildMatchPrompt(candidate, ideal), judgeWorkdir, judgeModel, options);
        matched = parseMatchedCount(res.stdout, Math.min(candidateCount, idealCount));
    } catch {
        matched = 0;
    }
    const { precision, recall, f1 } = computeF1(matched, candidateCount, idealCount);

    // 2. Holistic similarity
    let holisticScore = 0.5;
    try {
        const res = await runCopilotCli(buildHolisticPrompt(candidate, ideal), judgeWorkdir, judgeModel, options);
        holisticScore = parseHolisticScore(res.stdout);
    } catch {
        holisticScore = 0.5;
    }

    const score = blendReferenceScore(f1, holisticScore, weights);

    return {
        score,
        pointF1: f1,
        holisticScore,
        precision,
        recall,
        matched,
        candidateCount,
        idealCount,
    };
}
