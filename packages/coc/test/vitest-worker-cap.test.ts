/**
 * Regression guard for the per-OS vitest fork ceiling.
 *
 * The suite used to pin `maxWorkers: 2` on every platform because three
 * concurrent excalidraw + jsdom forks OOM the macOS runner. That cap also
 * applied to the Linux and Windows CI shards, which have twice the memory and
 * more cores, and it made them the slowest jobs in the matrix.
 *
 * Two things can silently undo the fix, so both are asserted here:
 *  - someone "simplifies" resolveMaxWorkers() back to a constant, which would
 *    either re-throttle Linux/Windows or re-OOM macOS;
 *  - someone adds an entry to the `projects` array without spreading
 *    commonTestOptions, in which case that project quietly falls back to
 *    vitest's own default concurrency.
 */

import { describe, it, expect } from 'vitest';
import { resolveMaxWorkers } from '../vitest.workers';
import cocConfig from '../vitest.config';
import rootConfig from '../../../vitest.config';

describe('resolveMaxWorkers', () => {
    it('keeps macOS at 2 forks, the only platform with the OOM ceiling', () => {
        expect(resolveMaxWorkers('darwin')).toBe(2);
    });

    it('gives Linux one fork per core', () => {
        expect(resolveMaxWorkers('linux')).toBe(4);
    });

    it('leaves Windows one below the core count for fork overhead', () => {
        expect(resolveMaxWorkers('win32')).toBe(3);
    });

    it('lets every non-darwin platform past the macOS-only cap', () => {
        for (const platform of ['linux', 'win32', 'freebsd'] as NodeJS.Platform[]) {
            expect(resolveMaxWorkers(platform)).toBeGreaterThan(resolveMaxWorkers('darwin'));
        }
    });

    it('defaults to the current platform when none is passed', () => {
        expect(resolveMaxWorkers()).toBe(resolveMaxWorkers(process.platform));
    });
});

describe('vitest config wiring', () => {
    const expected = resolveMaxWorkers();

    it('applies the cap at the top level of the coc config', () => {
        expect(cocConfig.test?.maxWorkers).toBe(expected);
        expect(cocConfig.test?.pool).toBe('forks');
        expect(cocConfig.test?.minWorkers).toBe(1);
    });

    it('applies the cap to every project, not just the top level', () => {
        const projects = cocConfig.test?.projects ?? [];
        expect(projects.length).toBeGreaterThan(0);
        for (const project of projects) {
            // Inline project definitions only; a string glob would point at a
            // separate config file that this assertion cannot reach.
            expect(typeof project).toBe('object');
            const test = (project as { test?: { name?: string; maxWorkers?: number } }).test;
            expect(test?.maxWorkers, `project ${test?.name} is missing the fork cap`).toBe(expected);
        }
    });

    it('keeps the repo-root config on the same ceiling', () => {
        expect(rootConfig.test?.maxForks).toBe(expected);
    });
});
