import { availableParallelism } from 'node:os';

/**
 * Default Playwright worker count for the CoC e2e suite: one per available
 * core, capped at four, never below one. Local runs and CI use the same rule.
 *
 * Every worker runs its own in-process CoC server, an esbuild service and a
 * Chromium instance, so more workers than cores only adds memory pressure
 * without adding throughput. An explicit `--workers` flag still overrides
 * this default.
 */
export function resolvePlaywrightWorkers(cores: number = availableParallelism()): number {
    return Math.max(1, Math.min(4, cores));
}
