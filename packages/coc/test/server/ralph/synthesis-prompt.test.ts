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

    it('improved base prompt explicitly mentions decisions, constraints, and ACs with DoD', () => {
        const prompt = buildRalphSynthesisPrompt();
        expect(prompt).toContain('Do not include preamble');
        expect(prompt).toContain('[decision]');
        expect(prompt).toContain('constraint');
        expect(prompt).toContain('Acceptance criteria');
        expect(prompt).toContain('Definition of Done');
    });

    // ── Seed goal (AC-01) ──

    it('injects seed block with authoritative-preserve instruction when seedGoal is provided', () => {
        const seed = '## Goal\nBuild a widget factory.\n\n[decision] Use TypeScript.';
        const prompt = buildRalphSynthesisPrompt({ seedGoal: seed });
        expect(prompt).toContain(seed);
        expect(prompt).toContain('authoritative');
        expect(prompt).toContain('preserve all [decision] tags and constraints verbatim');
    });

    it('does not inject a seed section when seedGoal is absent', () => {
        const prompt = buildRalphSynthesisPrompt({});
        expect(prompt).not.toContain('authoritative');
        expect(prompt).not.toContain('preserve all [decision] tags');
    });

    it('treats whitespace-only seedGoal as absent', () => {
        const prompt = buildRalphSynthesisPrompt({ seedGoal: '   \n  ' });
        expect(prompt).not.toContain('authoritative');
    });

    it('combines seedGoal and extraGuidance in the correct order', () => {
        const seed = '## Goal\nSeed content.';
        const guidance = 'focus on the auth module';
        const prompt = buildRalphSynthesisPrompt({ seedGoal: seed, extraGuidance: guidance });
        const seedIdx = prompt.indexOf(seed);
        const guidanceIdx = prompt.indexOf(guidance);
        expect(seedIdx).toBeGreaterThan(-1);
        expect(guidanceIdx).toBeGreaterThan(-1);
        // seed should appear before extra guidance
        expect(seedIdx).toBeLessThan(guidanceIdx);
    });
});
