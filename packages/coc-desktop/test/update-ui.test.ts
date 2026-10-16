import { describe, expect, it, vi } from 'vitest';
import { createUpdateDialogs } from '../src/update-ui';
import { UpdateCoordinator } from '../src/update-coordinator';
import { confirmUpdateRestart } from '../src/update-restart';
import type { ReleaseInfo } from '../src/update-check';

const release: ReleaseInfo = {
    tag: 'v3.5.3', version: '3.5.3', htmlUrl: 'https://example.com/release',
    notes: '', assets: [], isPrerelease: false,
};

describe('native update dialogs', () => {
    it.each([0, 1])('returns restart only for the restart button (%s)', async response => {
        const show = vi.fn(async () => ({ response }));
        expect(await createUpdateDialogs(show).promptRestart(release)).toBe(response === 0);
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            message: 'CoC 3.5.3 is ready to install.',
            buttons: ['Restart to update', 'Later'], cancelId: 1,
        }));
    });

    it.each([1, 7])('shows the exact running count %s and defaults to cancel', async count => {
        const show = vi.fn(async () => ({ response: 1 }));
        expect(await createUpdateDialogs(show).confirmRunningTasks(count)).toBe(false);
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            message: `${count} running ${count === 1 ? 'task' : 'tasks'} will be interrupted.`,
            detail: expect.stringContaining('all workspaces'),
            buttons: ['Restart to update', 'Cancel'], defaultId: 1, cancelId: 1,
        }));
    });

    it.each([0, 1])('offers browser fallback with the complete failure reason (%s)', async response => {
        const show = vi.fn(async () => ({ response }));
        expect(await createUpdateDialogs(show).promptError('Checksum mismatch\nDetails')).toBe(response === 0);
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error', detail: 'Checksum mismatch\nDetails',
            buttons: ['Download in browser', 'Later'], cancelId: 1,
        }));
    });

    it('keeps a cancelled native work warning ready, then installs after a fresh confirmation', async () => {
        // Restart, cancel running work, then Restart and confirm running work.
        const responses = [0, 1, 0, 0];
        const show = vi.fn(async () => ({ response: responses.shift()! }));
        const dialogs = createUpdateDialogs(show);
        const download = vi.fn(async () => ({
            installerPath: '/temp/update', tempDir: '/temp', cleanup: vi.fn(async () => {}),
        }));
        const install = vi.fn(async () => {});
        const quit = vi.fn();
        const fetchFn = vi.fn(async () => new Response(JSON.stringify({ running: [{}, {}] })));
        const coordinator = new UpdateCoordinator({
            downloadOptions: { tempDir: '/temp' }, download,
            setProgress: vi.fn(), ...dialogs,
            confirmRestart: () => confirmUpdateRestart({
                server: { started: true, url: 'http://localhost:4321' },
                confirmRunningTasks: dialogs.confirmRunningTasks, fetchFn,
            }),
            install, quit, openBrowser: vi.fn(async () => {}),
        });
        await coordinator.start(release);
        expect(coordinator.readyRelease).toBe(release);
        expect(install).not.toHaveBeenCalled();
        expect(quit).not.toHaveBeenCalled();
        await coordinator.start(coordinator.readyRelease!);
        expect(download).toHaveBeenCalledTimes(1);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(install).toHaveBeenCalledTimes(1);
        expect(quit).toHaveBeenCalledTimes(1);
        expect(coordinator.readyRelease).toBeUndefined();
    });
});
