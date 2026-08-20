import { describe, expect, it } from 'vitest';
import { parseRalphSubmitResult } from '../../src/ralph';

function wrapSubmit(json: string): string {
    return `All done.\n\nRALPH_SUBMIT_RESULT\n\`\`\`json\n${json}\n\`\`\``;
}

describe('parseRalphSubmitResult', () => {
    it('parses a valid submitted result with PR metadata', () => {
        const result = parseRalphSubmitResult(wrapSubmit(JSON.stringify({
            status: 'submitted',
            prUrl: 'https://github.com/acme/repo/pull/42',
            prNumber: 42,
            commitShas: ['aaa111', 'bbb222'],
        })));

        expect(result).toEqual({
            status: 'submitted',
            prUrl: 'https://github.com/acme/repo/pull/42',
            prNumber: 42,
            commitShas: ['aaa111', 'bbb222'],
        });
    });

    it('parses a valid failed result with an error reason', () => {
        const result = parseRalphSubmitResult(wrapSubmit(JSON.stringify({
            status: 'failed',
            error: 'cherry-pick conflict on aaa111; submit aborted',
        })));

        expect(result).toEqual({
            status: 'failed',
            error: 'cherry-pick conflict on aaa111; submit aborted',
        });
    });

    it('parses a bare (unfenced) JSON block after the marker', () => {
        const result = parseRalphSubmitResult(
            `RALPH_SUBMIT_RESULT\n{ "status": "submitted", "prUrl": "https://github.com/acme/repo/pull/7" }`,
        );

        expect(result.status).toBe('submitted');
        expect(result.prUrl).toBe('https://github.com/acme/repo/pull/7');
    });

    it('tolerates CRLF line endings', () => {
        const result = parseRalphSubmitResult(
            `RALPH_SUBMIT_RESULT\r\n\`\`\`json\r\n{ "status": "failed", "error": "dirty worktree" }\r\n\`\`\`\r\n`,
        );

        expect(result).toEqual({ status: 'failed', error: 'dirty worktree' });
    });

    it('returns unparseable when the marker is missing', () => {
        const result = parseRalphSubmitResult('I created the PR but forgot the result block.');

        expect(result.status).toBe('unparseable');
        expect(result.error).toContain('RALPH_SUBMIT_RESULT marker');
    });

    it('returns unparseable when no JSON follows the marker', () => {
        const result = parseRalphSubmitResult('RALPH_SUBMIT_RESULT\nnothing here');

        expect(result.status).toBe('unparseable');
        expect(result.error).toContain('No JSON block');
    });

    it('returns unparseable on malformed JSON', () => {
        const result = parseRalphSubmitResult('RALPH_SUBMIT_RESULT\n```json\n{ "status": "submitted", \n```');

        expect(result.status).toBe('unparseable');
        expect(result.error).toContain('Malformed JSON');
    });

    it('returns unparseable when status is not submitted/failed', () => {
        const result = parseRalphSubmitResult(wrapSubmit(JSON.stringify({ status: 'done' })));

        expect(result.status).toBe('unparseable');
        expect(result.error).toContain('"status" field');
    });

    it('drops non-string commitShas entries and empty optional fields', () => {
        const result = parseRalphSubmitResult(wrapSubmit(JSON.stringify({
            status: 'submitted',
            prUrl: '  ',
            prNumber: 'forty-two',
            commitShas: ['aaa111', 7, '', null, 'bbb222'],
        })));

        expect(result).toEqual({
            status: 'submitted',
            commitShas: ['aaa111', 'bbb222'],
        });
    });
});
