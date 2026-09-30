import type {
    RalphInputOption,
    RalphInputQuestion,
    RalphInputQuestionType,
    RalphInputRequest,
    RalphNeedsInputParseResult,
} from './types';
import { extractJsonObjectString, normalizeNewlines } from '../utils/text';

export const RALPH_NEEDS_INPUT_TOKEN = 'RALPH_NEEDS_INPUT';
/** Upper bound on questions in the one batch an iteration may raise. */
export const RALPH_NEEDS_INPUT_MAX_QUESTIONS = 5;
/** Upper bound on the raw JSON block size, in characters. */
export const RALPH_NEEDS_INPUT_MAX_BLOCK_CHARS = 20_000;

const QUESTION_TYPES: readonly RalphInputQuestionType[] = ['select', 'multi-select', 'yes-no', 'confirm', 'text'];

/**
 * Parse the RALPH_NEEDS_INPUT signal and its JSON question block from a Ralph
 * iteration response.
 *
 * Returns `absent` when the token never appears, `invalid` when the token is
 * present but the block is missing, malformed, oversized, or carries more than
 * one batch, and `ok` with the normalized request otherwise. Callers treat
 * `invalid` exactly like a response with no signal.
 */
export function parseRalphNeedsInput(response: string): RalphNeedsInputParseResult {
    const text = normalizeNewlines(response);
    const markerIndex = findTokenIndex(text);
    if (markerIndex === -1) {
        return { status: 'absent' };
    }

    const afterMarker = text.slice(markerIndex + RALPH_NEEDS_INPUT_TOKEN.length);
    const raw = extractJsonObjectString(afterMarker);
    if (!raw) {
        return invalid(`No JSON block found after ${RALPH_NEEDS_INPUT_TOKEN}`);
    }
    if (raw.length > RALPH_NEEDS_INPUT_MAX_BLOCK_CHARS) {
        return invalid(`Question block exceeds ${RALPH_NEEDS_INPUT_MAX_BLOCK_CHARS} characters`);
    }
    if (countQuestionBatches(afterMarker) > 1) {
        return invalid('Only one question batch is allowed per iteration');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return invalid(`Malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return validateRequest(parsed);
}

function validateRequest(parsed: unknown): RalphNeedsInputParseResult {
    if (!isRecord(parsed)) {
        return invalid('JSON root must be an object');
    }
    const context = typeof parsed['context'] === 'string' ? parsed['context'].trim() : '';
    if (!context) {
        return invalid('"context" must be a non-empty string');
    }
    const rawQuestions = parsed['questions'];
    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        return invalid('"questions" must be a non-empty array');
    }
    if (rawQuestions.length > RALPH_NEEDS_INPUT_MAX_QUESTIONS) {
        return invalid(`At most ${RALPH_NEEDS_INPUT_MAX_QUESTIONS} questions are allowed`);
    }

    const questions: RalphInputQuestion[] = [];
    for (const [index, rawQuestion] of rawQuestions.entries()) {
        const question = validateQuestion(rawQuestion);
        if (typeof question === 'string') {
            return invalid(`questions[${index}]: ${question}`);
        }
        questions.push(question);
    }
    const request: RalphInputRequest = { context, questions };
    return { status: 'ok', request };
}

/** Returns the normalized question, or an error message. */
function validateQuestion(raw: unknown): RalphInputQuestion | string {
    if (!isRecord(raw)) {
        return 'must be an object';
    }
    const question = typeof raw['question'] === 'string' ? raw['question'].trim() : '';
    if (!question) {
        return '"question" must be a non-empty string';
    }
    const type = raw['type'] as RalphInputQuestionType;
    if (!QUESTION_TYPES.includes(type)) {
        return `"type" must be one of ${QUESTION_TYPES.join(', ')}`;
    }

    let options: RalphInputOption[] | undefined;
    if (raw['options'] !== undefined) {
        if (!Array.isArray(raw['options'])) {
            return '"options" must be an array';
        }
        options = [];
        for (const rawOption of raw['options']) {
            const option = normalizeOption(rawOption);
            if (!option) {
                return 'each option needs a string "value" and "label"';
            }
            options.push(option);
        }
    }
    if ((type === 'select' || type === 'multi-select') && !options?.length) {
        return `"${type}" questions need at least one option`;
    }

    if (raw['defaultValue'] !== undefined && !isAnswerValue(raw['defaultValue'])) {
        return '"defaultValue" must be a string or string array';
    }
    const recommendation = raw['recommendation'];
    if (!isAnswerValue(recommendation) || (Array.isArray(recommendation) ? recommendation.length === 0 : !recommendation.trim())) {
        return '"recommendation" must be a non-empty string or string array';
    }

    return {
        question,
        type,
        ...(options ? { options } : {}),
        ...(raw['defaultValue'] !== undefined ? { defaultValue: raw['defaultValue'] as string | string[] } : {}),
        recommendation,
    };
}

function normalizeOption(raw: unknown): RalphInputOption | null {
    if (!isRecord(raw) || typeof raw['value'] !== 'string' || typeof raw['label'] !== 'string') {
        return null;
    }
    return {
        value: raw['value'],
        label: raw['label'],
        ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
    };
}

/**
 * Count both fenced and bare question batches after the first marker.
 */
function countQuestionBatches(text: string): number {
    let count = 0;
    const withoutFences = text.replace(/```json\s*\n([\s\S]*?)\n```/gm, (_match, json: string) => {
        try {
            const parsed: unknown = JSON.parse(json.trim());
            if (isRecord(parsed) && Array.isArray(parsed['questions'])) {
                count += 1;
            }
        } catch {
            // Non-JSON fenced blocks are not question batches.
        }
        return '';
    });
    let remaining = withoutFences;
    while (remaining.includes('{')) {
        const start = remaining.indexOf('{');
        const raw = extractJsonObjectString(remaining.slice(start));
        if (!raw) {
            remaining = remaining.slice(start + 1);
            continue;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            if (isRecord(parsed) && Array.isArray(parsed['questions'])) {
                count += 1;
            }
            remaining = remaining.slice(start + raw.length);
        } catch {
            remaining = remaining.slice(start + 1);
        }
    }
    return count;
}

function findTokenIndex(text: string): number {
    let index = text.indexOf(RALPH_NEEDS_INPUT_TOKEN);
    while (index !== -1) {
        const before = index === 0 ? undefined : text[index - 1];
        const after = text[index + RALPH_NEEDS_INPUT_TOKEN.length];
        if (!isIdentifierChar(before) && !isIdentifierChar(after)) {
            return index;
        }
        index = text.indexOf(RALPH_NEEDS_INPUT_TOKEN, index + 1);
    }
    return -1;
}

function isIdentifierChar(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function isAnswerValue(value: unknown): value is string | string[] {
    return typeof value === 'string'
        || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function invalid(error: string): RalphNeedsInputParseResult {
    return { status: 'invalid', error };
}
