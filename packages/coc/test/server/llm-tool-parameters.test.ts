/**
 * Unit tests for LLM tool parameter summarization.
 *
 * Covers the pure JSON-schema → compact display-metadata derivation used by the
 * workspace LLM tools settings surface (AC-01 / AC-02 compact format).
 */

import { describe, it, expect } from 'vitest';
import {
    summarizeToolParameters,
    compactParamType,
} from '../../src/server/llm-tools/llm-tool-parameters';

describe('compactParamType', () => {
    it('returns the primitive type name for primitives', () => {
        expect(compactParamType({ type: 'string' })).toBe('string');
        expect(compactParamType({ type: 'number' })).toBe('number');
        expect(compactParamType({ type: 'boolean' })).toBe('boolean');
        expect(compactParamType({ type: 'integer' })).toBe('integer');
    });

    it('collapses nested objects to {...}', () => {
        expect(compactParamType({ type: 'object', properties: { a: { type: 'string' } } })).toBe('{...}');
        // Inferred object shape with no explicit type.
        expect(compactParamType({ properties: { a: { type: 'string' } } })).toBe('{...}');
    });

    it('collapses arrays to [...]', () => {
        expect(compactParamType({ type: 'array', items: { type: 'string' } })).toBe('[...]');
        expect(compactParamType({ type: 'array', items: { type: 'object', properties: {} } })).toBe('[...]');
        // Inferred array shape with no explicit type.
        expect(compactParamType({ items: { type: 'string' } })).toBe('[...]');
    });

    it('picks the first non-null type from a union', () => {
        expect(compactParamType({ type: ['string', 'null'] })).toBe('string');
        expect(compactParamType({ type: ['null', 'number'] })).toBe('number');
    });

    it('labels typeless enums as enum but keeps the explicit type when present', () => {
        expect(compactParamType({ enum: ['a', 'b'] })).toBe('enum');
        expect(compactParamType({ type: 'string', enum: ['a', 'b'] })).toBe('string');
    });

    it('falls back to any for indeterminate shapes', () => {
        expect(compactParamType({ description: 'no type here' })).toBe('any');
        expect(compactParamType({})).toBe('any');
        expect(compactParamType('nope')).toBe('any');
        expect(compactParamType(null)).toBe('any');
    });
});

describe('summarizeToolParameters', () => {
    it('summarizes a typical tool schema with required and optional params, preserving order', () => {
        const schema = {
            type: 'object',
            properties: {
                processId: { type: 'string', description: 'id' },
                maxChars: { type: 'number', description: 'cap' },
                includeToolCalls: { type: 'boolean' },
                fromTurn: { type: 'number' },
            },
            required: ['processId'],
        };
        expect(summarizeToolParameters(schema)).toEqual([
            { name: 'processId', type: 'string', required: true },
            { name: 'maxChars', type: 'number', required: false },
            { name: 'includeToolCalls', type: 'boolean', required: false },
            { name: 'fromTurn', type: 'number', required: false },
        ]);
    });

    it('renders nested objects and arrays compactly', () => {
        const schema = {
            type: 'object',
            properties: {
                questions: { type: 'array', items: { type: 'object', properties: {} } },
                tags: { type: 'array', items: { type: 'string' } },
                config: { type: 'object', properties: { a: { type: 'string' } } },
            },
            required: ['questions'],
        };
        expect(summarizeToolParameters(schema)).toEqual([
            { name: 'questions', type: '[...]', required: true },
            { name: 'tags', type: '[...]', required: false },
            { name: 'config', type: '{...}', required: false },
        ]);
    });

    it('returns an empty array for an object schema with no properties (no parameters)', () => {
        expect(summarizeToolParameters({ type: 'object', properties: {} })).toEqual([]);
        expect(summarizeToolParameters({ type: 'object' })).toEqual([]);
    });

    it('returns undefined when no JSON-schema object is available (parameters unavailable)', () => {
        expect(summarizeToolParameters(undefined)).toBeUndefined();
        expect(summarizeToolParameters(null)).toBeUndefined();
        expect(summarizeToolParameters('string-schema')).toBeUndefined();
        // A Zod-like schema instance exposes neither `type: 'object'` nor a
        // plain `properties` map, so it is treated as unavailable.
        expect(summarizeToolParameters({ _def: { typeName: 'ZodObject' }, shape: {} })).toBeUndefined();
    });

    it('ignores non-string entries in the required list', () => {
        const schema = {
            type: 'object',
            properties: { a: { type: 'string' } },
            required: ['a', 123, null],
        };
        expect(summarizeToolParameters(schema)).toEqual([
            { name: 'a', type: 'string', required: true },
        ]);
    });
});
