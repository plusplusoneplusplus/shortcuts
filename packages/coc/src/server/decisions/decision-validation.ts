/**
 * Pure request validation and model-output normalization for the decision API.
 *
 * Code, not the model, derives every Choice `choice`, Score `score`/`legend`,
 * and final `confidence`. Confidence uses one formula for every answer type:
 *
 *     confidence = 1 - H(p) / ln(n)
 *
 * where `H(p) = -Σ pᵢ ln pᵢ` is the Shannon entropy of the normalized
 * distribution over `n` options (Noul uses `[value, 1 - value]`). A one-hot
 * distribution yields `1`; a uniform distribution yields `0`.
 */

import {
    DECISION_BACKENDS,
    type ChoiceDecisionAnswer,
    type DecisionAnswer,
    type DecisionBackendName,
    type DecisionJsonValue,
    type NoulDecisionAnswer,
    type NoulDecisionQuestion,
    type ScoreDecisionAnswer,
} from '@plusplusoneplusplus/coc-client';
import {
    DecisionBackendError,
    type ValidatedDecisionQuestion,
    type ValidatedDecisionRequest,
} from './decision-backend';

export const DECISION_LIMITS = {
    maxBodyBytes: 256 * 1024,
    maxQuestions: 64,
    minChoiceOptions: 2,
    maxChoiceOptions: 64,
    minScoreLevels: 2,
    maxScoreLevels: 10,
    maxQuestionIdLength: 100,
    maxOptionLength: 100,
    maxJsonDepth: 64,
} as const;

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_REPORTED_ERRORS = 20;

type Obj = Record<string, unknown>;

