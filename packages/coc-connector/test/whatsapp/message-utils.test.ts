import { describe, expect, it } from 'vitest';
import {
    chunkWhatsAppText, formatWhatsAppOutbound, formatWhatsAppQuestion, stripWhatsAppGlobalPrefix,
} from '../../src/whatsapp/message-utils';

describe('WhatsApp message helpers', () => {
    it('formats container outbound turns without changing sender or metadata', () => {
        expect(formatWhatsAppOutbound({
            role: 'user', agent: 'A', repo: 'repo', title: 'Topic', content: '  hello', userName: 'Owner',
        })).toBe('*Owner*\nAgent: A\nRepo: repo\nTitle: Topic\n\n*Message:*\nhello');
        expect(formatWhatsAppOutbound({
            role: 'assistant', agent: 'A', repo: 'repo', title: '', content: 'answer',
        })).toBe('*CoC Agent*\nAgent: A\nRepo: repo\n\n*Message:*\nanswer');
    });

    it('chunks long messages without losing text or splitting surrogate pairs', () => {
        const text = 'hello world\n' + 'x'.repeat(4090) + '👍' + 'end';
        const chunks = chunkWhatsAppText(text);
        expect(chunks.join('')).toBe(text);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every(chunk => chunk.length <= 4096)).toBe(true);
        expect(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
        expect(chunkWhatsAppText('')).toEqual([]);
        expect(chunkWhatsAppText('short')).toEqual(['short']);
        expect(() => chunkWhatsAppText('abc', 1)).toThrow(RangeError);
    });

    it('strips only the container global prefix', () => {
        expect(stripWhatsAppGlobalPrefix('[global] Ask')).toBe('Ask');
        expect(stripWhatsAppGlobalPrefix('regular')).toBeNull();
        expect(stripWhatsAppGlobalPrefix('[global]')).toBe('');
    });
});

describe('formatWhatsAppQuestion', () => {
    it('bolds the question, lists options one per line, and ends with the hint', () => {
        expect(formatWhatsAppQuestion({
            progress: '(Question 2 of 3)', question: 'Which database?',
            options: ['1. Postgres', '2. SQLite'], hint: 'Reply: 1-2 or "skip"',
        })).toBe('(Question 2 of 3)\n*Which database?*\n1. Postgres\n2. SQLite\n\nReply: 1-2 or "skip"');
    });

    it('bolds each line of a multi-line question and omits progress and options when absent', () => {
        expect(formatWhatsAppQuestion({ question: 'Name the repo\n\n for the release ', options: [], hint: 'Reply: your answer or "skip"' }))
            .toBe('*Name the repo*\n\n*for the release*\n\nReply: your answer or "skip"');
    });
});
