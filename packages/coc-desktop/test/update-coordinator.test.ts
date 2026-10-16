import { describe, expect, it, vi } from 'vitest';
import type { ReleaseInfo } from '../src/update-check';
import { UpdateCoordinator, type UpdateCoordinatorOptions } from '../src/update-coordinator';
import type { DownloadUpdateOptions } from '../src/update-install';

const release: ReleaseInfo = {
    tag: 'v3.5.3', version: '3.5.3', htmlUrl: 'https://example.com/release', notes: '',
    isPrerelease: false, assets: [
        { name: 'CoC-3.5.3-arm64.dmg', url: 'https://example.com/mac' },
        { name: 'CoC.Setup.3.5.3.exe', url: 'https://example.com/win' },
    ],
};

function fixture() {
    const cleanup = vi.fn(async () => {});
    const download = { installerPath: '/temp/update', tempDir: '/temp', cleanup };
    const options: UpdateCoordinatorOptions = {
        downloadOptions: { tempDir: '/app-temp', platform: 'darwin', arch: 'arm64' },
        download: vi.fn(async () => download),
        setProgress: vi.fn(), promptRestart: vi.fn(async () => true),
        confirmRestart: vi.fn(async () => true), install: vi.fn(async () => {}),
        quit: vi.fn(), promptError: vi.fn(async () => false), openBrowser: vi.fn(async () => {}),
    };
    const coordinator = new UpdateCoordinator(options);
    return { coordinator, options, download, cleanup };
}

