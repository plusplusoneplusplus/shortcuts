import { describe, it, expect } from 'vitest';
import {
    buildRalphSynthesisPrompt,
    RALPH_SYNTHESIS_HINT_MAX_LENGTH,
} from '../../../src/server/ralph/synthesis-prompt';

describe('buildRalphSynthesisPrompt', () => {
    it('returns the base prompt when no extraGuidance is supplied', () => {
        const prompt = buildRalphSynthesisPrompt();
        expect(prompt).toContain('Ralph grilling phase');
        expect(prompt).toContain('## Goal');
        expect(prompt).not.toContain('user added this guidance');
    });

    it('treats whitespace-only extraGuidance as absent', () => {
        const prompt = buildRalphSynthesisPrompt({ extraGuidance: '   \n  ' });
        expect(prompt).not.toContain('user added this guidance');
    });

    it('appends a guidance section when extraGuidance is provided', () => {
        const prompt = buildRalphSynthesisPrompt({
            extraGuidance: 'focus on the queue refactor, ignore the UI changes',
        });
        expect(prompt).toContain('user added this guidance');
        expect(prompt).toContain('focus on the queue refactor, ignore the UI changes');
    });

    it('truncates extraGuidance that exceeds the hard cap', () => {
        const huge = 'a'.repeat(RALPH_SYNTHESIS_HINT_MAX_LENGTH + 500);
        const prompt = buildRalphSynthesisPrompt({ extraGuidance: huge });
        // The full huge string is not included verbatim; only the cap-prefix
        // followed by the ellipsis truncation marker.
        expect(prompt).not.toContain(huge);
        expect(prompt).toContain('a'.repeat(RALPH_SYNTHESIS_HINT_MAX_LENGTH));
        expect(prompt).toMatch(/…$/);
    });

    it('keeps the goal-block instruction stable across calls (snapshot-style)', () => {
        const prompt = buildRalphSynthesisPrompt();
        expect(prompt).toContain('one or two short paragraphs');
        expect(prompt).toContain('Do not include preamble');
    });
});
