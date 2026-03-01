import { describe, it, expect } from 'vitest';
import { getEdgeBadgeText, getEdgeSchemaText } from '../../../../src/server/spa/client/react/processes/dag/edgeAnnotations';

describe('getEdgeBadgeText', () => {
    it('returns "CSV" for input→map with CSV source', () => {
        const config = { input: { from: { type: 'csv', path: 'data.csv' } }, map: { prompt: '...' } };
        expect(getEdgeBadgeText('input', 'map', config)).toBe('CSV');
    });

    it('returns "CSV" for input→filter with CSV source', () => {
        const config = { input: { from: { type: 'csv', path: 'data.csv' } }, filter: { type: 'rule' } };
        expect(getEdgeBadgeText('input', 'filter', config)).toBe('CSV');
    });

    it('returns item count for input→map with inline items', () => {
        const config = { input: { items: [{ a: 1 }, { a: 2 }] } };
        expect(getEdgeBadgeText('input', 'map', config)).toBe('2 items');
    });

    it('returns item count for input→map with inline from array', () => {
        const config = { input: { from: [{ x: 1 }, { x: 2 }, { x: 3 }] } };
        expect(getEdgeBadgeText('input', 'map', config)).toBe('3 items');
    });

    it('returns "generated" for input→map with generate config', () => {
        const config = { input: { generate: { prompt: '...', schema: ['a'] } } };
        expect(getEdgeBadgeText('input', 'map', config)).toBe('generated');
    });

    it('returns output fields for map→reduce', () => {
        const config = { map: { output: ['category', 'summary'] } };
        expect(getEdgeBadgeText('map', 'reduce', config)).toBe('[category, summary]');
    });

    it('returns output fields for 3 fields without truncation', () => {
        const config = { map: { output: ['a', 'b', 'c'] } };
        expect(getEdgeBadgeText('map', 'reduce', config)).toBe('[a, b, c]');
    });

    it('truncates long output fields', () => {
        const config = { map: { output: ['a', 'b', 'c', 'd', 'e'] } };
        expect(getEdgeBadgeText('map', 'reduce', config)).toBe('[a, b, …+3]');
    });

    it('returns "filtered" for filter→map', () => {
        const config = { filter: { type: 'rule' } };
        expect(getEdgeBadgeText('filter', 'map', config)).toBe('filtered');
    });

    it('returns null when config is undefined', () => {
        expect(getEdgeBadgeText('input', 'map', undefined)).toBeNull();
    });

    it('returns null for unsupported edge transitions', () => {
        const config = { input: { items: [{ a: 1 }] } };
        expect(getEdgeBadgeText('reduce', 'map', config)).toBeNull();
    });

    it('returns null for input→map when input is empty', () => {
        const config = { input: {} };
        expect(getEdgeBadgeText('input', 'map', config)).toBeNull();
    });

    it('returns null for map→reduce when no output defined', () => {
        const config = { map: { prompt: 'test' } };
        expect(getEdgeBadgeText('map', 'reduce', config)).toBeNull();
    });

    it('returns null for map→reduce when output is empty array', () => {
        const config = { map: { output: [] } };
        expect(getEdgeBadgeText('map', 'reduce', config)).toBeNull();
    });
});

describe('getEdgeSchemaText', () => {
    it('returns fields from inline items for input→map', () => {
        const config = { input: { items: [{ title: 'x', desc: 'y' }] } };
        const result = getEdgeSchemaText('input', 'map', config);
        expect(result).toContain('title');
        expect(result).toContain('desc');
        expect(result).toContain('Fields:');
    });

    it('returns CSV source path for input→map', () => {
        const config = { input: { from: { type: 'csv', path: 'data.csv' } }, map: { prompt: 'Analyze {{col1}}' } };
        const result = getEdgeSchemaText('input', 'map', config);
        expect(result).toContain('Source: CSV');
        expect(result).toContain('data.csv');
        expect(result).toContain('col1');
    });

    it('infers fields from map prompt template variables', () => {
        const config = { input: {}, map: { prompt: 'Analyze {{title}} and {{content}}' } };
        const result = getEdgeSchemaText('input', 'map', config);
        expect(result).toContain('title');
        expect(result).toContain('content');
    });

    it('excludes reserved template vars (ITEMS, BATCH)', () => {
        const config = { input: {}, map: { prompt: '{{ITEMS}} and {{name}} and {{BATCH}}' } };
        const result = getEdgeSchemaText('input', 'map', config);
        expect(result).toContain('name');
        expect(result).not.toContain('ITEMS');
        expect(result).not.toContain('BATCH');
    });

    it('returns fields from generate schema', () => {
        const config = { input: { generate: { schema: ['field1', 'field2'] } } };
        const result = getEdgeSchemaText('input', 'map', config);
        expect(result).toContain('field1');
        expect(result).toContain('field2');
    });

    it('returns fields from inline from array', () => {
        const config = { input: { from: [{ x: 1, y: 2 }] } };
        const result = getEdgeSchemaText('input', 'map', config);
        expect(result).toContain('x');
        expect(result).toContain('y');
    });

    it('returns input→output for map→reduce edge', () => {
        const config = { input: { items: [{ a: 1, b: 2 }] }, map: { output: ['c', 'd'] } };
        const result = getEdgeSchemaText('map', 'reduce', config);
        expect(result).toContain('Input:');
        expect(result).toContain('a');
        expect(result).toContain('b');
        expect(result).toContain('Output:');
        expect(result).toContain('c');
        expect(result).toContain('d');
    });

    it('returns only Output for map→reduce when no input fields', () => {
        const config = { input: {}, map: { output: ['c', 'd'] } };
        const result = getEdgeSchemaText('map', 'reduce', config);
        expect(result).toContain('Output:');
        expect(result).toContain('c');
        expect(result).not.toContain('Input:');
    });

    it('returns filter metadata for filter→map', () => {
        const config = {
            filter: {
                type: 'rule',
                rule: { rules: [{ field: 'status', operator: 'equals', value: 'active' }, { field: 'age' }] },
            },
        };
        const result = getEdgeSchemaText('filter', 'map', config);
        expect(result).toContain('Filter type: rule');
        expect(result).toContain('Rule fields:');
        expect(result).toContain('status');
        expect(result).toContain('age');
    });

    it('returns filter type without rule fields when no rules', () => {
        const config = { filter: { type: 'ai' } };
        const result = getEdgeSchemaText('filter', 'map', config);
        expect(result).toBe('Filter type: ai');
    });

    it('returns null when config is undefined', () => {
        expect(getEdgeSchemaText('input', 'map', undefined)).toBeNull();
    });

    it('returns null when no data available', () => {
        const config = { input: {}, map: {} };
        expect(getEdgeSchemaText('input', 'map', config)).toBeNull();
    });

    it('returns null for unsupported edge transitions', () => {
        const config = { input: { items: [{ a: 1 }] } };
        expect(getEdgeSchemaText('reduce', 'map', config)).toBeNull();
    });

    it('returns null for filter→map when no filter config', () => {
        const config = {};
        expect(getEdgeSchemaText('filter', 'map', config)).toBeNull();
    });

    it('returns null for map→reduce when no fields and no output', () => {
        const config = { input: {}, map: {} };
        expect(getEdgeSchemaText('map', 'reduce', config)).toBeNull();
    });
});
