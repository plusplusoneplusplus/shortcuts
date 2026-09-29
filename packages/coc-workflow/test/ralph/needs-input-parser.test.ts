import { describe, expect, it } from 'vitest';
import {
    parseRalphNeedsInput,
    RALPH_NEEDS_INPUT_MAX_BLOCK_CHARS,
    RALPH_NEEDS_INPUT_MAX_QUESTIONS,
} from '../../src/ralph';

const validQuestion = {
    question: 'Which storage backend should the cache use?',
    type: 'select',
    options: [
        { value: 'sqlite', label: 'SQLite' },
        { value: 'fs', label: 'Files', description: 'One JSON file per entry' },
    ],
    defaultValue: 'sqlite',
    recommendation: 'sqlite',
};

function block(payload: unknown): string {
    return `I hit a blocker.\n\nRALPH_NEEDS_INPUT\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
}

describe('parseRalphNeedsInput', () => {
    it('returns absent when the token is missing', () => {
        expect(parseRalphNeedsInput('Done.\nRALPH_NEXT')).toEqual({ status: 'absent' });
    });

    it('ignores the token inside a longer identifier', () => {
        expect(parseRalphNeedsInput('RALPH_NEEDS_INPUTS {"context":"x"}').status).toBe('absent');
    });

    it('parses a valid fenced block', () => {
        const result = parseRalphNeedsInput(block({
            context: 'The [decision] item conflicts with the repo.',
            questions: [validQuestion, { question: 'Proceed?', type: 'yes-no', recommendation: 'yes' }],
        }));
        expect(result).toEqual({
            status: 'ok',
            request: {
                context: 'The [decision] item conflicts with the repo.',
                questions: [validQuestion, { question: 'Proceed?', type: 'yes-no', recommendation: 'yes' }],
            },
        });
    });

    it('parses a bare JSON block and CRLF line endings', () => {
        const response = 'RALPH_NEEDS_INPUT\r\n{"context":"ctx","questions":[{"question":"Name?","type":"text","recommendation":"foo"}]}\r\n';
        const result = parseRalphNeedsInput(response);
        expect(result.status).toBe('ok');
    });

    it('accepts multi-select recommendations as arrays', () => {
        const result = parseRalphNeedsInput(block({
            context: 'ctx',
            questions: [{ ...validQuestion, type: 'multi-select', defaultValue: ['fs'], recommendation: ['sqlite', 'fs'] }],
        }));
        expect(result.status).toBe('ok');
    });

    it('drops unknown fields', () => {
        const result = parseRalphNeedsInput(block({
            context: 'ctx',
            extra: true,
            questions: [{ question: 'Q?', type: 'confirm', recommendation: 'yes', junk: 1 }],
        }));
        expect(result).toEqual({
            status: 'ok',
            request: { context: 'ctx', questions: [{ question: 'Q?', type: 'confirm', recommendation: 'yes' }] },
        });
    });

    it.each([
        ['no block', 'RALPH_NEEDS_INPUT\nplease help', /No JSON block/],
        ['malformed JSON', 'RALPH_NEEDS_INPUT\n```json\n{"context": \n```', /Malformed JSON/],
        ['array root', 'RALPH_NEEDS_INPUT\n```json\n[1]\n```', /root must be an object/],
    ])('rejects %s', (_label, response, error) => {
        const result = parseRalphNeedsInput(response);
        expect(result.status).toBe('invalid');
        expect(result.status === 'invalid' && result.error).toMatch(error);
    });

    it.each([
        ['missing context', { questions: [validQuestion] }, /context/],
        ['blank context', { context: '  ', questions: [validQuestion] }, /context/],
        ['empty questions', { context: 'c', questions: [] }, /questions/],
        ['bad type', { context: 'c', questions: [{ ...validQuestion, type: 'radio' }] }, /questions\[0\].*type/],
        ['missing question text', { context: 'c', questions: [{ ...validQuestion, question: '' }] }, /question/],
        ['select without options', { context: 'c', questions: [{ question: 'Q', type: 'select', recommendation: 'a' }] }, /option/],
        ['bad option', { context: 'c', questions: [{ ...validQuestion, options: [{ value: 'a' }] }] }, /option/],
        ['missing recommendation', { context: 'c', questions: [{ question: 'Q', type: 'text' }] }, /recommendation/],
        ['empty recommendation array', { context: 'c', questions: [{ question: 'Q', type: 'text', recommendation: [] }] }, /recommendation/],
        ['bad defaultValue', { context: 'c', questions: [{ ...validQuestion, defaultValue: 3 }] }, /defaultValue/],
    ])('rejects %s', (_label, payload, error) => {
        const result = parseRalphNeedsInput(block(payload));
        expect(result.status).toBe('invalid');
        expect(result.status === 'invalid' && result.error).toMatch(error);
    });

    it('rejects more than the maximum number of questions', () => {
        const questions = Array.from({ length: RALPH_NEEDS_INPUT_MAX_QUESTIONS + 1 }, () => validQuestion);
        const result = parseRalphNeedsInput(block({ context: 'c', questions }));
        expect(result).toMatchObject({ status: 'invalid', error: expect.stringMatching(/At most/) });
    });

    it('rejects an oversized block', () => {
        const context = 'x'.repeat(RALPH_NEEDS_INPUT_MAX_BLOCK_CHARS);
        const result = parseRalphNeedsInput(block({ context, questions: [validQuestion] }));
        expect(result).toMatchObject({ status: 'invalid', error: expect.stringMatching(/exceeds/) });
    });

    it('rejects more than one question batch', () => {
        const payload = { context: 'c', questions: [validQuestion] };
        const result = parseRalphNeedsInput(`${block(payload)}\nAnd also:\n${block(payload)}`);
        expect(result).toMatchObject({ status: 'invalid', error: expect.stringMatching(/one question batch/) });
    });

    it.each(['bare', 'mixed'])('rejects a second %s question batch', (format) => {
        const payload = JSON.stringify({ context: 'c', questions: [validQuestion] });
        const response = format === 'bare'
            ? `RALPH_NEEDS_INPUT\n${payload}\n${payload}`
            : `${block(JSON.parse(payload))}\n${payload}`;
        expect(parseRalphNeedsInput(response)).toMatchObject({
            status: 'invalid',
            error: expect.stringMatching(/one question batch/),
        });
    });

    it('does not count unrelated fenced JSON as a second batch', () => {
        const payload = { context: 'c', questions: [validQuestion] };
        const result = parseRalphNeedsInput(`${block(payload)}\n\`\`\`json\n{"note":1}\n\`\`\`\n`);
        expect(result.status).toBe('ok');
    });
});
