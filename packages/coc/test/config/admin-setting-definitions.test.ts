/**
 * Generic contract tests for the unified admin setting registry.
 *
 * Every definition in ADMIN_SETTING_DEFINITIONS is verified end-to-end:
 * DEFAULT_CONFIG consistency, file-schema validation, admin validate/apply,
 * resolved-config merge, source-key tracking, runtime feature flags, and
 * Features-card UI metadata. Adding a new setting to the registry gets this
 * coverage automatically — no per-setting test is required for the standard
 * contract.
 */

import { describe, it, expect } from 'vitest';
import {
    ADMIN_SETTING_DEFINITIONS,
    ADMIN_SETTING_KEYS,
    FEATURE_CARD_GROUPS,
    NAMESPACED_ADMIN_SETTING_KEYS,
    getConfigValueAtPath,
    setConfigValueAtPath,
    getFeatureCardSettings,
    readAdminSettingValue,
    buildRuntimeFeatureFlags,
    validateAdminSettingValue,
    applyAdminSettingValue,
    type AdminSettingDefinition,
} from '../../src/config/admin-setting-definitions';
import { ADMIN_EDITABLE_KEYS } from '../../src/server/admin/admin-config-fields';
import { CLIConfigSchema } from '../../src/config/schema';
import { CONFIG_SOURCE_KEYS, DEFAULT_CONFIG, mergeConfig, type CLIConfig } from '../../src/config';
import { getNamespaceFieldSource } from '../../src/config/namespace-registry';
import { buildRuntimeFeatures } from '../../src/server/config/runtime-config-handler';

// ── per-kind sample helpers ───────────────────────────────────────────────────

/** A value that must pass validation for this definition. */
function validSample(def: AdminSettingDefinition): unknown {
    const spec = def.value;
    switch (spec.kind) {
        case 'boolean':
            return true;
        case 'string':
            return 'sample';
        case 'number':
            if (typeof def.default === 'number') return def.default;
            return (spec.min ?? (spec.gt !== undefined ? spec.gt + 1 : 1));
        case 'enum':
            return spec.values[0];
        case 'custom':
            return def.default;
    }
}

/** A valid value that differs from the resolved default (for merge tests). */
function alternateValidValue(def: AdminSettingDefinition): unknown {
    const spec = def.value;
    switch (spec.kind) {
        case 'boolean':
            return def.default !== true;
        case 'string':
            return 'alternate';
        case 'enum':
            return spec.values.find(v => v !== def.default) ?? spec.values[0];
        case 'number': {
            const base = typeof def.default === 'number' ? def.default : (spec.min ?? 1);
            const candidate = spec.max !== undefined && base + 1 > spec.max ? base - 1 : base + 1;
            return candidate;
        }
        case 'custom':
            return undefined;
    }
}

/** A value that must FAIL validation for this definition. */
function invalidProbe(def: AdminSettingDefinition): unknown {
    switch (def.value.kind) {
        case 'boolean': return 'not-a-boolean';
        case 'string': return 12345;
        case 'number': return 'not-a-number';
        case 'enum': return '__not_a_valid_enum_value__';
        case 'custom': return 42;
    }
}

function nestedConfigWith(key: string, value: unknown): CLIConfig {
    const config: Record<string, unknown> = {};
    setConfigValueAtPath(config, key, value);
    return config as CLIConfig;
}

// ── registry integrity ────────────────────────────────────────────────────────

