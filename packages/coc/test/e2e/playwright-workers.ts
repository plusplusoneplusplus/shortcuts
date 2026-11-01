/**
 * Default Playwright worker count for the CoC e2e suite.
 *
 * Every worker runs its own in-process CoC server, an esbuild service and a
 * Chromium instance, so peak memory grows with the worker count. Four local
 * workers exhausted an ~8 GB, no-swap dev host; the kernel OOM killer then
 * took down the systemd-hosted CoC server that had launched the run. Local
 * runs therefore default to two workers.
 *
 * CI keeps four: its runners have the headroom, and each sharded e2e job
 * already runs close to its timeout. An explicit `--workers` flag still
 * overrides both values.
 */
export function resolvePlaywrightWorkers(env: NodeJS.ProcessEnv = process.env): number {
    return env.CI ? 4 : 2;
}
