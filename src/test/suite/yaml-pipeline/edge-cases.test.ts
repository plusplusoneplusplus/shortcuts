/**
 * Edge case tests for AI response parsing
 */

import * as assert from 'assert';
import { parseAIResponse, extractJSON } from '../../../shortcuts/yaml-pipeline/template';

suite('AI Response Edge Cases', () => {
    suite('extractJSON', () => {
        test('handles response with explanation before JSON', () => {
            const response = `Here's my analysis:
            
{"severity": "high", "category": "bug"}

Hope this helps!`;
            const json = extractJSON(response);
            assert.ok(json);
            assert.ok(json.includes('severity'));
        });

        test('handles JSON in code block with language tag', () => {
            const response = '```json\n{"severity": "high"}\n```';
            const json = extractJSON(response);
            assert.ok(json);
            const parsed = JSON.parse(json!);
            assert.strictEqual(parsed.severity, 'high');
        });

        test('handles JSON in code block without language tag', () => {
            const response = '```\n{"severity": "high"}\n```';
            const json = extractJSON(response);
            assert.ok(json);
        });

        test('handles key-value pairs without JSON', () => {
            const response = `severity: high
category: bug
effort: 5`;
            const json = extractJSON(response);
            assert.ok(json);
            const parsed = JSON.parse(json!);
            assert.strictEqual(parsed.severity, 'high');
            assert.strictEqual(parsed.category, 'bug');
        });

        test('handles malformed JSON with trailing comma', () => {
            const response = '{"severity": "high", "category": "bug",}';
            const json = extractJSON(response);
            // Should still extract it, parseAIResponse will fix it
            assert.ok(json);
        });

        test('handles nested JSON objects', () => {
            const response = '{"severity": "high", "details": {"category": "bug"}}';
            const json = extractJSON(response);
            assert.ok(json);
            const parsed = JSON.parse(json!);
            assert.strictEqual(parsed.severity, 'high');
        });

        test('returns null for completely invalid response', () => {
            const response = 'This is just plain text with no structure';
            const json = extractJSON(response);
            // Will return null, and parseAIResponse will try natural language extraction
            assert.strictEqual(json, null);
        });
    });

    suite('parseAIResponse', () => {
        test('parses standard JSON response', () => {
            const response = '{"severity": "high", "category": "bug"}';
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('handles missing fields', () => {
            const response = '{"severity": "high"}';
            const result = parseAIResponse(response, ['severity', 'category', 'effort']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, null);
            assert.strictEqual(result.effort, null);
        });

        test('handles case-insensitive field matching', () => {
            const response = '{"Severity": "high", "CATEGORY": "bug"}';
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('coerces boolean strings', () => {
            const response = '{"urgent": "true", "resolved": "false"}';
            const result = parseAIResponse(response, ['urgent', 'resolved']);
            assert.strictEqual(result.urgent, true);
            assert.strictEqual(result.resolved, false);
        });

        test('coerces number strings', () => {
            const response = '{"effort": "5", "priority": "3.5"}';
            const result = parseAIResponse(response, ['effort', 'priority']);
            assert.strictEqual(result.effort, 5);
            assert.strictEqual(result.priority, 3.5);
        });

        test('handles single quotes instead of double quotes', () => {
            const response = "{'severity': 'high', 'category': 'bug'}";
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('handles array with single object', () => {
            const response = '[{"severity": "high", "category": "bug"}]';
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('handles array of field-value pairs', () => {
            const response = '[{"field": "severity", "value": "high"}, {"field": "category", "value": "bug"}]';
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('extracts from natural language with colons', () => {
            const response = `Based on my analysis:
severity: high
category: bug
This is a critical issue.`;
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('extracts from natural language with "is"', () => {
            const response = `The severity is high and the category is bug`;
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('extracts from markdown formatted response', () => {
            const response = `**severity**: high
**category**: bug`;
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('handles null values correctly', () => {
            const response = '{"severity": null, "category": "n/a", "effort": "none"}';
            const result = parseAIResponse(response, ['severity', 'category', 'effort']);
            assert.strictEqual(result.severity, null);
            assert.strictEqual(result.category, null);
            assert.strictEqual(result.effort, null);
        });

        test('handles extra fields in response', () => {
            const response = '{"severity": "high", "category": "bug", "extra": "ignored", "another": "field"}';
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
            assert.strictEqual(Object.keys(result).length, 2);
        });

        test('handles unquoted keys', () => {
            const response = '{severity: "high", category: "bug"}';
            const result = parseAIResponse(response, ['severity', 'category']);
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'bug');
        });

        test('handles JSON with explanation and code block', () => {
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
            assert.strictEqual(result.severity, 'high');
            assert.strictEqual(result.category, 'security');
            assert.strictEqual(result.effort, 8);
        });
    });
});
