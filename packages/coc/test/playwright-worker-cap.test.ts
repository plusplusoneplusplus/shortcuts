/**
 * Regression guard for the Playwright worker default.
 *
 * The e2e config must default to min(4, available cores), at least one, the
 * same locally and in CI. Each worker runs a CoC server, esbuild and Chromium,
 * so a fixed count either oversubscribes small hosts or ignores the cap.
 * Two things could silently undo that, and both are asserted here:
 *  - resolvePlaywrightWorkers() "simplified" back to a constant or a CI switch;
 *  - the config going back to an inline `workers` literal instead of using it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { availableParallelism } from 'node:os';
import { resolvePlaywrightWorkers } from './e2e/playwright-workers';

describe('resolvePlaywrightWorkers', () => {
    it.each([
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 4],
        [64, 4],
    ])('uses %i core(s) as %i worker(s)', (cores, workers) => {
        expect(resolvePlaywrightWorkers(cores)).toBe(workers);
    });

    it('never drops below one worker', () => {
        expect(resolvePlaywrightWorkers(0)).toBe(1);
    });

    it('defaults to the available parallelism of this host', () => {
        expect(resolvePlaywrightWorkers()).toBe(Math.min(4, availableParallelism()));
    });
});

describe('playwright config wiring', () => {
    afterEach(() => {
        vi.doUnmock('node:os');
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    async function loadWorkers(cores: number, ci: string): Promise<unknown> {
        vi.resetModules();
        vi.doMock('node:os', async importOriginal => ({
            ...(await importOriginal<typeof import('node:os')>()),
            availableParallelism: () => cores,
        }));
        vi.stubEnv('CI', ci);
        const config = (await import('./e2e/playwright.config')).default;
        return config.workers;
    }

    it.each(['', 'true'])('caps by available cores whether CI is %j', async ci => {
        expect(await loadWorkers(2, ci)).toBe(2);
        expect(await loadWorkers(16, ci)).toBe(4);
    });
});
