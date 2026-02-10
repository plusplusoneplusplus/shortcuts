/**
 * Tests for shared AI response parsing utility.
 *
 * Covers happy path, error cases, JSON repair, and context in error messages.
 */

import { describe, it, expect } from 'vitest';
import { parseAIJsonResponse, attemptJsonRepair } from '../../src/utils/parse-ai-response';

describe('parseAIJsonResponse', () => {
    // ========================================================================
    // Happy Path
    // ========================================================================

    it('returns parsed object for valid JSON response', () => {
        const response = '{"key": "value", "num": 42}';
        const result = parseAIJsonResponse(response, { context: 'test' });
        expect(result).toEqual({ key: 'value', num: 42 });
    });

    it('extracts JSON from markdown code block', () => {
        const response = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.';
        const result = parseAIJsonResponse(response, { context: 'test' });
        expect(result).toEqual({ key: 'value' });
    });

    it('handles nested objects', () => {
        const response = '{"outer": {"inner": "value"}, "list": [1, 2, 3]}';
        const result = parseAIJsonResponse(response, { context: 'test' });
        expect(result).toEqual({ outer: { inner: 'value' }, list: [1, 2, 3] });
    });

    // ========================================================================
    // Error Cases — Empty/Null/Undefined
    // ========================================================================

    it('throws on empty string', () => {
        expect(() => parseAIJsonResponse('', { context: 'test' }))
            .toThrow('Empty or invalid response from AI (test)');
    });

    it('throws on null response', () => {
        expect(() => parseAIJsonResponse(null, { context: 'test' }))
            .toThrow('Empty or invalid response from AI (test)');
    });

    it('throws on undefined response', () => {
        expect(() => parseAIJsonResponse(undefined, { context: 'test' }))
            .toThrow('Empty or invalid response from AI (test)');
    });

    // ========================================================================
    // Error Cases — No JSON Found
    // ========================================================================

    it('throws when no JSON found in response', () => {
        expect(() => parseAIJsonResponse('Just plain text, no JSON here', { context: 'discovery' }))
            .toThrow('No JSON found in AI response (discovery)');
    });

    // ========================================================================
    // Error Cases — Invalid JSON (no repair)
    // ========================================================================

    it('throws on invalid JSON without repair mode', () => {
        // extractJSON returns null for non-JSON content, so this triggers "No JSON found"
        const response = '{invalid json here}';
        expect(() => parseAIJsonResponse(response, { context: 'probe' }))
            .toThrow('No JSON found in AI response (probe)');
    });

    // ========================================================================
    // JSON Repair
    // ========================================================================

    it('attempts repair and succeeds when repair: true', () => {
        // Trailing comma — fixable by attemptJsonRepair
        const response = '{"key": "value",}';
        const result = parseAIJsonResponse(response, { context: 'test', repair: true });
        expect(result).toEqual({ key: 'value' });
    });

    it('attempts repair and fails with original error when repair fails', () => {
        // extractJSON returns null for completely broken content
        const response = '{{{totally broken';
        expect(() => parseAIJsonResponse(response, { context: 'seeds', repair: true }))
            .toThrow('No JSON found in AI response (seeds)');
    });

    it('does not attempt repair when repair: false (default)', () => {
        const response = '{"key": "value",}';
        expect(() => parseAIJsonResponse(response, { context: 'test' }))
            .toThrow(/Invalid JSON in test response/);
    });

    // ========================================================================
    // Error Cases — Not a JSON Object
    // ========================================================================

    it('throws when response is a JSON array', () => {
        const response = '[1, 2, 3]';
        expect(() => parseAIJsonResponse(response, { context: 'merge' }))
            .toThrow('merge response is not a JSON object');
    });

    it('throws on JSON that extractJSON extracts but is invalid', () => {
        // Wrap invalid JSON in a code block so extractJSON returns it
        const response = '```json\n{"key": value_without_quotes}\n```';
        expect(() => parseAIJsonResponse(response, { context: 'test' }))
            .toThrow(/Invalid JSON in test response/);
    });

    it('repair fails on JSON that extractJSON extracts but cannot be repaired', () => {
        const response = '```json\n{"key": <<<>>>\n```';
        expect(() => parseAIJsonResponse(response, { context: 'test', repair: true }))
            .toThrow(/Invalid JSON in test response/);
    });

    it('throws when response is a JSON string (extractJSON returns null)', () => {
        const response = '"just a string"';
        expect(() => parseAIJsonResponse(response, { context: 'test' }))
            .toThrow('No JSON found in AI response (test)');
    });

    it('throws when response is a JSON number (extractJSON returns null)', () => {
        const response = '42';
        expect(() => parseAIJsonResponse(response, { context: 'test' }))
            .toThrow('No JSON found in AI response (test)');
    });

    // ========================================================================
    // Context String in Errors
    // ========================================================================

    it('includes context string in empty response error', () => {
        expect(() => parseAIJsonResponse(null, { context: 'my-context' }))
            .toThrow('(my-context)');
    });

    it('includes context string in no-JSON error', () => {
        expect(() => parseAIJsonResponse('no json', { context: 'my-context' }))
            .toThrow('(my-context)');
    });

    it('includes context string in invalid JSON error', () => {
        expect(() => parseAIJsonResponse('{bad}', { context: 'my-context' }))
            .toThrow('my-context');
    });

    it('includes context string in not-object error', () => {
        expect(() => parseAIJsonResponse('[1]', { context: 'my-context' }))
            .toThrow('my-context');
    });
});

describe('attemptJsonRepair', () => {
    it('fixes trailing commas', () => {
        const result = attemptJsonRepair('{"key": "value",}');
        expect(result).not.toBeNull();
        expect(JSON.parse(result!)).toEqual({ key: 'value' });
    });

    it('fixes single quotes', () => {
        const result = attemptJsonRepair("{'key': 'value'}");
        expect(result).not.toBeNull();
        expect(JSON.parse(result!)).toEqual({ key: 'value' });
    });

    it('fixes unquoted keys', () => {
        const result = attemptJsonRepair('{key: "value"}');
        expect(result).not.toBeNull();
        expect(JSON.parse(result!)).toEqual({ key: 'value' });
    });

    it('returns null for unfixable JSON', () => {
        const result = attemptJsonRepair('{{{totally broken');
        expect(result).toBeNull();
    });
});