describe('admin setting registry integrity', () => {
    it('has unique keys', () => {
        const seen = new Set<string>();
        for (const key of ADMIN_SETTING_KEYS) {
            expect(seen.has(key), `duplicate key: ${key}`).toBe(false);
            seen.add(key);
        }
    });

    it('has unique runtime flags', () => {
        const seen = new Set<string>();
        for (const def of ADMIN_SETTING_DEFINITIONS) {
            if (!def.runtimeFlag) continue;
            expect(seen.has(def.runtimeFlag), `duplicate runtimeFlag: ${def.runtimeFlag}`).toBe(false);
            seen.add(def.runtimeFlag);
        }
    });

    it('derives ADMIN_EDITABLE_KEYS 1:1 from the registry', () => {
        expect([...ADMIN_EDITABLE_KEYS]).toEqual([...ADMIN_SETTING_KEYS]);
    });

    it('tracks every setting in CONFIG_SOURCE_KEYS', () => {
        for (const key of ADMIN_SETTING_KEYS) {
            expect(CONFIG_SOURCE_KEYS, `untracked key: ${key}`).toContain(key);
        }
    });

    it('namespaced keys are exactly the dotted keys', () => {
        expect([...NAMESPACED_ADMIN_SETTING_KEYS]).toEqual(ADMIN_SETTING_KEYS.filter(k => k.includes('.')));
    });
});

// ── DEFAULT_CONFIG consistency ────────────────────────────────────────────────

describe('registry defaults match DEFAULT_CONFIG', () => {
    for (const def of ADMIN_SETTING_DEFINITIONS) {
        it(`'${def.key}' default matches DEFAULT_CONFIG`, () => {
            expect(getConfigValueAtPath(DEFAULT_CONFIG, def.key)).toEqual(def.default);
        });
    }
});

// ── file schema (generated from the registry) ─────────────────────────────────

describe('config file schema covers every setting', () => {
    for (const def of ADMIN_SETTING_DEFINITIONS) {
        if (def.default !== undefined) {
            it(`'${def.key}' accepts its default value`, () => {
                expect(() => CLIConfigSchema.parse(nestedConfigWith(def.key, def.default))).not.toThrow();
            });
        }

        it(`'${def.key}' accepts a valid sample`, () => {
            const sample = validSample(def);
            if (sample === undefined) return;
            expect(() => CLIConfigSchema.parse(nestedConfigWith(def.key, sample))).not.toThrow();
        });

        if (def.value.kind !== 'custom' && def.value.kind !== 'string') {
            it(`'${def.key}' rejects an invalid value`, () => {
                expect(() => CLIConfigSchema.parse(nestedConfigWith(def.key, invalidProbe(def)))).toThrow();
            });
        }
    }
});

// ── admin API validation + apply ──────────────────────────────────────────────

describe('admin validate/apply round-trip', () => {
    for (const def of ADMIN_SETTING_DEFINITIONS) {
        it(`'${def.key}' accepts a valid value and rejects an invalid one`, () => {
            expect(validateAdminSettingValue(def, validSample(def))).toBeUndefined();
            expect(typeof validateAdminSettingValue(def, invalidProbe(def))).toBe('string');
        });

        it(`'${def.key}' apply() writes the value at the key path`, () => {
            const config: CLIConfig = {};
            const sample = validSample(def);
            applyAdminSettingValue(config, def, sample);
            expect(getConfigValueAtPath(config, def.key)).toEqual(sample);
        });

        const spec = def.value;
        if ((spec.kind === 'number' || spec.kind === 'string') && spec.nullable) {
            it(`'${def.key}' accepts null and apply(null) clears the stored value`, () => {
                expect(validateAdminSettingValue(def, null)).toBeUndefined();
                const config: CLIConfig = {};
                applyAdminSettingValue(config, def, validSample(def));
                applyAdminSettingValue(config, def, null);
                expect(getConfigValueAtPath(config, def.key)).toBeUndefined();
            });
        }
    }
});

// ── resolved config merge ─────────────────────────────────────────────────────

describe('resolved config merge honors file overrides', () => {
    it('with no override, every setting resolves to its default', () => {
        const resolved = mergeConfig(DEFAULT_CONFIG, undefined);
        for (const def of ADMIN_SETTING_DEFINITIONS) {
            expect(getConfigValueAtPath(resolved, def.key), def.key).toEqual(def.default);
        }
    });

    for (const def of ADMIN_SETTING_DEFINITIONS) {
        if (def.customMerge) continue;
        const override = alternateValidValue(def);
        if (override === undefined) continue;

        it(`'${def.key}' file value wins over the default`, () => {
            const resolved = mergeConfig(DEFAULT_CONFIG, nestedConfigWith(def.key, override));
            expect(getConfigValueAtPath(resolved, def.key)).toEqual(override);
        });
    }
});

