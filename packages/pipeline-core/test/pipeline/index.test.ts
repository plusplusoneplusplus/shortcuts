/**
 * Tests for YAML Pipeline index exports
 *
 * Verifies all modules are properly exported.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import * as PipelineCore from '../../src/pipeline';

describe('Pipeline Index Exports', () => {
    describe('CSV Reader exports', () => {
        it('exports parseCSVContent', () => {
            expect(typeof PipelineCore.parseCSVContent).toBe('function');
        });

        it('exports readCSVFile', () => {
            expect(typeof PipelineCore.readCSVFile).toBe('function');
        });

        it('exports readCSVFileSync', () => {
            expect(typeof PipelineCore.readCSVFileSync).toBe('function');
        });

        it('exports resolveCSVPath', () => {
            expect(typeof PipelineCore.resolveCSVPath).toBe('function');
        });

        it('exports validateCSVHeaders', () => {
            expect(typeof PipelineCore.validateCSVHeaders).toBe('function');
        });

        it('exports getCSVPreview', () => {
            expect(typeof PipelineCore.getCSVPreview).toBe('function');
        });

        it('exports CSVParseError', () => {
            expect(typeof PipelineCore.CSVParseError).toBe('function');
        });

        it('exports DEFAULT_CSV_OPTIONS', () => {
            expect(PipelineCore.DEFAULT_CSV_OPTIONS).toBeTruthy();
            expect(PipelineCore.DEFAULT_CSV_OPTIONS.delimiter).toBe(',');
        });
    });

    describe('Template exports', () => {
        it('exports substituteTemplate', () => {
            expect(typeof PipelineCore.substituteTemplate).toBe('function');
        });

        it('exports extractVariables', () => {
            expect(typeof PipelineCore.extractVariables).toBe('function');
        });

        it('exports validateItemForTemplate', () => {
            expect(typeof PipelineCore.validateItemForTemplate).toBe('function');
        });

        it('exports buildFullPrompt', () => {
            expect(typeof PipelineCore.buildFullPrompt).toBe('function');
        });

        it('exports buildPromptFromTemplate', () => {
            expect(typeof PipelineCore.buildPromptFromTemplate).toBe('function');
        });

        it('exports parseAIResponse', () => {
            expect(typeof PipelineCore.parseAIResponse).toBe('function');
        });

        it('exports extractJSON', () => {
            expect(typeof PipelineCore.extractJSON).toBe('function');
        });

        it('exports escapeTemplateValue', () => {
            expect(typeof PipelineCore.escapeTemplateValue).toBe('function');
        });

        it('exports previewTemplate', () => {
            expect(typeof PipelineCore.previewTemplate).toBe('function');
        });

        it('exports TemplateError', () => {
            expect(typeof PipelineCore.TemplateError).toBe('function');
        });
    });

    describe('Executor exports', () => {
        it('exports executePipeline', () => {
            expect(typeof PipelineCore.executePipeline).toBe('function');
        });

        it('exports parsePipelineYAML', () => {
            expect(typeof PipelineCore.parsePipelineYAML).toBe('function');
        });

        it('exports parsePipelineYAMLSync', () => {
            expect(typeof PipelineCore.parsePipelineYAMLSync).toBe('function');
        });

        it('exports PipelineExecutionError', () => {
            expect(typeof PipelineCore.PipelineExecutionError).toBe('function');
        });

        it('exports DEFAULT_PARALLEL_LIMIT', () => {
            expect(PipelineCore.DEFAULT_PARALLEL_LIMIT).toBe(5);
        });
    });

    describe('integration smoke test', () => {
        it('can parse CSV and substitute template', () => {
            const csvContent = 'name,age\nAlice,30';
            const result = PipelineCore.parseCSVContent(csvContent);

            expect(result.items.length).toBe(1);

            const template = 'Hello {{name}}, you are {{age}} years old.';
            const output = PipelineCore.substituteTemplate(template, result.items[0]);

            expect(output).toBe('Hello Alice, you are 30 years old.');
        });

        it('can build full prompt and parse response', () => {
            const prompt = PipelineCore.buildFullPrompt('Analyze this', ['severity', 'category']);
            expect(prompt).toContain('Return JSON with these fields: severity, category');

            const response = '{"severity": "high", "category": "bug", "extra": "ignored"}';
            const parsed = PipelineCore.parseAIResponse(response, ['severity', 'category']);

            expect(parsed).toEqual({ severity: 'high', category: 'bug' });
        });
    });
});
