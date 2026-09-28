import { describe, expect, it } from 'vitest';
import { DecisionBackendError } from '../../../src/server/decisions/decision-backend';
import {
    DECISION_LIMITS,
    entropyConfidence,
    parseDecisionOutput,
    validateDecisionRequest,
} from '../../../src/server/decisions/decision-validation';

const mixedBody = {
    state: { ticket: 'Login fails on Safari', severity: 'high' },
    questions: {
        isBug: { type: 'noul', instructions: 'Is this a bug report?', criteria: { true: 'Describes broken behavior', false: 'Feature request' } },
        area: { type: 'choice', instructions: 'Which area?', criteria: { auth: 'Login/session', ui: null, billing: 'Payments' } },
        urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Low', 'Medium', 'High'] },
    },
};

function expectInvalid(body: unknown, fragment: string): void {
    let caught: unknown;
    try {
        validateDecisionRequest(body);
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(DecisionBackendError);
    const error = caught as DecisionBackendError;
    expect(error.status).toBe(400);
    expect(error.code).toBe('DECISION_INVALID_REQUEST');
    expect((error.details as { errors: string[] }).errors.join('\n')).toContain(fragment);
}

function options(count: number): Record<string, string> {
    return Object.fromEntries(Array.from({ length: count }, (_, i) => [`opt${i}`, `Option ${i}`]));
}

describe('validateDecisionRequest', () => {
    it('accepts each question type and mixed questions, preserving request order', () => {
        const request = validateDecisionRequest(mixedBody);
        expect(request.backend).toBe('copilot');
        expect(request.questions.map(q => [q.id, q.type])).toEqual([['isBug', 'noul'], ['area', 'choice'], ['urgency', 'score']]);
        const choice = request.questions[1];
        expect(choice.type === 'choice' && choice.options).toEqual(['auth', 'ui', 'billing']);
    });

    it('accepts a noul question without criteria and string/array state', () => {
        expect(validateDecisionRequest({ state: 'plain text', questions: { q: { type: 'noul', instructions: 'Yes?' } } }).questions).toHaveLength(1);
        expect(validateDecisionRequest({ state: [1, 2], questions: { q: { type: 'noul', instructions: { text: 'Yes?' } } } }).state).toEqual([1, 2]);
    });

    it('accepts typesafe as a backend', () => {
        expect(validateDecisionRequest({ ...mixedBody, backend: 'typesafe' }).backend).toBe('typesafe');
    });

    it('rejects unknown backends, fields, and question types', () => {
        expectInvalid({ ...mixedBody, backend: 'openai' }, 'backend must be one of');
        expectInvalid({ ...mixedBody, model: 'gpt-4' }, "unknown field 'model'");
        expectInvalid({ state: 's', questions: { q: { type: 'rank', instructions: 'x' } } }, "type must be one of");
    });

    it('rejects missing or null state, and empty questions/instructions', () => {
        expectInvalid({ questions: mixedBody.questions }, 'state must be a string, object, or array');
        expectInvalid({ state: null, questions: mixedBody.questions }, 'got null');
        expectInvalid({ state: 's', questions: {} }, 'questions must not be empty');
        expectInvalid({ state: 's', questions: { q: { type: 'noul', instructions: '   ' } } }, 'instructions must not be empty');
        expectInvalid({ state: 's', questions: { q: { type: 'noul', instructions: {} } } }, 'instructions must not be empty');
    });

    it('rejects non-JSON-serializable state and descriptions', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expectInvalid({ state: cyclic, questions: mixedBody.questions }, 'circular reference');
        expectInvalid({ state: { n: Number.NaN }, questions: mixedBody.questions }, 'finite number');
        expectInvalid({ state: { d: new Date() }, questions: mixedBody.questions }, 'plain JSON object');
        expectInvalid({ state: 's', questions: { q: { type: 'noul', instructions: 'x', criteria: { true: () => 1 } } } }, 'not JSON-serializable');
    });

    it('rejects dangerous keys in question ids, options, and state', () => {
        expectInvalid(JSON.parse('{"state":"s","questions":{"__proto__":{"type":"noul","instructions":"x"}}}'), "'__proto__' is forbidden");
        expectInvalid({ state: 's', questions: { constructor: { type: 'noul', instructions: 'x' } } }, "'constructor' is forbidden");
        expectInvalid({ state: 's', questions: { q: { type: 'choice', instructions: 'x', criteria: { prototype: 'a', b: 'b' } } } }, "'prototype' is forbidden");
        expectInvalid(JSON.parse('{"state":{"nested":{"__proto__":{"admin":true}}},"questions":{"q":{"type":"noul","instructions":"x"}}}'), "forbidden key '__proto__'");
    });

    it('enforces question, option, level, and id limits', () => {
        const tooMany = Object.fromEntries(Array.from({ length: DECISION_LIMITS.maxQuestions + 1 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'x' }]));
        expectInvalid({ state: 's', questions: tooMany }, `must not exceed ${DECISION_LIMITS.maxQuestions}`);
        const atLimit = Object.fromEntries(Array.from({ length: DECISION_LIMITS.maxQuestions }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'x' }]));
        expect(validateDecisionRequest({ state: 's', questions: atLimit }).questions).toHaveLength(DECISION_LIMITS.maxQuestions);

        expectInvalid({ state: 's', questions: { q: { type: 'choice', instructions: 'x', criteria: options(1) } } }, 'must have 2-64 options');
        expectInvalid({ state: 's', questions: { q: { type: 'choice', instructions: 'x', criteria: options(65) } } }, 'must have 2-64 options');
        expect(validateDecisionRequest({ state: 's', questions: { q: { type: 'choice', instructions: 'x', criteria: options(64) } } }).questions).toHaveLength(1);

        expectInvalid({ state: 's', questions: { q: { type: 'score', instructions: 'x', criteria: ['only'] } } }, 'must have 2-10 levels');
        expectInvalid({ state: 's', questions: { q: { type: 'score', instructions: 'x', criteria: Array.from({ length: 11 }, (_, i) => `L${i}`) } } }, 'must have 2-10 levels');
        expectInvalid({ state: 's', questions: { q: { type: 'score', instructions: 'x', criteria: 'low,high' } } }, 'must be an array');

        expectInvalid({ state: 's', questions: { ['x'.repeat(101)]: { type: 'noul', instructions: 'x' } } }, 'exceeds 100 characters');
        expect(validateDecisionRequest({ state: 's', questions: { ['x'.repeat(100)]: { type: 'noul', instructions: 'x' } } }).questions).toHaveLength(1);
    });

    it('rejects unknown noul criteria keys', () => {
        expectInvalid({ state: 's', questions: { q: { type: 'noul', instructions: 'x', criteria: { maybe: 'x' } } } }, "unknown key 'maybe'");
    });
});

