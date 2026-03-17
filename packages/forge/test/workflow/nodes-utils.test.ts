import { describe, it, expect, vi } from 'vitest';
import {
    extractJsonFromResponse,
    mergeOutput,
    buildItemPrompt,
    buildBatchPrompt,
    splitIntoBatches,
} from '../../src/workflow/nodes/utils';

describe('extractJsonFromResponse', () => {
    it('extracts JSON from a ```json code block', () => {
        const response = '```json\n{"key":"val"}\n```';
        expect(extractJsonFromResponse(response)).toEqual({ key: 'val' });
    });

    it('extracts JSON from a bare ``` code block', () => {
        const response = '```\n{"x":1}\n```';
        expect(extractJsonFromResponse(response)).toEqual({ x: 1 });
    });

    it('parses a bare JSON object with no code block', () => {
        expect(extractJsonFromResponse('{"key":"val"}')).toEqual({ key: 'val' });
    });

    it('parses a JSON array response', () => {
        expect(extractJsonFromResponse('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('extracts embedded JSON when surrounded by extra text', () => {
        const response = 'Here is the result: {"score":5} that is the end.';
        const result = extractJsonFromResponse(response) as { score: number };
        expect(result.score).toBe(5);
    });

    it('throws on non-JSON text with no extractable object', () => {
        expect(() => extractJsonFromResponse('just plain text')).toThrow('Cannot extract JSON');
    });
});

describe('mergeOutput', () => {
    it('text mode — adds response as "text" field when outputFields is empty', () => {
        const item = { id: '1' };
        const result = mergeOutput(item, 'response text');
        expect(result).toMatchObject({ id: '1', text: 'response text' });
    });

    it('text mode — adds response as "text" field when outputFields is undefined', () => {
        const item = { id: '2' };
        const result = mergeOutput(item, 'hello', undefined);
        expect(result.text).toBe('hello');
    });

    it('JSON mode — extracts declared outputFields from a JSON response', () => {
        const item = { id: '3' };
        const response = JSON.stringify({ score: 9, notes: 'good' });
        const result = mergeOutput(item, response, ['score', 'notes']);
        expect(result).toMatchObject({ score: 9, notes: 'good' });
    });

    it('JSON mode — sets missing declared fields to null', () => {
        const item = { id: '4' };
        const response = JSON.stringify({ score: 9 });
        const result = mergeOutput(item, response, ['score', 'missing']);
        expect(result.score).toBe(9);
        expect(result.missing).toBeNull();
    });

    it('JSON mode — falls back to text mode when response is not valid JSON', () => {
        const item = { id: '5' };
        const result = mergeOutput(item, 'not json at all', ['score']);
        expect(result.text).toBe('not json at all');
        expect(result.__parseError).toBe(true);
    });

    it('JSON mode — falls back to text mode when JSON is an array, not an object', () => {
        const item = { id: '6' };
        const result = mergeOutput(item, '[1,2,3]', ['field']);
        expect(result.__parseError).toBe(true);
    });
});

describe('buildItemPrompt', () => {
    it('substitutes {{fieldName}} with the item field value', () => {
        const result = buildItemPrompt('Review: {{name}}', { name: 'foo.ts' });
        expect(result).toBe('Review: foo.ts');
    });

    it('replaces multiple occurrences of the same placeholder', () => {
        const result = buildItemPrompt('{{x}} and {{x}}', { x: 'hello' });
        expect(result).toBe('hello and hello');
    });

    it('replaces multiple distinct placeholders', () => {
        const result = buildItemPrompt('{{a}} + {{b}}', { a: '1', b: '2' });
        expect(result).toBe('1 + 2');
    });

    it('replaces missing fields with empty string', () => {
        const result = buildItemPrompt('{{missing}} value', {});
        expect(result).toBe(' value');
    });

    it('handles numeric item values', () => {
        const result = buildItemPrompt('Count: {{count}}', { count: 42 });
        expect(result).toBe('Count: 42');
    });
});

describe('buildBatchPrompt', () => {
    it('replaces {{ITEMS}} with JSON representation of the batch', () => {
        const batch = [{ id: '1' }, { id: '2' }];
        const result = buildBatchPrompt('Items: {{ITEMS}}', batch);
        expect(result).toContain('"id": "1"');
        expect(result).toContain('"id": "2"');
    });

    it('leaves template unchanged when {{ITEMS}} is absent', () => {
        const result = buildBatchPrompt('no placeholder', []);
        expect(result).toBe('no placeholder');
    });
});

describe('splitIntoBatches', () => {
    it('splits items into batches of specified size', () => {
        const result = splitIntoBatches([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
        expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]);
    });

    it('returns single batch when items count is less than batchSize', () => {
        const result = splitIntoBatches([1, 2], 5);
        expect(result).toEqual([[1, 2]]);
    });

    it('returns empty array for empty input', () => {
        const result = splitIntoBatches([], 3);
        expect(result).toEqual([]);
    });

    it('returns each item in its own batch when batchSize is 1', () => {
        const result = splitIntoBatches([1, 2, 3], 1);
        expect(result).toEqual([[1], [2], [3]]);
    });
});
