/**
 * Tests for extraction-prompts.ts
 */
import { describe, it, expect } from 'vitest';
import {
    EXTRACTION_SYSTEM_PROMPT,
    buildExtractionUserPrompt,
    parseExtractionResponse,
} from '../../src/memory/extraction-prompts';

describe('EXTRACTION_SYSTEM_PROMPT', () => {
    it('includes required category names', () => {
        for (const cat of ['conventions', 'architecture', 'patterns', 'gotchas', 'tools', 'decisions']) {
            expect(EXTRACTION_SYSTEM_PROMPT).toContain(cat);
        }
    });

    it('instructs JSON array output', () => {
        expect(EXTRACTION_SYSTEM_PROMPT).toContain('JSON array');
    });
});

describe('buildExtractionUserPrompt', () => {
    it('includes transcript in output', () => {
        const result = buildExtractionUserPrompt('[User]: Hello\n[Assistant]: Hi');
        expect(result).toContain('[User]: Hello');
        expect(result).toContain('Conversation Transcript');
    });

    it('includes repo context when provided', () => {
        const result = buildExtractionUserPrompt('transcript', 'my-repo');
        expect(result).toContain('Repository: my-repo');
    });

    it('omits repo context when not provided', () => {
        const result = buildExtractionUserPrompt('transcript');
        expect(result).not.toContain('Repository:');
    });
});

describe('parseExtractionResponse', () => {
    it('parses valid JSON array', () => {
        const response = '[{"fact": "Use ESLint", "category": "conventions"}]';
        const facts = parseExtractionResponse(response);
        expect(facts).toEqual([{ fact: 'Use ESLint', category: 'conventions' }]);
    });

    it('parses multiple facts', () => {
        const response = JSON.stringify([
            { fact: 'Fact 1', category: 'architecture' },
            { fact: 'Fact 2', category: 'gotchas' },
            { fact: 'Fact 3', category: 'tools' },
        ]);
        const facts = parseExtractionResponse(response);
        expect(facts).toHaveLength(3);
        expect(facts[0].category).toBe('architecture');
        expect(facts[2].category).toBe('tools');
    });

    it('handles markdown code fences', () => {
        const response = '```json\n[{"fact": "Use tabs", "category": "conventions"}]\n```';
        const facts = parseExtractionResponse(response);
        expect(facts).toHaveLength(1);
        expect(facts[0].fact).toBe('Use tabs');
    });

    it('handles empty array', () => {
        expect(parseExtractionResponse('[]')).toEqual([]);
    });

    it('handles empty string', () => {
        expect(parseExtractionResponse('')).toEqual([]);
    });

    it('handles malformed JSON gracefully', () => {
        expect(parseExtractionResponse('not json at all')).toEqual([]);
    });

    it('extracts JSON from surrounding text', () => {
        const response = 'Here are the facts:\n[{"fact": "Use Vitest", "category": "tools"}]\nDone.';
        const facts = parseExtractionResponse(response);
        expect(facts).toHaveLength(1);
        expect(facts[0].fact).toBe('Use Vitest');
    });

    it('defaults unknown category to patterns', () => {
        const response = '[{"fact": "Something", "category": "unknown-cat"}]';
        const facts = parseExtractionResponse(response);
        expect(facts[0].category).toBe('patterns');
    });

    it('skips entries with empty fact', () => {
        const response = '[{"fact": "", "category": "tools"}, {"fact": "Real fact", "category": "tools"}]';
        const facts = parseExtractionResponse(response);
        expect(facts).toHaveLength(1);
        expect(facts[0].fact).toBe('Real fact');
    });

    it('skips entries without fact field', () => {
        const response = '[{"content": "not a fact"}, {"fact": "Real", "category": "tools"}]';
        const facts = parseExtractionResponse(response);
        expect(facts).toHaveLength(1);
    });

    it('trims whitespace from facts', () => {
        const response = '[{"fact": "  trimmed  ", "category": "conventions"}]';
        const facts = parseExtractionResponse(response);
        expect(facts[0].fact).toBe('trimmed');
    });

    it('handles all valid categories', () => {
        const categories = ['conventions', 'architecture', 'patterns', 'gotchas', 'tools', 'decisions'];
        for (const cat of categories) {
            const response = `[{"fact": "test", "category": "${cat}"}]`;
            const facts = parseExtractionResponse(response);
            expect(facts[0].category).toBe(cat);
        }
    });
});
