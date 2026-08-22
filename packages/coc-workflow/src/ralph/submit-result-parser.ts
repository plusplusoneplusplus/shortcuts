import type { RalphSubmitResult } from './types';

const MARKER = 'RALPH_SUBMIT_RESULT';

/**
 * Extract and parse the RALPH_SUBMIT_RESULT JSON block from a PR-submit
 * agent response string. Tolerant of fenced and bare JSON, modeled on
 * `parseFinalCheckResult`. Missing marker, missing JSON, malformed JSON,
 * or an unknown status all yield `status: 'unparseable'` with the parse
 * detail in `error` — callers persist those as a failed submit.
 */
export function parseRalphSubmitResult(response: string): RalphSubmitResult {
    const normalised = response.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const markerIdx = normalised.indexOf(MARKER);
    if (markerIdx === -1) {
        return unparseable('Response does not contain RALPH_SUBMIT_RESULT marker');
    }

    const afterMarker = normalised.slice(markerIdx + MARKER.length);
    const raw = extractJson(afterMarker);
    if (!raw) {
        return unparseable('No JSON block found after RALPH_SUBMIT_RESULT marker');
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

function validateParsed(parsed: unknown): RalphSubmitResult {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return unparseable('JSON root must be an object');
    }

    const obj = parsed as Record<string, unknown>;
    const status = obj['status'];
    if (status !== 'submitted' && status !== 'failed') {
        return unparseable('"status" field must be "submitted" or "failed"');
    }

    const prUrl = typeof obj['prUrl'] === 'string' && obj['prUrl'].trim() ? obj['prUrl'].trim() : undefined;
    const prNumber = typeof obj['prNumber'] === 'number' && Number.isFinite(obj['prNumber'])
        ? obj['prNumber']
        : undefined;
    const commitShas = Array.isArray(obj['commitShas'])
        ? obj['commitShas'].filter((sha): sha is string => typeof sha === 'string' && sha.trim().length > 0)
        : undefined;
    const error = typeof obj['error'] === 'string' && obj['error'].trim() ? obj['error'].trim() : undefined;

    return {
        status,
        ...(prUrl ? { prUrl } : {}),
        ...(prNumber !== undefined ? { prNumber } : {}),
        ...(commitShas && commitShas.length > 0 ? { commitShas } : {}),
        ...(error ? { error } : {}),
    };
}

function unparseable(error: string): RalphSubmitResult {
    return { status: 'unparseable', error };
}
