import { describe, expect, it } from 'vitest';
import { buildSideNotePrompt } from '../../src/server/processes/chat-sidenotes/chat-sidenotes-prompt';

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
