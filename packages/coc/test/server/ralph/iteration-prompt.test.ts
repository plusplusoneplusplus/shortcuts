/**
 * Unit tests for `buildRalphIterationPrompt`.
 */
import { describe, it, expect } from 'vitest';
import {
    buildRalphIterationPrompt,
} from '../../../src/server/ralph/iteration-prompt';

describe('buildRalphIterationPrompt', () => {
    it('starts with the ultra-ralph skill pointer', () => {
        const prompt = buildRalphIterationPrompt({ originalGoal: 'do x' });
        expect(prompt).toMatch(/^Load and follow the `ultra-ralph` skill/);
        expect(prompt).toContain('execution');
        expect(prompt).toContain('~/.coc/skills/ultra-ralph/SKILL.md');
    });

    it('embeds the goal inside a <goal> block at the end', () => {
        const goal = 'Implement diff providers in forge/src/diff and add tests.';
        const prompt = buildRalphIterationPrompt({ originalGoal: goal });
        expect(prompt).toContain('<goal>');
        expect(prompt).toContain(goal);
        expect(prompt).toContain('</goal>');
        // goal block must be last
        const goalIdx = prompt.lastIndexOf('<goal>');
        const endIdx = prompt.lastIndexOf('</goal>');
        expect(goalIdx).toBeGreaterThan(-1);
        expect(endIdx).toBeGreaterThan(goalIdx);
        expect(endIdx + '</goal>'.length).toBe(prompt.length);
    });

    it('includes progress path and iteration counter when both are provided', () => {
        const prompt = buildRalphIterationPrompt({
            originalGoal: 'Build a feature',
            progressPath: '/tmp/ralph-sessions/sess-1/progress.md',
            currentIteration: 3,
            maxIterations: 10,
        });
        expect(prompt).toContain('/tmp/ralph-sessions/sess-1/progress.md');
        expect(prompt).toContain('Iteration 3 of 10.');
        expect(prompt).toContain('Progress journal:');
    });

    it('includes context map path with read-first and rewrite instructions when provided', () => {
        const prompt = buildRalphIterationPrompt({
            originalGoal: 'Build a feature',
            progressPath: '/tmp/ralph-sessions/sess-1/progress.md',
            contextPath: '/tmp/ralph-sessions/sess-1/context.md',
            currentIteration: 3,
            maxIterations: 10,
        });

        expect(prompt).toContain('Progress journal: /tmp/ralph-sessions/sess-1/progress.md');
        expect(prompt).toContain('Context map: /tmp/ralph-sessions/sess-1/context.md');
        expect(prompt).toContain('read this first');
        expect(prompt).toContain('rewrite it at the end');
        expect(prompt.indexOf('Context map:')).toBeLessThan(prompt.indexOf('<goal>'));
    });

    it('keeps the progress/iteration block unchanged when context path is omitted', () => {
        const prompt = buildRalphIterationPrompt({
            originalGoal: 'goal text',
            progressPath: '/p/progress.md',
            currentIteration: 2,
            maxIterations: 5,
        });

        expect(prompt).toBe([
            'Load and follow the `ultra-ralph` skill, `execution` section. The skill file is at ~/.coc/skills/ultra-ralph/SKILL.md.',
            'Progress journal: /p/progress.md\nIteration 2 of 5.',
            '<goal>\ngoal text\n</goal>',
        ].join('\n\n'));
    });

    it('includes progress path and iteration counter before the <goal> block', () => {
        const prompt = buildRalphIterationPrompt({
            originalGoal: 'goal text',
            progressPath: '/p/progress.md',
            currentIteration: 2,
            maxIterations: 5,
        });
        const pathIdx = prompt.indexOf('/p/progress.md');
        const goalIdx = prompt.indexOf('<goal>');
        expect(pathIdx).toBeGreaterThan(-1);
        expect(pathIdx).toBeLessThan(goalIdx);
    });

    it('uses default iteration 1 of 20 when neither currentIteration nor maxIterations is supplied', () => {
        const prompt = buildRalphIterationPrompt({
            originalGoal: 'do x',
            progressPath: '/p/progress.md',
        });
        expect(prompt).toContain('Iteration 1 of 20.');
    });

    it('omits the progress/iteration line when no progressPath and no counter are given', () => {
        const prompt = buildRalphIterationPrompt({ originalGoal: 'do x' });
        expect(prompt).not.toContain('Progress journal:');
        expect(prompt).not.toContain('Iteration');
    });

    it('includes iteration counter without progress path when counter-only fields supplied', () => {
        const prompt = buildRalphIterationPrompt({
            originalGoal: 'do x',
            currentIteration: 4,
            maxIterations: 8,
        });
        expect(prompt).toContain('Iteration 4 of 8.');
        expect(prompt).not.toContain('Progress journal:');
    });

    it('omits the <goal> block when goal is empty or whitespace', () => {
        for (const goal of ['', '   ', '\n\t', undefined]) {
            const prompt = buildRalphIterationPrompt({ originalGoal: goal });
            expect(prompt).not.toContain('<goal>');
            expect(prompt).toMatch(/^Load and follow the `ultra-ralph` skill/);
        }
    });

    it('includes very large goals in full without truncation', () => {
        const goal = 'x'.repeat(50_000);
        const prompt = buildRalphIterationPrompt({ originalGoal: goal });
        expect(prompt).not.toContain('[truncated]');
        expect(prompt).toContain(goal);
    });

    it('preserves non-ASCII characters in the goal', () => {
        const goal = 'Implementér diff–providers (日本語)';
        const prompt = buildRalphIterationPrompt({ originalGoal: goal });
        expect(prompt).toContain(goal);
    });

    it('does not contain old WORK_INTENT or SPEC_CONTRACT scaffolding', () => {
        const prompt = buildRalphIterationPrompt({ originalGoal: 'some goal' });
        expect(prompt).not.toContain('<work_intent>');
        expect(prompt).not.toContain('<spec_contract>');
        expect(prompt).not.toContain('RALPH_NEXT');
        expect(prompt).not.toContain('RALPH_COMPLETE');
        expect(prompt).not.toContain('## Iteration <N>');
    });

    it('returns empty input as just the skill pointer line', () => {
        const prompt = buildRalphIterationPrompt({});
        expect(prompt).toMatch(/^Load and follow the `ultra-ralph` skill/);
        expect(prompt).not.toContain('<goal>');
    });
});
