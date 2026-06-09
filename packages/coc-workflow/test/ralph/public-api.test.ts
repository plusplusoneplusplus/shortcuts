import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    appendProgress,
    buildFinalCheckPrompt,
    buildRalphIterationPrompt,
    classifyRalphProgressStagnation,
    decideRalphIterationActions,
    decideRalphFinalCheckActions,
    formatFinalCheckProgressSection,
    formatProgressSection,
    parseFinalCheckResult,
    parseProgressSections,
    parseRalphSignal,
    type FinalCheckResult,
    type RalphSessionRecord,
} from '../../src/ralph';

const FINAL_CHECK_MARKER = 'RALPH_FINAL_CHECK_RESULT';

function wrapFinalCheck(json: string): string {
    return `${FINAL_CHECK_MARKER}\n\`\`\`json\n${json}\n\`\`\``;
}

describe('Ralph public module boundary', () => {
    it('exports portable Ralph helpers from a sibling module', () => {
        expect(typeof parseRalphSignal).toBe('function');
        expect(typeof appendProgress).toBe('function');
        expect(typeof parseProgressSections).toBe('function');
        expect(typeof formatProgressSection).toBe('function');
        expect(typeof buildRalphIterationPrompt).toBe('function');
        expect(typeof classifyRalphProgressStagnation).toBe('function');
        expect(typeof buildFinalCheckPrompt).toBe('function');
        expect(typeof parseFinalCheckResult).toBe('function');
        expect(typeof decideRalphIterationActions).toBe('function');
        expect(typeof decideRalphFinalCheckActions).toBe('function');
        expect(typeof formatFinalCheckProgressSection).toBe('function');
    });

    it('declares the ./ralph JavaScript and declaration subpath', () => {
        const packageJsonPath = path.resolve(__dirname, '../../package.json');
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
            exports?: Record<string, string>;
            typesVersions?: Record<string, Record<string, string[]>>;
            dependencies?: Record<string, string>;
        };

        expect(pkg.exports?.['./ralph']).toBe('./dist/ralph/index.js');
        expect(pkg.typesVersions?.['*']?.ralph).toEqual(['dist/ralph/index.d.ts']);
        expect(pkg.dependencies).not.toHaveProperty('@plusplusoneplusplus/forge');
        expect(pkg.dependencies).not.toHaveProperty('@plusplusoneplusplus/coc');
    });
});

describe('parseRalphSignal', () => {
    it('detects RALPH_NEXT and extracts progress', () => {
        const result = parseRalphSignal('Done.\n\nRALPH_PROGRESS:\nCreated parser tests\n\nRALPH_NEXT');

        expect(result).toEqual({
            signal: 'RALPH_NEXT',
            progress: 'Created parser tests',
        });
    });

    it('gives RALPH_COMPLETE precedence when both signals appear', () => {
        expect(parseRalphSignal('RALPH_NEXT\nRALPH_COMPLETE').signal).toBe('RALPH_COMPLETE');
    });

    it('normalizes CRLF line endings and avoids partial signal matches', () => {
        expect(parseRalphSignal('Work\r\nRALPH_PROGRESS:\r\nLine\r\nRALPH_NEXT').progress).toBe('Line');
        expect(parseRalphSignal('RALPH_NEXTEND').signal).toBe('NONE');
    });
});

describe('appendProgress', () => {
    it('accumulates non-empty progress with a blank-line separator', () => {
        expect(appendProgress('Iteration 1', 'Iteration 2')).toBe('Iteration 1\n\nIteration 2');
        expect(appendProgress(undefined, 'Iteration 1')).toBe('Iteration 1');
        expect(appendProgress('Iteration 1', '')).toBe('Iteration 1');
    });
});

describe('Ralph progress sections', () => {
    it('formats canonical iteration blocks and parses them back', () => {
        const block = formatProgressSection({
            iteration: 2,
            signal: 'RALPH_NEXT',
            timestamp: '2026-06-03T00:00:00.000Z',
            body: 'Files: a.ts\nRemaining: tests',
        });

        expect(block).toBe('## Iteration 2 — RALPH_NEXT — 2026-06-03T00:00:00.000Z\nFiles: a.ts\nRemaining: tests\n');
        expect(parseProgressSections(`# Header\n${block}`)).toEqual([
            {
                iteration: 2,
                signal: 'RALPH_NEXT',
                timestamp: '2026-06-03T00:00:00.000Z',
                body: 'Files: a.ts\nRemaining: tests',
            },
        ]);
    });

    it('parses legacy ASCII hyphen headings and CRLF journals', () => {
        const journal = [
            '# Header',
            '## Iteration 1 - RALPH_COMPLETE - 2026-06-03T00:00:00.000Z',
            'Done',
        ].join('\r\n');

        expect(parseProgressSections(journal)).toEqual([
            {
                iteration: 1,
                signal: 'RALPH_COMPLETE',
                timestamp: '2026-06-03T00:00:00.000Z',
                body: 'Done',
            },
        ]);
    });
});

