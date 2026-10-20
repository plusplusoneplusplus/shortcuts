import { describe, expect, it, vi } from 'vitest';
import { createUpdateDialogs } from '../src/update-ui';
import { UpdateCoordinator } from '../src/update-coordinator';
import { confirmUpdateRestart } from '../src/update-restart';
import { DOWNLOAD_INSTALLER_LABEL, formatUpdatePrompt, pickDownloadUrl, type ReleaseInfo } from '../src/update-check';

const release: ReleaseInfo = {
    tag: 'v3.5.3', version: '3.5.3', htmlUrl: 'https://example.com/release',
    notes: '', assets: [], isPrerelease: false,
};

describe('native update dialogs', () => {
    it.each([0, 1])('returns restart only for the restart button (%s)', async response => {
        const show = vi.fn(async () => ({ response }));
        expect(await createUpdateDialogs(show, vi.fn()).promptRestart(release)).toBe(response === 0);
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            message: 'CoC 3.5.3 is ready to install.',
            buttons: ['Restart to update', 'Later', DOWNLOAD_INSTALLER_LABEL], cancelId: 1,
        }));
    });

    it.each([1, 7])('shows the exact running count %s and defaults to cancel', async count => {
        const show = vi.fn(async () => ({ response: 1 }));
        expect(await createUpdateDialogs(show, vi.fn()).confirmRunningTasks(count)).toBe(false);
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            message: `${count} running ${count === 1 ? 'task' : 'tasks'} will be interrupted.`,
            detail: expect.stringContaining('all workspaces'),
            buttons: ['Restart to update', 'Cancel'], defaultId: 1, cancelId: 1,
        }));
    });

    it.each([0, 1])('offers browser fallback with the complete failure reason (%s)', async response => {
        const show = vi.fn(async () => ({ response }));
        expect(await createUpdateDialogs(show, vi.fn()).promptError('Checksum mismatch\nDetails')).toBe(response === 0);
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error', detail: 'Checksum mismatch\nDetails',
            buttons: [DOWNLOAD_INSTALLER_LABEL, 'Later'], cancelId: 1,
        }));
    });

    it('keeps a cancelled native work warning ready, then installs after a fresh confirmation', async () => {
        // Restart, cancel running work, then Restart and confirm running work.
        const responses = [0, 1, 0, 0];
        const show = vi.fn(async () => ({ response: responses.shift()! }));
        const dialogs = createUpdateDialogs(show, vi.fn());
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

    it.each([
        ['darwin', 'arm64', 'CoC-3.5.3-arm64.dmg'],
        ['darwin', 'x64', 'CoC-3.5.3-x64.dmg'],
        ['win32', 'x64', 'CoC.Setup.3.5.3.exe'],
        ['win32', 'arm64', 'CoC.Setup.3.5.3-arm64.exe'],
        ['linux', 'x64', undefined],
    ] as const)
    ('opens a manual browser download on %s/%s without invoking the automatic updater', async (platform, arch, name) => {
        const assets = [
            'CoC-3.5.3-arm64.dmg', 'CoC-3.5.3-x64.dmg',
            'CoC.Setup.3.5.3-arm64.exe', 'CoC.Setup.3.5.3.exe',
        ].map(name => ({ name, url: `https://example.com/${name}` }));
        const prompt = formatUpdatePrompt({ ...release, assets }, '3.5.2', platform, arch);
        const show = vi.fn(async () => ({ response: prompt.buttons.indexOf(DOWNLOAD_INSTALLER_LABEL) }));
        const openBrowser = vi.fn(async () => {});
        const actions = {
            startUpdate: vi.fn(async () => { throw new Error('Automatic updater unavailable'); }),
            skipVersion: vi.fn(),
        };
        await createUpdateDialogs(show, openBrowser).promptUpdate(prompt, actions);
        expect(openBrowser).toHaveBeenCalledExactlyOnceWith(name ? `https://example.com/${name}` : release.htmlUrl);
        expect(actions.startUpdate).not.toHaveBeenCalled();
        expect(actions.skipVersion).not.toHaveBeenCalled();
        expect(show).toHaveBeenCalledTimes(1);
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            buttons: prompt.buttons, defaultId: 0, cancelId: prompt.buttons.length - 1, noLink: true,
        }));
    });

    it.each(['Update', 'Skip This Version', 'Later', 'dismiss'])('preserves the %s action', async choice => {
        const prompt = formatUpdatePrompt(release, '3.5.2', 'win32');
        const show = vi.fn(async () => ({ response: prompt.buttons.indexOf(choice) }));
        const openBrowser = vi.fn(async () => {});
        const actions = { startUpdate: vi.fn(async () => {}), skipVersion: vi.fn() };
        await createUpdateDialogs(show, openBrowser).promptUpdate(prompt, actions);
        expect(actions.startUpdate).toHaveBeenCalledTimes(choice === 'Update' ? 1 : 0);
        expect(actions.skipVersion).toHaveBeenCalledTimes(choice === 'Skip This Version' ? 1 : 0);
        if (choice === 'Skip This Version') expect(actions.skipVersion).toHaveBeenCalledWith(release.version);
        expect(openBrowser).not.toHaveBeenCalled();
    });

    it.each(['javascript:alert(1)', 'file:///tmp/setup.exe', 'ms-settings:privacy', 'not a URL', '', 'https://example.com/\nfile'])
    ('rejects an unsafe manual download URL: %s', async downloadUrl => {
        const prompt = formatUpdatePrompt(release, '3.5.2', 'win32');
        const show = vi.fn(async () => ({ response: 1 }));
        const openBrowser = vi.fn(async () => {});
        const startUpdate = vi.fn(async () => {});
        await createUpdateDialogs(show, openBrowser).promptUpdate(
            { ...prompt, downloadUrl }, { startUpdate, skipVersion: vi.fn() },
        );
        expect(openBrowser).not.toHaveBeenCalled();
        expect(startUpdate).not.toHaveBeenCalled();
        expect(show).toHaveBeenLastCalledWith(expect.objectContaining({
            type: 'error', title: 'Browser Download Failed',
        }));
    });

    it('reports an external browser failure without falling back to automatic installation', async () => {
        const show = vi.fn(async () => ({ response: 1 }));
        const openBrowser = vi.fn(async () => { throw new Error('No system browser available'); });
        const startUpdate = vi.fn(async () => {});
        await createUpdateDialogs(show, openBrowser).promptUpdate(
            formatUpdatePrompt(release, '3.5.2', 'win32'), { startUpdate, skipVersion: vi.fn() },
        );
        expect(startUpdate).not.toHaveBeenCalled();
        expect(show).toHaveBeenLastCalledWith(expect.objectContaining({
            title: 'Browser Download Failed', detail: 'No system browser available',
        }));
    });

    it.each(['download', 'install'])('opens the browser after an automatic %s failure without retry or quit', async phase => {
        const responses = [0, 0];
        const show = vi.fn(async () => ({ response: responses.shift()! }));
        const openBrowser = vi.fn(async () => {});
        const dialogs = createUpdateDialogs(show, openBrowser);
        const download = vi.fn(async () => {
            if (phase === 'download') throw new Error('Missing SHA-256 checksum');
            return { installerPath: 'mock-installer', tempDir: 'mock-temp', cleanup: vi.fn(async () => {}) };
        });
        const install = vi.fn(async () => { throw new Error('Helper unavailable'); });
        const quit = vi.fn();
        const coordinator = new UpdateCoordinator({
            downloadOptions: { tempDir: 'mock-temp' }, download, install, quit,
            setProgress: vi.fn(), ...dialogs, confirmRestart: vi.fn(async () => true),
            openBrowser: dialogs.openDownload,
        });
        await coordinator.start(release);
        expect(download).toHaveBeenCalledTimes(1);
        expect(install).toHaveBeenCalledTimes(phase === 'install' ? 1 : 0);
        expect(openBrowser).toHaveBeenCalledExactlyOnceWith(release.htmlUrl);
        expect(quit).not.toHaveBeenCalled();
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Update Failed', buttons: [DOWNLOAD_INSTALLER_LABEL, 'Later'],
        }));
    });

    it('offers the browser for a retained update without restarting or redownloading', async () => {
        const responses = [1, 2];
        const show = vi.fn(async () => ({ response: responses.shift()! }));
        const openBrowser = vi.fn(async () => {});
        const dialogs = createUpdateDialogs(show, openBrowser);
        const download = vi.fn(async () => ({
            installerPath: 'mock-installer', tempDir: 'mock-temp', cleanup: vi.fn(async () => {}),
        }));
        const install = vi.fn(async () => {});
        const quit = vi.fn();
        const confirmRestart = vi.fn(async () => true);
        const coordinator = new UpdateCoordinator({
            downloadOptions: { tempDir: 'mock-temp' }, download, install, quit, confirmRestart,
            setProgress: vi.fn(), ...dialogs, openBrowser: dialogs.openDownload,
        });
        await coordinator.start(release);
        expect(openBrowser).not.toHaveBeenCalled();
        await coordinator.start(coordinator.readyRelease!);
        expect(openBrowser).toHaveBeenCalledExactlyOnceWith(pickDownloadUrl(release, process.platform));
        expect(download).toHaveBeenCalledTimes(1);
        expect(install).not.toHaveBeenCalled();
        expect(confirmRestart).not.toHaveBeenCalled();
        expect(quit).not.toHaveBeenCalled();
        expect(coordinator.readyRelease).toBe(release);
    });
});
