/**
 * Template Engine Tests
 *
 * Tests for the shared template variable substitution logic.
 */

import { describe, it, expect } from 'vitest';
import {
    TEMPLATE_VARIABLE_REGEX,
    SPECIAL_VARIABLES,
    TemplateVariableError,
    substituteVariables,
    extractVariables,
    hasVariables,
    containsVariables,
    validateVariables
} from '../../src/utils/template-engine';

describe('Template Engine', () => {
    describe('TEMPLATE_VARIABLE_REGEX', () => {
        it('should match simple variables', () => {
            const matches = 'Hello {{name}}'.match(new RegExp(TEMPLATE_VARIABLE_REGEX.source, 'g'));
            expect(matches).toEqual(['{{name}}']);
        });

        it('should match multiple variables', () => {
            const matches = '{{greeting}} {{name}}!'.match(new RegExp(TEMPLATE_VARIABLE_REGEX.source, 'g'));
            expect(matches).toEqual(['{{greeting}}', '{{name}}']);
        });

        it('should match alphanumeric variables', () => {
            const matches = '{{var1}} {{var2_name}}'.match(new RegExp(TEMPLATE_VARIABLE_REGEX.source, 'g'));
            expect(matches).toEqual(['{{var1}}', '{{var2_name}}']);
        });

        it('should not match variables with spaces', () => {
            const matches = '{{ name }}'.match(new RegExp(TEMPLATE_VARIABLE_REGEX.source, 'g'));
            expect(matches).toBeNull();
        });
    });

    describe('SPECIAL_VARIABLES', () => {
        it('should contain system variables', () => {
            expect(SPECIAL_VARIABLES.has('ITEMS')).toBe(true);
            expect(SPECIAL_VARIABLES.has('RESULTS')).toBe(true);
            expect(SPECIAL_VARIABLES.has('RESULTS_FILE')).toBe(true);
            expect(SPECIAL_VARIABLES.has('COUNT')).toBe(true);
            expect(SPECIAL_VARIABLES.has('SUCCESS_COUNT')).toBe(true);
            expect(SPECIAL_VARIABLES.has('FAILURE_COUNT')).toBe(true);
        });

        it('should not contain regular variables', () => {
            expect(SPECIAL_VARIABLES.has('name')).toBe(false);
            expect(SPECIAL_VARIABLES.has('title')).toBe(false);
        });
    });

    describe('substituteVariables', () => {
        it('should substitute simple variables', () => {
            const result = substituteVariables('Hello {{name}}!', { name: 'World' });
            expect(result).toBe('Hello World!');
        });

        it('should substitute multiple variables', () => {
            const result = substituteVariables(
                '{{greeting}}, {{name}}!',
                { greeting: 'Hello', name: 'World' }
            );
            expect(result).toBe('Hello, World!');
        });

        it('should handle missing variables with empty string by default', () => {
            const result = substituteVariables('Hello {{name}}!', {});
            expect(result).toBe('Hello !');
        });

        it('should preserve missing variables when option is set', () => {
            const result = substituteVariables('Hello {{name}}!', {}, {
                missingValueBehavior: 'preserve'
            });
            expect(result).toBe('Hello {{name}}!');
        });

        it('should throw in strict mode for missing variables', () => {
            expect(() => {
                substituteVariables('Hello {{name}}!', {}, { strict: true });
            }).toThrow(TemplateVariableError);
        });

        it('should preserve special variables by default', () => {
            const result = substituteVariables('Items: {{ITEMS}}', { ITEMS: 'ignored' });
            expect(result).toBe('Items: {{ITEMS}}');
        });

        it('should not preserve special variables when option is false', () => {
            const result = substituteVariables('Items: {{ITEMS}}', { ITEMS: 'data' }, {
                preserveSpecialVariables: false
            });
            expect(result).toBe('Items: data');
        });

        it('should handle null values', () => {
            const result = substituteVariables('Value: {{val}}', { val: null });
            expect(result).toBe('Value: ');
        });

        it('should handle undefined values', () => {
            const result = substituteVariables('Value: {{val}}', { val: undefined });
            expect(result).toBe('Value: ');
        });

        it('should stringify objects', () => {
            const result = substituteVariables('Data: {{obj}}', { obj: { key: 'value' } }, {
                preserveSpecialVariables: false
            });
            expect(result).toBe('Data: {"key":"value"}');
        });

        it('should convert numbers to strings', () => {
            const result = substituteVariables('Count: {{num}}', { num: 42 });
            expect(result).toBe('Count: 42');
        });

        it('should handle empty template', () => {
            const result = substituteVariables('', { name: 'test' });
            expect(result).toBe('');
        });

        it('should handle template with no variables', () => {
            const result = substituteVariables('Hello World!', { name: 'test' });
            expect(result).toBe('Hello World!');
        });
    });

    describe('extractVariables', () => {
        it('should extract variable names from template', () => {
            const variables = extractVariables('Hello {{name}}, you have {{count}} messages');
            expect(variables).toEqual(expect.arrayContaining(['name', 'count']));
            expect(variables.length).toBe(2);
        });

        it('should return unique variable names', () => {
            const variables = extractVariables('{{name}} and {{name}} again');
            expect(variables).toEqual(['name']);
        });

        it('should exclude special variables by default', () => {
            const variables = extractVariables('Items: {{ITEMS}}, Name: {{name}}');
            expect(variables).toEqual(['name']);
        });

        it('should include special variables when excludeSpecial is false', () => {
            const variables = extractVariables('Items: {{ITEMS}}, Name: {{name}}', false);
            expect(variables).toEqual(expect.arrayContaining(['ITEMS', 'name']));
        });

        it('should return empty array for template with no variables', () => {
            const variables = extractVariables('No variables here');
            expect(variables).toEqual([]);
        });
    });

    describe('hasVariables', () => {
        it('should return true when template has variables', () => {
            expect(hasVariables('Hello {{name}}')).toBe(true);
        });

        it('should return false when template has no variables', () => {
            expect(hasVariables('Hello World')).toBe(false);
        });

        it('should return false for empty string', () => {
            expect(hasVariables('')).toBe(false);
        });
    });

    describe('containsVariables', () => {
        it('should return true when template contains specified variable', () => {
            expect(containsVariables('Hello {{name}}', ['name'])).toBe(true);
        });

        it('should return false when template does not contain specified variable', () => {
            expect(containsVariables('Hello {{name}}', ['title'])).toBe(false);
        });

        it('should return true if any specified variable is found', () => {
            expect(containsVariables('Hello {{name}}', ['title', 'name', 'age'])).toBe(true);
        });

        it('should return false for empty variable list', () => {
            expect(containsVariables('Hello {{name}}', [])).toBe(false);
        });
    });

    describe('validateVariables', () => {
        it('should return valid when all variables are present', () => {
            const result = validateVariables(
                'Hello {{name}}, you are {{age}} years old',
                { name: 'Alice', age: 30 }
            );
            expect(result.valid).toBe(true);
            expect(result.missingVariables).toEqual([]);
        });

        it('should return invalid when variables are missing', () => {
            const result = validateVariables(
                'Hello {{name}}, you are {{age}} years old',
                { name: 'Alice' }
            );
            expect(result.valid).toBe(false);
            expect(result.missingVariables).toEqual(['age']);
        });

        it('should not require special variables', () => {
            const result = validateVariables(
                'Items: {{ITEMS}}, Name: {{name}}',
                { name: 'Alice' }
            );
            expect(result.valid).toBe(true);
        });

        it('should handle empty template', () => {
            const result = validateVariables('', {});
            expect(result.valid).toBe(true);
            expect(result.missingVariables).toEqual([]);
        });
    });

    describe('TemplateVariableError', () => {
        it('should include variable name', () => {
            const error = new TemplateVariableError('Missing variable', 'name');
            expect(error.variableName).toBe('name');
            expect(error.name).toBe('TemplateVariableError');
        });

        it('should work without variable name', () => {
            const error = new TemplateVariableError('General error');
            expect(error.variableName).toBeUndefined();
        });
    });

    describe('Edge cases', () => {
        it('should handle consecutive variables', () => {
            const result = substituteVariables('{{a}}{{b}}{{c}}', { a: '1', b: '2', c: '3' });
            expect(result).toBe('123');
        });

        it('should handle nested braces (not as variable)', () => {
            const result = substituteVariables('{{{name}}}', { name: 'test' });
            expect(result).toBe('{test}');
        });

        it('should handle special characters in values', () => {
            const result = substituteVariables('{{msg}}', { msg: 'Hello\nWorld\t!' });
            expect(result).toBe('Hello\nWorld\t!');
        });

        it('should handle unicode in values', () => {
            const result = substituteVariables('{{msg}}', { msg: '你好世界 🌍' });
            expect(result).toBe('你好世界 🌍');
        });

        it('should handle large templates efficiently', () => {
            const template = '{{x}}'.repeat(1000);
            const result = substituteVariables(template, { x: 'a' });
            expect(result).toBe('a'.repeat(1000));
        });
    });
});
