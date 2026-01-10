/**
 * Tests for YAML Pipeline index exports
 *
 * Verifies all modules are properly exported.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as YamlPipeline from '../../../shortcuts/yaml-pipeline';

suite('YAML Pipeline Index Exports', () => {
    suite('CSV Reader exports', () => {
        test('exports parseCSVContent', () => {
            assert.ok(typeof YamlPipeline.parseCSVContent === 'function');
        });

        test('exports readCSVFile', () => {
            assert.ok(typeof YamlPipeline.readCSVFile === 'function');
        });

        test('exports readCSVFileSync', () => {
            assert.ok(typeof YamlPipeline.readCSVFileSync === 'function');
        });

        test('exports resolveCSVPath', () => {
            assert.ok(typeof YamlPipeline.resolveCSVPath === 'function');
        });

        test('exports validateCSVHeaders', () => {
            assert.ok(typeof YamlPipeline.validateCSVHeaders === 'function');
        });

        test('exports getCSVPreview', () => {
            assert.ok(typeof YamlPipeline.getCSVPreview === 'function');
        });

        test('exports CSVParseError', () => {
            assert.ok(typeof YamlPipeline.CSVParseError === 'function');
        });

        test('exports DEFAULT_CSV_OPTIONS', () => {
            assert.ok(YamlPipeline.DEFAULT_CSV_OPTIONS);
            assert.strictEqual(YamlPipeline.DEFAULT_CSV_OPTIONS.delimiter, ',');
        });
    });

    suite('Template exports', () => {
        test('exports substituteTemplate', () => {
            assert.ok(typeof YamlPipeline.substituteTemplate === 'function');
        });

        test('exports extractVariables', () => {
            assert.ok(typeof YamlPipeline.extractVariables === 'function');
        });

        test('exports validateItemForTemplate', () => {
            assert.ok(typeof YamlPipeline.validateItemForTemplate === 'function');
        });

        test('exports buildFullPrompt', () => {
            assert.ok(typeof YamlPipeline.buildFullPrompt === 'function');
        });

        test('exports buildPromptFromTemplate', () => {
            assert.ok(typeof YamlPipeline.buildPromptFromTemplate === 'function');
        });

        test('exports parseAIResponse', () => {
            assert.ok(typeof YamlPipeline.parseAIResponse === 'function');
        });

        test('exports extractJSON', () => {
            assert.ok(typeof YamlPipeline.extractJSON === 'function');
        });

        test('exports escapeTemplateValue', () => {
            assert.ok(typeof YamlPipeline.escapeTemplateValue === 'function');
        });

        test('exports previewTemplate', () => {
            assert.ok(typeof YamlPipeline.previewTemplate === 'function');
        });

        test('exports TemplateError', () => {
            assert.ok(typeof YamlPipeline.TemplateError === 'function');
        });
    });

    suite('Executor exports', () => {
        test('exports executePipeline', () => {
            assert.ok(typeof YamlPipeline.executePipeline === 'function');
        });

        test('exports parsePipelineYAML', () => {
            assert.ok(typeof YamlPipeline.parsePipelineYAML === 'function');
        });

        test('exports parsePipelineYAMLSync', () => {
            assert.ok(typeof YamlPipeline.parsePipelineYAMLSync === 'function');
        });

        test('exports PipelineExecutionError', () => {
            assert.ok(typeof YamlPipeline.PipelineExecutionError === 'function');
        });

        test('exports DEFAULT_PARALLEL_LIMIT', () => {
            assert.strictEqual(YamlPipeline.DEFAULT_PARALLEL_LIMIT, 5);
        });
    });

    suite('Map-reduce job exports', () => {
        test('exports createPromptMapJob', () => {
            assert.ok(typeof YamlPipeline.createPromptMapJob === 'function');
        });

        test('exports createPromptMapInput', () => {
            assert.ok(typeof YamlPipeline.createPromptMapInput === 'function');
        });
    });

    suite('integration smoke test', () => {
        test('can parse CSV and substitute template', () => {
            const csvContent = 'name,age\nAlice,30';
            const result = YamlPipeline.parseCSVContent(csvContent);

            assert.strictEqual(result.items.length, 1);

            const template = 'Hello {{name}}, you are {{age}} years old.';
            const output = YamlPipeline.substituteTemplate(template, result.items[0]);

            assert.strictEqual(output, 'Hello Alice, you are 30 years old.');
        });

        test('can build full prompt and parse response', () => {
            const prompt = YamlPipeline.buildFullPrompt('Analyze this', ['severity', 'category']);
            assert.ok(prompt.includes('Return JSON with these fields: severity, category'));

            const response = '{"severity": "high", "category": "bug", "extra": "ignored"}';
            const parsed = YamlPipeline.parseAIResponse(response, ['severity', 'category']);

            assert.deepStrictEqual(parsed, { severity: 'high', category: 'bug' });
        });
    });
});
