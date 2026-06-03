import type { FinalCheckGap, FinalCheckResult } from './types';

const MARKER = 'RALPH_FINAL_CHECK_RESULT';

/**
 * Extract and parse the RALPH_FINAL_CHECK_RESULT JSON block from a checker
 * AI response string.
 */
export function parseFinalCheckResult(response: string): FinalCheckResult {
    const normalised = response.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const markerIdx = normalised.indexOf(MARKER);
    if (markerIdx === -1) {
        return unparseable('Response does not contain RALPH_FINAL_CHECK_RESULT marker');
    }

    const afterMarker = normalised.slice(markerIdx + MARKER.length);
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

function extractJson(text: string): string | null {
    const fenced = /```json\s*\n([\s\S]*?)\n```/m.exec(text);
    if (fenced) {
        return fenced[1].trim();
    }

    const start = text.indexOf('{');
    if (start === -1) {
        return null;
    }

    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') {
            depth++;
        } else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
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

    const hasGaps = obj['hasGaps'];
    const summary = typeof obj['summary'] === 'string' ? obj['summary'] : '';
    const rawGaps = Array.isArray(obj['gaps']) ? obj['gaps'] : [];
    const gaps = rawGaps.map(normaliseGap).filter((gap): gap is FinalCheckGap => gap !== null);
    const rawGapFixGoal = typeof obj['gapFixGoal'] === 'string' ? obj['gapFixGoal'].trim() : '';

    if (!hasGaps && gaps.length > 0) {
        return {
            status: 'invalid',
            hasGaps: false,
            summary,
            gaps,
            error: 'Contradictory result: hasGaps is false but gaps array is non-empty',
        };
    }

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

    let gapFixGoal = rawGapFixGoal;
    let goalSynthesized = false;
    if (!gapFixGoal) {
        const gapList = gaps.map(gap => `- ${gap.title}: ${gap.evidence}`).join('\n');
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
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
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