// ── source tracking ───────────────────────────────────────────────────────────

describe('per-field source tracking', () => {
    for (const key of NAMESPACED_ADMIN_SETTING_KEYS) {
        it(`'${key}' reports 'default' without a file value and 'file' with one`, () => {
            const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === key)!;
            expect(getNamespaceFieldSource(key, {} as CLIConfig)).toBe('default');
            const sample = validSample(def);
            expect(getNamespaceFieldSource(key, nestedConfigWith(key, sample))).toBe('file');
        });
    }
});

// ── runtime feature flags ─────────────────────────────────────────────────────

describe('runtime feature flags', () => {
    it('exposes every runtimeFlag from a resolved config with its resolved value', () => {
        const flags = buildRuntimeFeatures(DEFAULT_CONFIG);
        for (const def of ADMIN_SETTING_DEFINITIONS) {
            if (!def.runtimeFlag) continue;
            expect((flags as Record<string, unknown>)[def.runtimeFlag], def.runtimeFlag).toEqual(def.default);
        }
    });

    it('includes the hand-mapped gitCommitLookupEnabled flag', () => {
        const flags = buildRuntimeFeatures(DEFAULT_CONFIG) as Record<string, unknown>;
        expect(flags.gitCommitLookupEnabled).toBe(false);
    });

    it('exposes only the unified native CLI sessions runtime flag', () => {
        const flags = buildRuntimeFeatures(DEFAULT_CONFIG) as Record<string, unknown>;
        expect(flags.nativeCliSessionsEnabled).toBe(false);
        expect(flags.nativeCopilotSessionsEnabled).toBeUndefined();
        expect(ADMIN_SETTING_DEFINITIONS.some(def => def.key === 'features.nativeCopilotSessions')).toBe(false);
    });

    it('registers exploration.enabled as a live, default-off feature flag (AC-08)', () => {
        const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === 'exploration.enabled');
        expect(def, 'exploration.enabled must be an admin setting').toBeDefined();
        expect(def!.value).toEqual({ kind: 'boolean' });
        expect(def!.default, 'exploration.enabled must default off').toBe(false);
        expect(def!.runtime).toBe('live');
        expect(def!.runtimeFlag).toBe('explorationEnabled');
        expect((buildRuntimeFeatures(DEFAULT_CONFIG) as Record<string, unknown>).explorationEnabled).toBe(false);
        expect(buildRuntimeFeatureFlags({}).explorationEnabled).toBe(false);
    });

    it('falls back to absentFallback ?? default for partial configs', () => {
        const flags = buildRuntimeFeatureFlags({});
        for (const def of ADMIN_SETTING_DEFINITIONS) {
            if (!def.runtimeFlag) continue;
            const expected = def.absentFallback !== undefined ? def.absentFallback : def.default;
            expect(flags[def.runtimeFlag], def.runtimeFlag).toEqual(expected);
        }
    });
});

// ── value reading (admin UI loader) ───────────────────────────────────────────

describe('readAdminSettingValue', () => {
    for (const def of ADMIN_SETTING_DEFINITIONS) {
        it(`'${def.key}' returns stored valid values and falls back otherwise`, () => {
            const sample = validSample(def);
            expect(readAdminSettingValue(def, nestedConfigWith(def.key, sample))).toEqual(sample);

            const fallback = def.absentFallback !== undefined ? def.absentFallback : def.default;
            expect(readAdminSettingValue(def, {})).toEqual(fallback);
            expect(readAdminSettingValue(def, nestedConfigWith(def.key, invalidProbe(def)))).toEqual(fallback);
        });
    }
});

// ── Features card UI metadata ─────────────────────────────────────────────────

