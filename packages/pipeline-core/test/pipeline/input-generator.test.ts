/**
 * Tests for Input Generator
 *
 * Comprehensive tests for AI-powered input generation.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import {
    buildGeneratePrompt,
    parseGenerateResponse,
    generateInputItems,
    toGeneratedItems,
    getSelectedItems,
    createEmptyItem,
    validateGenerateConfig,
    InputGenerationError
} from '../../src/pipeline';
import { GenerateInputConfig } from '../../src/pipeline/types';

describe('Input Generator', () => {
    describe('buildGeneratePrompt', () => {
        it('builds prompt with basic schema', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate 5 test cases for login validation',
                schema: ['testName', 'input', 'expected']
            };

            const result = buildGeneratePrompt(config);

            expect(result).toContain('Generate 5 test cases for login validation');
            expect(result).toContain('testName, input, expected');
            expect(result).toContain('Return a JSON array');
            expect(result).toContain('"testName": "..."');
            expect(result).toContain('"input": "..."');
            expect(result).toContain('"expected": "..."');
        });

        it('builds prompt with single field schema', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate 10 company names',
                schema: ['name']
            };

            const result = buildGeneratePrompt(config);

            expect(result).toContain('Generate 10 company names');
            expect(result).toContain('name');
            expect(result).toContain('"name": "..."');
        });

        it('builds prompt with many fields', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate user profiles',
                schema: ['firstName', 'lastName', 'email', 'age', 'country', 'occupation']
            };

            const result = buildGeneratePrompt(config);

            expect(result).toContain('firstName, lastName, email, age, country, occupation');
        });

        it('includes instruction for JSON-only response', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['field1']
            };

            const result = buildGeneratePrompt(config);

            expect(result).toContain('IMPORTANT: Return ONLY the JSON array');
        });
    });

    describe('parseGenerateResponse', () => {
        it('parses valid JSON array response', () => {
            const response = `[
                {"testName": "Valid login", "input": "user@test.com", "expected": "Success"},
                {"testName": "Empty email", "input": "", "expected": "Error"}
            ]`;
            const schema = ['testName', 'input', 'expected'];

            const result = parseGenerateResponse(response, schema);

            expect(result.length).toBe(2);
            expect(result[0].testName).toBe('Valid login');
            expect(result[0].input).toBe('user@test.com');
            expect(result[0].expected).toBe('Success');
            expect(result[1].testName).toBe('Empty email');
            expect(result[1].input).toBe('');
            expect(result[1].expected).toBe('Error');
        });

        it('parses response with extra text around JSON', () => {
            const response = `Here are the test cases:
            
            [{"name": "Test 1", "value": "100"}]
            
            Let me know if you need more.`;
            const schema = ['name', 'value'];

            const result = parseGenerateResponse(response, schema);

            expect(result.length).toBe(1);
            expect(result[0].name).toBe('Test 1');
            expect(result[0].value).toBe('100');
        });

        it('handles missing fields by setting to empty string', () => {
            const response = `[{"name": "Test"}]`;
            const schema = ['name', 'description', 'category'];

            const result = parseGenerateResponse(response, schema);

            expect(result.length).toBe(1);
            expect(result[0].name).toBe('Test');
            expect(result[0].description).toBe('');
            expect(result[0].category).toBe('');
        });

        it('ignores extra fields not in schema', () => {
            const response = `[{"name": "Test", "extraField": "ignored", "anotherExtra": 123}]`;
            const schema = ['name'];

            const result = parseGenerateResponse(response, schema);

            expect(result.length).toBe(1);
            expect(result[0].name).toBe('Test');
            expect('extraField' in result[0]).toBe(false);
            expect('anotherExtra' in result[0]).toBe(false);
        });

        it('converts non-string values to strings', () => {
            const response = `[{"name": "Test", "count": 42, "active": true, "score": 3.14}]`;
            const schema = ['name', 'count', 'active', 'score'];

            const result = parseGenerateResponse(response, schema);

            expect(result[0].name).toBe('Test');
            expect(result[0].count).toBe('42');
            expect(result[0].active).toBe('true');
            expect(result[0].score).toBe('3.14');
        });

        it('handles null values as empty string', () => {
            const response = `[{"name": "Test", "value": null}]`;
            const schema = ['name', 'value'];

            const result = parseGenerateResponse(response, schema);

            expect(result[0].name).toBe('Test');
            expect(result[0].value).toBe('');
        });

        it('throws InputGenerationError for non-JSON response', () => {
            const response = 'This is not JSON at all';
            const schema = ['name'];

            expect(() => parseGenerateResponse(response, schema)).toThrow(InputGenerationError);
        });

        it('throws InputGenerationError for non-array JSON', () => {
            const response = '{"name": "Test"}';
            const schema = ['name'];

            expect(() => parseGenerateResponse(response, schema)).toThrow(/not an array/i);
        });

        it('throws InputGenerationError for array with non-object items', () => {
            const response = '["item1", "item2"]';
            const schema = ['name'];

            expect(() => parseGenerateResponse(response, schema)).toThrow(/not an object/i);
        });

        it('throws InputGenerationError for invalid JSON syntax', () => {
            const response = '[{"name": "Test"';
            const schema = ['name'];

            expect(() => parseGenerateResponse(response, schema)).toThrow(InputGenerationError);
        });

        it('parses empty array successfully', () => {
            const response = '[]';
            const schema = ['name'];

            const result = parseGenerateResponse(response, schema);

            expect(result.length).toBe(0);
        });

        it('parses response with markdown code block', () => {
            const response = '```json\n[{"name": "Test"}]\n```';
            const schema = ['name'];

            const result = parseGenerateResponse(response, schema);

            expect(result.length).toBe(1);
            expect(result[0].name).toBe('Test');
        });
    });

    describe('generateInputItems', () => {
        it('returns success with valid AI response', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name', 'value']
            };

            const mockInvoker = async () => ({
                success: true,
                response: '[{"name": "Test 1", "value": "100"}]'
            });

            const result = await generateInputItems(config, mockInvoker);

            expect(result.success).toBe(true);
            expect(result.items).toBeTruthy();
            expect(result.items!.length).toBe(1);
            expect(result.items![0].name).toBe('Test 1');
        });

        it('returns failure when AI invocation fails', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name']
            };

            const mockInvoker = async () => ({
                success: false,
                error: 'API rate limit exceeded'
            });

            const result = await generateInputItems(config, mockInvoker);

            expect(result.success).toBe(false);
            expect(result.error).toContain('rate limit');
        });

        it('returns failure when AI returns empty response', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name']
            };

            const mockInvoker = async () => ({
                success: true,
                response: ''
            });

            const result = await generateInputItems(config, mockInvoker);

            expect(result.success).toBe(false);
            expect(result.error).toContain('empty');
        });

        it('returns failure when AI returns invalid JSON', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name']
            };

            const mockInvoker = async () => ({
                success: true,
                response: 'Not valid JSON'
            });

            const result = await generateInputItems(config, mockInvoker);

            expect(result.success).toBe(false);
            expect(result.error).toBeTruthy();
            expect(result.rawResponse).toBe('Not valid JSON');
        });

        it('includes raw response in result', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name']
            };

            const rawResponse = 'Here is the data: [{"name": "Test"}]';
            const mockInvoker = async () => ({
                success: true,
                response: rawResponse
            });

            const result = await generateInputItems(config, mockInvoker);

            expect(result.rawResponse).toBe(rawResponse);
        });

        it('passes model option to AI invoker when specified', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name'],
                model: 'gpt-4'
            };

            let receivedOptions: { model?: string } | undefined;
            const mockInvoker = async (_prompt: string, options?: { model?: string }) => {
                receivedOptions = options;
                return {
                    success: true,
                    response: '[{"name": "Test"}]'
                };
            };

            await generateInputItems(config, mockInvoker);

            expect(receivedOptions).toBeTruthy();
            expect(receivedOptions?.model).toBe('gpt-4');
        });

        it('does not pass model option when not specified', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name']
                // No model specified
            };

            let receivedOptions: { model?: string } | undefined;
            const mockInvoker = async (_prompt: string, options?: { model?: string }) => {
                receivedOptions = options;
                return {
                    success: true,
                    response: '[{"name": "Test"}]'
                };
            };

            await generateInputItems(config, mockInvoker);

            expect(receivedOptions).toBeUndefined();
        });
    });

    describe('toGeneratedItems', () => {
        it('wraps items with selected=true by default', () => {
            const items = [
                { name: 'Item 1' },
                { name: 'Item 2' },
                { name: 'Item 3' }
            ];

            const result = toGeneratedItems(items);

            expect(result.length).toBe(3);
            expect(result[0].selected).toBe(true);
            expect(result[1].selected).toBe(true);
            expect(result[2].selected).toBe(true);
        });

        it('preserves item data', () => {
            const items = [
                { name: 'Test', value: '100', category: 'A' }
            ];

            const result = toGeneratedItems(items);

            expect(result[0].data).toEqual(items[0]);
        });

        it('handles empty array', () => {
            const result = toGeneratedItems([]);
            expect(result.length).toBe(0);
        });
    });

    describe('getSelectedItems', () => {
        it('returns only selected items', () => {
            const items = [
                { data: { name: 'Item 1' }, selected: true },
                { data: { name: 'Item 2' }, selected: false },
                { data: { name: 'Item 3' }, selected: true }
            ];

            const result = getSelectedItems(items);

            expect(result.length).toBe(2);
            expect(result[0].name).toBe('Item 1');
            expect(result[1].name).toBe('Item 3');
        });

        it('returns empty array when none selected', () => {
            const items = [
                { data: { name: 'Item 1' }, selected: false },
                { data: { name: 'Item 2' }, selected: false }
            ];

            const result = getSelectedItems(items);

            expect(result.length).toBe(0);
        });

        it('returns all items when all selected', () => {
            const items = [
                { data: { name: 'Item 1' }, selected: true },
                { data: { name: 'Item 2' }, selected: true }
            ];

            const result = getSelectedItems(items);

            expect(result.length).toBe(2);
        });
    });

    describe('createEmptyItem', () => {
        it('creates item with all schema fields as empty strings', () => {
            const schema = ['name', 'description', 'category'];

            const result = createEmptyItem(schema);

            expect(result).toEqual({
                name: '',
                description: '',
                category: ''
            });
        });

        it('handles single field schema', () => {
            const result = createEmptyItem(['field']);
            expect(result).toEqual({ field: '' });
        });

        it('handles empty schema', () => {
            const result = createEmptyItem([]);
            expect(result).toEqual({});
        });
    });

    describe('validateGenerateConfig', () => {
        it('validates correct config', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name', 'value']
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(true);
            expect(result.errors.length).toBe(0);
        });

        it('rejects missing prompt', () => {
            const config = {
                schema: ['name']
            } as GenerateInputConfig;

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('prompt'))).toBe(true);
        });

        it('rejects empty prompt', () => {
            const config: GenerateInputConfig = {
                prompt: '   ',
                schema: ['name']
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('empty'))).toBe(true);
        });

        it('rejects missing schema', () => {
            const config = {
                prompt: 'Generate items'
            } as GenerateInputConfig;

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('schema'))).toBe(true);
        });

        it('rejects empty schema array', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: []
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('at least one field'))).toBe(true);
        });

        it('rejects non-string schema fields', () => {
            const config = {
                prompt: 'Generate items',
                schema: ['name', 123 as unknown as string, 'value']
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('must be a string'))).toBe(true);
        });

        it('rejects empty schema field names', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name', '', 'value']
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('cannot be empty'))).toBe(true);
        });

        it('rejects invalid identifier schema fields', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['valid_name', '123invalid', 'also-invalid']
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('123invalid'))).toBe(true);
            expect(result.errors.some(e => e.includes('also-invalid'))).toBe(true);
        });

        it('rejects duplicate schema fields', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name', 'value', 'name']
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
        });

        it('accepts valid identifier formats', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name', '_private', 'camelCase', 'with_underscore', 'field123']
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(true);
        });

        it('accepts config with optional model field', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name', 'value'],
                model: 'gpt-4'
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(true);
            expect(result.errors.length).toBe(0);
        });

        it('accepts config without model field', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name']
                // No model - should use default
            };

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(true);
        });

        it('collects multiple errors', () => {
            const config = {
                prompt: '',
                schema: ['', '123invalid']
            } as GenerateInputConfig;

            const result = validateGenerateConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('InputGenerationError', () => {
        it('has correct name', () => {
            const error = new InputGenerationError('Test error');
            expect(error.name).toBe('InputGenerationError');
        });

        it('preserves message', () => {
            const error = new InputGenerationError('Test error message');
            expect(error.message).toBe('Test error message');
        });

        it('preserves cause', () => {
            const cause = new Error('Original error');
            const error = new InputGenerationError('Wrapped error', cause);
            expect(error.cause).toBe(cause);
        });
    });
});
