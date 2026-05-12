/**
 * Unit tests for `buildRalphIterationPrompt`.
 */
import { describe, it, expect } from 'vitest';
import {
    buildRalphIterationPrompt,
    RALPH_GOAL_PROMPT_MAX_LENGTH,
} from '../../../src/server/ralph/iteration-prompt';

// The Copilot host CLI's embedding retriever explicitly skips messages
// beginning with these tags when looking for the most recent user query.
// Source: node_modules/@github/copilot/app.js (DAs constant).
const RETRIEVER_SKIP_PREFIXES = [
    '<available_skills>',
    '<additional_tool_instructions>',
    '<skill-context',
];

describe('buildRalphIterationPrompt', () => {
    it('embeds the goal verbatim inside a <goal> block', () => {
        const goal = 'Implement diff providers in forge/src/diff and add tests.';
        const prompt = buildRalphIterationPrompt({ originalGoal: goal });
        expect(prompt).toContain('<goal>');
        expect(prompt).toContain(goal);
        expect(prompt).toContain('</goal>');
    });

    it('includes the iteration directive prefix so the model knows to act', () => {
        const prompt = buildRalphIterationPrompt({ originalGoal: 'do x' });
        expect(prompt).toMatch(/Continue the Ralph execution loop/);
        expect(prompt).toMatch(/progress journal/);
        expect(prompt).toMatch(/commit/);
    });

    it('returns the bare prefix when the goal is empty or whitespace', () => {
        for (const goal of ['', '   ', '\n\t', undefined]) {
            const prompt = buildRalphIterationPrompt({ originalGoal: goal });
            expect(prompt).not.toContain('<goal>');
            expect(prompt).toMatch(/Continue the Ralph execution loop/);
        }
    });

    it('does not start with any retriever-skipped prefix', () => {
        const cases = [
            buildRalphIterationPrompt({ originalGoal: 'normal goal' }),
            buildRalphIterationPrompt({ originalGoal: '' }),
            buildRalphIterationPrompt({ originalGoal: 'a'.repeat(50_000) }),
        ];
        for (const prompt of cases) {
            for (const prefix of RETRIEVER_SKIP_PREFIXES) {
                expect(prompt.startsWith(prefix)).toBe(false);
            }
        }
    });

    it('truncates oversize goals and appends a marker', () => {
        const goal = 'x'.repeat(RALPH_GOAL_PROMPT_MAX_LENGTH * 2);
        const prompt = buildRalphIterationPrompt({ originalGoal: goal });
        expect(prompt).toContain('[truncated]');
        // Goal section length should respect the cap (modulo the marker).
        const goalSection = prompt.split('<goal>\n')[1].split('\n</goal>')[0];
        expect(goalSection.length).toBeLessThanOrEqual(
            RALPH_GOAL_PROMPT_MAX_LENGTH + '\n…[truncated]'.length,
        );
    });

    it('respects a custom maxGoalLength override', () => {
        const goal = 'abcdefghij';
        const prompt = buildRalphIterationPrompt({
            originalGoal: goal,
            maxGoalLength: 4,
        });
        expect(prompt).toContain('abcd');
        expect(prompt).toContain('[truncated]');
        expect(prompt).not.toContain('efghij');
    });

    it('preserves non-ASCII characters in the goal', () => {
        const goal = 'Implementér diff–providers (日本語)';
        const prompt = buildRalphIterationPrompt({ originalGoal: goal });
        expect(prompt).toContain(goal);
    });

    it('produces output rich enough to surface skill keywords for retrieval', () => {
        // Regression for the original bug: the placeholder
        // "Begin Ralph execution loop." had no semantic overlap with skill
        // descriptions, so retrieval surfaced nothing. The new prompt MUST
        // carry the goal text, which is what retrieval queries against.
        const goal =
            'Implement PR diff provider tests and run the forge test suite.';
        const prompt = buildRalphIterationPrompt({ originalGoal: goal });
        expect(prompt).not.toBe('Begin Ralph execution loop.');
        expect(prompt).toContain('Implement');
        expect(prompt).toContain('tests');
    });
});