describe('buildRalphIterationPrompt', () => {
    it('keeps the skill pointer first and the goal block last', () => {
        const prompt = buildRalphIterationPrompt({
            originalGoal: 'Implement the feature.',
            progressPath: '/tmp/session/progress.md',
            currentIteration: 3,
            maxIterations: 20,
        });

        expect(prompt).toMatch(/^Load and follow the `ultra-ralph` skill/);
        expect(prompt).toContain('Progress journal: /tmp/session/progress.md');
        expect(prompt).toContain('Iteration 3 of 20.');
        expect(prompt.endsWith('<goal>\nImplement the feature.\n</goal>')).toBe(true);
        expect(prompt).not.toContain('<work_intent>');
        expect(prompt).not.toContain('<spec_contract>');
    });
});

describe('buildFinalCheckPrompt', () => {
    it('builds the read-only final-check prompt without inlining journal content', () => {
        const prompt = buildFinalCheckPrompt({
            originalGoal: 'Ship Ralph.',
            progressPath: '/tmp/session/progress.md',
            sessionId: 'ralph-1',
            workspaceId: 'ws-1',
            loopIndex: 1,
            sourceIteration: 4,
        });

        expect(prompt).toContain('Load and follow the `ultra-ralph` skill, `final-check` section.');
        expect(prompt).toContain('Session ID: ralph-1');
        expect(prompt).toContain('Workspace ID: ws-1');
        expect(prompt).toContain('Loop just completed: 1 (last iteration: 4)');
        expect(prompt).toContain('Read the Ralph progress journal from: /tmp/session/progress.md');
        expect(prompt).toContain('manual-verification-only');
        expect(prompt).toContain(FINAL_CHECK_MARKER);
    });
});

describe('parseFinalCheckResult', () => {
    it('parses a clean final-check result', () => {
        const result = parseFinalCheckResult(wrapFinalCheck(JSON.stringify({
            marker: FINAL_CHECK_MARKER,
            hasGaps: false,
            summary: 'All ACs pass.',
            gaps: [],
        })));

        expect(result).toEqual({
            status: 'clean',
            hasGaps: false,
            summary: 'All ACs pass.',
            gaps: [],
        } satisfies FinalCheckResult);
    });

    it('synthesizes a gap-fix goal when gaps omit one', () => {
        const result = parseFinalCheckResult(wrapFinalCheck(JSON.stringify({
            marker: FINAL_CHECK_MARKER,
            hasGaps: true,
            summary: 'A test gap remains.',
            gaps: [{ id: 'GAP-01', title: 'Missing tests', evidence: 'No parser tests.', recommendedAction: 'Add tests.' }],
        })));

        expect(result.status).toBe('gaps');
        expect(result.goalSynthesized).toBe(true);
        expect(result.gapFixGoal).toContain('Missing tests');
    });

    it('classifies unparseable and contradictory outputs', () => {
        expect(parseFinalCheckResult('No marker').status).toBe('unparseable');

        const contradictory = parseFinalCheckResult(wrapFinalCheck(JSON.stringify({
            marker: FINAL_CHECK_MARKER,
            hasGaps: false,
            summary: 'Clean.',
            gaps: [{ id: 'GAP-01', title: 'But gap', evidence: '', recommendedAction: '' }],
        })));

        expect(contradictory.status).toBe('invalid');
        expect(contradictory.error).toContain('non-empty');
    });
});

describe('Ralph types', () => {
    it('supports TypeScript consumers using exported record contracts', () => {
        const record: RalphSessionRecord = {
            sessionId: 'ralph-1',
            workspaceId: 'ws-1',
            originalGoal: 'Goal',
            maxIterations: 20,
            currentIteration: 0,
            phase: 'executing',
            startedAt: '2026-06-03T00:00:00.000Z',
            iterations: [],
        };

        expect(record.phase).toBe('executing');
    });
});
