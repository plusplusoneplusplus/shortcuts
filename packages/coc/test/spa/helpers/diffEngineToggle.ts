/**
 * The Classic/Editor diff engine switch is opt-in (`features.diffEngineToggle`).
 * Suites that exercise engine switching or a saved Classic choice turn the
 * live setting on for each test and reset the runtime config afterwards.
 */
import { afterEach, beforeEach } from 'vitest';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';

export function setDiffEngineToggleEnabled(enabled: boolean): void {
    applyRuntimeConfigPatch({ diffEngineToggleEnabled: enabled });
}

export function enableDiffEngineToggleForEachTest(): void {
    beforeEach(() => setDiffEngineToggleEnabled(true));
    afterEach(() => _resetRuntimeConfig());
}