function isPlainObject(value: unknown): value is Obj {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function describe(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

/** Append JSON-serializability problems for `value` (finite numbers, plain objects, no cycles, no dangerous keys). */
function checkJsonValue(value: unknown, path: string, errors: string[], seen = new Set<object>(), depth = 0): void {
    if (depth > DECISION_LIMITS.maxJsonDepth) {
        errors.push(`${path} exceeds maximum nesting depth of ${DECISION_LIMITS.maxJsonDepth}`);
        return;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) errors.push(`${path} must be a finite number`);
        return;
    }
    if (typeof value !== 'object') {
        errors.push(`${path} is not JSON-serializable (${typeof value})`);
        return;
    }
    if (seen.has(value)) {
        errors.push(`${path} contains a circular reference`);
        return;
    }
    if (!Array.isArray(value) && !isPlainObject(value)) {
        errors.push(`${path} must be a plain JSON object`);
        return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach((item, index) => checkJsonValue(item, `${path}[${index}]`, errors, seen, depth + 1));
    } else {
        for (const key of Object.keys(value)) {
            if (DANGEROUS_KEYS.has(key)) {
                errors.push(`${path} contains forbidden key '${key}'`);
                continue;
            }
            checkJsonValue(value[key], `${path}.${key}`, errors, seen, depth + 1);
        }
    }
    seen.delete(value);
}

function isEmptyJson(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (isPlainObject(value)) return Object.keys(value).length === 0;
    return false;
}

function checkKey(key: string, label: string, maxLength: number, errors: string[]): boolean {
    if (key.trim().length === 0) {
        errors.push(`${label} must not be empty`);
        return false;
    }
    if (key.length > maxLength) {
        errors.push(`${label} '${key.slice(0, 20)}…' exceeds ${maxLength} characters`);
        return false;
    }
    if (DANGEROUS_KEYS.has(key)) {
        errors.push(`${label} '${key}' is forbidden`);
        return false;
    }
    return true;
}

function validateQuestion(id: string, raw: unknown, errors: string[]): ValidatedDecisionQuestion | undefined {
    const path = `questions.${id}`;
    if (!isPlainObject(raw)) {
        errors.push(`${path} must be an object`);
        return undefined;
    }
    const before = errors.length;
    checkJsonValue(raw, path, errors);
    if (isEmptyJson(raw.instructions)) errors.push(`${path}.instructions must not be empty`);

    switch (raw.type) {
        case 'noul': {
            const criteria = raw.criteria;
            if (criteria !== undefined) {
                if (!isPlainObject(criteria)) {
                    errors.push(`${path}.criteria must be an object with optional 'true'/'false' keys`);
                } else {
                    for (const key of Object.keys(criteria)) {
                        if (key !== 'true' && key !== 'false') errors.push(`${path}.criteria has unknown key '${key}'`);
                    }
                }
            }
            if (errors.length > before) return undefined;
            return { id, type: 'noul', instructions: raw.instructions as DecisionJsonValue, ...(criteria !== undefined ? { criteria: criteria as NoulDecisionQuestion['criteria'] } : {}) };
        }
        case 'choice': {
            const criteria = raw.criteria;
            if (!isPlainObject(criteria)) {
                errors.push(`${path}.criteria must be an object mapping option → description`);
                return undefined;
            }
            const options = Object.keys(criteria);
            if (options.length < DECISION_LIMITS.minChoiceOptions || options.length > DECISION_LIMITS.maxChoiceOptions) {
                errors.push(`${path}.criteria must have ${DECISION_LIMITS.minChoiceOptions}-${DECISION_LIMITS.maxChoiceOptions} options`);
            }
            for (const option of options) checkKey(option, `${path} option`, DECISION_LIMITS.maxOptionLength, errors);
            if (errors.length > before) return undefined;
            return { id, type: 'choice', instructions: raw.instructions as DecisionJsonValue, criteria: criteria as Record<string, DecisionJsonValue | null>, options };
        }
        case 'score': {
            const criteria = raw.criteria;
            if (!Array.isArray(criteria)) {
                errors.push(`${path}.criteria must be an array of level descriptions`);
                return undefined;
            }
            if (criteria.length < DECISION_LIMITS.minScoreLevels || criteria.length > DECISION_LIMITS.maxScoreLevels) {
                errors.push(`${path}.criteria must have ${DECISION_LIMITS.minScoreLevels}-${DECISION_LIMITS.maxScoreLevels} levels`);
            }
            criteria.forEach((level, index) => {
                if (isEmptyJson(level)) errors.push(`${path}.criteria[${index}] must not be empty`);
            });
            if (errors.length > before) return undefined;
            return { id, type: 'score', instructions: raw.instructions as DecisionJsonValue, criteria: criteria as DecisionJsonValue[] };
        }
        default:
            errors.push(`${path}.type must be one of 'noul', 'choice', 'score'`);
            return undefined;
    }
}

function invalidRequest(errors: string[]): DecisionBackendError {
    const reported = errors.slice(0, MAX_REPORTED_ERRORS);
    return new DecisionBackendError({
        code: 'DECISION_INVALID_REQUEST',
        status: 400,
        message: `Invalid decision request: ${reported[0]}`,
        details: { errors: reported },
    });
}

/** Validate a parsed request body. Throws a `400` `DecisionBackendError` listing every problem found. */
export function validateDecisionRequest(body: unknown): ValidatedDecisionRequest {
    if (!isPlainObject(body)) throw invalidRequest(['request body must be a JSON object']);
    const errors: string[] = [];

    for (const key of Object.keys(body)) {
        if (key !== 'backend' && key !== 'state' && key !== 'questions') errors.push(`unknown field '${key}'`);
    }

    let backend: DecisionBackendName = 'copilot';
    if (body.backend !== undefined) {
        if (!DECISION_BACKENDS.includes(body.backend as DecisionBackendName)) {
            errors.push(`backend must be one of ${DECISION_BACKENDS.join(', ')}`);
        } else {
            backend = body.backend as DecisionBackendName;
        }
    }

    const state = body.state;
    if (typeof state !== 'string' && (state === null || typeof state !== 'object')) {
        errors.push(`state must be a string, object, or array (got ${describe(state)})`);
    } else {
        checkJsonValue(state, 'state', errors);
    }

    const questions: ValidatedDecisionQuestion[] = [];
    if (!isPlainObject(body.questions)) {
        errors.push('questions must be an object mapping question id → question');
    } else {
        const ids = Object.keys(body.questions);
        if (ids.length === 0) errors.push('questions must not be empty');
        if (ids.length > DECISION_LIMITS.maxQuestions) errors.push(`questions must not exceed ${DECISION_LIMITS.maxQuestions} entries`);
        for (const id of ids) {
            if (!checkKey(id, 'question id', DECISION_LIMITS.maxQuestionIdLength, errors)) continue;
            const question = validateQuestion(id, body.questions[id], errors);
            if (question) questions.push(question);
        }
    }

    if (errors.length > 0) throw invalidRequest(errors);
    return { backend, state, questions };
}

// ============================================================================
// Output normalization
// ============================================================================

export type ParsedDecisionOutput =
    | { ok: true; answers: Record<string, DecisionAnswer> }
    | { ok: false; errors: string[] };

/** `1 - H(p)/ln(n)` over a normalized distribution; see module doc. */
export function entropyConfidence(probabilities: number[]): number {
    const n = probabilities.length;
    if (n <= 1) return 1;
    let entropy = 0;
    for (const p of probabilities) {
        if (p > 0) entropy -= p * Math.log(p);
    }
    return Math.min(1, Math.max(0, 1 - entropy / Math.log(n)));
}

/** Validate a raw distribution against `keys` and normalize it to sum to `1`. */
function normalizeDistribution(raw: unknown, keys: string[], path: string, errors: string[]): Record<string, number> | undefined {
    if (!isPlainObject(raw)) {
        errors.push(`${path}.probabilities must be an object`);
        return undefined;
    }
    const before = errors.length;
    const expected = new Set(keys);
    for (const key of Object.keys(raw)) {
        if (!expected.has(key)) errors.push(`${path}.probabilities has unknown option '${key}'`);
    }
    let sum = 0;
    for (const key of keys) {
        const value = raw[key];
        if (value === undefined) {
            errors.push(`${path}.probabilities is missing option '${key}'`);
        } else if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push(`${path}.probabilities['${key}'] must be a finite number`);
        } else if (value < 0) {
            errors.push(`${path}.probabilities['${key}'] must not be negative`);
        } else {
            sum += value;
        }
    }
    if (errors.length > before) return undefined;
    if (sum <= 0) {
        errors.push(`${path}.probabilities must not sum to zero`);
        return undefined;
    }
    const normalized: Record<string, number> = {};
    for (const key of keys) normalized[key] = (raw[key] as number) / sum;
    return normalized;
}

