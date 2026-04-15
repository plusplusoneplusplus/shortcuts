/**
 * Tests for ExtractionConfig validation
 */
import { describe, it, expect } from 'vitest';
import {
    validateExtractionConfig,
    DEFAULT_EXTRACTION_CONFIG,
} from '../../src/server/memory/extraction-config';

describe('validateExtractionConfig', () => {
    it('returns defaults for null input', () => {
        expect(validateExtractionConfig(null)).toEqual(DEFAULT_EXTRACTION_CONFIG);
    });

    it('returns defaults for non-object input', () => {
        expect(validateExtractionConfig('string')).toEqual(DEFAULT_EXTRACTION_CONFIG);
        expect(validateExtractionConfig(123)).toEqual(DEFAULT_EXTRACTION_CONFIG);
    });

    it('returns defaults for empty object', () => {
        expect(validateExtractionConfig({})).toEqual(DEFAULT_EXTRACTION_CONFIG);
    });

    it('accepts valid overrides', () => {
        const config = validateExtractionConfig({
            enabled: false,
            sweepIntervalMs: 60000,
            idleThresholdMs: 30000,
            batchSize: 5,
            model: 'claude-sonnet-4',
            minTurns: 4,
            consolidationThreshold: 50,
        });
        expect(config.enabled).toBe(false);
        expect(config.sweepIntervalMs).toBe(60000);
        expect(config.idleThresholdMs).toBe(30000);
        expect(config.batchSize).toBe(5);
        expect(config.model).toBe('claude-sonnet-4');
        expect(config.minTurns).toBe(4);
        expect(config.consolidationThreshold).toBe(50);
    });

    it('falls back to defaults for invalid field values', () => {
        const config = validateExtractionConfig({
            sweepIntervalMs: -1,
            batchSize: 0,
            model: '',
            minTurns: 0,
        });
        expect(config.sweepIntervalMs).toBe(DEFAULT_EXTRACTION_CONFIG.sweepIntervalMs);
        expect(config.batchSize).toBe(DEFAULT_EXTRACTION_CONFIG.batchSize);
        expect(config.model).toBe(DEFAULT_EXTRACTION_CONFIG.model);
        expect(config.minTurns).toBe(DEFAULT_EXTRACTION_CONFIG.minTurns);
    });

    it('floors fractional numbers', () => {
        const config = validateExtractionConfig({
            batchSize: 3.7,
            minTurns: 2.9,
            consolidationThreshold: 15.1,
        });
        expect(config.batchSize).toBe(3);
        expect(config.minTurns).toBe(2);
        expect(config.consolidationThreshold).toBe(15);
    });
});
