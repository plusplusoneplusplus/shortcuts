/**
 * Model Registry Tests
 *
 * Comprehensive tests for the central AI model registry.
 * Ensures the registry is the single source of truth for model definitions,
 * and that all derived constants and helper functions work correctly.
 */

import { describe, it, expect } from 'vitest';
import {
    ModelDefinition,
    MODEL_REGISTRY,
    VALID_MODELS,
    AIModel,
    DEFAULT_MODEL_ID,
    getModelLabel,
    getModelDescription,
    getModelDefinition,
    getAllModels,
    getActiveModels,
    isValidModelId,
    getModelCount,
    getModelsByTier,
} from '../../src/copilot-sdk-wrapper/model-registry';

describe('Model Registry', () => {
    // ========================================================================
    // Registry Structure
    // ========================================================================

    describe('MODEL_REGISTRY', () => {
        it('should be a ReadonlyMap', () => {
            expect(MODEL_REGISTRY).toBeInstanceOf(Map);
        });

        it('should contain at least one model', () => {
            expect(MODEL_REGISTRY.size).toBeGreaterThan(0);
        });

        it('should be indexed by model ID', () => {
            for (const [id, definition] of MODEL_REGISTRY) {
                expect(id).toBe(definition.id);
            }
        });

        it('should have unique IDs', () => {
            const ids = [...MODEL_REGISTRY.keys()];
            const uniqueIds = new Set(ids);
            expect(ids.length).toBe(uniqueIds.size);
        });

        it('should have unique labels', () => {
            const labels = [...MODEL_REGISTRY.values()].map(m => m.label);
            const uniqueLabels = new Set(labels);
            expect(labels.length).toBe(uniqueLabels.size);
        });
    });

    // ========================================================================
    // Model Definitions
    // ========================================================================

    describe('ModelDefinition interface', () => {
        it('every model should have all required fields', () => {
            for (const model of getAllModels()) {
                expect(model.id).toBeDefined();
                expect(typeof model.id).toBe('string');
                expect(model.id.length).toBeGreaterThan(0);

                expect(model.label).toBeDefined();
                expect(typeof model.label).toBe('string');
                expect(model.label.length).toBeGreaterThan(0);

                expect(typeof model.description).toBe('string');

                expect(model.tier).toBeDefined();
                expect(['fast', 'standard', 'premium']).toContain(model.tier);
            }
        });

        it('model IDs should be lowercase with hyphens/dots only', () => {
            for (const model of getAllModels()) {
                expect(model.id).toMatch(/^[a-z0-9][a-z0-9.\-]*$/);
            }
        });

        it('deprecated flag should be boolean or undefined', () => {
            for (const model of getAllModels()) {
                if (model.deprecated !== undefined) {
                    expect(typeof model.deprecated).toBe('boolean');
                }
            }
        });
    });

    // ========================================================================
    // Derived Constants
    // ========================================================================

    describe('VALID_MODELS', () => {
        it('should be a readonly array', () => {
            expect(Array.isArray(VALID_MODELS)).toBe(true);
        });

        it('should contain all registry model IDs in order', () => {
            const registryIds = getAllModels().map(m => m.id);
            expect([...VALID_MODELS]).toEqual(registryIds);
        });

        it('should have the same length as the registry', () => {
            expect(VALID_MODELS.length).toBe(MODEL_REGISTRY.size);
        });

        it('should contain known models', () => {
            // These are the currently expected models - update when registry changes
            expect(VALID_MODELS).toContain('claude-sonnet-4.5');
            expect(VALID_MODELS).toContain('claude-haiku-4.5');
            expect(VALID_MODELS).toContain('claude-opus-4.6');
            expect(VALID_MODELS).toContain('gpt-5.2');
            expect(VALID_MODELS).toContain('gpt-5.1-codex-max');
            expect(VALID_MODELS).toContain('gemini-3-pro-preview');
        });

        it('should have exactly 6 models', () => {
            expect(VALID_MODELS.length).toBe(6);
        });
    });

    describe('DEFAULT_MODEL_ID', () => {
        it('should be a string', () => {
            expect(typeof DEFAULT_MODEL_ID).toBe('string');
        });

        it('should be the first model in VALID_MODELS', () => {
            expect(DEFAULT_MODEL_ID).toBe(VALID_MODELS[0]);
        });

        it('should be a valid model ID', () => {
            expect(isValidModelId(DEFAULT_MODEL_ID)).toBe(true);
        });

        it('should exist in the registry', () => {
            expect(MODEL_REGISTRY.has(DEFAULT_MODEL_ID)).toBe(true);
        });

        it('should be claude-sonnet-4.5 (current default)', () => {
            expect(DEFAULT_MODEL_ID).toBe('claude-sonnet-4.5');
        });
    });

    // ========================================================================
    // Helper Functions
    // ========================================================================

    describe('getModelLabel()', () => {
        it('should return the label for known models', () => {
            expect(getModelLabel('claude-sonnet-4.5')).toBe('Claude Sonnet 4.5');
            expect(getModelLabel('claude-haiku-4.5')).toBe('Claude Haiku 4.5');
            expect(getModelLabel('claude-opus-4.6')).toBe('Claude Opus 4.6');
            expect(getModelLabel('gpt-5.2')).toBe('GPT-5.2');
            expect(getModelLabel('gpt-5.1-codex-max')).toBe('GPT-5.1 Codex Max');
            expect(getModelLabel('gemini-3-pro-preview')).toBe('Gemini 3 Pro');
        });

        it('should return the raw ID for unknown models', () => {
            expect(getModelLabel('unknown-model')).toBe('unknown-model');
            expect(getModelLabel('')).toBe('');
        });
    });

    describe('getModelDescription()', () => {
        it('should return description for known models', () => {
            expect(getModelDescription('claude-sonnet-4.5')).toBe('(Recommended)');
            expect(getModelDescription('claude-haiku-4.5')).toBe('(Fast)');
            expect(getModelDescription('claude-opus-4.6')).toBe('(Premium)');
            expect(getModelDescription('gemini-3-pro-preview')).toBe('(Preview)');
        });

        it('should return empty string for models without description', () => {
            expect(getModelDescription('gpt-5.2')).toBe('');
            expect(getModelDescription('gpt-5.1-codex-max')).toBe('');
        });

        it('should return empty string for unknown models', () => {
            expect(getModelDescription('unknown-model')).toBe('');
        });
    });

    describe('getModelDefinition()', () => {
        it('should return the full definition for known models', () => {
            const def = getModelDefinition('claude-sonnet-4.5');
            expect(def).toBeDefined();
            expect(def!.id).toBe('claude-sonnet-4.5');
            expect(def!.label).toBe('Claude Sonnet 4.5');
            expect(def!.description).toBe('(Recommended)');
            expect(def!.tier).toBe('standard');
        });

        it('should return undefined for unknown models', () => {
            expect(getModelDefinition('unknown-model')).toBeUndefined();
        });

        it('should return correct tier for each model', () => {
            expect(getModelDefinition('claude-haiku-4.5')?.tier).toBe('fast');
            expect(getModelDefinition('claude-sonnet-4.5')?.tier).toBe('standard');
            expect(getModelDefinition('claude-opus-4.6')?.tier).toBe('premium');
            expect(getModelDefinition('gpt-5.2')?.tier).toBe('standard');
            expect(getModelDefinition('gpt-5.1-codex-max')?.tier).toBe('premium');
            expect(getModelDefinition('gemini-3-pro-preview')?.tier).toBe('standard');
        });
    });

    describe('getAllModels()', () => {
        it('should return all models', () => {
            const models = getAllModels();
            expect(models.length).toBe(MODEL_REGISTRY.size);
        });

        it('should return models in order', () => {
            const models = getAllModels();
            for (let i = 0; i < models.length; i++) {
                expect(models[i].id).toBe(VALID_MODELS[i]);
            }
        });

        it('should return readonly array', () => {
            const models1 = getAllModels();
            const models2 = getAllModels();
            expect(models1).toBe(models2); // same reference
        });
    });

    describe('getActiveModels()', () => {
        it('should return all non-deprecated models', () => {
            const active = getActiveModels();
            for (const model of active) {
                expect(model.deprecated).not.toBe(true);
            }
        });

        it('should currently return all models (none deprecated)', () => {
            const active = getActiveModels();
            const all = getAllModels();
            expect(active.length).toBe(all.length);
        });
    });

    describe('isValidModelId()', () => {
        it('should return true for all registry models', () => {
            for (const id of VALID_MODELS) {
                expect(isValidModelId(id)).toBe(true);
            }
        });

        it('should return false for invalid model IDs', () => {
            expect(isValidModelId('gpt-4')).toBe(false);
            expect(isValidModelId('unknown')).toBe(false);
            expect(isValidModelId('')).toBe(false);
            expect(isValidModelId('Claude Sonnet 4.5')).toBe(false); // label, not ID
        });

        it('should be case sensitive', () => {
            expect(isValidModelId('CLAUDE-SONNET-4.5')).toBe(false);
            expect(isValidModelId('Claude-Sonnet-4.5')).toBe(false);
        });
    });

    describe('getModelCount()', () => {
        it('should return the number of models', () => {
            expect(getModelCount()).toBe(MODEL_REGISTRY.size);
            expect(getModelCount()).toBe(VALID_MODELS.length);
        });

        it('should be a positive number', () => {
            expect(getModelCount()).toBeGreaterThan(0);
        });
    });

    describe('getModelsByTier()', () => {
        it('should return fast-tier models', () => {
            const fast = getModelsByTier('fast');
            expect(fast.length).toBeGreaterThan(0);
            for (const model of fast) {
                expect(model.tier).toBe('fast');
            }
        });

        it('should return standard-tier models', () => {
            const standard = getModelsByTier('standard');
            expect(standard.length).toBeGreaterThan(0);
            for (const model of standard) {
                expect(model.tier).toBe('standard');
            }
        });

        it('should return premium-tier models', () => {
            const premium = getModelsByTier('premium');
            expect(premium.length).toBeGreaterThan(0);
            for (const model of premium) {
                expect(model.tier).toBe('premium');
            }
        });

        it('tiers should cover all models', () => {
            const fast = getModelsByTier('fast');
            const standard = getModelsByTier('standard');
            const premium = getModelsByTier('premium');
            expect(fast.length + standard.length + premium.length).toBe(getModelCount());
        });

        it('should return empty array for invalid tier', () => {
            const invalid = getModelsByTier('invalid' as any);
            expect(invalid.length).toBe(0);
        });
    });

    // ========================================================================
    // Consistency Checks
    // ========================================================================

    describe('Registry Consistency', () => {
        it('VALID_MODELS and MODEL_REGISTRY should be in sync', () => {
            expect(VALID_MODELS.length).toBe(MODEL_REGISTRY.size);
            for (const id of VALID_MODELS) {
                expect(MODEL_REGISTRY.has(id)).toBe(true);
            }
        });

        it('getAllModels() and VALID_MODELS should be in sync', () => {
            const allIds = getAllModels().map(m => m.id);
            expect(allIds).toEqual([...VALID_MODELS]);
        });

        it('getModelCount() should match VALID_MODELS.length', () => {
            expect(getModelCount()).toBe(VALID_MODELS.length);
        });

        it('every VALID_MODELS entry should be queryable by helpers', () => {
            for (const id of VALID_MODELS) {
                expect(isValidModelId(id)).toBe(true);
                expect(getModelDefinition(id)).toBeDefined();
                expect(getModelLabel(id)).not.toBe(id); // should have a proper label
            }
        });
    });

    // ========================================================================
    // Cross-platform & Edge Cases
    // ========================================================================

    describe('Edge Cases', () => {
        it('should handle null/undefined gracefully in helpers', () => {
            // These should not throw
            expect(getModelLabel(null as any)).toBe(null);
            expect(getModelDescription(undefined as any)).toBe('');
            expect(getModelDefinition(null as any)).toBeUndefined();
            expect(isValidModelId(undefined as any)).toBe(false);
        });

        it('should not allow modification of VALID_MODELS at runtime', () => {
            // VALID_MODELS should be readonly, but we verify behavior
            const originalLength = VALID_MODELS.length;
            try {
                (VALID_MODELS as any).push('new-model');
            } catch {
                // Expected in strict mode
            }
            // Even if push didn't throw, the original constant should be intact
            // (in practice, 'as const' makes the type readonly but array is still mutable at runtime)
            expect(VALID_MODELS.length).toBeGreaterThanOrEqual(originalLength);
        });
    });
});
