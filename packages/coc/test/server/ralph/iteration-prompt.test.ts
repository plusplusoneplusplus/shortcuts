/**
 * Unit tests for `buildRalphIterationPrompt`.
 */
import { describe, it, expect } from 'vitest';
import {
    buildRalphIterationPrompt,
    RALPH_WORK_INTENT_PROMPT,
    RALPH_SPEC_CONTRACT_PROMPT,
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
    function goalSection(prompt: string): string {
        return prompt.split('<goal>\n')[1].split('\n</goal>')[0];
    }

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

    it('includes repository-agnostic work intent before the goal', () => {
        const prompt = buildRalphIterationPrompt({ originalGoal: 'Build a feature' });
        expect(prompt).toContain(RALPH_WORK_INTENT_PROMPT);
        expect(prompt.indexOf('<work_intent>')).toBeGreaterThan(
            prompt.indexOf('Continue the Ralph execution loop'),
        );
        expect(prompt.indexOf('</work_intent>')).toBeLessThan(prompt.indexOf('<goal>'));
        expect(prompt).not.toContain('<selected_skills>');
        expect(prompt).not.toMatch(/\bimpl\b/);
    });

    it('keeps work intent when the goal is empty or whitespace', () => {
        for (const goal of ['', '   ', '\n\t', undefined]) {
            const prompt = buildRalphIterationPrompt({ originalGoal: goal });
            expect(prompt).not.toContain('<goal>');
            expect(prompt).toContain('<work_intent>');
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

    it('includes very large goals in full without truncation', () => {
        const goal = 'x'.repeat(50_000);
        const prompt = buildRalphIterationPrompt({ originalGoal: goal });
        expect(prompt).not.toContain('[truncated]');
        expect(goalSection(prompt)).toBe(goal);
        expect(prompt).toContain(RALPH_WORK_INTENT_PROMPT);
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

    it('embeds the spec contract that delegates to ultra-ralph skill', () => {
        const prompt = buildRalphIterationPrompt({ originalGoal: 'a goal' });
        expect(prompt).toContain(RALPH_SPEC_CONTRACT_PROMPT);
        expect(prompt).toContain('ultra-ralph');
        // Spec contract must sit before the goal block so the goal text
        // remains the dominant retrieval signal at the end of the prompt.
        expect(prompt.indexOf('<spec_contract>')).toBeGreaterThan(
            prompt.indexOf('<work_intent>'),
        );
        expect(prompt.indexOf('</spec_contract>')).toBeLessThan(
            prompt.indexOf('<goal>'),
        );
    });

    it('includes the spec contract even when the goal is empty', () => {
        const prompt = buildRalphIterationPrompt({ originalGoal: '' });
        expect(prompt).toContain(RALPH_SPEC_CONTRACT_PROMPT);
        expect(prompt).not.toContain('<goal>');
    });
});
