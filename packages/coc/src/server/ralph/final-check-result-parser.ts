/**
 * Parser for the structured RALPH_FINAL_CHECK_RESULT block emitted by the
 * read-only final-check AI (AC-02).
 *
 * The checker AI is instructed to emit exactly one JSON block preceded by
 * the `RALPH_FINAL_CHECK_RESULT` marker. This module extracts and validates
 * that block, handling edge cases defensively.
 */

// ============================================================================
// Types
// ============================================================================

export interface FinalCheckGap {
    id: string;
    title: string;
    evidence: string;
    recommendedAction: string;
    validation?: string;
}

export type FinalCheckParseStatus =
    | 'clean'       // hasGaps: false, empty gaps array
    | 'gaps'        // hasGaps: true, non-empty gaps array
    | 'invalid'     // contradictory fields (hasGaps:false + non-empty gaps, or hasGaps:true + empty gaps)
    | 'unparseable'; // no marker or malformed JSON

export interface FinalCheckResult {
    status: FinalCheckParseStatus;
    hasGaps: boolean;
    summary: string;
    gaps: FinalCheckGap[];
    /**
     * Focused gap-fix goal. Present when hasGaps is true.
     * When the AI omitted it but hasGaps is true, this field contains a
     * synthesized goal (and `goalSynthesized` is true).
     */
    gapFixGoal?: string;
    /** True when gapFixGoal was absent in the AI response and was synthesized. */
    goalSynthesized?: boolean;
    /** Raw error message when status is 'unparseable' or 'invalid'. */
    error?: string;
}

// ============================================================================
// Parser
// ============================================================================

const MARKER = 'RALPH_FINAL_CHECK_RESULT';

/**
 * Extract and parse the RALPH_FINAL_CHECK_RESULT JSON block from a checker
 * AI response string.
 *
 * Strategy:
 * 1. Locate the `RALPH_FINAL_CHECK_RESULT` marker.
 * 2. Extract the first ```json ... ``` fenced block after the marker, or a
 *    bare `{...}` block.
 * 3. Validate the parsed object.
 * 4. Handle contradictory fields and synthesize missing gapFixGoal.
 */
export function parseFinalCheckResult(response: string): FinalCheckResult {
    const normalised = response.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const markerIdx = normalised.indexOf(MARKER);
    if (markerIdx === -1) {
        return unparseable('Response does not contain RALPH_FINAL_CHECK_RESULT marker');
    }

    const afterMarker = normalised.slice(markerIdx + MARKER.length);

    // Try to extract JSON from a fenced block first, then bare object
    const raw = extractJson(afterMarker);
    if (!raw) {
        return unparseable('No JSON block found after RALPH_FINAL_CHECK_RESULT marker');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return unparseable(`Malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    return validateParsed(parsed);
}

// ============================================================================
// Internal helpers
// ============================================================================

function extractJson(text: string): string | null {
    // Prefer fenced ```json ... ``` block
    const fenced = /```json\s*\n([\s\S]*?)\n```/m.exec(text);
    if (fenced) return fenced[1].trim();

    // Fall back to first bare { ... } block (greedy from first `{`)
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

function validateParsed(parsed: unknown): FinalCheckResult {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return unparseable('JSON root must be an object');
    }

    const obj = parsed as Record<string, unknown>;

    if (obj['marker'] !== MARKER) {
        return unparseable(`JSON "marker" field must equal "${MARKER}"`);
    }

    if (typeof obj['hasGaps'] !== 'boolean') {
        return unparseable('"hasGaps" field must be a boolean');
    }

    const hasGaps = obj['hasGaps'] as boolean;
    const summary = typeof obj['summary'] === 'string' ? obj['summary'] : '';
    const rawGaps = Array.isArray(obj['gaps']) ? obj['gaps'] : [];
    const gaps = rawGaps.map(normaliseGap).filter((g): g is FinalCheckGap => g !== null);
    const rawGapFixGoal = typeof obj['gapFixGoal'] === 'string' ? obj['gapFixGoal'].trim() : '';

    // Contradiction: hasGaps:false but non-empty gaps
    if (!hasGaps && gaps.length > 0) {
        return {
            status: 'invalid',
            hasGaps: false,
            summary,
            gaps,
            error: 'Contradictory result: hasGaps is false but gaps array is non-empty',
        };
    }

    // Contradiction: hasGaps:true but empty gaps
    if (hasGaps && gaps.length === 0) {
        return {
            status: 'invalid',
            hasGaps: true,
            summary,
            gaps: [],
            error: 'Contradictory result: hasGaps is true but gaps array is empty',
        };
    }

    if (!hasGaps) {
        return { status: 'clean', hasGaps: false, summary, gaps: [] };
    }

    // hasGaps: true path
    let gapFixGoal = rawGapFixGoal;
    let goalSynthesized = false;

    if (!gapFixGoal) {
        // Synthesize a conservative goal from the gap list
        const gapList = gaps.map(g => `- ${g.title}: ${g.evidence}`).join('\n');
        gapFixGoal = `Fix only the following gaps found by the final checker. Preserve all completed behavior. Rerun required validation and emit RALPH_COMPLETE only when each gap is resolved.\n\nGaps:\n${gapList}`;
        goalSynthesized = true;
    }

    return {
        status: 'gaps',
        hasGaps: true,
        summary,
        gaps,
        gapFixGoal,
        ...(goalSynthesized ? { goalSynthesized: true } : {}),
    };
}

function normaliseGap(raw: unknown): FinalCheckGap | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    return {
        id: typeof obj['id'] === 'string' ? obj['id'] : 'GAP-?',
        title: typeof obj['title'] === 'string' ? obj['title'] : '(untitled)',
        evidence: typeof obj['evidence'] === 'string' ? obj['evidence'] : '',
        recommendedAction: typeof obj['recommendedAction'] === 'string' ? obj['recommendedAction'] : '',
        ...(typeof obj['validation'] === 'string' ? { validation: obj['validation'] } : {}),
    };
}

function unparseable(error: string): FinalCheckResult {
    return { status: 'unparseable', hasGaps: false, summary: '', gaps: [], error };
}
