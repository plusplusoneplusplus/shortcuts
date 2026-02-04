/**
 * Comprehensive tests for AI response parser
 * Includes tests for bracket matcher abstraction
 */

import { describe, it, expect } from 'vitest';
import { parseAIResponse, extractJSON } from '../../src/pipeline';

describe('AI Response Parser', () => {
    describe('extractJSON', () => {
        describe('basic extraction', () => {
            it('extracts simple JSON object', () => {
                const json = extractJSON('{"key": "value"}');
                expect(json).toBe('{"key": "value"}');
            });

            it('extracts simple JSON array', () => {
                const json = extractJSON('[1, 2, 3]');
                expect(json).toBe('[1, 2, 3]');
            });

            it('returns null for empty string', () => {
                expect(extractJSON('')).toBeNull();
            });

            it('returns null for null input', () => {
                expect(extractJSON(null as any)).toBeNull();
            });

            it('returns null for non-string input', () => {
                expect(extractJSON(123 as any)).toBeNull();
            });
        });

        describe('bracket matching - objects', () => {
            it('handles nested objects', () => {
                const input = '{"outer": {"inner": {"deep": "value"}}}';
                const json = extractJSON(input);
                expect(json).toBe(input);
                expect(JSON.parse(json!)).toEqual({outer: {inner: {deep: "value"}}});
            });

            it('handles objects with arrays inside', () => {
                const input = '{"items": [1, 2, [3, 4]], "nested": {"arr": [5]}}';
                const json = extractJSON(input);
                expect(json).toBe(input);
            });

            it('handles multiple top-level objects - extracts greedy match', () => {
                const input = '{"first": 1} some text {"second": 2}';
                const json = extractJSON(input);
                // Regex is greedy, so it matches from first { to last }
                // The positions-based fallback will find valid JSON
                expect(json).toBeTruthy();
            });

            it('extracts object after explanation text', () => {
                const input = 'Here is the result:\n\n{"severity": "high"}';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({severity: "high"});
            });

            it('rejects malformed braces without colon (not valid JSON object)', () => {
                const input = '{invalid without colon}';
                const json = extractJSON(input);
                // Should return null since it has no colon (doesn't look like JSON)
                expect(json).toBeNull();
            });

            it('returns balanced braces with colon for potential JSON fix', () => {
                const input = '{key: "value"}';  // unquoted key
                const json = extractJSON(input);
                expect(json).toBeTruthy();
            });
        });

        describe('bracket matching - arrays', () => {
            it('handles nested arrays', () => {
                const input = '[[1, 2], [3, [4, 5]], 6]';
                const json = extractJSON(input);
                expect(json).toBe(input);
            });

            it('handles arrays with objects inside', () => {
                const input = '[{"a": 1}, {"b": [2, 3]}]';
                const json = extractJSON(input);
                expect(json).toBe(input);
            });

            it('handles array of arrays of arrays', () => {
                const input = '[[[1]]]';
                const json = extractJSON(input);
                expect(json).toBe(input);
            });

            it('extracts array after explanation text', () => {
                const input = 'The results are:\n\n[1, 2, 3]';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual([1, 2, 3]);
            });

            it('handles empty array', () => {
                const input = '[]';
                const json = extractJSON(input);
                expect(json).toBe('[]');
            });
        });

        describe('bracket matching - mixed structures', () => {
            it('prefers array when array appears first', () => {
                const input = '[1, 2] before {"key": "value"}';
                const json = extractJSON(input);
                expect(json).toBe('[1, 2]');
            });

            it('prefers object when object appears first', () => {
                const input = '{"key": "value"} before [1, 2]';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({key: "value"});
            });

            it('handles deeply nested mixed structures', () => {
                const input = '{"data": [{"items": [1, {"nested": true}]}, "string"]}';
                const json = extractJSON(input);
                expect(json).toBe(input);
            });
        });

        describe('bracket matching - malformed input', () => {
            it('returns null for unbalanced braces with too many opens', () => {
                // The regex matches from first { to last }, but that's not valid JSON
                // and the balanced check fails
                const input = '{{{"key": "value"}';
                const json = extractJSON(input);
                // Cannot find balanced valid JSON, so falls back to other extraction
                expect(json).toBeNull();
            });

            it('handles unbalanced braces - too many close', () => {
                const input = '{"key": "value"}}}';
                const json = extractJSON(input);
                expect(json).toBeTruthy();
                expect(JSON.parse(json!)).toEqual({key: "value"});
            });

            it('returns null for unbalanced brackets with too many opens', () => {
                // Similar to braces case - cannot find valid balanced JSON
                const input = '[[[1, 2, 3]';
                const json = extractJSON(input);
                expect(json).toBeNull();
            });

            it('handles unbalanced brackets - too many close', () => {
                const input = '[1, 2, 3]]]';
                const json = extractJSON(input);
                expect(json).toBeTruthy();
                expect(JSON.parse(json!)).toEqual([1, 2, 3]);
            });

            it('finds valid JSON among garbage', () => {
                const input = 'garbage { not valid } more {"valid": true} end';
                const json = extractJSON(input);
                expect(json).toBeTruthy();
                expect(JSON.parse(json!)).toEqual({valid: true});
            });
        });

        describe('bracket matching - edge cases', () => {
            it('handles brackets in strings correctly', () => {
                const input = '{"text": "array [1,2] and object {a:1}"}';
                const json = extractJSON(input);
                expect(json).toBe(input);
            });

            it('handles escaped quotes in strings', () => {
                const input = '{"quote": "He said \\"hello\\""}';
                const json = extractJSON(input);
                expect(json).toBe(input);
            });

            it('handles empty object - valid JSON', () => {
                const input = '{}';
                const json = extractJSON(input);
                // Empty object is valid JSON and passes JSON.parse
                expect(json).toBe('{}');
            });

            it('handles whitespace within JSON', () => {
                const input = '{\n  "key": \n    "value"\n}';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({key: "value"});
            });

            it('handles unicode in JSON', () => {
                const input = '{"emoji": "🎉", "chinese": "中文"}';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({emoji: "🎉", chinese: "中文"});
            });
        });

        describe('code block extraction', () => {
            it('extracts from json code block', () => {
                const input = '```json\n{"key": "value"}\n```';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({key: "value"});
            });

            it('extracts from javascript code block', () => {
                const input = '```javascript\n{"key": "value"}\n```';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({key: "value"});
            });

            it('extracts from js code block', () => {
                const input = '```js\n[1, 2, 3]\n```';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual([1, 2, 3]);
            });

            it('extracts from plain code block', () => {
                const input = '```\n{"key": "value"}\n```';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({key: "value"});
            });

            it('ignores code block with non-JSON content', () => {
                const input = '```\nconst x = 5;\n```\n{"key": "value"}';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({key: "value"});
            });

            it('prefers code block over inline JSON', () => {
                const input = '{"inline": true} ```json\n{"codeblock": true}\n```';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({codeblock: true});
            });
        });

        describe('key-value pair extraction', () => {
            it('extracts key-value pairs with colons', () => {
                const input = 'severity: high\ncategory: bug';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({severity: "high", category: "bug"});
            });

            it('extracts key-value pairs with equals', () => {
                const input = 'severity = high\ncategory = bug';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({severity: "high", category: "bug"});
            });

            it('strips quotes from values', () => {
                const input = 'severity: "high"\ncategory: \'bug\'';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({severity: "high", category: "bug"});
            });

            it('strips trailing punctuation', () => {
                const input = 'severity: high,\ncategory: bug;';
                const json = extractJSON(input);
                expect(JSON.parse(json!)).toEqual({severity: "high", category: "bug"});
            });
        });
    });

    describe('parseAIResponse', () => {
        describe('field extraction', () => {
            it('extracts all requested fields that exist', () => {
                const response = '{"a": 1, "b": 2, "c": 3}';
                const result = parseAIResponse(response, ['a', 'c']);
                // Both a and c exist in the response and are extracted
                expect(result).toEqual({a: 1, c: 3});
            });

            it('returns null for missing fields', () => {
                const response = '{"a": 1}';
                const result = parseAIResponse(response, ['a', 'b', 'c']);
                expect(result).toEqual({a: 1, b: null, c: null});
            });

            it('handles case-insensitive field matching', () => {
                const response = '{"SEVERITY": "high", "Category": "bug"}';
                const result = parseAIResponse(response, ['severity', 'category']);
                expect(result.severity).toBe('high');
                expect(result.category).toBe('bug');
            });
        });

        describe('value coercion', () => {
            it('coerces "true" to boolean', () => {
                const response = '{"flag": "true"}';
                const result = parseAIResponse(response, ['flag']);
                expect(result.flag).toBe(true);
            });

            it('coerces "false" to boolean', () => {
                const response = '{"flag": "false"}';
                const result = parseAIResponse(response, ['flag']);
                expect(result.flag).toBe(false);
            });

            it('coerces "yes" to boolean', () => {
                const response = '{"flag": "yes"}';
                const result = parseAIResponse(response, ['flag']);
                expect(result.flag).toBe(true);
            });

            it('coerces "no" to boolean', () => {
                const response = '{"flag": "no"}';
                const result = parseAIResponse(response, ['flag']);
                expect(result.flag).toBe(false);
            });

            it('coerces numeric strings to numbers', () => {
                const response = '{"count": "42", "ratio": "3.14"}';
                const result = parseAIResponse(response, ['count', 'ratio']);
                expect(result.count).toBe(42);
                expect(result.ratio).toBe(3.14);
            });

            it('coerces negative numbers', () => {
                const response = '{"value": "-5"}';
                const result = parseAIResponse(response, ['value']);
                expect(result.value).toBe(-5);
            });

            it('coerces null-like strings to null', () => {
                const response = '{"a": "null", "b": "none", "c": "n/a", "d": ""}';
                const result = parseAIResponse(response, ['a', 'b', 'c', 'd']);
                expect(result.a).toBeNull();
                expect(result.b).toBeNull();
                expect(result.c).toBeNull();
                expect(result.d).toBeNull();
            });

            it('preserves non-coercible strings', () => {
                const response = '{"text": "hello world"}';
                const result = parseAIResponse(response, ['text']);
                expect(result.text).toBe('hello world');
            });
        });

        describe('array handling', () => {
            it('unwraps single-element array', () => {
                const response = '[{"severity": "high"}]';
                const result = parseAIResponse(response, ['severity']);
                expect(result.severity).toBe('high');
            });

            it('reconstructs from field-value pairs', () => {
                const response = '[{"field": "severity", "value": "high"}, {"field": "category", "value": "bug"}]';
                const result = parseAIResponse(response, ['severity', 'category']);
                expect(result.severity).toBe('high');
                expect(result.category).toBe('bug');
            });

            it('reconstructs from key-value pairs with multiple items', () => {
                // Single item array gets unwrapped, need multiple items to test key-value reconstruction
                const response = '[{"key": "severity", "value": "high"}, {"key": "category", "value": "bug"}]';
                const result = parseAIResponse(response, ['severity', 'category']);
                expect(result.severity).toBe('high');
                expect(result.category).toBe('bug');
            });

            it('throws for non-reconstructible array', () => {
                const response = '[1, 2, 3]';
                expect(() => parseAIResponse(response, ['a'])).toThrow('AI returned array instead of object');
            });
        });

        describe('JSON fixing', () => {
            it('fixes single quotes', () => {
                const response = "{'severity': 'high'}";
                const result = parseAIResponse(response, ['severity']);
                expect(result.severity).toBe('high');
            });

            it('fixes unquoted keys', () => {
                const response = '{severity: "high"}';
                const result = parseAIResponse(response, ['severity']);
                expect(result.severity).toBe('high');
            });

            it('fixes trailing commas', () => {
                const response = '{"severity": "high",}';
                const result = parseAIResponse(response, ['severity']);
                expect(result.severity).toBe('high');
            });
        });

        describe('natural language fallback', () => {
            it('extracts from colon format', () => {
                const response = 'The severity: high and category: bug';
                const result = parseAIResponse(response, ['severity', 'category']);
                expect(result.severity).toBe('high');
                expect(result.category).toBe('bug');
            });

            it('extracts from "is" format', () => {
                const response = 'The severity is high and the category is bug';
                const result = parseAIResponse(response, ['severity', 'category']);
                expect(result.severity).toBe('high');
                expect(result.category).toBe('bug');
            });

            it('extracts from markdown bold format', () => {
                const response = '**severity**: high\n**category**: bug';
                const result = parseAIResponse(response, ['severity', 'category']);
                expect(result.severity).toBe('high');
                expect(result.category).toBe('bug');
            });

            it('extracts quoted values', () => {
                const response = 'severity: "high"';
                const result = parseAIResponse(response, ['severity']);
                expect(result.severity).toBe('high');
            });

            it('throws when no fields found', () => {
                const response = 'This is just plain text';
                expect(() => parseAIResponse(response, ['severity'])).toThrow('No JSON found');
            });
        });
    });
});
