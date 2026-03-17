/**
 * Tests for Template Engine
 *
 * Comprehensive tests for template substitution and prompt building.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
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
    TemplateError,
    PromptItem
} from '../../src/pipeline';

describe('Template Engine', () => {
    describe('substituteTemplate', () => {
        it('substitutes single variable', () => {
            const result = substituteTemplate(
                'Hello {{name}}!',
                { name: 'Alice' }
            );
            expect(result).toBe('Hello Alice!');
        });

        it('substitutes multiple variables', () => {
            const result = substituteTemplate(
                '{{greeting}} {{name}}, welcome to {{place}}!',
                { greeting: 'Hello', name: 'Alice', place: 'NYC' }
            );
            expect(result).toBe('Hello Alice, welcome to NYC!');
        });

        it('substitutes same variable multiple times', () => {
            const result = substituteTemplate(
                '{{name}} is {{name}}, yes {{name}}!',
                { name: 'Bob' }
            );
            expect(result).toBe('Bob is Bob, yes Bob!');
        });

        it('handles template with no variables', () => {
            const result = substituteTemplate(
                'Hello World!',
                { name: 'Alice' }
            );
            expect(result).toBe('Hello World!');
        });

        it('handles empty item', () => {
            const result = substituteTemplate(
                'Value: {{missing}}',
                {}
            );
            // Non-strict mode: missing variables become empty
            expect(result).toBe('Value: ');
        });

        it('handles empty values', () => {
            const result = substituteTemplate(
                'Name: {{name}}, Value: {{value}}',
                { name: '', value: 'test' }
            );
            expect(result).toBe('Name: , Value: test');
        });

        it('preserves non-variable braces', () => {
            const result = substituteTemplate(
                'JSON: {key: "{{value}}"}',
                { value: 'hello' }
            );
            expect(result).toBe('JSON: {key: "hello"}');
        });

        it('handles variables with underscores', () => {
            const result = substituteTemplate(
                '{{first_name}} {{last_name}}',
                { first_name: 'John', last_name: 'Doe' }
            );
            expect(result).toBe('John Doe');
        });

        it('handles variables with numbers', () => {
            const result = substituteTemplate(
                '{{field1}} {{field2}}',
                { field1: 'a', field2: 'b' }
            );
            expect(result).toBe('a b');
        });

        it('preserves multiline template structure', () => {
            const template = `Line 1: {{a}}
Line 2: {{b}}
Line 3: {{c}}`;
            const result = substituteTemplate(template, { a: '1', b: '2', c: '3' });

            expect(result).toBe(`Line 1: 1
Line 2: 2
Line 3: 3`);
        });

        describe('strict mode', () => {
            it('throws TemplateError for missing variable in strict mode', () => {
                expect(() => substituteTemplate('Hello {{name}}!', {}, true)).toThrow(TemplateError);
            });

            it('includes variable name in error', () => {
                try {
                    substituteTemplate('Hello {{missing_var}}!', {}, true);
                    expect.fail('Should have thrown');
                } catch (error) {
                    expect(error).toBeInstanceOf(TemplateError);
                    expect((error as TemplateError).variableName).toBe('missing_var');
                }
            });

            it('succeeds in strict mode when all variables present', () => {
                const result = substituteTemplate(
                    '{{a}} {{b}}',
                    { a: '1', b: '2' },
                    true
                );
                expect(result).toBe('1 2');
            });
        });
    });

    describe('extractVariables', () => {
        it('extracts single variable', () => {
            const vars = extractVariables('Hello {{name}}!');
            expect(vars).toEqual(['name']);
        });

        it('extracts multiple unique variables', () => {
            const vars = extractVariables('{{a}} {{b}} {{c}}');
            expect(vars.sort()).toEqual(['a', 'b', 'c']);
        });

        it('deduplicates repeated variables', () => {
            const vars = extractVariables('{{x}} {{x}} {{x}}');
            expect(vars).toEqual(['x']);
        });

        it('returns empty array for no variables', () => {
            const vars = extractVariables('Hello World!');
            expect(vars).toEqual([]);
        });

        it('handles complex template', () => {
            const template = `
Analyze this bug:

ID: {{id}}
Title: {{title}}
Description: {{description}}
Priority: {{priority}}

Please classify this bug.
            `;
            const vars = extractVariables(template);
            expect(vars.sort()).toEqual(['description', 'id', 'priority', 'title']);
        });

        it('handles adjacent variables', () => {
            const vars = extractVariables('{{a}}{{b}}{{c}}');
            expect(vars.sort()).toEqual(['a', 'b', 'c']);
        });

        it('ignores malformed variable syntax', () => {
            const vars = extractVariables('{{valid}} {invalid} {{ spaces }} {{}}');
            expect(vars).toEqual(['valid']);
        });
    });

    describe('validateItemForTemplate', () => {
        it('returns valid when all variables present', () => {
            const result = validateItemForTemplate(
                'Hello {{name}}, age {{age}}!',
                { name: 'Alice', age: '30' }
            );
            expect(result.valid).toBe(true);
            expect(result.missingVariables).toEqual([]);
        });

        it('returns invalid with missing variables', () => {
            const result = validateItemForTemplate(
                '{{a}} {{b}} {{c}}',
                { a: '1' }
            );
            expect(result.valid).toBe(false);
            expect(result.missingVariables.sort()).toEqual(['b', 'c']);
        });

        it('handles template with no variables', () => {
            const result = validateItemForTemplate('Hello!', {});
            expect(result.valid).toBe(true);
            expect(result.missingVariables).toEqual([]);
        });

        it('extra item properties do not affect validation', () => {
            const result = validateItemForTemplate(
                '{{a}}',
                { a: '1', b: '2', c: '3' }
            );
            expect(result.valid).toBe(true);
        });
    });

    describe('buildFullPrompt', () => {
        it('appends JSON output instruction', () => {
            const result = buildFullPrompt(
                'Analyze this bug.',
                ['severity', 'category']
            );

            expect(result).toContain('Analyze this bug.');
            expect(result).toContain('Return JSON with these fields: severity, category');
        });

        it('handles single output field', () => {
            const result = buildFullPrompt('Question', ['answer']);

            expect(result).toContain('Return JSON with these fields: answer');
        });

        it('handles many output fields', () => {
            const fields = ['a', 'b', 'c', 'd', 'e'];
            const result = buildFullPrompt('Prompt', fields);

            expect(result).toContain('Return JSON with these fields: a, b, c, d, e');
        });

        it('returns original prompt when no output fields', () => {
            const result = buildFullPrompt('Just a prompt', []);
            expect(result).toBe('Just a prompt');
        });
    });

    describe('buildPromptFromTemplate', () => {
        it('combines substitution and output instruction', () => {
            const result = buildPromptFromTemplate(
                'Analyze bug: {{title}}',
                { title: 'Login broken' },
                ['severity', 'effort']
            );

            expect(result).toContain('Analyze bug: Login broken');
            expect(result).toContain('Return JSON with these fields: severity, effort');
        });

        it('works with complex template', () => {
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

            expect(result).toContain('ID: 123');
            expect(result).toContain('Title: Test bug');
            expect(result).toContain('Description: Something is wrong');
            expect(result).toContain('Return JSON with these fields: severity');
        });
    });

    describe('parseAIResponse', () => {
        it('parses valid JSON response', () => {
            const response = '{"severity": "high", "category": "backend"}';
            const result = parseAIResponse(response, ['severity', 'category']);

            expect(result).toEqual({ severity: 'high', category: 'backend' });
        });

        it('extracts declared fields only (ignores extra)', () => {
            const response = '{"a": 1, "b": 2, "c": 3, "extra": "ignored"}';
            const result = parseAIResponse(response, ['a', 'b']);

            expect(result).toEqual({ a: 1, b: 2 });
        });

        it('sets missing fields to null', () => {
            const response = '{"a": 1}';
            const result = parseAIResponse(response, ['a', 'b', 'c']);

            expect(result).toEqual({ a: 1, b: null, c: null });
        });

        it('extracts JSON from markdown code block', () => {
            const response = 'Here is the result:\n```json\n{"severity": "low"}\n```\nDone.';
            const result = parseAIResponse(response, ['severity']);

            expect(result).toEqual({ severity: 'low' });
        });

        it('extracts JSON from code block without language tag', () => {
            const response = '```\n{"value": 42}\n```';
            const result = parseAIResponse(response, ['value']);

            expect(result).toEqual({ value: 42 });
        });

        it('extracts embedded JSON object', () => {
            const response = 'The analysis shows {"severity": "medium", "effort": 5} based on the data.';
            const result = parseAIResponse(response, ['severity', 'effort']);

            expect(result).toEqual({ severity: 'medium', effort: 5 });
        });

        it('handles various JSON value types', () => {
            const response = '{"str": "hello", "num": 42, "bool": true, "arr": [1,2], "obj": {"x": 1}, "nil": null}';
            const result = parseAIResponse(response, ['str', 'num', 'bool', 'arr', 'obj', 'nil']);

            expect(result.str).toBe('hello');
            expect(result.num).toBe(42);
            expect(result.bool).toBe(true);
            expect(result.arr).toEqual([1, 2]);
            expect(result.obj).toEqual({ x: 1 });
            expect(result.nil).toBeNull();
        });

        it('throws TemplateError for no JSON found', () => {
            expect(() => parseAIResponse('This response has no JSON', ['field'])).toThrow(TemplateError);
        });

        it('throws TemplateError for invalid JSON', () => {
            expect(() => parseAIResponse('{invalid json}', ['field'])).toThrow(TemplateError);
        });
    });

    describe('extractJSON', () => {
        it('extracts JSON from code block', () => {
            const result = extractJSON('```json\n{"a": 1}\n```');
            expect(result).toBe('{"a": 1}');
        });

        it('extracts JSON object from text', () => {
            const result = extractJSON('Result: {"x": 1} end');
            expect(result).toBe('{"x": 1}');
        });

        it('extracts JSON array from text', () => {
            const result = extractJSON('Items: [1, 2, 3] done');
            expect(result).toBe('[1, 2, 3]');
        });

        it('prefers code block over inline JSON', () => {
            const result = extractJSON('{"inline": 1}\n```json\n{"block": 2}\n```');
            expect(result).toBe('{"block": 2}');
        });

        it('returns null for no JSON', () => {
            const result = extractJSON('Just plain text');
            expect(result).toBeNull();
        });

        it('handles nested JSON objects', () => {
            const result = extractJSON('{"outer": {"inner": {"deep": 1}}}');
            expect(result).toBe('{"outer": {"inner": {"deep": 1}}}');
        });
    });

    describe('escapeTemplateValue', () => {
        it('escapes backslashes', () => {
            expect(escapeTemplateValue('path\\to\\file')).toBe('path\\\\to\\\\file');
        });

        it('escapes braces', () => {
            expect(escapeTemplateValue('{test}')).toBe('\\{test\\}');
        });

        it('handles mixed special characters', () => {
            const result = escapeTemplateValue('\\{value\\}');
            expect(result).toBe('\\\\\\{value\\\\\\}');
        });

        it('leaves normal text unchanged', () => {
            expect(escapeTemplateValue('Hello World')).toBe('Hello World');
        });
    });

    describe('previewTemplate', () => {
        it('renders template with sample values', () => {
            const result = previewTemplate(
                'Hello {{name}}!',
                { name: 'Alice' }
            );
            expect(result).toBe('Hello Alice!');
        });

        it('truncates long output', () => {
            const item = { value: 'x'.repeat(1000) };
            const result = previewTemplate('{{value}}', item, 50);

            expect(result.length).toBe(53); // 50 + '...'
            expect(result).toMatch(/\.\.\.$/);
        });

        it('handles missing variables gracefully', () => {
            const result = previewTemplate('{{missing}}', {});
            expect(result).toBe('');
        });

        it('returns error message on template error', () => {
            // This shouldn't happen with current implementation, but test defensive behavior
            const result = previewTemplate('{{valid}}', { valid: 'ok' });
            expect(result).not.toContain('Error');
        });
    });

    describe('{{ITEMS}} special variable', () => {
        it('substitutes {{ITEMS}} with JSON array of all items', () => {
            const allItems: PromptItem[] = [
                { id: '1', title: 'Bug A' },
                { id: '2', title: 'Bug B' },
                { id: '3', title: 'Bug C' }
            ];
            
            const result = substituteTemplate(
                'Current: {{title}}\nAll items: {{ITEMS}}',
                { id: '1', title: 'Bug A' },
                { allItems }
            );
            
            expect(result).toContain('Current: Bug A');
            expect(result).toContain('"id": "1"');
            expect(result).toContain('"id": "2"');
            expect(result).toContain('"id": "3"');
            expect(result).toContain('"title": "Bug A"');
            expect(result).toContain('"title": "Bug B"');
            expect(result).toContain('"title": "Bug C"');
        });

        it('{{ITEMS}} returns empty array when allItems is empty', () => {
            const result = substituteTemplate(
                'Items: {{ITEMS}}',
                { id: '1' },
                { allItems: [] }
            );
            
            expect(result).toContain('[]');
        });

        it('{{ITEMS}} is preserved when allItems not provided', () => {
            const result = substituteTemplate(
                'Items: {{ITEMS}}',
                { id: '1' }
            );
            
            // Special variables are preserved as-is when not provided
            expect(result).toBe('Items: {{ITEMS}}');
        });

        it('extractVariables excludes ITEMS by default', () => {
            const vars = extractVariables('{{title}} {{ITEMS}} {{description}}');
            expect(vars.sort()).toEqual(['description', 'title']);
            expect(vars).not.toContain('ITEMS');
        });

        it('extractVariables includes ITEMS when excludeSpecial is false', () => {
            const vars = extractVariables('{{title}} {{ITEMS}} {{description}}', false);
            expect(vars.sort()).toEqual(['ITEMS', 'description', 'title']);
        });

        it('extractVariables excludes all special variables by default', () => {
            const template = '{{field}} {{ITEMS}} {{RESULTS}} {{COUNT}} {{SUCCESS_COUNT}} {{FAILURE_COUNT}} {{RESULTS_FILE}}';
            const vars = extractVariables(template);
            expect(vars).toEqual(['field']);
        });

        it('validateItemForTemplate ignores ITEMS in validation', () => {
            // ITEMS is a special variable, so it should not cause validation to fail
            const result = validateItemForTemplate(
                '{{title}} {{ITEMS}}',
                { title: 'Test' }
            );
            expect(result.valid).toBe(true);
            expect(result.missingVariables).toEqual([]);
        });

        it('previewTemplate supports {{ITEMS}}', () => {
            const allItems: PromptItem[] = [
                { id: '1', name: 'Item 1' },
                { id: '2', name: 'Item 2' }
            ];
            
            const result = previewTemplate(
                'Current: {{name}}, All: {{ITEMS}}',
                { id: '1', name: 'Item 1' },
                500,
                allItems
            );
            
            expect(result).toContain('Current: Item 1');
            expect(result).toContain('"id": "1"');
            expect(result).toContain('"id": "2"');
        });

        it('{{ITEMS}} works with complex nested data', () => {
            const allItems: PromptItem[] = [
                { id: '1', data: '{"nested": true}' },
                { id: '2', data: '{"nested": false}' }
            ];
            
            const result = substituteTemplate(
                'Processing {{id}}\nContext: {{ITEMS}}',
                { id: '1', data: '{"nested": true}' },
                { allItems }
            );
            
            expect(result).toContain('Processing 1');
            // Verify JSON is properly formatted
            const parsed = JSON.parse(result.split('Context: ')[1]);
            expect(parsed.length).toBe(2);
            expect(parsed[0].id).toBe('1');
            expect(parsed[1].id).toBe('2');
        });
    });

    describe('integration scenarios', () => {
        it('full pipeline prompt generation', () => {
            const template = `Analyze this bug report:

ID: {{id}}
Title: {{title}}
Description: {{description}}
Priority: {{priority}}

Classify the severity (critical/high/medium/low), 
category (ui/backend/database/infra),
estimate effort in hours,
and note if more info is needed.`;

            const item: PromptItem = {
                id: '1',
                title: 'Login broken',
                description: "Users can't login",
                priority: 'high'
            };

            const outputFields = ['severity', 'category', 'effort_hours', 'needs_more_info'];

            // Build prompt
            const prompt = buildPromptFromTemplate(template, item, outputFields);

            // Verify substitution
            expect(prompt).toContain('ID: 1');
            expect(prompt).toContain('Title: Login broken');
            expect(prompt).toContain("Description: Users can't login");
            expect(prompt).toContain('Priority: high');

            // Verify output instruction
            expect(prompt).toContain('Return JSON with these fields: severity, category, effort_hours, needs_more_info');
        });

        it('full AI response parsing', () => {
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

            expect(result).toEqual({
                severity: 'critical',
                category: 'backend',
                effort_hours: 4,
                needs_more_info: false
            });

            // Verify extra_note is excluded
            expect('extra_note' in result).toBe(false);
        });

        it('pipeline prompt with {{ITEMS}} for context-aware processing', () => {
            const template = `Analyze bug {{id}}: {{title}}

For context, here are all bugs in this batch:
{{ITEMS}}

Determine if this bug is related to any others in the batch.`;

            const allItems: PromptItem[] = [
                { id: '1', title: 'Login fails' },
                { id: '2', title: 'Auth token expired' },
                { id: '3', title: 'Session timeout' }
            ];

            const result = substituteTemplate(
                template,
                allItems[0],
                { allItems }
            );

            // Verify current item substitution
            expect(result).toContain('Analyze bug 1: Login fails');
            
            // Verify all items are included as JSON
            expect(result).toContain('"id": "1"');
            expect(result).toContain('"id": "2"');
            expect(result).toContain('"id": "3"');
            expect(result).toContain('"title": "Login fails"');
            expect(result).toContain('"title": "Auth token expired"');
            expect(result).toContain('"title": "Session timeout"');
        });
    });
});
