/**
 * Tests for Prompt Template
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    renderTemplate,
    createTemplate,
    extractVariables,
    validateTemplate,
    composeTemplates,
    TemplateHelpers,
    ResponseParsers,
    MissingVariableError,
    TemplateRenderError
} from '../../../shortcuts/map-reduce/prompt-template';
import { PromptTemplate } from '../../../shortcuts/map-reduce/types';

suite('Prompt Template', () => {
    suite('extractVariables', () => {
        test('extracts single variable', () => {
            const vars = extractVariables('Hello {{name}}!');
            assert.deepStrictEqual(vars, ['name']);
        });

        test('extracts multiple variables', () => {
            const vars = extractVariables('{{greeting}} {{name}}, welcome to {{place}}!');
            assert.deepStrictEqual(vars.sort(), ['greeting', 'name', 'place'].sort());
        });

        test('extracts unique variables only', () => {
            const vars = extractVariables('{{name}} {{name}} {{name}}');
            assert.deepStrictEqual(vars, ['name']);
        });

        test('returns empty array for no variables', () => {
            const vars = extractVariables('Hello World!');
            assert.deepStrictEqual(vars, []);
        });

        test('handles template with only variables', () => {
            const vars = extractVariables('{{a}}{{b}}{{c}}');
            assert.deepStrictEqual(vars.sort(), ['a', 'b', 'c'].sort());
        });
    });

    suite('createTemplate', () => {
        test('creates template with auto-detected variables', () => {
            const template = createTemplate({
                template: 'Hello {{name}}, you are {{age}} years old.'
            });

            assert.strictEqual(template.template, 'Hello {{name}}, you are {{age}} years old.');
            assert.deepStrictEqual(template.requiredVariables.sort(), ['age', 'name'].sort());
        });

        test('creates template with explicit required variables', () => {
            const template = createTemplate({
                template: 'Hello {{name}}!',
                requiredVariables: ['name', 'extra']
            });

            assert.deepStrictEqual(template.requiredVariables, ['name', 'extra']);
        });

        test('creates template with system prompt', () => {
            const template = createTemplate({
                template: 'Answer: {{question}}',
                systemPrompt: 'You are a helpful assistant.'
            });

            assert.strictEqual(template.systemPrompt, 'You are a helpful assistant.');
        });

        test('creates template with response parser', () => {
            const parser = (response: string) => ({ parsed: response });
            const template = createTemplate({
                template: 'Test',
                responseParser: parser
            });

            assert.strictEqual(template.responseParser, parser);
        });
    });

    suite('validateTemplate', () => {
        test('validates template with all variables in template', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}}!',
                requiredVariables: ['name']
            };

            const result = validateTemplate(template);
            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.missingInTemplate, []);
        });

        test('detects required variables missing from template', () => {
            const template: PromptTemplate = {
                template: 'Hello World!',
                requiredVariables: ['name']
            };

            const result = validateTemplate(template);
            assert.strictEqual(result.valid, false);
            assert.deepStrictEqual(result.missingInTemplate, ['name']);
        });

        test('detects undeclared variables in template', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}} and {{friend}}!',
                requiredVariables: ['name']
            };

            const result = validateTemplate(template);
            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.undeclaredVariables, ['friend']);
        });
    });

    suite('renderTemplate', () => {
        test('renders template with all variables', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}}, you are {{age}} years old.',
                requiredVariables: ['name', 'age']
            };

            const rendered = renderTemplate(template, {
                variables: { name: 'Alice', age: 30 }
            });

            assert.strictEqual(rendered, 'Hello Alice, you are 30 years old.');
        });

        test('throws MissingVariableError for missing required variable', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}}!',
                requiredVariables: ['name']
            };

            assert.throws(
                () => renderTemplate(template, { variables: {} }),
                MissingVariableError
            );
        });

        test('preserves unmatched optional variables', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}}, {{optional}}!',
                requiredVariables: ['name']
            };

            const rendered = renderTemplate(template, {
                variables: { name: 'Alice' }
            });

            assert.strictEqual(rendered, 'Hello Alice, {{optional}}!');
        });

        test('includes system prompt when requested', () => {
            const template: PromptTemplate = {
                template: 'Question: {{question}}',
                requiredVariables: ['question'],
                systemPrompt: 'You are helpful.'
            };

            const rendered = renderTemplate(template, {
                variables: { question: 'Why?' },
                includeSystemPrompt: true
            });

            assert.strictEqual(rendered, 'You are helpful.\n\nQuestion: Why?');
        });

        test('does not include system prompt by default', () => {
            const template: PromptTemplate = {
                template: 'Question: {{question}}',
                requiredVariables: ['question'],
                systemPrompt: 'You are helpful.'
            };

            const rendered = renderTemplate(template, {
                variables: { question: 'Why?' }
            });

            assert.strictEqual(rendered, 'Question: Why?');
        });

        test('handles boolean and number variables', () => {
            const template: PromptTemplate = {
                template: 'Active: {{active}}, Count: {{count}}',
                requiredVariables: ['active', 'count']
            };

            const rendered = renderTemplate(template, {
                variables: { active: true, count: 42 }
            });

            assert.strictEqual(rendered, 'Active: true, Count: 42');
        });

        test('handles multiple occurrences of same variable', () => {
            const template: PromptTemplate = {
                template: '{{name}} is {{name}}, yes {{name}}!',
                requiredVariables: ['name']
            };

            const rendered = renderTemplate(template, {
                variables: { name: 'Bob' }
            });

            assert.strictEqual(rendered, 'Bob is Bob, yes Bob!');
        });
    });

    suite('composeTemplates', () => {
        test('combines templates with default separator', () => {
            const t1: PromptTemplate = {
                template: 'Part 1: {{a}}',
                requiredVariables: ['a']
            };
            const t2: PromptTemplate = {
                template: 'Part 2: {{b}}',
                requiredVariables: ['b']
            };

            const combined = composeTemplates([t1, t2]);
            assert.strictEqual(combined.template, 'Part 1: {{a}}\n\nPart 2: {{b}}');
            assert.deepStrictEqual(combined.requiredVariables.sort(), ['a', 'b'].sort());
        });

        test('combines templates with custom separator', () => {
            const t1: PromptTemplate = {
                template: 'A',
                requiredVariables: []
            };
            const t2: PromptTemplate = {
                template: 'B',
                requiredVariables: []
            };

            const combined = composeTemplates([t1, t2], '---');
            assert.strictEqual(combined.template, 'A---B');
        });

        test('uses first available system prompt', () => {
            const t1: PromptTemplate = {
                template: 'A',
                requiredVariables: []
            };
            const t2: PromptTemplate = {
                template: 'B',
                requiredVariables: [],
                systemPrompt: 'System'
            };

            const combined = composeTemplates([t1, t2]);
            assert.strictEqual(combined.systemPrompt, 'System');
        });

        test('deduplicates required variables', () => {
            const t1: PromptTemplate = {
                template: '{{x}} {{y}}',
                requiredVariables: ['x', 'y']
            };
            const t2: PromptTemplate = {
                template: '{{y}} {{z}}',
                requiredVariables: ['y', 'z']
            };

            const combined = composeTemplates([t1, t2]);
            assert.deepStrictEqual(combined.requiredVariables.sort(), ['x', 'y', 'z'].sort());
        });
    });

    suite('TemplateHelpers', () => {
        test('escape() escapes special characters', () => {
            const escaped = TemplateHelpers.escape('{test} \\path');
            assert.strictEqual(escaped, '\\{test\\} \\\\path');
        });

        test('truncate() truncates long strings', () => {
            const truncated = TemplateHelpers.truncate('Hello World', 8);
            assert.strictEqual(truncated, 'Hello...');
        });

        test('truncate() preserves short strings', () => {
            const truncated = TemplateHelpers.truncate('Hi', 10);
            assert.strictEqual(truncated, 'Hi');
        });

        test('indent() indents all lines', () => {
            const indented = TemplateHelpers.indent('line1\nline2', 4);
            assert.strictEqual(indented, '    line1\n    line2');
        });

        test('formatObject() formats simple object', () => {
            const formatted = TemplateHelpers.formatObject({ a: 1, b: 'test' });
            assert.ok(formatted.includes('a: 1'));
            assert.ok(formatted.includes('b: test'));
        });
    });

    suite('ResponseParsers', () => {
        test('json() parses JSON object', () => {
            const result = ResponseParsers.json<{ a: number }>('{"a": 42}');
            assert.deepStrictEqual(result, { a: 42 });
        });

        test('json() extracts JSON from markdown code block', () => {
            const result = ResponseParsers.json<{ b: string }>('```json\n{"b": "test"}\n```');
            assert.deepStrictEqual(result, { b: 'test' });
        });

        test('json() extracts JSON from response text', () => {
            const result = ResponseParsers.json<{ c: boolean }>('Here is the result: {"c": true} and more text');
            assert.deepStrictEqual(result, { c: true });
        });

        test('json() throws for no JSON found', () => {
            assert.throws(() => ResponseParsers.json('no json here'), /No JSON found/);
        });

        test('list() parses bullet points', () => {
            const result = ResponseParsers.list('- Item 1\n- Item 2\n- Item 3');
            assert.deepStrictEqual(result, ['Item 1', 'Item 2', 'Item 3']);
        });

        test('list() parses numbered list', () => {
            const result = ResponseParsers.list('1. First\n2. Second\n3. Third');
            assert.deepStrictEqual(result, ['First', 'Second', 'Third']);
        });

        test('keyValue() parses key-value pairs', () => {
            const result = ResponseParsers.keyValue('name: Alice\nage: 30');
            assert.deepStrictEqual(result, { name: 'Alice', age: '30' });
        });
    });
});
