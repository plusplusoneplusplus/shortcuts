/**
 * Unit tests for parseFinalCheckResult (AC-02).
 */

import { describe, it, expect } from 'vitest';
import { parseFinalCheckResult, type FinalCheckResult } from '../../../src/server/ralph/final-check-result-parser';

const MARKER = 'RALPH_FINAL_CHECK_RESULT';

function makeCleanJson(): string {
    return JSON.stringify({
        marker: MARKER,
        hasGaps: false,
        summary: 'All acceptance criteria are satisfied.',
        gaps: [],
    }, null, 2);
}

function makeGapsJson(gapFixGoal?: string): string {
    const obj: Record<string, unknown> = {
        marker: MARKER,
        hasGaps: true,
        summary: 'Two gaps found.',
        gaps: [
            {
                id: 'GAP-01',
                title: 'Missing test coverage',
                evidence: 'progress.md does not record test output.',
                recommendedAction: 'Run npm test and record output.',
                validation: 'npm run test',
            },
            {
                id: 'GAP-02',
                title: 'Build failure',
                evidence: 'npm run build exits with errors.',
                recommendedAction: 'Fix compilation errors.',
            },
        ],
    };
    if (gapFixGoal !== undefined) {
        obj['gapFixGoal'] = gapFixGoal;
    }
    return JSON.stringify(obj, null, 2);
}

function wrap(json: string): string {
    return `Some AI text.\n\n${MARKER}\n\`\`\`json\n${json}\n\`\`\`\n`;
}

function wrapBare(json: string): string {
    return `Some AI text.\n\n${MARKER}\n${json}\n`;
}

// ============================================================================
// Clean result
// ============================================================================

describe('parseFinalCheckResult — clean', () => {
    it('parses a clean fenced result', () => {
        const res = parseFinalCheckResult(wrap(makeCleanJson()));
        expect(res.status).toBe('clean');
        expect(res.hasGaps).toBe(false);
        expect(res.gaps).toEqual([]);
        expect(res.summary).toBe('All acceptance criteria are satisfied.');
        expect(res.gapFixGoal).toBeUndefined();
    });

    it('parses a clean bare JSON result', () => {
        const res = parseFinalCheckResult(wrapBare(makeCleanJson()));
        expect(res.status).toBe('clean');
        expect(res.hasGaps).toBe(false);
    });

    it('normalises CRLF line endings', () => {
        const text = wrap(makeCleanJson()).replace(/\n/g, '\r\n');
        expect(parseFinalCheckResult(text).status).toBe('clean');
    });
});

// ============================================================================
// Gaps result
// ============================================================================

describe('parseFinalCheckResult — gaps', () => {
    it('parses a gaps result with explicit gapFixGoal', () => {
        const res = parseFinalCheckResult(wrap(makeGapsJson('Fix the listed gaps.')));
        expect(res.status).toBe('gaps');
        expect(res.hasGaps).toBe(true);
        expect(res.gaps).toHaveLength(2);
        expect(res.gaps[0].id).toBe('GAP-01');
        expect(res.gaps[0].title).toBe('Missing test coverage');
        expect(res.gaps[0].validation).toBe('npm run test');
        expect(res.gaps[1].validation).toBeUndefined();
        expect(res.gapFixGoal).toBe('Fix the listed gaps.');
        expect(res.goalSynthesized).toBeUndefined();
    });

    it('synthesizes gapFixGoal when absent', () => {
        const res = parseFinalCheckResult(wrap(makeGapsJson()));
        expect(res.status).toBe('gaps');
        expect(res.hasGaps).toBe(true);
        expect(res.goalSynthesized).toBe(true);
        expect(typeof res.gapFixGoal).toBe('string');
        expect(res.gapFixGoal!.length).toBeGreaterThan(0);
        expect(res.gapFixGoal).toContain('Missing test coverage');
        expect(res.gapFixGoal).toContain('Build failure');
    });

    it('synthesizes gapFixGoal when empty string', () => {
        const res = parseFinalCheckResult(wrap(makeGapsJson('')));
        expect(res.goalSynthesized).toBe(true);
        expect(res.gapFixGoal).toBeTruthy();
    });
});

// ============================================================================
// Malformed / unparseable
// ============================================================================

