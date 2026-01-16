/**
 * Tests for Input Generator
 *
 * Comprehensive tests for AI-powered input generation.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    buildGeneratePrompt,
    parseGenerateResponse,
    generateInputItems,
    toGeneratedItems,
    getSelectedItems,
    createEmptyItem,
    validateGenerateConfig,
    InputGenerationError
} from '../../../shortcuts/yaml-pipeline/input-generator';
import { GenerateInputConfig } from '../../../shortcuts/yaml-pipeline/types';

suite('Input Generator', () => {
    suite('buildGeneratePrompt', () => {
        test('builds prompt with basic schema', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate 5 test cases for login validation',
                schema: ['testName', 'input', 'expected']
            };

            const result = buildGeneratePrompt(config);

            assert.ok(result.includes('Generate 5 test cases for login validation'));
            assert.ok(result.includes('testName, input, expected'));
            assert.ok(result.includes('Return a JSON array'));
            assert.ok(result.includes('"testName": "..."'));
            assert.ok(result.includes('"input": "..."'));
            assert.ok(result.includes('"expected": "..."'));
        });

        test('builds prompt with single field schema', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate 10 company names',
                schema: ['name']
            };

            const result = buildGeneratePrompt(config);

            assert.ok(result.includes('Generate 10 company names'));
            assert.ok(result.includes('name'));
            assert.ok(result.includes('"name": "..."'));
        });

        test('builds prompt with many fields', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate user profiles',
                schema: ['firstName', 'lastName', 'email', 'age', 'country', 'occupation']
            };

            const result = buildGeneratePrompt(config);

            assert.ok(result.includes('firstName, lastName, email, age, country, occupation'));
        });

        test('includes instruction for JSON-only response', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['field1']
            };

            const result = buildGeneratePrompt(config);

            assert.ok(result.includes('IMPORTANT: Return ONLY the JSON array'));
        });
    });

    suite('parseGenerateResponse', () => {
        test('parses valid JSON array response', () => {
            const response = `[
                {"testName": "Valid login", "input": "user@test.com", "expected": "Success"},
                {"testName": "Empty email", "input": "", "expected": "Error"}
            ]`;
            const schema = ['testName', 'input', 'expected'];

            const result = parseGenerateResponse(response, schema);

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].testName, 'Valid login');
            assert.strictEqual(result[0].input, 'user@test.com');
            assert.strictEqual(result[0].expected, 'Success');
            assert.strictEqual(result[1].testName, 'Empty email');
            assert.strictEqual(result[1].input, '');
            assert.strictEqual(result[1].expected, 'Error');
        });

        test('parses response with extra text around JSON', () => {
            const response = `Here are the test cases:
            
            [{"name": "Test 1", "value": "100"}]
            
            Let me know if you need more.`;
            const schema = ['name', 'value'];

            const result = parseGenerateResponse(response, schema);

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'Test 1');
            assert.strictEqual(result[0].value, '100');
        });

        test('handles missing fields by setting to empty string', () => {
            const response = `[{"name": "Test"}]`;
            const schema = ['name', 'description', 'category'];

            const result = parseGenerateResponse(response, schema);

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'Test');
            assert.strictEqual(result[0].description, '');
            assert.strictEqual(result[0].category, '');
        });

        test('ignores extra fields not in schema', () => {
            const response = `[{"name": "Test", "extraField": "ignored", "anotherExtra": 123}]`;
            const schema = ['name'];

            const result = parseGenerateResponse(response, schema);

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'Test');
            assert.ok(!('extraField' in result[0]));
            assert.ok(!('anotherExtra' in result[0]));
        });

        test('converts non-string values to strings', () => {
            const response = `[{"name": "Test", "count": 42, "active": true, "score": 3.14}]`;
            const schema = ['name', 'count', 'active', 'score'];

            const result = parseGenerateResponse(response, schema);

            assert.strictEqual(result[0].name, 'Test');
            assert.strictEqual(result[0].count, '42');
            assert.strictEqual(result[0].active, 'true');
            assert.strictEqual(result[0].score, '3.14');
        });

        test('handles null values as empty string', () => {
            const response = `[{"name": "Test", "value": null}]`;
            const schema = ['name', 'value'];

            const result = parseGenerateResponse(response, schema);

            assert.strictEqual(result[0].name, 'Test');
            assert.strictEqual(result[0].value, '');
        });

        test('throws InputGenerationError for non-JSON response', () => {
            const response = 'This is not JSON at all';
            const schema = ['name'];

            assert.throws(
                () => parseGenerateResponse(response, schema),
                InputGenerationError
            );
        });

        test('throws InputGenerationError for non-array JSON', () => {
            const response = '{"name": "Test"}';
            const schema = ['name'];

            assert.throws(
                () => parseGenerateResponse(response, schema),
                /not an array/i
            );
        });

        test('throws InputGenerationError for array with non-object items', () => {
            const response = '["item1", "item2"]';
            const schema = ['name'];

            assert.throws(
                () => parseGenerateResponse(response, schema),
                /not an object/i
            );
        });

        test('throws InputGenerationError for invalid JSON syntax', () => {
            const response = '[{"name": "Test"';
            const schema = ['name'];

            assert.throws(
                () => parseGenerateResponse(response, schema),
                InputGenerationError
            );
        });

        test('parses empty array successfully', () => {
            const response = '[]';
            const schema = ['name'];

            const result = parseGenerateResponse(response, schema);

            assert.strictEqual(result.length, 0);
        });

        test('parses response with markdown code block', () => {
            const response = '```json\n[{"name": "Test"}]\n```';
            const schema = ['name'];

            const result = parseGenerateResponse(response, schema);

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'Test');
        });
    });

    suite('generateInputItems', () => {
        test('returns success with valid AI response', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name', 'value']
            };

            const mockInvoker = async () => ({
                success: true,
                response: '[{"name": "Test 1", "value": "100"}]'
            });

            const result = await generateInputItems(config, mockInvoker);

            assert.strictEqual(result.success, true);
            assert.ok(result.items);
            assert.strictEqual(result.items.length, 1);
            assert.strictEqual(result.items[0].name, 'Test 1');
        });

        test('returns failure when AI invocation fails', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name']
            };

            const mockInvoker = async () => ({
                success: false,
                error: 'API rate limit exceeded'
            });

            const result = await generateInputItems(config, mockInvoker);

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('rate limit'));
        });

        test('returns failure when AI returns empty response', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name']
            };

            const mockInvoker = async () => ({
                success: true,
                response: ''
            });

            const result = await generateInputItems(config, mockInvoker);

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('empty'));
        });

        test('returns failure when AI returns invalid JSON', async () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name']
            };

            const mockInvoker = async () => ({
                success: true,
                response: 'Not valid JSON'
            });

            const result = await generateInputItems(config, mockInvoker);

            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.ok(result.rawResponse === 'Not valid JSON');
        });

        test('includes raw response in result', async () => {
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

            assert.strictEqual(result.rawResponse, rawResponse);
        });

        test('passes model option to AI invoker when specified', async () => {
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

            assert.ok(receivedOptions, 'Options should be passed to invoker');
            assert.strictEqual(receivedOptions?.model, 'gpt-4');
        });

        test('does not pass model option when not specified', async () => {
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

            assert.strictEqual(receivedOptions, undefined);
        });
    });

    suite('toGeneratedItems', () => {
        test('wraps items with selected=true by default', () => {
            const items = [
                { name: 'Item 1' },
                { name: 'Item 2' },
                { name: 'Item 3' }
            ];

            const result = toGeneratedItems(items);

            assert.strictEqual(result.length, 3);
            assert.strictEqual(result[0].selected, true);
            assert.strictEqual(result[1].selected, true);
            assert.strictEqual(result[2].selected, true);
        });

        test('preserves item data', () => {
            const items = [
                { name: 'Test', value: '100', category: 'A' }
            ];

            const result = toGeneratedItems(items);

            assert.deepStrictEqual(result[0].data, items[0]);
        });

        test('handles empty array', () => {
            const result = toGeneratedItems([]);
            assert.strictEqual(result.length, 0);
        });
    });

    suite('getSelectedItems', () => {
        test('returns only selected items', () => {
            const items = [
                { data: { name: 'Item 1' }, selected: true },
                { data: { name: 'Item 2' }, selected: false },
                { data: { name: 'Item 3' }, selected: true }
            ];

            const result = getSelectedItems(items);

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].name, 'Item 1');
            assert.strictEqual(result[1].name, 'Item 3');
        });

        test('returns empty array when none selected', () => {
            const items = [
                { data: { name: 'Item 1' }, selected: false },
                { data: { name: 'Item 2' }, selected: false }
            ];

            const result = getSelectedItems(items);

            assert.strictEqual(result.length, 0);
        });

        test('returns all items when all selected', () => {
            const items = [
                { data: { name: 'Item 1' }, selected: true },
                { data: { name: 'Item 2' }, selected: true }
            ];

            const result = getSelectedItems(items);

            assert.strictEqual(result.length, 2);
        });
    });

    suite('createEmptyItem', () => {
        test('creates item with all schema fields as empty strings', () => {
            const schema = ['name', 'description', 'category'];

            const result = createEmptyItem(schema);

            assert.deepStrictEqual(result, {
                name: '',
                description: '',
                category: ''
            });
        });

        test('handles single field schema', () => {
            const result = createEmptyItem(['field']);
            assert.deepStrictEqual(result, { field: '' });
        });

        test('handles empty schema', () => {
            const result = createEmptyItem([]);
            assert.deepStrictEqual(result, {});
        });
    });

    suite('validateGenerateConfig', () => {
        test('validates correct config', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate test cases',
                schema: ['name', 'value']
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('rejects missing prompt', () => {
            const config = {
                schema: ['name']
            } as GenerateInputConfig;

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('prompt')));
        });

        test('rejects empty prompt', () => {
            const config: GenerateInputConfig = {
                prompt: '   ',
                schema: ['name']
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('empty')));
        });

        test('rejects missing schema', () => {
            const config = {
                prompt: 'Generate items'
            } as GenerateInputConfig;

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('schema')));
        });

        test('rejects empty schema array', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: []
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('at least one field')));
        });

        test('rejects non-string schema fields', () => {
            const config = {
                prompt: 'Generate items',
                schema: ['name', 123 as unknown as string, 'value']
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('must be a string')));
        });

        test('rejects empty schema field names', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name', '', 'value']
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('cannot be empty')));
        });

        test('rejects invalid identifier schema fields', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['valid_name', '123invalid', 'also-invalid']
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('123invalid')));
            assert.ok(result.errors.some(e => e.includes('also-invalid')));
        });

        test('rejects duplicate schema fields', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name', 'value', 'name']
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('Duplicate')));
        });

        test('accepts valid identifier formats', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name', '_private', 'camelCase', 'with_underscore', 'field123']
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, true);
        });

        test('accepts config with optional model field', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name', 'value'],
                model: 'gpt-4'
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('accepts config without model field', () => {
            const config: GenerateInputConfig = {
                prompt: 'Generate items',
                schema: ['name']
                // No model - should use default
            };

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, true);
        });

        test('collects multiple errors', () => {
            const config = {
                prompt: '',
                schema: ['', '123invalid']
            } as GenerateInputConfig;

            const result = validateGenerateConfig(config);

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length >= 3);
        });
    });

    suite('InputGenerationError', () => {
        test('has correct name', () => {
            const error = new InputGenerationError('Test error');
            assert.strictEqual(error.name, 'InputGenerationError');
        });

        test('preserves message', () => {
            const error = new InputGenerationError('Test error message');
            assert.strictEqual(error.message, 'Test error message');
        });

        test('preserves cause', () => {
            const cause = new Error('Original error');
            const error = new InputGenerationError('Wrapped error', cause);
            assert.strictEqual(error.cause, cause);
        });
    });
});