describe('Features card UI metadata', () => {
    const uiDefs = ADMIN_SETTING_DEFINITIONS.filter(d => d.ui);

    it('has unique testIds', () => {
        const seen = new Set<string>();
        for (const def of uiDefs) {
            expect(seen.has(def.ui!.testId), `duplicate testId: ${def.ui!.testId}`).toBe(false);
            seen.add(def.ui!.testId);
        }
    });

    it('uses known groups and unique order within each group', () => {
        const groupIds = new Set(FEATURE_CARD_GROUPS.map(g => g.id));
        for (const def of uiDefs) {
            expect(groupIds.has(def.ui!.group), `unknown group for ${def.key}`).toBe(true);
        }
        for (const group of FEATURE_CARD_GROUPS) {
            const orders = getFeatureCardSettings(group.id).map(d => d.ui!.order);
            expect(new Set(orders).size, `duplicate ui.order in group ${group.id}`).toBe(orders.length);
        }
    });

    it('has non-empty label and hint, and testIds follow the control convention', () => {
        for (const def of uiDefs) {
            expect(def.ui!.label.length, def.key).toBeGreaterThan(0);
            expect(def.ui!.hint.length, def.key).toBeGreaterThan(0);
            const prefix = def.ui!.control?.type === 'select' ? 'select-' : 'toggle-';
            expect(def.ui!.testId.startsWith(prefix), `${def.key} testId should start with '${prefix}'`).toBe(true);
        }
    });

    it('dependsOn points at a boolean setting rendered on the card', () => {
        for (const def of uiDefs) {
            const dependsOn = def.ui!.dependsOn;
            if (!dependsOn) continue;
            const target = ADMIN_SETTING_DEFINITIONS.find(d => d.key === dependsOn);
            expect(target, `${def.key} dependsOn missing setting ${dependsOn}`).toBeDefined();
            expect(target!.value.kind, `${def.key} dependsOn non-boolean ${dependsOn}`).toBe('boolean');
            expect(target!.ui, `${def.key} dependsOn ${dependsOn} which is not on the card`).toBeDefined();
        }
    });

    it('select options are valid enum values', () => {
        for (const def of uiDefs) {
            if (def.ui!.control?.type !== 'select') continue;
            expect(def.value.kind).toBe('enum');
            const values = def.value.kind === 'enum' ? def.value.values : [];
            for (const option of def.ui!.control.options) {
                expect(values, `${def.key} select option ${option.value}`).toContain(option.value);
            }
        }
    });

    // AC-03: `dreams.enabled` is rendered bespoke in the admin Dreams tab, not on
    // the general Features grid — it must stay a valid admin-editable definition
    // (live runtime flag) while omitting its `ui` block.
    it('keeps dreams.enabled admin-editable but off the Features card', () => {
        const dreams = ADMIN_SETTING_DEFINITIONS.find(d => d.key === 'dreams.enabled');
        expect(dreams, 'dreams.enabled must remain an admin setting').toBeDefined();
        expect(dreams!.ui, 'dreams.enabled must not be on the Features card').toBeUndefined();
        expect(dreams!.runtimeFlag).toBe('dreamsEnabled');
        expect(dreams!.runtime).toBe('live');
    });

    // AC-02: the Dreams tab renders this bespoke in minutes, but the admin
    // registry must keep the persisted millisecond field editable.
    it('keeps dreams.idleCheckIntervalMs admin-editable but off the Features card', () => {
        const interval = ADMIN_SETTING_DEFINITIONS.find(d => d.key === 'dreams.idleCheckIntervalMs');
        expect(interval, 'dreams.idleCheckIntervalMs must be an admin setting').toBeDefined();
        expect(interval!.ui, 'dreams.idleCheckIntervalMs must not be on the Features card').toBeUndefined();
        expect(interval!.default).toBe(300_000);
        expect(interval!.runtime).toBe('restartRequired');
    });

    // AC-01: the global system prompt is rendered bespoke on Admin -> System
    // Prompts (no Features-card `ui`), is live-editable, and clears on null/''.
    it('keeps chat.globalSystemPrompt admin-editable, live, nullable, and off the Features card', () => {
        const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === 'chat.globalSystemPrompt');
        expect(def, 'chat.globalSystemPrompt must be an admin setting').toBeDefined();
        expect(def!.ui, 'chat.globalSystemPrompt must not be on the Features card').toBeUndefined();
        expect(def!.runtime, 'chat.globalSystemPrompt must be live-editable').toBe('live');
        expect(def!.default).toBeUndefined();
        expect(def!.value).toMatchObject({ kind: 'string', nullable: true, clearOnEmpty: true });
        // Saving an empty prompt clears the stored value.
        const config: CLIConfig = {};
        applyAdminSettingValue(config, def!, 'be concise');
        expect(getConfigValueAtPath(config, 'chat.globalSystemPrompt')).toBe('be concise');
        applyAdminSettingValue(config, def!, '');
        expect(getConfigValueAtPath(config, 'chat.globalSystemPrompt')).toBeUndefined();
    });

    // AC-01 (plans-dep-tab-admin-toggle): a global boolean `showPlanDepTab`
    // defaulting to false, on the Features card under devTools, with a runtime
    // flag so the SPA can gate the deprecated Plans/Tasks sub-tab.
    it('exposes showPlanDepTab as a Features toggle defaulting to off', () => {
        const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === 'showPlanDepTab');
        expect(def, 'showPlanDepTab must be an admin setting').toBeDefined();
        expect(def!.value).toEqual({ kind: 'boolean' });
        expect(def!.default, 'showPlanDepTab must default to off (opt-in)').toBe(false);
        expect(def!.runtime).toBe('live');
        expect(def!.runtimeFlag).toBe('showPlanDepTab');
        expect(def!.ui, 'showPlanDepTab must appear on the Features card').toBeDefined();
        expect(def!.ui!.group).toBe('devTools');
        expect(def!.ui!.label).toBe('Show Plans (Dep.) tab');
        expect(def!.ui!.hint, 'hint should note the tab is deprecated').toMatch(/deprecated/i);
        // Rendered on the Features card in the devTools group.
        expect(getFeatureCardSettings('devTools').some(d => d.key === 'showPlanDepTab')).toBe(true);
        // Runtime flag reads false when absent from a partial config.
        expect(buildRuntimeFeatureFlags({}).showPlanDepTab).toBe(false);
    });

    // Remote-first shell and Split Workspace panel graduated out of experimental:
    // they now default ON (resolved default true) with no `experimental` badge,
    // while staying bootstrap-conservative (absentFallback false) so legacy
    // partial configs that predate the flag still read as off.
    it.each([
        { key: 'features.remoteShell', flag: 'remoteShellEnabled', label: 'Remote-first shell' },
        { key: 'features.splitWorkspacePanel', flag: 'splitWorkspacePanelEnabled', label: 'Split Workspace panel' },
    ])('exposes $label as a default-on Features toggle with no experimental badge', ({ key, flag, label }) => {
        const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === key);
        expect(def, `${key} must be an admin setting`).toBeDefined();
        expect(def!.value).toEqual({ kind: 'boolean' });
        expect(def!.default, `${key} must default on`).toBe(true);
        expect(def!.absentFallback, `${key} must stay bootstrap-conservative`).toBe(false);
        expect(def!.runtime).toBe('live');
        expect(def!.runtimeFlag).toBe(flag);
        expect(def!.ui, `${key} must appear on the Features card`).toBeDefined();
        expect(def!.ui!.group).toBe('dashboard');
        expect(def!.ui!.label).toBe(label);
        expect(def!.ui!.badge, `${key} must no longer be flagged experimental`).toBeUndefined();
        expect(def!.ui!.hint).toMatch(/enabled by default/i);
        expect(getFeatureCardSettings('dashboard').some(d => d.key === key)).toBe(true);
        // Resolved config (all fields present) reads the on default; a legacy
        // partial config that lacks the key still reads off.
        expect((buildRuntimeFeatures(DEFAULT_CONFIG) as Record<string, unknown>)[flag]).toBe(true);
        expect(buildRuntimeFeatureFlags({})[flag]).toBe(false);
    });
});