describe('UpdateCoordinator', () => {
    it('does nothing until requested, then verifies before prompting and launches before quitting', async () => {
        const f = fixture();
        expect(f.options.download).not.toHaveBeenCalled();
        const calls: string[] = [];
        vi.mocked(f.options.download!).mockImplementation(async opts => {
            expect(opts).toMatchObject({ release, tempDir: '/app-temp', platform: 'darwin', arch: 'arm64' });
            calls.push('download');
            return f.download;
        });
        vi.mocked(f.options.promptRestart).mockImplementation(async () => { calls.push('prompt'); return true; });
        vi.mocked(f.options.confirmRestart).mockImplementation(async () => { calls.push('confirm'); return true; });
        vi.mocked(f.options.install).mockImplementation(async (download, info) => {
            expect(download).toBe(f.download);
            expect(info).toBe(release);
            calls.push('helper');
        });
        vi.mocked(f.options.quit).mockImplementation(() => { calls.push('quit'); });
        await f.coordinator.start(release);
        expect(calls).toEqual(['download', 'prompt', 'confirm', 'helper', 'quit']);
        expect(f.cleanup).not.toHaveBeenCalled();
        await f.coordinator.start(release);
        expect(calls).toHaveLength(5);
    });

    it('keeps running until helper launch resolves', async () => {
        const f = fixture();
        let launched!: () => void;
        vi.mocked(f.options.install).mockReturnValue(new Promise(resolve => { launched = resolve; }));
        const pending = f.coordinator.start(release);
        await vi.waitFor(() => expect(f.options.install).toHaveBeenCalled());
        expect(f.options.quit).not.toHaveBeenCalled();
        launched();
        await pending;
        expect(f.options.quit).toHaveBeenCalledTimes(1);
    });

    it('reports known and unknown length progress and clears it before the restart dialog', async () => {
        const f = fixture();
        vi.mocked(f.options.download!).mockImplementation(async (opts: DownloadUpdateOptions) => {
            opts.onProgress!({ downloadedBytes: 42, totalBytes: 100 });
            opts.onProgress!({ downloadedBytes: 120, totalBytes: 100 });
            opts.onProgress!({ downloadedBytes: 42 });
            return f.download;
        });
        vi.mocked(f.options.promptRestart).mockImplementation(async () => {
            expect(vi.mocked(f.options.setProgress).mock.calls).toEqual([[undefined], [0.42], [1], [undefined], [null]]);
            return false;
        });
        await f.coordinator.start(release);
    });

    it.each(['later', 'cancel work warning'])('retains verified bytes after %s and retries without downloading', async choice => {
        const f = fixture();
        const hook = choice === 'later' ? f.options.promptRestart : f.options.confirmRestart;
        vi.mocked(hook).mockResolvedValueOnce(false);
        await f.coordinator.start(release);
        expect(f.options.install).not.toHaveBeenCalled();
        expect(f.options.quit).not.toHaveBeenCalled();
        expect(f.cleanup).not.toHaveBeenCalled();
        await f.coordinator.start(release);
        expect(f.options.download).toHaveBeenCalledTimes(1);
        expect(f.options.install).toHaveBeenCalledTimes(1);
    });

    it('coalesces repeated clicks while a download or dialog is active', async () => {
        const f = fixture();
        let resolve!: (value: boolean) => void;
        vi.mocked(f.options.promptRestart).mockReturnValue(new Promise(r => { resolve = r; }));
        const first = f.coordinator.start(release);
        const second = f.coordinator.start(release);
        expect(second).toBe(first);
        await vi.waitFor(() => expect(f.options.promptRestart).toHaveBeenCalled());
        expect(f.coordinator.start(release)).toBe(first);
        resolve(false);
        await first;
        expect(f.options.download).toHaveBeenCalledTimes(1);
    });

    it('cleans a retained release before downloading a different version', async () => {
        const f = fixture();
        vi.mocked(f.options.promptRestart).mockResolvedValue(false);
        await f.coordinator.start(release);
        const next = { ...release, tag: 'v3.5.4', version: '3.5.4' };
        vi.mocked(f.options.download!).mockImplementation(async opts => {
            expect(f.cleanup).toHaveBeenCalledTimes(1);
            expect(opts.release).toBe(next);
            return f.download;
        });
        await f.coordinator.start(next);
    });

    it.each([
        'No supported CoC installer', 'Missing SHA-256 checksum', 'HTTP 404',
        'Network error', 'SHA-256 checksum mismatch', 'Aborted',
    ])('offers fallback with download failure reason: %s', async reason => {
        const f = fixture();
        vi.mocked(f.options.download!).mockRejectedValueOnce(new Error(reason));
        vi.mocked(f.options.promptError).mockResolvedValue(true);
        await f.coordinator.start(release);
        expect(f.options.setProgress).toHaveBeenLastCalledWith(null);
        expect(f.options.promptError).toHaveBeenCalledWith(reason);
        expect(f.options.openBrowser).toHaveBeenCalledWith('https://example.com/mac');
        expect(f.options.promptRestart).not.toHaveBeenCalled();
        expect(f.options.quit).not.toHaveBeenCalled();
        await f.coordinator.start(release);
        expect(f.options.download).toHaveBeenCalledTimes(2);
    });

    it.each(['Unwritable location', 'AppTranslocation', 'Running from DMG', 'Helper spawn failed'])
    ('cleans downloaded files and offers fallback after install failure: %s', async reason => {
        const f = fixture();
        vi.mocked(f.options.install).mockRejectedValue(new Error(reason));
        vi.mocked(f.options.promptError).mockResolvedValue(true);
        await f.coordinator.start(release);
        expect(f.cleanup).toHaveBeenCalledTimes(1);
        expect(f.options.promptError).toHaveBeenCalledWith(reason);
        expect(f.options.openBrowser).toHaveBeenCalledWith('https://example.com/mac');
        expect(f.options.quit).not.toHaveBeenCalled();
    });

    it('reports cleanup errors alongside the original failure', async () => {
        const f = fixture();
        vi.mocked(f.options.install).mockRejectedValue(new Error('Cannot install'));
        f.cleanup.mockRejectedValue(new Error('Access denied'));
        await f.coordinator.start(release);
        expect(f.options.promptError).toHaveBeenCalledWith(expect.stringMatching(/Cannot install\n.*Access denied/));
    });

    it('keeps the app running when the owned-server check fails', async () => {
        const f = fixture();
        vi.mocked(f.options.confirmRestart).mockRejectedValue(new Error('Queue unavailable'));
        await f.coordinator.start(release);
        expect(f.options.promptError).toHaveBeenCalledWith('Queue unavailable');
        expect(f.options.install).not.toHaveBeenCalled();
        expect(f.options.quit).not.toHaveBeenCalled();
    });

    it.each(['win32', 'linux'] as const)('uses the existing browser URL selection on %s', async platform => {
        const f = fixture();
        f.options.downloadOptions.platform = platform;
        vi.mocked(f.options.download!).mockRejectedValue('Failed');
        vi.mocked(f.options.promptError).mockResolvedValue(true);
        await f.coordinator.start(release);
        expect(f.options.openBrowser).toHaveBeenCalledWith(platform === 'win32' ? 'https://example.com/win' : release.htmlUrl);
    });

    it('does not open a browser when the failure dialog is dismissed', async () => {
        const f = fixture();
        vi.mocked(f.options.download!).mockRejectedValue(new Error('Network failed'));
        await f.coordinator.start(release);
        expect(f.options.openBrowser).not.toHaveBeenCalled();
    });
});
