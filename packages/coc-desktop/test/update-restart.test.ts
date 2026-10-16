import { describe, expect, it, vi } from 'vitest';
import { confirmUpdateRestart } from '../src/update-restart';
import { UpdateCoordinator } from '../src/update-coordinator';
import type { ReleaseInfo } from '../src/update-check';

function fixture(running: unknown[] = []) {
    return {
        server: { started: true, url: 'http://127.0.0.1:49152/' },
        fetchFn: vi.fn<typeof fetch>(async () => Response.json({
            queued: [{ id: 'queued' }], running, stats: { running: 999 },
        })),
        confirmRunningTasks: vi.fn(async (_count: number) => true),
    };
}

describe('confirmUpdateRestart', () => {
    it.each([null, { started: false, url: 'http://127.0.0.1:4000/' }])
    ('does not query or warn for an external or absent server (%j)', async server => {
        const options = { ...fixture(), server };
        expect(await confirmUpdateRestart(options)).toBe(true);
        expect(options.fetchFn).not.toHaveBeenCalled();
        expect(options.confirmRunningTasks).not.toHaveBeenCalled();
    });

    it('queries the actual owned server port without a workspace filter and bypasses idle confirmation', async () => {
        const options = fixture();
        expect(await confirmUpdateRestart(options)).toBe(true);
        expect(options.fetchFn).toHaveBeenCalledWith('http://127.0.0.1:49152/api/queue', {
            signal: expect.any(AbortSignal), redirect: 'error',
        });
        expect(options.confirmRunningTasks).not.toHaveBeenCalled();
    });

    it.each([true, false])('passes the aggregate running count and returns the confirmation (%s)', async choice => {
        const options = fixture([{ id: 'a', repoId: 'one' }, { id: 'b', repoId: 'two' }]);
        options.confirmRunningTasks.mockResolvedValue(choice);
        expect(await confirmUpdateRestart(options)).toBe(choice);
        expect(options.confirmRunningTasks).toHaveBeenCalledExactlyOnceWith(2);
    });

    it.each([null, {}, { running: 3 }, { running: null }])('rejects malformed queue data (%j)', async data => {
        const options = fixture();
        options.fetchFn.mockResolvedValue(Response.json(data));
        await expect(confirmUpdateRestart(options)).rejects.toThrow('Invalid queue response');
        expect(options.confirmRunningTasks).not.toHaveBeenCalled();
    });

    it('reports an HTTP failure and releases its response body', async () => {
        const options = fixture();
        const response = new Response('unavailable', { status: 503 });
        const cancel = vi.spyOn(response.body!, 'cancel');
        options.fetchFn.mockResolvedValue(response);
        await expect(confirmUpdateRestart(options)).rejects.toThrow('Could not check running tasks before updating: HTTP 503');
        expect(cancel).toHaveBeenCalledOnce();
        expect(options.confirmRunningTasks).not.toHaveBeenCalled();
    });

    it.each(['network', 'json', 'timeout'])('prevents restart after a %s failure', async failure => {
        const options = fixture();
        if (failure === 'network') options.fetchFn.mockRejectedValue(new Error('Connection refused'));
        if (failure === 'json') options.fetchFn.mockResolvedValue(new Response('invalid json'));
        if (failure === 'timeout') {
            const signal = AbortSignal.abort(new Error('Queue request timed out'));
            const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
            try {
                await expect(confirmUpdateRestart(options)).rejects.toThrow('Queue request timed out');
                expect(timeout).toHaveBeenCalledWith(10_000);
                expect(options.confirmRunningTasks).not.toHaveBeenCalled();
            } finally { timeout.mockRestore(); }
            return;
        }
        await expect(confirmUpdateRestart(options)).rejects.toThrow('Could not check running tasks before updating:');
        expect(options.confirmRunningTasks).not.toHaveBeenCalled();
    });

    it('keeps the app and verified download ready on cancel, then rechecks before retry', async () => {
        const options = fixture([{ id: 'running', repoId: 'another-workspace' }]);
        options.confirmRunningTasks.mockResolvedValueOnce(false);
        const cleanup = vi.fn(async () => {});
        const download = vi.fn(async () => ({ installerPath: '/temp/installer', tempDir: '/temp', cleanup }));
        const install = vi.fn(async () => {});
        const quit = vi.fn();
        const promptError = vi.fn(async () => false);
        const coordinator = new UpdateCoordinator({
            downloadOptions: { tempDir: '/temp' }, download,
            setProgress: vi.fn(), promptRestart: async () => true,
            confirmRestart: () => confirmUpdateRestart(options),
            install, quit, promptError, openBrowser: vi.fn(),
        });
        const release: ReleaseInfo = {
            tag: 'v3.5.3', version: '3.5.3', htmlUrl: 'https://example.com/release',
            notes: '', isPrerelease: false, assets: [],
        };
        await coordinator.start(release);
        expect(install).not.toHaveBeenCalled();
        expect(quit).not.toHaveBeenCalled();
        expect(cleanup).not.toHaveBeenCalled();
        // Work completed while the user waited: retry uses a fresh queue snapshot.
        options.fetchFn.mockResolvedValue(Response.json({ running: [] }));
        await coordinator.start(release);
        expect(options.fetchFn).toHaveBeenCalledTimes(2);
        expect(options.confirmRunningTasks).toHaveBeenCalledTimes(1);
        expect(download).toHaveBeenCalledOnce();
        expect(install).toHaveBeenCalledOnce();
        expect(quit).toHaveBeenCalledOnce();
        expect(cleanup).not.toHaveBeenCalled();
        expect(promptError).not.toHaveBeenCalled();
    });
});
