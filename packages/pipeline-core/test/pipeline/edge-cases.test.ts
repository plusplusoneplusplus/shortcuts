/**
 * Edge case tests for AI response parsing
 */

import { describe, it, expect } from 'vitest';
import { parseAIResponse, extractJSON } from '../../src/pipeline';

describe('AI Response Edge Cases', () => {
    describe('extractJSON', () => {
        it('handles response with explanation before JSON', () => {
            const response = `Here's my analysis:
            
{"severity": "high", "category": "bug"}

Hope this helps!`;
            const json = extractJSON(response);
            expect(json).toBeTruthy();
            expect(json).toContain('severity');
        });

        it('handles JSON in code block with language tag', () => {
            const response = '```json\n{"severity": "high"}\n```';
            const json = extractJSON(response);
            expect(json).toBeTruthy();
            const parsed = JSON.parse(json!);
            expect(parsed.severity).toBe('high');
        });

        it('handles JSON in code block without language tag', () => {
            const response = '```\n{"severity": "high"}\n```';
            const json = extractJSON(response);
            expect(json).toBeTruthy();
        });

        it('handles key-value pairs without JSON', () => {
            const response = `severity: high
category: bug
effort: 5`;
            const json = extractJSON(response);
            expect(json).toBeTruthy();
            const parsed = JSON.parse(json!);
            expect(parsed.severity).toBe('high');
            expect(parsed.category).toBe('bug');
        });

        it('handles malformed JSON with trailing comma', () => {
            const response = '{"severity": "high", "category": "bug",}';
            const json = extractJSON(response);
            // Should still extract it, parseAIResponse will fix it
            expect(json).toBeTruthy();
        });

        it('handles nested JSON objects', () => {
            const response = '{"severity": "high", "details": {"category": "bug"}}';
            const json = extractJSON(response);
            expect(json).toBeTruthy();
            const parsed = JSON.parse(json!);
            expect(parsed.severity).toBe('high');
        });

        it('returns null for completely invalid response', () => {
            const response = 'This is just plain text with no structure';
            const json = extractJSON(response);
            // Will return null, and parseAIResponse will try natural language extraction
            expect(json).toBeNull();
        });
    });

    describe('parseAIResponse', () => {
        it('parses standard JSON response', () => {
            const response = '{"severity": "high", "category": "bug"}';
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('handles missing fields', () => {
            const response = '{"severity": "high"}';
            const result = parseAIResponse(response, ['severity', 'category', 'effort']);
            expect(result.severity).toBe('high');
            expect(result.category).toBeNull();
            expect(result.effort).toBeNull();
        });

        it('handles case-insensitive field matching', () => {
            const response = '{"Severity": "high", "CATEGORY": "bug"}';
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('coerces boolean strings', () => {
            const response = '{"urgent": "true", "resolved": "false"}';
            const result = parseAIResponse(response, ['urgent', 'resolved']);
            expect(result.urgent).toBe(true);
            expect(result.resolved).toBe(false);
        });

        it('coerces number strings', () => {
            const response = '{"effort": "5", "priority": "3.5"}';
            const result = parseAIResponse(response, ['effort', 'priority']);
            expect(result.effort).toBe(5);
            expect(result.priority).toBe(3.5);
        });

        it('handles single quotes instead of double quotes', () => {
            const response = "{'severity': 'high', 'category': 'bug'}";
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('handles array with single object', () => {
            const response = '[{"severity": "high", "category": "bug"}]';
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('handles array of field-value pairs', () => {
            const response = '[{"field": "severity", "value": "high"}, {"field": "category", "value": "bug"}]';
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('extracts from natural language with colons', () => {
            const response = `Based on my analysis:
severity: high
category: bug
This is a critical issue.`;
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('extracts from natural language with "is"', () => {
            const response = `The severity is high and the category is bug`;
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('extracts from markdown formatted response', () => {
            const response = `**severity**: high
**category**: bug`;
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('handles null values correctly', () => {
            const response = '{"severity": null, "category": "n/a", "effort": "none"}';
            const result = parseAIResponse(response, ['severity', 'category', 'effort']);
            expect(result.severity).toBeNull();
            expect(result.category).toBeNull();
            expect(result.effort).toBeNull();
        });

        it('handles extra fields in response', () => {
            const response = '{"severity": "high", "category": "bug", "extra": "ignored", "another": "field"}';
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
            expect(Object.keys(result).length).toBe(2);
        });

        it('handles unquoted keys', () => {
            const response = '{severity: "high", category: "bug"}';
            const result = parseAIResponse(response, ['severity', 'category']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('bug');
        });

        it('handles JSON with explanation and code block', () => {
            const response = `I've analyzed the issue:

\`\`\`json
{
    "severity": "high",
    "category": "security",
    "effort": 8
}
\`\`\`

This requires immediate attention.`;
            const result = parseAIResponse(response, ['severity', 'category', 'effort']);
            expect(result.severity).toBe('high');
            expect(result.category).toBe('security');
            expect(result.effort).toBe(8);
        });
    });
});