function normalizeAnswer(question: ValidatedDecisionQuestion, raw: unknown, errors: string[]): DecisionAnswer | undefined {
    const path = `answers.${question.id}`;
    if (!isPlainObject(raw)) {
        errors.push(`${path} must be an object`);
        return undefined;
    }
    if (raw.type !== question.type) {
        errors.push(`${path}.type must be '${question.type}'`);
        return undefined;
    }
    switch (question.type) {
        case 'noul': {
            if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
                errors.push(`${path}.value must be a finite number between 0 and 1`);
                return undefined;
            }
            const value = Math.min(1, Math.max(0, raw.value));
            const answer: NoulDecisionAnswer = { type: 'noul', value, confidence: entropyConfidence([value, 1 - value]) };
            return answer;
        }
        case 'choice': {
            const probabilities = normalizeDistribution(raw.probabilities, question.options, path, errors);
            if (!probabilities) return undefined;
            // Ties resolve to the earliest option in request order.
            let choice = question.options[0];
            for (const option of question.options) {
                if (probabilities[option] > probabilities[choice]) choice = option;
            }
            const answer: ChoiceDecisionAnswer = {
                type: 'choice',
                choice,
                probabilities,
                confidence: entropyConfidence(Object.values(probabilities)),
            };
            return answer;
        }
        case 'score': {
            const levels = question.criteria.map((_, index) => String(index));
            const probabilities = normalizeDistribution(raw.probabilities, levels, path, errors);
            if (!probabilities) return undefined;
            const legend: Record<string, DecisionJsonValue> = {};
            let score = 0;
            question.criteria.forEach((criterion, index) => {
                legend[String(index)] = criterion;
                score += index * probabilities[String(index)];
            });
            const answer: ScoreDecisionAnswer = {
                type: 'score',
                score,
                legend,
                probabilities,
                confidence: entropyConfidence(Object.values(probabilities)),
            };
            return answer;
        }
    }
}

function stripCodeFence(text: string): string {
    const trimmed = text.trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
    return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parse and normalize raw model output against the validated request.
 * Returns concise validation errors instead of throwing so the caller can
 * decide whether to send a repair prompt.
 */
export function parseDecisionOutput(text: string, request: ValidatedDecisionRequest): ParsedDecisionOutput {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripCodeFence(text));
    } catch (error) {
        return { ok: false, errors: [`output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.answers)) {
        return { ok: false, errors: ["output must be a JSON object with an 'answers' object"] };
    }
    const rawAnswers = parsed.answers;
    const errors: string[] = [];
    const expectedIds = new Set(request.questions.map(q => q.id));
    for (const key of Object.keys(parsed)) {
        if (key !== 'answers') errors.push(`output has unexpected top-level field '${key}'`);
    }
    for (const id of Object.keys(rawAnswers)) {
        if (!expectedIds.has(id)) errors.push(`answers has unexpected question id '${id}'`);
    }
    const answers: Record<string, DecisionAnswer> = {};
    for (const question of request.questions) {
        if (!Object.prototype.hasOwnProperty.call(rawAnswers, question.id)) {
            errors.push(`answers is missing question id '${question.id}'`);
            continue;
        }
        const answer = normalizeAnswer(question, rawAnswers[question.id], errors);
        if (answer) answers[question.id] = answer;
    }
    if (errors.length > 0) return { ok: false, errors: errors.slice(0, MAX_REPORTED_ERRORS) };
    return { ok: true, answers };
}
