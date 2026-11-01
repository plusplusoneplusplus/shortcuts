/**
 * Regression guard for the local Playwright worker default.
 *
 * Four local e2e workers OOM'd an ~8 GB dev host and took the systemd-hosted
 * CoC server down with them, so local runs default to two while CI keeps four.
 * Two things could silently undo that, and both are asserted here:
 *  - resolvePlaywrightWorkers() "simplified" back to a constant;
 *  - the config going back to an inline `workers` literal instead of using it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolvePlaywrightWorkers } from './e2e/playwright-workers';

describe('resolvePlaywrightWorkers', () => {
    it('defaults local runs to two workers', () => {
        expect(resolvePlaywrightWorkers({})).toBe(2);
    });

    it('keeps four workers on CI', () => {
        expect(resolvePlaywrightWorkers({ CI: 'true' })).toBe(4);
    });

    it('treats an empty CI variable as a local run', () => {
        expect(resolvePlaywrightWorkers({ CI: '' })).toBe(2);
    });
});

describe('playwright config wiring', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    async function loadWorkers(ci: string): Promise<unknown> {
        vi.stubEnv('CI', ci);
        vi.resetModules();
        const config = (await import('./e2e/playwright.config')).default;
        return config.workers;
    }

    it('uses two workers when CI is unset', async () => {
        expect(await loadWorkers('')).toBe(2);
    });

    it('uses four workers on CI', async () => {
        expect(await loadWorkers('true')).toBe(4);
    });
});
