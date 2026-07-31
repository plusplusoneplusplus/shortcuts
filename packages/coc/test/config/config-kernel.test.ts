/**
 * Kernel-contract tests for the config setting registry.
 *
 * Beyond the admin registry (covered in admin-setting-definitions.test.ts),
 * these assert the file-only leaf registry and the descriptor-driven top-level
 * scalar merge: defaults are generated from one place, source keys are derived,
 * and merge behavior (including present-as-undefined shape) matches the prior
 * hand-written literals.
 */

import { describe, it, expect } from 'vitest';
import {
    CONFIG_SOURCE_KEYS,
    DEFAULT_CONFIG,
    mergeConfig,
    type CLIConfig,
} from '../../src/config';
import {
    FILE_ONLY_TOP_LEVEL_LEAVES,
    FILE_ONLY_NAMESPACE_LEAVES,
    getNamespaceFieldSource,
} from '../../src/config/namespace-registry';
import {
    TOP_LEVEL_ADMIN_SETTING_KEYS,
    getConfigValueAtPath,
    setConfigValueAtPath,
} from '../../src/config/admin-setting-definitions';

function configWith(key: string, value: unknown): CLIConfig {
    const config: Record<string, unknown> = {};
    setConfigValueAtPath(config, key, value);
    return config as CLIConfig;
}

const ALL_FILE_ONLY_LEAVES = [...FILE_ONLY_TOP_LEVEL_LEAVES, ...FILE_ONLY_NAMESPACE_LEAVES];

// ── file-only leaf registry defaults ──────────────────────────────────────────

describe('file-only leaf defaults match DEFAULT_CONFIG', () => {
    for (const leaf of ALL_FILE_ONLY_LEAVES) {
        it(`'${leaf.key}' default matches DEFAULT_CONFIG`, () => {
            expect(getConfigValueAtPath(DEFAULT_CONFIG, leaf.key)).toEqual(leaf.default);
        });
    }

    it('has unique file-only leaf keys', () => {
        const seen = new Set<string>();
        for (const leaf of ALL_FILE_ONLY_LEAVES) {
            expect(seen.has(leaf.key), `duplicate file-only leaf: ${leaf.key}`).toBe(false);
            seen.add(leaf.key);
        }
    });
});

// ── source-key generation ─────────────────────────────────────────────────────

describe('CONFIG_SOURCE_KEYS is generated from the registries', () => {
    it('covers exactly the expected top-level scalar keys', () => {
        const topLevel = CONFIG_SOURCE_KEYS.filter(k => !k.includes('.'));
        expect(new Set(topLevel)).toEqual(new Set([
            ...TOP_LEVEL_ADMIN_SETTING_KEYS,
            ...FILE_ONLY_TOP_LEVEL_LEAVES.map(l => l.key),
        ]));
        // The three file-only top-level scalars remain tracked.
        for (const key of ['approvePermissions', 'mcpConfig', 'persist']) {
            expect(CONFIG_SOURCE_KEYS).toContain(key);
        }
    });

    it('tracks source-tracked file-only namespace leaves', () => {
        for (const leaf of FILE_ONLY_NAMESPACE_LEAVES) {
            if (leaf.sourceTracked === false) continue;
            expect(CONFIG_SOURCE_KEYS, `untracked leaf: ${leaf.key}`).toContain(leaf.key);
        }
    });

    it('does not source-track leaves flagged sourceTracked:false', () => {
        // features.gitCommitLookup is merged but carries no source indicator.
        expect(FILE_ONLY_NAMESPACE_LEAVES.some(l => l.key === 'features.gitCommitLookup' && l.sourceTracked === false)).toBe(true);
        expect(CONFIG_SOURCE_KEYS).not.toContain('features.gitCommitLookup');
    });

    it('has no duplicate keys', () => {
        expect(new Set(CONFIG_SOURCE_KEYS).size).toBe(CONFIG_SOURCE_KEYS.length);
    });
});

// ── descriptor-driven top-level scalar merge ──────────────────────────────────

describe('top-level scalar merge', () => {
    it('with no override, every top-level scalar resolves to its DEFAULT_CONFIG value', () => {
        const resolved = mergeConfig(DEFAULT_CONFIG, undefined) as Record<string, unknown>;
        for (const key of CONFIG_SOURCE_KEYS.filter(k => !k.includes('.'))) {
            expect(resolved[key], key).toEqual((DEFAULT_CONFIG as Record<string, unknown>)[key]);
        }
    });

    it('a file value wins over the default for each top-level scalar', () => {
        const overrides: Record<string, unknown> = {
            model: 'gpt-x', parallel: 12, output: 'json', timeout: 99,
            showReportIntent: true, showPlanDepTab: true, toolCompactness: 1,
            taskCardDensity: 'compact', groupSingleLineMessages: false, defaultProvider: 'codex',
            approvePermissions: true, mcpConfig: '/tmp/mcp.json', persist: false,
        };
        for (const [key, value] of Object.entries(overrides)) {
            const resolved = mergeConfig(DEFAULT_CONFIG, { [key]: value } as CLIConfig) as Record<string, unknown>;
            expect(resolved[key], key).toEqual(value);
        }
    });

    it('preserves present-as-undefined shape for optional scalars', () => {
        const resolved = mergeConfig(DEFAULT_CONFIG, { model: 'only-model' } as CLIConfig) as Record<string, unknown>;
        // Unset optional scalars are present with an undefined value (not absent).
        expect('timeout' in resolved).toBe(true);
        expect(resolved.timeout).toBeUndefined();
        expect('mcpConfig' in resolved).toBe(true);
        expect(resolved.mcpConfig).toBeUndefined();
    });
});

// ── file-only namespace leaf merge + source tracking ──────────────────────────

describe('file-only namespace leaf merge', () => {
    for (const leaf of FILE_ONLY_NAMESPACE_LEAVES) {
        it(`'${leaf.key}' resolves to its default without a file value`, () => {
            const resolved = mergeConfig(DEFAULT_CONFIG, undefined);
            expect(getConfigValueAtPath(resolved, leaf.key)).toEqual(leaf.default);
        });
    }

    it('a file value wins over the default (serve.port)', () => {
        const resolved = mergeConfig(DEFAULT_CONFIG, configWith('serve.port', 8123));
        expect(getConfigValueAtPath(resolved, 'serve.port')).toBe(8123);
    });

    it('preserves present-as-undefined for memoryPromotion.model', () => {
        const resolved = mergeConfig(DEFAULT_CONFIG, undefined) as Record<string, unknown>;
        const mp = resolved.memoryPromotion as Record<string, unknown>;
        expect('model' in mp).toBe(true);
        expect(mp.model).toBeUndefined();
    });
});

describe('file-only leaf source tracking', () => {
    for (const leaf of FILE_ONLY_NAMESPACE_LEAVES) {
        if (leaf.sourceTracked === false) continue;
        it(`'${leaf.key}' reports 'default' without a file value and 'file' with one`, () => {
            expect(getNamespaceFieldSource(leaf.key, {} as CLIConfig)).toBe('default');
            expect(getNamespaceFieldSource(leaf.key, configWith(leaf.key, leaf.default ?? 'x'))).toBe('file');
        });
    }

    it('returns undefined for a non-tracked key (features.gitCommitLookup)', () => {
        expect(getNamespaceFieldSource('features.gitCommitLookup', { features: { gitCommitLookup: true } } as CLIConfig)).toBeUndefined();
    });
});
