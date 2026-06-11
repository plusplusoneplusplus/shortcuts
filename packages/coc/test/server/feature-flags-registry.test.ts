/**
 * Drift guards for the FEATURE_FLAGS registry.
 *
 * The registry (coc-client/src/contracts/feature-flags.ts) is the single source
 * of truth for boolean admin config flags. The pieces it does NOT auto-generate
 * — DEFAULT_CONFIG, the Zod schema, the namespace source keys, and AdminResolvedConfig —
 * are hand-written. These tests assert those stay in lock-step with the registry,
 * so adding a flag with a missing default / schema entry / source key fails loudly
 * with a message naming the offending key, rather than shipping a half-wired flag.
 *
 * Because every assertion iterates the registry, a NEW flag is covered
 * automatically — no per-flag test is required.
 */

import { describe, it, expect } from 'vitest';
import {
    FEATURE_FLAGS,
    RUNTIME_FEATURE_FLAGS,
    ADMIN_FEATURE_TOGGLES,
    buildFeatureFlagRuntimeMap,
    readFlagValue,
    setFlagValue,
} from '@plusplusoneplusplus/coc-client';
import { DEFAULT_CONFIG, resolveConfig, CONFIG_SOURCE_KEYS, type CLIConfig } from '../../src/config';
import { validateConfigWithSchema } from '../../src/config/schema';
import { ADMIN_CONFIG_FIELDS, ADMIN_EDITABLE_KEYS } from '../../src/server/admin/admin-config-fields';

describe('FEATURE_FLAGS registry', () => {
    it('has unique keys, runtime flags, and testids', () => {
        const keys = FEATURE_FLAGS.map(f => f.key);
        expect(new Set(keys).size).toBe(keys.length);

        const runtimeFlags = RUNTIME_FEATURE_FLAGS.map(f => f.runtimeFlag);
        expect(new Set(runtimeFlags).size).toBe(runtimeFlags.length);

        const testids = ADMIN_FEATURE_TOGGLES.map(f => f.ui.testid);
        expect(new Set(testids).size).toBe(testids.length);
    });

    describe('DEFAULT_CONFIG ↔ registry default', () => {
        it.each(FEATURE_FLAGS.map(f => [f.key, f] as const))(
            '%s has a matching default in DEFAULT_CONFIG',
            (_key, flag) => {
                const value = readFlagValue(DEFAULT_CONFIG, flag.path);
                expect(value, `${flag.key} missing from DEFAULT_CONFIG`).not.toBeUndefined();
                expect(value, `${flag.key} default mismatch (registry vs DEFAULT_CONFIG)`).toBe(flag.default);
            },
        );
    });

    describe('resolved config ↔ registry default', () => {
        const resolved = resolveConfig(undefined, {});
        it.each(FEATURE_FLAGS.map(f => [f.key, f] as const))(
            '%s resolves to its registry default when unset',
            (_key, flag) => {
                expect(readFlagValue(resolved, flag.path)).toBe(flag.default);
            },
        );
    });

    describe('namespace source tracking', () => {
        it.each(FEATURE_FLAGS.map(f => [f.key] as const))(
            '%s is tracked in CONFIG_SOURCE_KEYS',
            (key) => {
                expect((CONFIG_SOURCE_KEYS as readonly string[]).includes(key)).toBe(true);
            },
        );
    });

    describe('admin editable fields', () => {
        it('admin field registry exposes exactly the editable flags (plus bespoke fields)', () => {
            for (const flag of FEATURE_FLAGS) {
                if (flag.editable) {
                    expect(ADMIN_EDITABLE_KEYS.includes(flag.key), `${flag.key} editable but missing from ADMIN_EDITABLE_KEYS`).toBe(true);
                } else {
                    expect(ADMIN_EDITABLE_KEYS.includes(flag.key), `${flag.key} not editable but present in ADMIN_EDITABLE_KEYS`).toBe(false);
                }
            }
        });

        it.each(FEATURE_FLAGS.filter(f => f.editable).map(f => [f.key, f] as const))(
            '%s validates booleans and rejects non-booleans, and applies to the right path',
            (_key, flag) => {
                const field = ADMIN_CONFIG_FIELDS.find(f => f.key === flag.key)!;
                expect(field).toBeDefined();
                expect(field.runtime).toBe(flag.runtime);
                expect(field.validate(true)).toBeUndefined();
                expect(field.validate(false)).toBeUndefined();
                expect(field.validate('nope')).toBeDefined();

                const cfg: CLIConfig = {};
                field.apply(cfg, true);
                expect(readFlagValue(cfg, flag.path)).toBe(true);
                field.apply(cfg, false);
                expect(readFlagValue(cfg, flag.path)).toBe(false);
            },
        );
    });

    describe('runtime dashboard config', () => {
        it('exposes every runtime flag at its default', () => {
            const map = buildFeatureFlagRuntimeMap(resolveConfig(undefined, {}));
            for (const flag of RUNTIME_FEATURE_FLAGS) {
                expect(map[flag.runtimeFlag as keyof typeof map], `${flag.runtimeFlag} missing from runtime map`).toBe(flag.default);
            }
        });
    });

    describe('schema acceptance', () => {
        it.each(FEATURE_FLAGS.map(f => [f.key, f] as const))(
            '%s round-trips through the config schema',
            (_key, flag) => {
                const cfg: Record<string, unknown> = {};
                setFlagValue(cfg, flag.path, !flag.default);
                // Should not throw and should preserve the value.
                const parsed = validateConfigWithSchema(cfg) as Record<string, unknown>;
                expect(readFlagValue(parsed, flag.path)).toBe(!flag.default);
            },
        );
    });

    describe('admin UI toggles', () => {
        it('every Features-card toggle belongs to a known group', () => {
            const groupIds = new Set(['dashboard', 'dev-tools', 'work-items', 'ai-modes', 'review', 'infrastructure']);
            for (const flag of ADMIN_FEATURE_TOGGLES) {
                expect(groupIds.has(flag.ui.group), `${flag.key} has unknown group ${flag.ui.group}`).toBe(true);
            }
        });

        it('every showWhenKey references a real registry flag', () => {
            const keys = new Set(FEATURE_FLAGS.map(f => f.key));
            for (const flag of ADMIN_FEATURE_TOGGLES) {
                if (flag.ui.showWhenKey) {
                    expect(keys.has(flag.ui.showWhenKey), `${flag.key} showWhenKey ${flag.ui.showWhenKey} is not a registry flag`).toBe(true);
                }
            }
        });
    });
});