describe('parseFinalCheckResult — unparseable', () => {
    it('returns unparseable when marker is absent', () => {
        const res = parseFinalCheckResult('No marker here.');
        expect(res.status).toBe('unparseable');
        expect(res.error).toContain('RALPH_FINAL_CHECK_RESULT marker');
    });

    it('returns unparseable when JSON is malformed', () => {
        const res = parseFinalCheckResult(`${MARKER}\n\`\`\`json\n{ bad json }\n\`\`\``);
        expect(res.status).toBe('unparseable');
        expect(res.error).toMatch(/[Mm]alformed JSON|JSON/);
    });

    it('returns unparseable when no JSON block follows marker', () => {
        const res = parseFinalCheckResult(`${MARKER}\nJust some text, no JSON.`);
        expect(res.status).toBe('unparseable');
    });

    it('returns unparseable when marker field does not match', () => {
        const json = JSON.stringify({ marker: 'WRONG', hasGaps: false, summary: '', gaps: [] });
        const res = parseFinalCheckResult(`${MARKER}\n\`\`\`json\n${json}\n\`\`\``);
        expect(res.status).toBe('unparseable');
        expect(res.error).toContain('marker');
    });

    it('returns unparseable when hasGaps is not boolean', () => {
        const json = JSON.stringify({ marker: MARKER, hasGaps: 'yes', summary: '', gaps: [] });
        const res = parseFinalCheckResult(`${MARKER}\n\`\`\`json\n${json}\n\`\`\``);
        expect(res.status).toBe('unparseable');
    });

    it('returns unparseable for array root', () => {
        const res = parseFinalCheckResult(`${MARKER}\n\`\`\`json\n[]\n\`\`\``);
        expect(res.status).toBe('unparseable');
    });
});

// ============================================================================
// Contradictory fields
// ============================================================================

describe('parseFinalCheckResult — invalid (contradictory)', () => {
    it('flags hasGaps:false with non-empty gaps array', () => {
        const json = JSON.stringify({
            marker: MARKER,
            hasGaps: false,
            summary: 'All good.',
            gaps: [{ id: 'GAP-01', title: 'Oops', evidence: 'e', recommendedAction: 'a' }],
        });
        const res = parseFinalCheckResult(`${MARKER}\n\`\`\`json\n${json}\n\`\`\``);
        expect(res.status).toBe('invalid');
        expect(res.error).toContain('non-empty');
    });

    it('flags hasGaps:true with empty gaps array', () => {
        const json = JSON.stringify({
            marker: MARKER,
            hasGaps: true,
            summary: 'There are gaps.',
            gaps: [],
            gapFixGoal: 'Fix them.',
        });
        const res = parseFinalCheckResult(`${MARKER}\n\`\`\`json\n${json}\n\`\`\``);
        expect(res.status).toBe('invalid');
        expect(res.error).toContain('empty');
    });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('parseFinalCheckResult — edge cases', () => {
    it('handles gaps with missing optional fields gracefully', () => {
        const json = JSON.stringify({
            marker: MARKER,
            hasGaps: true,
            summary: 'Gap found.',
            gaps: [{}],
            gapFixGoal: 'Fix it.',
        });
        const res = parseFinalCheckResult(`${MARKER}\n\`\`\`json\n${json}\n\`\`\``);
        expect(res.status).toBe('gaps');
        expect(res.gaps[0].id).toBe('GAP-?');
        expect(res.gaps[0].title).toBe('(untitled)');
    });

    it('uses content after the first RALPH_FINAL_CHECK_RESULT occurrence', () => {
        const json = makeCleanJson();
        const response = `Preamble text\n${MARKER}\n\`\`\`json\n${json}\n\`\`\`\nMore text`;
        const res = parseFinalCheckResult(response);
        expect(res.status).toBe('clean');
    });

    it('handles extra fields in JSON without error', () => {
        const json = JSON.stringify({
            marker: MARKER,
            hasGaps: false,
            summary: 'Clean.',
            gaps: [],
            extraField: 'ignored',
        });
        const res = parseFinalCheckResult(`${MARKER}\n\`\`\`json\n${json}\n\`\`\``);
        expect(res.status).toBe('clean');
    });
});
