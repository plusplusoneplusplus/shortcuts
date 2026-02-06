/**
 * Model Registry Integration Tests
 *
 * Tests that the central model registry is properly integrated across
 * the VS Code extension and pipeline-core package.
 *
 * These tests verify:
 * - Registry exports are accessible from extension code
 * - getAvailableModels() uses registry data
 * - Type consistency between registry and extension types
 * - package.json model enums match the registry (via validation script)
 */

import * as assert from 'assert';
import {
    VALID_MODELS,
    AIModel,
    DEFAULT_MODEL_ID,
    ModelDefinition,
    MODEL_REGISTRY,
    getModelLabel,
    getModelDescription,
    getModelDefinition,
    getAllModels,
    getActiveModels,
    isValidModelId,
    getModelCount,
    getModelsByTier,
    AIModelConfig,
} from '../../shortcuts/ai-service';

import {
    getAvailableModels,
} from '../../shortcuts/ai-service/ai-config-helpers';

suite('Model Registry - Extension Integration', () => {
    // ========================================================================
    // Registry Exports Accessibility
    // ========================================================================

    suite('Registry exports are accessible from extension code', () => {
        test('VALID_MODELS is exported and is an array', () => {
            assert.ok(Array.isArray(VALID_MODELS));
            assert.ok(VALID_MODELS.length > 0);
        });

        test('DEFAULT_MODEL_ID is exported and is a string', () => {
            assert.strictEqual(typeof DEFAULT_MODEL_ID, 'string');
            assert.ok(DEFAULT_MODEL_ID.length > 0);
        });

        test('MODEL_REGISTRY is exported and is a Map', () => {
            assert.ok(MODEL_REGISTRY instanceof Map);
            assert.ok(MODEL_REGISTRY.size > 0);
        });

        test('getAllModels is exported and returns models', () => {
            const models = getAllModels();
            assert.ok(Array.isArray(models));
            assert.ok(models.length > 0);
        });

        test('helper functions are exported', () => {
            assert.strictEqual(typeof getModelLabel, 'function');
            assert.strictEqual(typeof getModelDescription, 'function');
            assert.strictEqual(typeof getModelDefinition, 'function');
            assert.strictEqual(typeof getActiveModels, 'function');
            assert.strictEqual(typeof isValidModelId, 'function');
            assert.strictEqual(typeof getModelCount, 'function');
            assert.strictEqual(typeof getModelsByTier, 'function');
        });
    });

    // ========================================================================
    // getAvailableModels() uses registry
    // ========================================================================

    suite('getAvailableModels() derives from registry', () => {
        test('returns same number of models as registry', () => {
            const available = getAvailableModels();
            assert.strictEqual(available.length, getModelCount());
        });

        test('model IDs match registry in order', () => {
            const available = getAvailableModels();
            const registryModels = getAllModels();

            for (let i = 0; i < available.length; i++) {
                assert.strictEqual(available[i].id, registryModels[i].id);
            }
        });

        test('model labels match registry', () => {
            const available = getAvailableModels();

            for (const model of available) {
                assert.strictEqual(model.label, getModelLabel(model.id));
            }
        });

        test('model descriptions match registry', () => {
            const available = getAvailableModels();

            for (const model of available) {
                const registryDesc = getModelDescription(model.id);
                // getAvailableModels converts empty string to undefined
                if (registryDesc) {
                    assert.strictEqual(model.description, registryDesc);
                } else {
                    assert.strictEqual(model.description, undefined);
                }
            }
        });

        test('first model is marked as default', () => {
            const available = getAvailableModels();
            assert.strictEqual(available[0].isDefault, true);
            assert.strictEqual(available[0].id, DEFAULT_MODEL_ID);
        });

        test('only first model is marked as default', () => {
            const available = getAvailableModels();
            for (let i = 1; i < available.length; i++) {
                assert.strictEqual(available[i].isDefault, false);
            }
        });
    });

    // ========================================================================
    // Registry <-> VALID_MODELS Consistency
    // ========================================================================

    suite('VALID_MODELS and registry consistency', () => {
        test('VALID_MODELS contains exactly the registry model IDs', () => {
            const registryIds = getAllModels().map((m: ModelDefinition) => m.id);
            assert.deepStrictEqual([...VALID_MODELS], registryIds);
        });

        test('DEFAULT_MODEL_ID is first in VALID_MODELS', () => {
            assert.strictEqual(DEFAULT_MODEL_ID, VALID_MODELS[0]);
        });

        test('every VALID_MODELS entry is recognized by isValidModelId', () => {
            for (const id of VALID_MODELS) {
                assert.strictEqual(isValidModelId(id), true, `${id} should be valid`);
            }
        });

        test('every VALID_MODELS entry has a definition', () => {
            for (const id of VALID_MODELS) {
                const def = getModelDefinition(id);
                assert.ok(def, `${id} should have a definition`);
                assert.strictEqual(def!.id, id);
            }
        });
    });

    // ========================================================================
    // Model Tier Organization
    // ========================================================================

    suite('Model tiers', () => {
        test('all tiers have at least one model', () => {
            assert.ok(getModelsByTier('fast').length > 0, 'fast tier should have models');
            assert.ok(getModelsByTier('standard').length > 0, 'standard tier should have models');
            assert.ok(getModelsByTier('premium').length > 0, 'premium tier should have models');
        });

        test('tier counts sum to total model count', () => {
            const fast = getModelsByTier('fast').length;
            const standard = getModelsByTier('standard').length;
            const premium = getModelsByTier('premium').length;
            assert.strictEqual(fast + standard + premium, getModelCount());
        });

        test('default model is standard tier', () => {
            const defaultDef = getModelDefinition(DEFAULT_MODEL_ID);
            assert.ok(defaultDef);
            assert.strictEqual(defaultDef!.tier, 'standard');
        });
    });

    // ========================================================================
    // Known Models Snapshot
    // ========================================================================

    suite('Known models snapshot (update when registry changes)', () => {
        test('registry contains expected models', () => {
            const expectedModels = [
                'claude-sonnet-4.5',
                'claude-haiku-4.5',
                'claude-opus-4.6',
                'gpt-5.2',
                'gpt-5.1-codex-max',
                'gemini-3-pro-preview',
            ];

            assert.strictEqual(VALID_MODELS.length, expectedModels.length);

            for (const id of expectedModels) {
                assert.ok(
                    (VALID_MODELS as readonly string[]).includes(id),
                    `Expected model '${id}' in VALID_MODELS`
                );
            }
        });

        test('model labels are human-readable', () => {
            for (const model of getAllModels()) {
                // Labels should be proper case (not lowercase IDs)
                assert.notStrictEqual(model.label, model.id, `Label for '${model.id}' should differ from ID`);
                // Labels should be non-empty
                assert.ok(model.label.length > 0, `Label for '${model.id}' should be non-empty`);
            }
        });
    });

    // ========================================================================
    // Edge Cases
    // ========================================================================

    suite('Edge cases', () => {
        test('isValidModelId returns false for invalid inputs', () => {
            assert.strictEqual(isValidModelId(''), false);
            assert.strictEqual(isValidModelId('gpt-4'), false);
            assert.strictEqual(isValidModelId('nonexistent'), false);
        });

        test('getModelLabel returns raw ID for unknown models', () => {
            assert.strictEqual(getModelLabel('unknown-model'), 'unknown-model');
        });

        test('getModelDescription returns empty for unknown models', () => {
            assert.strictEqual(getModelDescription('unknown-model'), '');
        });

        test('getModelDefinition returns undefined for unknown models', () => {
            assert.strictEqual(getModelDefinition('unknown-model'), undefined);
        });
    });
});
