/**
 * Pins the dangerous-command guard admin flag.
 *
 * The guard ships dark: the feature must stay off unless an admin turns it on,
 * so a default flip is a regression, not a tweak. The generic registry contract
 * suite covers validate/merge/schema; this file only guards the bits the spec
 * calls out by name — the key, the default, and the runtime flag the gate and
 * the dashboard read.
 */

import { describe, it, expect } from 'vitest';
import { ADMIN_SETTING_DEFINITIONS, buildRuntimeFeatureFlags } from '../../src/config/admin-setting-definitions';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/config';
import { buildRuntimeFeatures } from '../../src/server/config/runtime-config-handler';
import {
    DEFAULT_QUEUE_RUNTIME_CONFIG,
    createFixedQueueRuntimeConfig,
    createQueueRuntimeConfig,
} from '../../src/server/queue/queue-runtime-config';

const KEY = 'dangerousCommandGuard.enabled';
const FLAG = 'dangerousCommandGuardEnabled';

describe('dangerousCommandGuard.enabled', () => {
    it('is registered as a live boolean admin setting that defaults to off', () => {
        const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === KEY);
        expect(def).toBeDefined();
        expect(def!.value).toEqual({ kind: 'boolean' });
        expect(def!.default).toBe(false);
        expect(def!.runtime).toBe('live');
        expect(def!.runtimeFlag).toBe(FLAG);
    });

    it('defaults to off in DEFAULT_CONFIG and in a config with no guard section', () => {
        expect(DEFAULT_CONFIG.dangerousCommandGuard.enabled).toBe(false);
        expect(mergeConfig({}, {}).dangerousCommandGuard.enabled).toBe(false);
        expect(buildRuntimeFeatureFlags({})[FLAG]).toBe(false);
        expect(buildRuntimeFeatures({})[FLAG]).toBe(false);
    });

    it('resolves and is exposed to the dashboard once an admin turns it on', () => {
        const resolved = mergeConfig({}, { dangerousCommandGuard: { enabled: true } });
        expect(resolved.dangerousCommandGuard.enabled).toBe(true);
        expect(buildRuntimeFeatures(resolved)[FLAG]).toBe(true);
    });

    it('reaches the executors off the queue config port, live and defaulted off', () => {
        expect(DEFAULT_QUEUE_RUNTIME_CONFIG.getDangerousCommandGuard().enabled).toBe(false);
        expect(createFixedQueueRuntimeConfig({ config: {} }).getDangerousCommandGuard().enabled).toBe(false);

        // `live` means the getter re-reads the source, so flipping the flag
        // takes effect on the next turn without a restart.
        const source = { config: mergeConfig({}, {}) };
        const queueConfig = createQueueRuntimeConfig(source);
        expect(queueConfig.getDangerousCommandGuard().enabled).toBe(false);
        source.config = mergeConfig({}, { dangerousCommandGuard: { enabled: true } });
        expect(queueConfig.getDangerousCommandGuard().enabled).toBe(true);
    });
});
