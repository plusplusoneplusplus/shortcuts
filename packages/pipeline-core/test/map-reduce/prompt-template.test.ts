/**
 * Tests for Prompt Template
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
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
} from '../../src/map-reduce/prompt-template';
import { PromptTemplate } from '../../src/map-reduce/types';

describe('Prompt Template', () => {
    describe('extractVariables', () => {
        it('extracts single variable', () => {
            const vars = extractVariables('Hello {{name}}!');
            expect(vars).toEqual(['name']);
        });

        it('extracts multiple variables', () => {
            const vars = extractVariables('{{greeting}} {{name}}, welcome to {{place}}!');
            expect(vars.sort()).toEqual(['greeting', 'name', 'place'].sort());
        });

        it('extracts unique variables only', () => {
            const vars = extractVariables('{{name}} {{name}} {{name}}');
            expect(vars).toEqual(['name']);
        });

        it('returns empty array for no variables', () => {
            const vars = extractVariables('Hello World!');
            expect(vars).toEqual([]);
        });

        it('handles template with only variables', () => {
            const vars = extractVariables('{{a}}{{b}}{{c}}');
            expect(vars.sort()).toEqual(['a', 'b', 'c'].sort());
        });
    });

    describe('createTemplate', () => {
        it('creates template with auto-detected variables', () => {
            const template = createTemplate({
                template: 'Hello {{name}}, you are {{age}} years old.'
            });

            expect(template.template).toBe('Hello {{name}}, you are {{age}} years old.');
            expect(template.requiredVariables.sort()).toEqual(['age', 'name'].sort());
        });

        it('creates template with explicit required variables', () => {
            const template = createTemplate({
                template: 'Hello {{name}}!',
                requiredVariables: ['name', 'extra']
            });

            expect(template.requiredVariables).toEqual(['name', 'extra']);
        });

        it('creates template with system prompt', () => {
            const template = createTemplate({
                template: 'Answer: {{question}}',
                systemPrompt: 'You are a helpful assistant.'
            });

            expect(template.systemPrompt).toBe('You are a helpful assistant.');
        });

        it('creates template with response parser', () => {
            const parser = (response: string) => ({ parsed: response });
            const template = createTemplate({
                template: 'Test',
                responseParser: parser
            });

            expect(template.responseParser).toBe(parser);
        });
    });

    describe('validateTemplate', () => {
        it('validates template with all variables in template', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}}!',
                requiredVariables: ['name']
            };

            const result = validateTemplate(template);
            expect(result.valid).toBe(true);
            expect(result.missingInTemplate).toEqual([]);
        });

        it('detects required variables missing from template', () => {
            const template: PromptTemplate = {
                template: 'Hello World!',
                requiredVariables: ['name']
            };

            const result = validateTemplate(template);
            expect(result.valid).toBe(false);
            expect(result.missingInTemplate).toEqual(['name']);
        });

        it('detects undeclared variables in template', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}} and {{friend}}!',
                requiredVariables: ['name']
            };

            const result = validateTemplate(template);
            expect(result.valid).toBe(true);
            expect(result.undeclaredVariables).toEqual(['friend']);
        });
    });

    describe('renderTemplate', () => {
        it('renders template with all variables', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}}, you are {{age}} years old.',
                requiredVariables: ['name', 'age']
            };

            const rendered = renderTemplate(template, {
                variables: { name: 'Alice', age: 30 }
            });

            expect(rendered).toBe('Hello Alice, you are 30 years old.');
        });

        it('throws MissingVariableError for missing required variable', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}}!',
                requiredVariables: ['name']
            };

            expect(() => renderTemplate(template, { variables: {} })).toThrow(MissingVariableError);
        });

        it('preserves unmatched optional variables', () => {
            const template: PromptTemplate = {
                template: 'Hello {{name}}, {{optional}}!',
                requiredVariables: ['name']
            };

            const rendered = renderTemplate(template, {
                variables: { name: 'Alice' }
            });

            expect(rendered).toBe('Hello Alice, {{optional}}!');
        });

        it('includes system prompt when requested', () => {
            const template: PromptTemplate = {
                template: 'Question: {{question}}',
                requiredVariables: ['question'],
                systemPrompt: 'You are helpful.'
            };

            const rendered = renderTemplate(template, {
                variables: { question: 'Why?' },
                includeSystemPrompt: true
            });

            expect(rendered).toBe('You are helpful.\n\nQuestion: Why?');
        });

        it('does not include system prompt by default', () => {
            const template: PromptTemplate = {
                template: 'Question: {{question}}',
                requiredVariables: ['question'],
                systemPrompt: 'You are helpful.'
            };

            const rendered = renderTemplate(template, {
                variables: { question: 'Why?' }
            });

            expect(rendered).toBe('Question: Why?');
        });

        it('handles boolean and number variables', () => {
            const template: PromptTemplate = {
                template: 'Active: {{active}}, Count: {{count}}',
                requiredVariables: ['active', 'count']
            };

            const rendered = renderTemplate(template, {
                variables: { active: true, count: 42 }
            });

            expect(rendered).toBe('Active: true, Count: 42');
        });

        it('handles multiple occurrences of same variable', () => {
            const template: PromptTemplate = {
                template: '{{name}} is {{name}}, yes {{name}}!',
                requiredVariables: ['name']
            };

            const rendered = renderTemplate(template, {
                variables: { name: 'Bob' }
            });

            expect(rendered).toBe('Bob is Bob, yes Bob!');
        });
    });

    describe('composeTemplates', () => {
        it('combines templates with default separator', () => {
            const t1: PromptTemplate = {
                template: 'Part 1: {{a}}',
                requiredVariables: ['a']
            };
            const t2: PromptTemplate = {
                template: 'Part 2: {{b}}',
                requiredVariables: ['b']
            };

            const combined = composeTemplates([t1, t2]);
            expect(combined.template).toBe('Part 1: {{a}}\n\nPart 2: {{b}}');
            expect(combined.requiredVariables.sort()).toEqual(['a', 'b'].sort());
        });

        it('combines templates with custom separator', () => {
            const t1: PromptTemplate = {
                template: 'A',
                requiredVariables: []
            };
            const t2: PromptTemplate = {
                template: 'B',
                requiredVariables: []
            };

            const combined = composeTemplates([t1, t2], '---');
            expect(combined.template).toBe('A---B');
        });

        it('uses first available system prompt', () => {
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
            expect(combined.systemPrompt).toBe('System');
        });

        it('deduplicates required variables', () => {
            const t1: PromptTemplate = {
                template: '{{x}} {{y}}',
                requiredVariables: ['x', 'y']
            };
            const t2: PromptTemplate = {
                template: '{{y}} {{z}}',
                requiredVariables: ['y', 'z']
            };

            const combined = composeTemplates([t1, t2]);
            expect(combined.requiredVariables.sort()).toEqual(['x', 'y', 'z'].sort());
        });
    });

    describe('TemplateHelpers', () => {
        it('escape() escapes special characters', () => {
            const escaped = TemplateHelpers.escape('{test} \\path');
            expect(escaped).toBe('\\{test\\} \\\\path');
        });

        it('truncate() truncates long strings', () => {
            const truncated = TemplateHelpers.truncate('Hello World', 8);
            expect(truncated).toBe('Hello...');
        });

        it('truncate() preserves short strings', () => {
            const truncated = TemplateHelpers.truncate('Hi', 10);
            expect(truncated).toBe('Hi');
        });

        it('indent() indents all lines', () => {
            const indented = TemplateHelpers.indent('line1\nline2', 4);
            expect(indented).toBe('    line1\n    line2');
        });

        it('formatObject() formats simple object', () => {
            const formatted = TemplateHelpers.formatObject({ a: 1, b: 'test' });
            expect(formatted).toContain('a: 1');
            expect(formatted).toContain('b: test');
        });
    });

    describe('ResponseParsers', () => {
        it('json() parses JSON object', () => {
            const result = ResponseParsers.json<{ a: number }>('{"a": 42}');
            expect(result).toEqual({ a: 42 });
        });

        it('json() extracts JSON from markdown code block', () => {
            const result = ResponseParsers.json<{ b: string }>('```json\n{"b": "test"}\n```');
            expect(result).toEqual({ b: 'test' });
        });

        it('json() extracts JSON from response text', () => {
            const result = ResponseParsers.json<{ c: boolean }>('Here is the result: {"c": true} and more text');
            expect(result).toEqual({ c: true });
        });

        it('json() throws for no JSON found', () => {
            expect(() => ResponseParsers.json('no json here')).toThrow(/No JSON found/);
        });

        it('list() parses bullet points', () => {
            const result = ResponseParsers.list('- Item 1\n- Item 2\n- Item 3');
            expect(result).toEqual(['Item 1', 'Item 2', 'Item 3']);
        });

        it('list() parses numbered list', () => {
            const result = ResponseParsers.list('1. First\n2. Second\n3. Third');
            expect(result).toEqual(['First', 'Second', 'Third']);
        });

        it('keyValue() parses key-value pairs', () => {
            const result = ResponseParsers.keyValue('name: Alice\nage: 30');
            expect(result).toEqual({ name: 'Alice', age: '30' });
        });
    });
});
