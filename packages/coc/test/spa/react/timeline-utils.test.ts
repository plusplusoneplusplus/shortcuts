import { describe, it, expect } from 'vitest';
import { mergeConsecutiveContentItems } from '../../../src/server/spa/client/react/processes/timeline-utils';
import type { ClientTimelineItem, ClientToolCall } from '../../../src/server/spa/client/react/types/dashboard';

function content(text: string, timestamp?: string): ClientTimelineItem {
    return { type: 'content', timestamp: timestamp ?? '2025-01-01T00:00:00Z', content: text };
}

function toolStart(name: string, timestamp?: string): ClientTimelineItem {
    const toolCall: ClientToolCall = { id: `tool-${name}`, toolName: name, args: {}, status: 'running' };
    return { type: 'tool-start', timestamp: timestamp ?? '2025-01-01T00:00:00Z', toolCall };
}

function toolComplete(name: string, timestamp?: string): ClientTimelineItem {
    const toolCall: ClientToolCall = { id: `tool-${name}`, toolName: name, args: {}, status: 'completed', result: 'ok' };
    return { type: 'tool-complete', timestamp: timestamp ?? '2025-01-01T00:00:00Z', toolCall };
}

describe('mergeConsecutiveContentItems (client)', () => {
    it('returns empty array for empty input', () => {
        expect(mergeConsecutiveContentItems([])).toEqual([]);
    });

    it('returns single content item unchanged', () => {
        const items = [content('hello')];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(1);
        expect(result[0].content).toBe('hello');
    });

    it('merges multiple consecutive content items into one', () => {
        const items = [
            content('Let ', '2025-01-01T00:00:00Z'),
            content('me ', '2025-01-01T00:00:01Z'),
            content('help.', '2025-01-01T00:00:02Z'),
        ];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(1);
        expect(result[0].content).toBe('Let me help.');
        expect(result[0].timestamp).toBe('2025-01-01T00:00:00Z');
    });

    it('preserves tool events as boundaries between content groups', () => {
        const items = [
            content('Let '), content('me '),
            toolStart('grep'), toolComplete('grep'),
            content('Found '), content('it'),
        ];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(4);
        expect(result[0]).toMatchObject({ type: 'content', content: 'Let me ' });
        expect(result[1]).toMatchObject({ type: 'tool-start' });
        expect(result[2]).toMatchObject({ type: 'tool-complete' });
        expect(result[3]).toMatchObject({ type: 'content', content: 'Found it' });
    });

    it('preserves tool event at start', () => {
        const items = [toolStart('grep'), content('hello')];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(2);
        expect(result[0].type).toBe('tool-start');
        expect(result[1]).toMatchObject({ type: 'content', content: 'hello' });
    });

    it('preserves tool event at end', () => {
        const items = [content('hello'), toolComplete('grep')];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ type: 'content', content: 'hello' });
        expect(result[1].type).toBe('tool-complete');
    });

    it('handles mixed sequence correctly', () => {
        const items = [
            content('a'), toolStart('x'), toolComplete('x'),
            content('b'), content('c'),
        ];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(4);
        expect(result[0]).toMatchObject({ type: 'content', content: 'a' });
        expect(result[1].type).toBe('tool-start');
        expect(result[2].type).toBe('tool-complete');
        expect(result[3]).toMatchObject({ type: 'content', content: 'bc' });
    });

    it('returns only tool events when there is no content', () => {
        const items = [toolStart('a'), toolComplete('a'), toolStart('b'), toolComplete('b')];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(4);
        expect(result.every(i => i.type !== 'content')).toBe(true);
    });

    it('handles content with empty string gracefully', () => {
        const items = [content('hello'), content(''), content(' world')];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(1);
        expect(result[0].content).toBe('hello world');
    });

    it('handles content with undefined content field', () => {
        const items: ClientTimelineItem[] = [
            { type: 'content', timestamp: '2025-01-01T00:00:00Z' },
            content('world'),
        ];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(1);
        expect(result[0].content).toBe('world');
    });

    it('does not mutate the input array', () => {
        const items = [content('a'), content('b')];
        const copy = [...items];
        mergeConsecutiveContentItems(items);
        expect(items).toEqual(copy);
    });

    it('handles tool-failed type as boundary', () => {
        const items: ClientTimelineItem[] = [
            content('before'),
            { type: 'tool-failed', timestamp: '2025-01-01T00:00:00Z', toolCall: { id: 'f1', toolName: 'x', args: {}, status: 'failed' } },
            content('after'),
        ];
        const result = mergeConsecutiveContentItems(items);
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({ type: 'content', content: 'before' });
        expect(result[1].type).toBe('tool-failed');
        expect(result[2]).toMatchObject({ type: 'content', content: 'after' });
    });
});
