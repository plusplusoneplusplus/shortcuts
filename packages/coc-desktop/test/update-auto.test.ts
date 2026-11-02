import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AUTO_UPDATE_CHECK_INTERVAL_MS, AUTO_UPDATE_IDLE_POLL_MS, AUTO_UPDATE_REQUIRED_IDLE_MS,
    AutoUpdater, isAppIdle, type AutoUpdaterOptions,
} from '../src/update-auto';
import type { ReleaseInfo, UpdateCheckResult } from '../src/update-check';
import { UpdateCoordinator } from '../src/update-coordinator';

const release: ReleaseInfo = {
    tag: 'v3.5.3', version: '3.5.3', htmlUrl: 'https://example.com/release', notes: '',
    isPrerelease: false, assets: [],
};
const newer: UpdateCheckResult = { reason: 'newer', release, prompt: null };
const upToDate: UpdateCheckResult = { reason: 'up-to-date', release, prompt: null };
const failed: UpdateCheckResult = { reason: 'error', release: null, prompt: null };

const IDLE_SECONDS = AUTO_UPDATE_REQUIRED_IDLE_MS / 1000;
const owned = { started: true, url: 'http://127.0.0.1:4000' };

function queueFetch(body: unknown, status = 200) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('constants', () => {
    it('checks hourly, requires 10 idle minutes and polls every minute', () => {
        expect(AUTO_UPDATE_CHECK_INTERVAL_MS).toBe(3_600_000);
        expect(AUTO_UPDATE_REQUIRED_IDLE_MS).toBe(600_000);
        expect(AUTO_UPDATE_IDLE_POLL_MS).toBe(60_000);
    });
});

