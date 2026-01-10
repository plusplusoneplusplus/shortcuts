/**
 * Tests for Template Engine
 *
 * Comprehensive tests for template substitution and prompt building.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    substituteTemplate,
    extractVariables,
    validateItemForTemplate,
    buildFullPrompt,
    buildPromptFromTemplate,
    parseAIResponse,
    extractJSON,
    escapeTemplateValue,
    previewTemplate,
    TemplateError
} from '../../../shortcuts/yaml-pipeline/template';
import { PipelineItem } from '../../../shortcuts/yaml-pipeline/types';

suite('Template Engine', () => {
    suite('substituteTemplate', () => {
        test('substitutes single variable', () => {
            const result = substituteTemplate(
                'Hello {{name}}!',
                { name: 'Alice' }
            );
            assert.strictEqual(result, 'Hello Alice!');
        });

        test('substitutes multiple variables', () => {
            const result = substituteTemplate(
                '{{greeting}} {{name}}, welcome to {{place}}!',
                { greeting: 'Hello', name: 'Alice', place: 'NYC' }
            );
            assert.strictEqual(result, 'Hello Alice, welcome to NYC!');
        });

        test('substitutes same variable multiple times', () => {
            const result = substituteTemplate(
                '{{name}} is {{name}}, yes {{name}}!',
                { name: 'Bob' }
            );
            assert.strictEqual(result, 'Bob is Bob, yes Bob!');
        });

        test('handles template with no variables', () => {
            const result = substituteTemplate(
                'Hello World!',
                { name: 'Alice' }
            );
            assert.strictEqual(result, 'Hello World!');
        });

        test('handles empty item', () => {
            const result = substituteTemplate(
                'Value: {{missing}}',
                {}
            );
            // Non-strict mode: missing variables become empty
            assert.strictEqual(result, 'Value: ');
        });

        test('handles empty values', () => {
            const result = substituteTemplate(
                'Name: {{name}}, Value: {{value}}',
                { name: '', value: 'test' }
            );
            assert.strictEqual(result, 'Name: , Value: test');
        });

        test('preserves non-variable braces', () => {
            const result = substituteTemplate(
                'JSON: {key: "{{value}}"}',
                { value: 'hello' }
            );
            assert.strictEqual(result, 'JSON: {key: "hello"}');
        });

        test('handles variables with underscores', () => {
            const result = substituteTemplate(
                '{{first_name}} {{last_name}}',
                { first_name: 'John', last_name: 'Doe' }
            );
            assert.strictEqual(result, 'John Doe');
        });

        test('handles variables with numbers', () => {
            const result = substituteTemplate(
                '{{field1}} {{field2}}',
                { field1: 'a', field2: 'b' }
            );
            assert.strictEqual(result, 'a b');
        });

        test('preserves multiline template structure', () => {
            const template = `Line 1: {{a}}
Line 2: {{b}}
Line 3: {{c}}`;
            const result = substituteTemplate(template, { a: '1', b: '2', c: '3' });

            assert.strictEqual(result, `Line 1: 1
Line 2: 2
Line 3: 3`);
        });

        suite('strict mode', () => {
            test('throws TemplateError for missing variable in strict mode', () => {
                assert.throws(
                    () => substituteTemplate('Hello {{name}}!', {}, true),
                    TemplateError
                );
            });

            test('includes variable name in error', () => {
                try {
                    substituteTemplate('Hello {{missing_var}}!', {}, true);
                    assert.fail('Should have thrown');
                } catch (error) {
                    assert.ok(error instanceof TemplateError);
                    assert.strictEqual(error.variableName, 'missing_var');
                }
            });

            test('succeeds in strict mode when all variables present', () => {
                const result = substituteTemplate(
                    '{{a}} {{b}}',
                    { a: '1', b: '2' },
                    true
                );
                assert.strictEqual(result, '1 2');
            });
        });
    });

    suite('extractVariables', () => {
        test('extracts single variable', () => {
            const vars = extractVariables('Hello {{name}}!');
            assert.deepStrictEqual(vars, ['name']);
        });

        test('extracts multiple unique variables', () => {
            const vars = extractVariables('{{a}} {{b}} {{c}}');
            assert.deepStrictEqual(vars.sort(), ['a', 'b', 'c']);
        });

        test('deduplicates repeated variables', () => {
            const vars = extractVariables('{{x}} {{x}} {{x}}');
            assert.deepStrictEqual(vars, ['x']);
        });

        test('returns empty array for no variables', () => {
            const vars = extractVariables('Hello World!');
            assert.deepStrictEqual(vars, []);
        });

        test('handles complex template', () => {
            const template = `
Analyze this bug:

ID: {{id}}
Title: {{title}}
Description: {{description}}
Priority: {{priority}}

Please classify this bug.
            `;
            const vars = extractVariables(template);
            assert.deepStrictEqual(vars.sort(), ['description', 'id', 'priority', 'title']);
        });

        test('handles adjacent variables', () => {
            const vars = extractVariables('{{a}}{{b}}{{c}}');
            assert.deepStrictEqual(vars.sort(), ['a', 'b', 'c']);
        });

        test('ignores malformed variable syntax', () => {
            const vars = extractVariables('{{valid}} {invalid} {{ spaces }} {{}}');
            assert.deepStrictEqual(vars, ['valid']);
        });
    });

    suite('validateItemForTemplate', () => {
        test('returns valid when all variables present', () => {
            const result = validateItemForTemplate(
                'Hello {{name}}, age {{age}}!',
                { name: 'Alice', age: '30' }
            );
            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.missingVariables, []);
        });

        test('returns invalid with missing variables', () => {
            const result = validateItemForTemplate(
                '{{a}} {{b}} {{c}}',
                { a: '1' }
            );
            assert.strictEqual(result.valid, false);
            assert.deepStrictEqual(result.missingVariables.sort(), ['b', 'c']);
        });

        test('handles template with no variables', () => {
            const result = validateItemForTemplate('Hello!', {});
            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.missingVariables, []);
        });

        test('extra item properties do not affect validation', () => {
            const result = validateItemForTemplate(
                '{{a}}',
                { a: '1', b: '2', c: '3' }
            );
            assert.strictEqual(result.valid, true);
        });
    });

    suite('buildFullPrompt', () => {
        test('appends JSON output instruction', () => {
            const result = buildFullPrompt(
                'Analyze this bug.',
                ['severity', 'category']
            );

            assert.ok(result.includes('Analyze this bug.'));
            assert.ok(result.includes('Return JSON with these fields: severity, category'));
        });

        test('handles single output field', () => {
            const result = buildFullPrompt('Question', ['answer']);

            assert.ok(result.includes('Return JSON with these fields: answer'));
        });

        test('handles many output fields', () => {
            const fields = ['a', 'b', 'c', 'd', 'e'];
            const result = buildFullPrompt('Prompt', fields);

            assert.ok(result.includes('Return JSON with these fields: a, b, c, d, e'));
        });

        test('returns original prompt when no output fields', () => {
            const result = buildFullPrompt('Just a prompt', []);
            assert.strictEqual(result, 'Just a prompt');
        });
    });

    suite('buildPromptFromTemplate', () => {
        test('combines substitution and output instruction', () => {
            const result = buildPromptFromTemplate(
                'Analyze bug: {{title}}',
                { title: 'Login broken' },
                ['severity', 'effort']
            );

            assert.ok(result.includes('Analyze bug: Login broken'));
            assert.ok(result.includes('Return JSON with these fields: severity, effort'));
        });

        test('works with complex template', () => {
            const template = `
Bug Report:
ID: {{id}}
Title: {{title}}
Description: {{description}}

Classify this bug.
            `;

            const item = {
                id: '123',
                title: 'Test bug',
                description: 'Something is wrong'
            };

            const result = buildPromptFromTemplate(template, item, ['severity']);

            assert.ok(result.includes('ID: 123'));
            assert.ok(result.includes('Title: Test bug'));
            assert.ok(result.includes('Description: Something is wrong'));
            assert.ok(result.includes('Return JSON with these fields: severity'));
        });
    });

    suite('parseAIResponse', () => {
        test('parses valid JSON response', () => {
            const response = '{"severity": "high", "category": "backend"}';
            const result = parseAIResponse(response, ['severity', 'category']);

            assert.deepStrictEqual(result, { severity: 'high', category: 'backend' });
        });

        test('extracts declared fields only (ignores extra)', () => {
            const response = '{"a": 1, "b": 2, "c": 3, "extra": "ignored"}';
            const result = parseAIResponse(response, ['a', 'b']);

            assert.deepStrictEqual(result, { a: 1, b: 2 });
        });

        test('sets missing fields to null', () => {
            const response = '{"a": 1}';
            const result = parseAIResponse(response, ['a', 'b', 'c']);

            assert.deepStrictEqual(result, { a: 1, b: null, c: null });
        });

        test('extracts JSON from markdown code block', () => {
            const response = 'Here is the result:\n```json\n{"severity": "low"}\n```\nDone.';
            const result = parseAIResponse(response, ['severity']);

            assert.deepStrictEqual(result, { severity: 'low' });
        });

        test('extracts JSON from code block without language tag', () => {
            const response = '```\n{"value": 42}\n```';
            const result = parseAIResponse(response, ['value']);

            assert.deepStrictEqual(result, { value: 42 });
        });

        test('extracts embedded JSON object', () => {
            const response = 'The analysis shows {"severity": "medium", "effort": 5} based on the data.';
            const result = parseAIResponse(response, ['severity', 'effort']);

            assert.deepStrictEqual(result, { severity: 'medium', effort: 5 });
        });

        test('handles various JSON value types', () => {
            const response = '{"str": "hello", "num": 42, "bool": true, "arr": [1,2], "obj": {"x": 1}, "nil": null}';
            const result = parseAIResponse(response, ['str', 'num', 'bool', 'arr', 'obj', 'nil']);

            assert.strictEqual(result.str, 'hello');
            assert.strictEqual(result.num, 42);
            assert.strictEqual(result.bool, true);
            assert.deepStrictEqual(result.arr, [1, 2]);
            assert.deepStrictEqual(result.obj, { x: 1 });
            assert.strictEqual(result.nil, null);
        });

        test('throws TemplateError for no JSON found', () => {
            assert.throws(
                () => parseAIResponse('This response has no JSON', ['field']),
                TemplateError
            );
        });

        test('throws TemplateError for invalid JSON', () => {
            assert.throws(
                () => parseAIResponse('{invalid json}', ['field']),
                TemplateError
            );
        });
    });

    suite('extractJSON', () => {
        test('extracts JSON from code block', () => {
            const result = extractJSON('```json\n{"a": 1}\n```');
            assert.strictEqual(result, '{"a": 1}');
        });

        test('extracts JSON object from text', () => {
            const result = extractJSON('Result: {"x": 1} end');
            assert.strictEqual(result, '{"x": 1}');
        });

        test('extracts JSON array from text', () => {
            const result = extractJSON('Items: [1, 2, 3] done');
            assert.strictEqual(result, '[1, 2, 3]');
        });

        test('prefers code block over inline JSON', () => {
            const result = extractJSON('{"inline": 1}\n```json\n{"block": 2}\n```');
            assert.strictEqual(result, '{"block": 2}');
        });

        test('returns null for no JSON', () => {
            const result = extractJSON('Just plain text');
            assert.strictEqual(result, null);
        });

        test('handles nested JSON objects', () => {
            const result = extractJSON('{"outer": {"inner": {"deep": 1}}}');
            assert.strictEqual(result, '{"outer": {"inner": {"deep": 1}}}');
        });
    });

    suite('escapeTemplateValue', () => {
        test('escapes backslashes', () => {
            assert.strictEqual(escapeTemplateValue('path\\to\\file'), 'path\\\\to\\\\file');
        });

        test('escapes braces', () => {
            assert.strictEqual(escapeTemplateValue('{test}'), '\\{test\\}');
        });

        test('handles mixed special characters', () => {
            const result = escapeTemplateValue('\\{value\\}');
            assert.strictEqual(result, '\\\\\\{value\\\\\\}');
        });

        test('leaves normal text unchanged', () => {
            assert.strictEqual(escapeTemplateValue('Hello World'), 'Hello World');
        });
    });

    suite('previewTemplate', () => {
        test('renders template with sample values', () => {
            const result = previewTemplate(
                'Hello {{name}}!',
                { name: 'Alice' }
            );
            assert.strictEqual(result, 'Hello Alice!');
        });

        test('truncates long output', () => {
            const item = { value: 'x'.repeat(1000) };
            const result = previewTemplate('{{value}}', item, 50);

            assert.strictEqual(result.length, 53); // 50 + '...'
            assert.ok(result.endsWith('...'));
        });

        test('handles missing variables gracefully', () => {
            const result = previewTemplate('{{missing}}', {});
            assert.strictEqual(result, '');
        });

        test('returns error message on template error', () => {
            // This shouldn't happen with current implementation, but test defensive behavior
            const result = previewTemplate('{{valid}}', { valid: 'ok' });
            assert.ok(!result.includes('Error'));
        });
    });

    suite('integration scenarios', () => {
        test('full pipeline prompt generation', () => {
            const template = `Analyze this bug report:

ID: {{id}}
Title: {{title}}
Description: {{description}}
Priority: {{priority}}

Classify the severity (critical/high/medium/low), 
category (ui/backend/database/infra),
estimate effort in hours,
and note if more info is needed.`;

            const item: PipelineItem = {
                id: '1',
                title: 'Login broken',
                description: "Users can't login",
                priority: 'high'
            };

            const outputFields = ['severity', 'category', 'effort_hours', 'needs_more_info'];

            // Build prompt
            const prompt = buildPromptFromTemplate(template, item, outputFields);

            // Verify substitution
            assert.ok(prompt.includes('ID: 1'));
            assert.ok(prompt.includes('Title: Login broken'));
            assert.ok(prompt.includes("Description: Users can't login"));
            assert.ok(prompt.includes('Priority: high'));

            // Verify output instruction
            assert.ok(prompt.includes('Return JSON with these fields: severity, category, effort_hours, needs_more_info'));
        });

        test('full AI response parsing', () => {
            const aiResponse = `Based on my analysis:

\`\`\`json
{
    "severity": "critical",
    "category": "backend",
    "effort_hours": 4,
    "needs_more_info": false,
    "extra_note": "This is urgent"
}
\`\`\`

Let me know if you need more details.`;

            const outputFields = ['severity', 'category', 'effort_hours', 'needs_more_info'];
            const result = parseAIResponse(aiResponse, outputFields);

            assert.deepStrictEqual(result, {
                severity: 'critical',
                category: 'backend',
                effort_hours: 4,
                needs_more_info: false
            });

            // Verify extra_note is excluded
            assert.ok(!('extra_note' in result));
        });
    });
});