describe('parseDecisionOutput', () => {
    const request = validateDecisionRequest(mixedBody);
    const valid = {
        answers: {
            isBug: { type: 'noul', value: 0.8 },
            area: { type: 'choice', probabilities: { auth: 6, ui: 3, billing: 1 } },
            urgency: { type: 'score', probabilities: { 0: 0, 1: 1, 2: 1 } },
        },
    };

    function errorsFor(output: unknown): string {
        const parsed = parseDecisionOutput(typeof output === 'string' ? output : JSON.stringify(output), request);
        expect(parsed.ok).toBe(false);
        return parsed.ok ? '' : parsed.errors.join('\n');
    }

    it('normalizes distributions and derives choice, score, legend, and confidence in code', () => {
        const parsed = parseDecisionOutput(JSON.stringify(valid), request);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const { isBug, area, urgency } = parsed.answers;
        expect(isBug).toEqual({ type: 'noul', value: 0.8, confidence: expect.closeTo(entropyConfidence([0.8, 0.2]), 10) });
        expect(area.type === 'choice' && area.choice).toBe('auth');
        expect(area.type === 'choice' && area.probabilities).toEqual({ auth: 0.6, ui: 0.3, billing: 0.1 });
        expect(urgency.type === 'score' && urgency.probabilities).toEqual({ 0: 0, 1: 0.5, 2: 0.5 });
        expect(urgency.type === 'score' && urgency.score).toBeCloseTo(1.5, 10);
        expect(urgency.type === 'score' && urgency.legend).toEqual({ 0: 'Low', 1: 'Medium', 2: 'High' });
        for (const answer of Object.values(parsed.answers)) {
            expect(answer.confidence).toBeGreaterThanOrEqual(0);
            expect(answer.confidence).toBeLessThanOrEqual(1);
        }
    });

    it('ignores model-supplied score/legend/confidence/choice fields', () => {
        const parsed = parseDecisionOutput(JSON.stringify({
            answers: {
                ...valid.answers,
                area: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { auth: 6, ui: 3, billing: 1 } },
                urgency: { type: 'score', score: 99, legend: 'bogus', confidence: 1, probabilities: { 0: 0, 1: 1, 2: 1 } },
            },
        }), request);
        expect(parsed.ok && parsed.answers.area).toMatchObject({ choice: 'auth' });
        expect(parsed.ok && parsed.answers.urgency).toMatchObject({ score: 1.5, legend: { 0: 'Low', 1: 'Medium', 2: 'High' } });
    });

    it('breaks choice ties by request option order', () => {
        const parsed = parseDecisionOutput(JSON.stringify({ answers: { ...valid.answers, area: { type: 'choice', probabilities: { auth: 1, ui: 2, billing: 2 } } } }), request);
        expect(parsed.ok && parsed.answers.area).toMatchObject({ choice: 'ui' });
    });

    it('computes entropy confidence: one-hot is 1, uniform is 0', () => {
        expect(entropyConfidence([1, 0, 0])).toBe(1);
        expect(entropyConfidence([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0, 10);
        expect(entropyConfidence([0.5, 0.5])).toBeCloseTo(0, 10);
    });

    it('clamps noul values into [0, 1]', () => {
        const high = parseDecisionOutput(JSON.stringify({ answers: { ...valid.answers, isBug: { type: 'noul', value: 1.7 } } }), request);
        const low = parseDecisionOutput(JSON.stringify({ answers: { ...valid.answers, isBug: { type: 'noul', value: -0.2 } } }), request);
        expect(high.ok && high.answers.isBug).toEqual({ type: 'noul', value: 1, confidence: 1 });
        expect(low.ok && low.answers.isBug).toEqual({ type: 'noul', value: 0, confidence: 1 });
        expect(errorsFor({ answers: { ...valid.answers, isBug: { type: 'noul', value: 'yes' } } })).toContain('isBug.value must be a finite number');
    });

    it('requires exactly the submitted question ids', () => {
        const { urgency: _omit, ...missing } = valid.answers;
        expect(errorsFor({ answers: missing })).toContain("missing question id 'urgency'");
        expect(errorsFor({ answers: { ...valid.answers, extra: { type: 'noul', value: 1 } } })).toContain("unexpected question id 'extra'");
        expect(errorsFor({ ...valid, note: 'hi' })).toContain("unexpected top-level field 'note'");
    });

    it('requires the answer type to match its question', () => {
        expect(errorsFor({ answers: { ...valid.answers, isBug: { type: 'choice', probabilities: {} } } })).toContain("isBug.type must be 'noul'");
    });

    it('rejects unknown choice options and missing probability entries', () => {
        expect(errorsFor({ answers: { ...valid.answers, area: { type: 'choice', probabilities: { auth: 1, ui: 1, billing: 1, other: 1 } } } })).toContain("unknown option 'other'");
        expect(errorsFor({ answers: { ...valid.answers, area: { type: 'choice', probabilities: { auth: 1, ui: 1 } } } })).toContain("missing option 'billing'");
        expect(errorsFor({ answers: { ...valid.answers, urgency: { type: 'score', probabilities: { 0: 1, 1: 1 } } } })).toContain("missing option '2'");
    });

    it('rejects zero-sum, negative, and non-numeric distributions', () => {
        expect(errorsFor({ answers: { ...valid.answers, area: { type: 'choice', probabilities: { auth: 0, ui: 0, billing: 0 } } } })).toContain('must not sum to zero');
        expect(errorsFor({ answers: { ...valid.answers, area: { type: 'choice', probabilities: { auth: -1, ui: 2, billing: 1 } } } })).toContain('must not be negative');
        expect(errorsFor({ answers: { ...valid.answers, area: { type: 'choice', probabilities: { auth: '0.5', ui: 2, billing: 1 } } } })).toContain('must be a finite number');
    });

    it('rejects non-JSON output and tolerates a single surrounding code fence', () => {
        expect(errorsFor('Sure! Here are the answers.')).toContain('not valid JSON');
        expect(errorsFor('[]')).toContain("'answers' object");
        expect(parseDecisionOutput('```json\n' + JSON.stringify(valid) + '\n```', request).ok).toBe(true);
    });
});