describe('isAppIdle', () => {
    it('is idle with an empty all-workspace queue and 10 idle minutes', async () => {
        const fetchFn = queueFetch({ queued: [], running: [] });
        await expect(isAppIdle({ server: owned, getSystemIdleSeconds: () => IDLE_SECONDS, fetchFn })).resolves.toBe(true);
        const [url] = fetchFn.mock.calls[0] as unknown as [string];
        expect(url).toBe('http://127.0.0.1:4000/api/queue');
    });

    it('ignores pause markers in the queue', async () => {
        const fetchFn = queueFetch({ queued: [{ kind: 'pause-marker' }], running: [] });
        await expect(isAppIdle({ server: owned, getSystemIdleSeconds: () => IDLE_SECONDS, fetchFn })).resolves.toBe(true);
    });

    it('is not idle when the user was active recently, without asking the server', async () => {
        const fetchFn = queueFetch({ queued: [], running: [] });
        await expect(isAppIdle({ server: owned, getSystemIdleSeconds: () => IDLE_SECONDS - 1, fetchFn })).resolves.toBe(false);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('is not idle with a running task', async () => {
        const fetchFn = queueFetch({ queued: [], running: [{ id: 't1' }] });
        await expect(isAppIdle({ server: owned, getSystemIdleSeconds: () => IDLE_SECONDS, fetchFn })).resolves.toBe(false);
    });

    it('is not idle with a queued task', async () => {
        const fetchFn = queueFetch({ queued: [{ id: 't2', type: 'chat' }], running: [] });
        await expect(isAppIdle({ server: owned, getSystemIdleSeconds: () => IDLE_SECONDS, fetchFn })).resolves.toBe(false);
    });

    it('is not idle when the queue check fails', async () => {
        const rejecting = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
        await expect(isAppIdle({ server: owned, getSystemIdleSeconds: () => IDLE_SECONDS, fetchFn: rejecting })).resolves.toBe(false);
        await expect(isAppIdle({
            server: owned, getSystemIdleSeconds: () => IDLE_SECONDS, fetchFn: queueFetch({ error: 'x' }, 500),
        })).resolves.toBe(false);
        await expect(isAppIdle({
            server: owned, getSystemIdleSeconds: () => IDLE_SECONDS, fetchFn: queueFetch({ running: [] }),
        })).resolves.toBe(false);
    });

    it('uses only user idle time for an attached external server', async () => {
        const fetchFn = queueFetch({ queued: [], running: [{ id: 't1' }] });
        const external = { started: false, url: 'http://127.0.0.1:4000' };
        await expect(isAppIdle({ server: external, getSystemIdleSeconds: () => IDLE_SECONDS, fetchFn })).resolves.toBe(true);
        await expect(isAppIdle({ server: external, getSystemIdleSeconds: () => 0, fetchFn })).resolves.toBe(false);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('is not idle before any server is known', async () => {
        await expect(isAppIdle({ server: null, getSystemIdleSeconds: () => IDLE_SECONDS })).resolves.toBe(false);
    });

    it.each([NaN, Infinity, -1])('fails closed for an invalid OS idle reading (%s)', async seconds => {
        await expect(isAppIdle({
            server: { ...owned, started: false }, getSystemIdleSeconds: () => seconds,
        })).resolves.toBe(false);
    });
});

describe('AutoUpdater', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    function fixture(overrides: Partial<AutoUpdaterOptions> = {}) {
        let checking = false;
        let ready: ReleaseInfo | undefined;
        let idle = false;
        const coordinator = {
            get readyRelease() { return ready; },
            // Mirrors the coordinator: download retains bytes, install only when idle.
            start: vi.fn(async (r: ReleaseInfo, opts?: { silent?: boolean; isIdle?(): Promise<boolean> }) => {
                ready = r;
                if (opts?.isIdle && await opts.isIdle()) {
                    installed.push(r.tag);
                    ready = undefined;
                }
            }),
        };
        const installed: string[] = [];
        const options: AutoUpdaterOptions = {
            check: vi.fn(async () => newer),
            getSkippedVersion: vi.fn(() => null),
            coordinator,
            isIdle: vi.fn(async () => idle),
            tryBeginCheck: vi.fn(() => { if (checking) return false; checking = true; return true; }),
            endCheck: vi.fn(() => { checking = false; }),
            ...overrides,
        };
        const updater = new AutoUpdater(options);
        return {
            updater, options, coordinator, installed,
            setIdle(value: boolean) { idle = value; },
            setReady(value: ReleaseInfo | undefined) { ready = value; },
            setChecking(value: boolean) { checking = value; },
        };
    }

    it('does not check until started, then checks every hour', async () => {
        const f = fixture({ check: vi.fn(async () => upToDate) });
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS * 2);
        expect(f.options.check).not.toHaveBeenCalled();
        f.updater.start();
        expect(f.updater.running).toBe(true);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS - 1);
        expect(f.options.check).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(f.options.check).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS);
        expect(f.options.check).toHaveBeenCalledTimes(2);
        f.updater.dispose();
    });

    it('stop clears the timer, and dispose prevents a restart', async () => {
        const f = fixture({ check: vi.fn(async () => upToDate) });
        f.updater.start();
        f.updater.stop();
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS * 3);
        expect(f.options.check).not.toHaveBeenCalled();
        await f.updater.checkNow();
        expect(f.options.check).not.toHaveBeenCalled();
        f.updater.dispose();
        f.updater.start();
        expect(f.updater.running).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('skips a check while a manual check holds the shared guard', async () => {
        const f = fixture();
        f.updater.start();
        f.setChecking(true);
        await f.updater.checkNow();
        expect(f.options.check).not.toHaveBeenCalled();
        f.setChecking(false);
        await f.updater.checkNow();
        expect(f.options.check).toHaveBeenCalledTimes(1);
        f.updater.dispose();
    });

    it('never overlaps its own checks and releases the guard after each', async () => {
        let finish!: (r: UpdateCheckResult) => void;
        const f = fixture({ check: vi.fn(() => new Promise<UpdateCheckResult>(r => { finish = r; })) });
        f.updater.start();
        const first = f.updater.checkNow();
        await f.updater.checkNow();
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS);
        expect(f.options.check).toHaveBeenCalledTimes(1);
        finish(upToDate);
        await first;
        expect(f.options.endCheck).toHaveBeenCalledTimes(1);
        f.updater.dispose();
    });

    it('does not revive a cancelled check after turning Off and back on', async () => {
        const check = Promise.withResolvers<UpdateCheckResult>();
        const f = fixture({ check: vi.fn(() => check.promise) });
        f.setIdle(true);
        f.updater.start();
        const pending = f.updater.checkNow();
        f.updater.stop();
        f.updater.start();
        check.resolve(newer);
        await pending;
        expect(f.coordinator.start).not.toHaveBeenCalled();
        await f.updater.checkNow();
        expect(f.installed).toEqual(['v3.5.3']);
        f.updater.dispose();
    });

    it('installs silently right away when already idle', async () => {
        const f = fixture();
        f.setIdle(true);
        f.updater.start();
        await f.updater.checkNow();
        expect(f.coordinator.start).toHaveBeenCalledWith(release, expect.objectContaining({ silent: true }));
        expect(f.installed).toEqual(['v3.5.3']);
        expect(vi.getTimerCount()).toBe(1); // only the hourly timer
        f.updater.dispose();
    });

    describe('AutoUpdater with the shared coordinator', () => {
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => { vi.useRealTimers(); });

        function fixture(isIdle: () => Promise<boolean>) {
            const cleanup = vi.fn(async () => {});
            const download = vi.fn(async () => ({ installerPath: 'installer', tempDir: 'temp', cleanup }));
            const install = vi.fn(async () => {});
            const quit = vi.fn();
            const prompt = vi.fn(async () => true);
            const coordinator = new UpdateCoordinator({
                downloadOptions: { tempDir: 'temp' }, download, install, quit,
                setProgress: vi.fn(), promptRestart: prompt, confirmRestart: prompt,
                promptError: prompt, openBrowser: vi.fn(async () => {}),
            });
            let skipped: string | null = null;
            let checking = false;
            const updater = new AutoUpdater({
                check: async () => newer, getSkippedVersion: () => skipped, coordinator, isIdle,
                tryBeginCheck: () => { if (checking) return false; checking = true; return true; },
                endCheck: () => { checking = false; },
            });
            return {
                updater, coordinator, download, install, quit, prompt, cleanup,
                skip() { skipped = release.version; },
            };
        }

        it.each(['stop', 'dispose', 'off-on', 'skip'] as const)(
            'cancels a silent install when %s happens during its final idle check',
            async action => {
                const idle = Promise.withResolvers<boolean>();
                const entered = Promise.withResolvers<void>();
                const f = fixture(async () => { entered.resolve(); return idle.promise; });
                f.updater.start();
                const pending = f.updater.checkNow();
                await entered.promise;
                if (action === 'skip') f.skip();
                else if (action === 'off-on') { f.updater.stop(); f.updater.start(); }
                else f.updater[action]();
                idle.resolve(true);
                await pending;
                expect(f.install).not.toHaveBeenCalled();
                expect(f.quit).not.toHaveBeenCalled();
                expect(f.prompt).not.toHaveBeenCalled();
                expect(f.coordinator.readyRelease).toBe(release);
                expect(f.cleanup).not.toHaveBeenCalled();
                f.updater.dispose();
                expect(vi.getTimerCount()).toBe(0);
                await f.coordinator.dispose();
            },
        );

        it('retains the download when the user returns during a queue request, then installs on a later poll', async () => {
            const response = Promise.withResolvers<Response>();
            const entered = Promise.withResolvers<void>();
            let idleSeconds = IDLE_SECONDS;
            const fetchFn: typeof fetch = vi.fn(async () => {
                entered.resolve();
                return response.promise;
            });
            const f = fixture(() => isAppIdle({
                server: owned, getSystemIdleSeconds: () => idleSeconds, fetchFn,
            }));
            f.updater.start();
            const pending = f.updater.checkNow();
            await entered.promise;
            idleSeconds = 0;
            response.resolve(new Response(JSON.stringify({ queued: [], running: [] })));
            await pending;
            expect(f.install).not.toHaveBeenCalled();
            expect(f.coordinator.readyRelease).toBe(release);
            idleSeconds = IDLE_SECONDS;
            vi.mocked(fetchFn).mockImplementation(queueFetch({ queued: [], running: [] }));
            await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_POLL_MS);
            expect(f.download).toHaveBeenCalledOnce();
            expect(f.install).toHaveBeenCalledOnce();
            expect(f.quit).toHaveBeenCalledOnce();
            expect(f.prompt).not.toHaveBeenCalled();
            f.updater.dispose();
            await f.coordinator.dispose();
        });
    });

    it('downloads while busy, polls every minute and installs once idle', async () => {
        const f = fixture();
        f.updater.start();
        await f.updater.checkNow();
        expect(f.coordinator.start).toHaveBeenCalledTimes(1);
        expect(f.installed).toEqual([]);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_POLL_MS * 3);
        // Busy polls do not restart the coordinator.
        expect(f.coordinator.start).toHaveBeenCalledTimes(1);
        expect(f.options.isIdle).toHaveBeenCalledTimes(4);
        f.setIdle(true);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_POLL_MS);
        expect(f.coordinator.start).toHaveBeenCalledTimes(2);
        expect(f.installed).toEqual(['v3.5.3']);
        // The poll stops once the bytes are gone.
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_POLL_MS);
        expect(vi.getTimerCount()).toBe(1);
        f.updater.dispose();
    });

    it('does not install when activity returns between the idle poll and install', async () => {
        const f = fixture();
        f.updater.start();
        await f.updater.checkNow();
        // Idle for the poll, busy for the coordinator's pre-install re-check.
        vi.mocked(f.options.isIdle).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_POLL_MS);
        expect(f.coordinator.start).toHaveBeenCalledTimes(2);
        expect(f.installed).toEqual([]);
        expect(f.coordinator.readyRelease).toBe(release);
        f.setIdle(true);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_IDLE_POLL_MS);
        expect(f.installed).toEqual(['v3.5.3']);
        f.updater.dispose();
    });

    it('turning off cancels a pending install but keeps the bytes for a manual update', async () => {
        const f = fixture();
        f.updater.start();
        await f.updater.checkNow();
        f.updater.stop();
        f.setIdle(true);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS * 2);
        expect(f.installed).toEqual([]);
        expect(f.coordinator.readyRelease).toBe(release);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels an install whose idle re-check runs after auto update was turned off', async () => {
        const f = fixture();
        f.setIdle(true);
        vi.mocked(f.coordinator.start).mockImplementationOnce(async (_r, opts) => {
            f.updater.stop();
            if (await opts!.isIdle!()) f.installed.push('installed');
        });
        f.updater.start();
        await f.updater.checkNow();
        expect(f.installed).toEqual([]);
    });

    it('stops polling after a failed download and retries on the next hourly check', async () => {
        const f = fixture();
        vi.mocked(f.coordinator.start).mockImplementationOnce(async () => { /* download failed: no bytes */ });
        f.updater.start();
        await f.updater.checkNow();
        expect(vi.getTimerCount()).toBe(1);
        f.setIdle(true);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS);
        expect(f.options.check).toHaveBeenCalledTimes(2);
        expect(f.installed).toEqual(['v3.5.3']);
        f.updater.dispose();
    });

    it('never installs a skipped version', async () => {
        const f = fixture({ getSkippedVersion: vi.fn(() => '3.5.3') });
        f.setIdle(true);
        f.updater.start();
        await f.updater.checkNow();
        expect(f.coordinator.start).not.toHaveBeenCalled();
        f.setReady(release);
        vi.mocked(f.options.check).mockResolvedValue(failed);
        await f.updater.checkNow();
        expect(f.coordinator.start).not.toHaveBeenCalled();
        f.updater.dispose();
    });

    it('does nothing when up to date', async () => {
        const f = fixture({ check: vi.fn(async () => upToDate) });
        f.setIdle(true);
        f.updater.start();
        await f.updater.checkNow();
        expect(f.coordinator.start).not.toHaveBeenCalled();
        f.updater.dispose();
    });

    it('reuses a retained download when the check fails', async () => {
        const f = fixture({ check: vi.fn(async () => failed) });
        f.setReady(release);
        f.setIdle(true);
        f.updater.start();
        await f.updater.checkNow();
        expect(f.coordinator.start).toHaveBeenCalledWith(release, expect.objectContaining({ silent: true }));
        expect(f.installed).toEqual(['v3.5.3']);
        f.updater.dispose();
    });

    it('releases the guard and logs when the check throws', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const f = fixture({ check: vi.fn(async () => { throw new Error('boom'); }) });
        f.updater.start();
        await f.updater.checkNow();
        expect(f.options.endCheck).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
        expect(f.coordinator.start).not.toHaveBeenCalled();
        error.mockRestore();
        f.updater.dispose();
    });
});
