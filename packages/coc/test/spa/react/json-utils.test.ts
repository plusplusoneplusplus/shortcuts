/**
 * Tests for isJsonResponse() utility.
 */
import { describe, it, expect } from 'vitest';
import { isJsonResponse } from '../../../src/server/spa/client/react/shared/json-utils';

describe('isJsonResponse', () => {
    // --- Valid JSON objects ---
    it('returns true for a simple JSON object', () => {
        expect(isJsonResponse('{"key": "value"}')).toBe(true);
    });

    it('returns true for a nested JSON object', () => {
        expect(isJsonResponse('{"a": {"b": {"c": 1}}}')).toBe(true);
    });

    it('returns true for an empty JSON object', () => {
        expect(isJsonResponse('{}')).toBe(true);
    });

    // --- Valid JSON arrays ---
    it('returns true for a JSON array', () => {
        expect(isJsonResponse('[1, 2, 3]')).toBe(true);
    });

    it('returns true for an array of objects', () => {
        expect(isJsonResponse('[{"id": 1}, {"id": 2}]')).toBe(true);
    });

    it('returns true for an empty JSON array', () => {
        expect(isJsonResponse('[]')).toBe(true);
    });

    // --- Whitespace handling ---
    it('returns true for JSON with leading/trailing whitespace', () => {
        expect(isJsonResponse('  \n  {"key": "value"}  \n  ')).toBe(true);
    });

    it('returns true for JSON with leading newlines', () => {
        expect(isJsonResponse('\n\n[1, 2]\n')).toBe(true);
    });

    // --- Non-JSON content ---
    it('returns false for plain text', () => {
        expect(isJsonResponse('Hello world')).toBe(false);
    });

    it('returns false for markdown', () => {
        expect(isJsonResponse('# Heading\n\nSome text')).toBe(false);
    });

    it('returns false for a code block containing JSON', () => {
        expect(isJsonResponse('```json\n{"key": "value"}\n```')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isJsonResponse('')).toBe(false);
    });

    it('returns false for whitespace only', () => {
        expect(isJsonResponse('   \n\t  ')).toBe(false);
    });

    // --- JSON primitives (not object/array) ---
    it('returns false for a JSON string primitive', () => {
        expect(isJsonResponse('"hello"')).toBe(false);
    });

    it('returns false for a JSON number primitive', () => {
        expect(isJsonResponse('42')).toBe(false);
    });

    it('returns false for JSON null', () => {
        expect(isJsonResponse('null')).toBe(false);
    });

    it('returns false for JSON boolean', () => {
        expect(isJsonResponse('true')).toBe(false);
    });

    // --- Partial / invalid JSON ---
    it('returns false for truncated JSON object', () => {
        expect(isJsonResponse('{"key": "val')).toBe(false);
    });

    it('returns false for truncated JSON array', () => {
        expect(isJsonResponse('[1, 2, ')).toBe(false);
    });

    it('returns false for text starting with { but not valid JSON', () => {
        expect(isJsonResponse('{this is not json}')).toBe(false);
    });

    // --- Mixed content ---
    it('returns false for text that contains JSON but is not purely JSON', () => {
        expect(isJsonResponse('Here is the result: {"key": "value"}')).toBe(false);
    });

    it('returns false for JSON followed by text', () => {
        expect(isJsonResponse('{"key": "value"}\nSome additional text')).toBe(false);
    });
});
