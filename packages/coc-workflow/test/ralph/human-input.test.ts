import { describe, expect, it } from 'vitest';
import {
    buildRalphIterationPrompt,
    formatHumanAnswersBlock,
    formatHumanInputSection,
    parseProgressSections,
} from '../../src/ralph';
import type { RalphHumanInput } from '../../src/ralph';

const input: RalphHumanInput = {
    iteration: 3,
    answeredAt: '2026-09-29T10:00:00.000Z',
    answers: [
        { question: 'Which database?', answer: 'sqlite' },
        { question: 'Which platforms?', answer: ['linux', 'macos'] },
    ],
    note: '  keep it small  ',
};

describe('formatHumanInputSection', () => {
    it('writes a Human input header with context, answers, and note', () => {
        const section = formatHumanInputSection(input, { context: 'Spec conflicts with repo.', questions: [] });
        expect(section).toBe([
            '## Human input — 2026-09-29T10:00:00.000Z',
            'Asked by: iteration 3',
            'Context: Spec conflicts with repo.',
            '1. Q: Which database?',
            '   A: sqlite',
            '2. Q: Which platforms?',
            '   A: linux, macos',
            'Note: keep it small',
            '',
        ].join('\n'));
    });

    it('omits context and note when absent', () => {
        const section = formatHumanInputSection({ ...input, note: '   ', answers: [{ question: 'Q', answer: [] }] });
        expect(section).not.toContain('Context:');
        expect(section).not.toContain('Note:');
        expect(section).toContain('   A: (none)');
    });

    it('is not parsed as an iteration section', () => {
        const journal = `## Iteration 3 — RALPH_NEEDS_INPUT — 2026-09-29T09:00:00Z\nFiles: a\n\n${formatHumanInputSection(input)}`;
        const sections = parseProgressSections(journal);
        expect(sections).toHaveLength(1);
        expect(sections[0].signal).toBe('RALPH_NEEDS_INPUT');
    });
});

describe('human answers in the iteration prompt', () => {
    it('formats a human_answers block', () => {
        const block = formatHumanAnswersBlock(input);
        expect(block.startsWith('<human_answers>\nHuman answers to the questions raised in iteration 3')).toBe(true);
        expect(block).toContain('2. Q: Which platforms?\n   A: linux, macos');
        expect(block.endsWith('Note: keep it small\n</human_answers>')).toBe(true);
    });

    it('puts the block before the goal when humanInput is given', () => {
        const prompt = buildRalphIterationPrompt({
            originalGoal: 'Do the thing',
            progressPath: '/tmp/progress.md',
            currentIteration: 4,
            maxIterations: 10,
            humanInput: input,
        });
        const answersAt = prompt.indexOf('<human_answers>');
        expect(answersAt).toBeGreaterThan(prompt.indexOf('Iteration 4 of 10.'));
        expect(answersAt).toBeLessThan(prompt.indexOf('<goal>'));
    });

    it('leaves the prompt unchanged without humanInput', () => {
        const prompt = buildRalphIterationPrompt({ originalGoal: 'Do the thing' });
        expect(prompt).not.toContain('human_answers');
    });
});
