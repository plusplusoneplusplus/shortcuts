import { describe, it, expect } from 'vitest';
import { isCSVSource, isGenerateConfig } from '../../src/workflow/pipeline-compat';

describe('isCSVSource', () => {
    it('returns true for valid CSV source', () => {
        expect(isCSVSource({ type: 'csv', path: 'data/items.csv' })).toBe(true);
    });

    it('returns true with optional delimiter', () => {
        expect(isCSVSource({ type: 'csv', path: 'file.csv', delimiter: '\t' })).toBe(true);
    });

    it('returns false for generate config', () => {
        expect(isCSVSource({ prompt: 'list items', schema: ['name'] })).toBe(false);
    });

    it('returns false for null', () => {
        expect(isCSVSource(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isCSVSource(undefined)).toBe(false);
    });

    it('returns false for empty object', () => {
        expect(isCSVSource({})).toBe(false);
    });

    it('returns false when type is csv but path is missing', () => {
        expect(isCSVSource({ type: 'csv' })).toBe(false);
    });

    it('returns false when type is csv but path is not a string', () => {
        expect(isCSVSource({ type: 'csv', path: 123 })).toBe(false);
    });

    it('returns false when path exists but type is wrong', () => {
        expect(isCSVSource({ type: 'json', path: 'file.json' })).toBe(false);
    });

    it('returns false for primitive values', () => {
        expect(isCSVSource('csv')).toBe(false);
        expect(isCSVSource(42)).toBe(false);
        expect(isCSVSource(true)).toBe(false);
    });
});

describe('isGenerateConfig', () => {
    it('returns true for valid generate config', () => {
        expect(isGenerateConfig({ prompt: 'Generate 10 items', schema: ['name', 'value'] })).toBe(true);
    });

    it('returns true with optional model and autoApprove', () => {
        expect(isGenerateConfig({
            prompt: 'Generate items',
            schema: ['name'],
            model: 'gpt-4',
            autoApprove: true,
        })).toBe(true);
    });

    it('returns true with empty schema array', () => {
        expect(isGenerateConfig({ prompt: 'Generate', schema: [] })).toBe(true);
    });

    it('returns false for CSV config', () => {
        expect(isGenerateConfig({ type: 'csv', path: 'file.csv' })).toBe(false);
    });

    it('returns false for null', () => {
        expect(isGenerateConfig(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isGenerateConfig(undefined)).toBe(false);
    });

    it('returns false for empty object', () => {
        expect(isGenerateConfig({})).toBe(false);
    });

    it('returns false when prompt exists but schema is missing', () => {
        expect(isGenerateConfig({ prompt: 'Generate items' })).toBe(false);
    });

    it('returns false when schema exists but prompt is missing', () => {
        expect(isGenerateConfig({ schema: ['name'] })).toBe(false);
    });

    it('returns false when prompt is not a string', () => {
        expect(isGenerateConfig({ prompt: 123, schema: ['name'] })).toBe(false);
    });

    it('returns false when schema is not an array', () => {
        expect(isGenerateConfig({ prompt: 'Generate', schema: 'name' })).toBe(false);
    });

    it('returns false for primitive values', () => {
        expect(isGenerateConfig('generate')).toBe(false);
        expect(isGenerateConfig(42)).toBe(false);
        expect(isGenerateConfig(true)).toBe(false);
    });
});
