import { describe, expect, it } from 'vitest';
import { buildSideNotePrompt, buildRegionAskPrompt } from '../../src/server/processes/chat-sidenotes/chat-sidenotes-prompt';

describe('buildSideNotePrompt', () => {
    it('wraps the selection in markers and includes surrounding context', () => {
        const prompt = buildSideNotePrompt({
            selectedText: 'MTBF',
            contextBefore: 'when the ',
            contextAfter: ' shrinks over time',
        });
        expect(prompt).toContain('⟦MTBF⟧');
        expect(prompt).toContain('when the');
        expect(prompt).toContain('shrinks over time');
        expect(prompt).toContain('Markdown');
    });

    it('uses a default explain question when none is supplied', () => {
        const prompt = buildSideNotePrompt({ selectedText: 'Daly formula' });
        expect(prompt).toContain('Briefly explain "Daly formula"');
    });

    it('uses a custom question when provided', () => {
        const prompt = buildSideNotePrompt({
            selectedText: 'Daly formula',
            question: 'Where is it used?',
        });
        expect(prompt).toContain('Question: Where is it used?');
        expect(prompt).not.toContain('Briefly explain');
    });

    it('truncates an overly long selection', () => {
        const long = 'x'.repeat(1000);
        const prompt = buildSideNotePrompt({ selectedText: long });
        expect(prompt).toContain('…');
        expect(prompt.length).toBeLessThan(long.length + 500);
    });
});

describe('buildRegionAskPrompt', () => {
    it('tells the model to read the attached cropped image', () => {
        const prompt = buildRegionAskPrompt({});
        expect(prompt).toContain('attached as an image');
        expect(prompt).toContain('Markdown');
    });

    it('uses a default figure/equation question when none is supplied', () => {
        const prompt = buildRegionAskPrompt({});
        expect(prompt).toContain('Explain this figure or equation');
    });

    it('uses a custom question when provided', () => {
        const prompt = buildRegionAskPrompt({ question: 'What does the y-axis show?' });
        expect(prompt).toContain('Question: What does the y-axis show?');
        expect(prompt).not.toContain('Explain this figure or equation');
    });

    it('includes nearby page text when context is supplied', () => {
        const prompt = buildRegionAskPrompt({
            contextBefore: 'Figure 3 shows',
            contextAfter: 'the training loss.',
        });
        expect(prompt).toContain('Nearby page text');
        expect(prompt).toContain('Figure 3 shows');
        expect(prompt).toContain('the training loss.');
    });

    it('omits the context section when no context is supplied', () => {
        const prompt = buildRegionAskPrompt({ question: 'Explain.' });
        expect(prompt).not.toContain('Nearby page text');
    });
});
