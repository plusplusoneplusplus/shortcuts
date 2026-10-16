import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ReleaseInfo } from '../src/update-check';
import {
    downloadUpdate, selectUpdateAssets,
    type DownloadProgress, type DownloadUpdateOptions, type UpdateDownloadFileSystem,
} from '../src/update-install';

const macName = 'CoC-3.5.3-arm64.dmg';
const winName = 'CoC.Setup.3.5.3.exe';
const bytes = Buffer.from('installer bytes');
const digest = createHash('sha256').update(bytes).digest('hex');
const asset = (name: string) => ({ name, url: `https://example.com/${encodeURIComponent(name)}` });
const release: ReleaseInfo = {
    version: '3.5.3', tag: 'v3.5.3', htmlUrl: 'https://example.com/release',
    notes: '', isPrerelease: false,
    assets: [
        'CoCContainer-3.5.3-arm64.dmg', 'CoCContainer.Setup.3.5.3.exe',
        'CoC-3.5.3-x64.dmg', macName, `${macName}.sha256`, winName, `${winName}.sha256`,
    ].map(asset),
};

function fixture(overrides: Partial<DownloadUpdateOptions> = {}) {
    let contents = Buffer.alloc(0);
    const close = vi.fn(async () => {});
    const store: UpdateDownloadFileSystem = {
        mkdtemp: vi.fn(async prefix => `${prefix}test`),
        open: vi.fn(async () => ({
            writeFile: vi.fn(async chunk => { contents = Buffer.concat([contents, chunk]); }),
            close,
        })),
        rm: vi.fn(async () => {}),
    };
    const fetchFn = vi.fn<typeof fetch>(async url => {
        if (String(url).endsWith('.sha256')) return new Response(`${digest}  ${macName}\n`);
        return new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(bytes.subarray(0, 4));
                controller.enqueue(bytes.subarray(4));
                controller.close();
            },
        }), { headers: { 'content-length': String(bytes.length) } });
    });
    const options: DownloadUpdateOptions = {
        release, platform: 'darwin', arch: 'arm64', tempDir: os.tmpdir(),
        fs: store, fetchFn, ...overrides,
    };
    return { options, store, fetchFn, close, contents: () => contents };
}

describe('selectUpdateAssets', () => {
    it.each([
        ['darwin', 'arm64', macName], ['win32', 'x64', winName],
    ] as const)('selects installer and exact sidecar for %s/%s', (platform, arch, name) => {
        expect(selectUpdateAssets(release, platform, arch)).toEqual({
            installer: asset(name), checksum: asset(`${name}.sha256`),
        });
    });

    it.each([
        ['linux', 'x64'], ['darwin', 'x64'], ['win32', 'arm64'],
    ] as const)('rejects unsupported %s/%s', (platform, arch) => {
        expect(() => selectUpdateAssets(release, platform, arch)).toThrow('No supported');
    });

    it('rejects a release with only container installers or incompatible architecture', () => {
        expect(() => selectUpdateAssets({ ...release, assets: release.assets.slice(0, 3) }, 'darwin', 'arm64'))
            .toThrow('No supported');
    });

    it('requires the sidecar for the selected installer', () => {
        const assets = release.assets.filter(a => a.name !== `${macName}.sha256`);
        expect(() => selectUpdateAssets({ ...release, assets }, 'darwin', 'arm64'))
            .toThrow('Missing SHA-256');
    });

    it('rejects filenames containing path separators', () => {
        expect(() => selectUpdateAssets({ ...release, assets: [asset('CoC-../../evil-arm64.dmg')] }, 'darwin', 'arm64'))
            .toThrow('Invalid installer filename');
    });
});

describe('downloadUpdate', () => {
    it('streams verified bytes to disk, reports progress, and retains the file until cleanup', async () => {
        const progress: DownloadProgress[] = [];
        const f = fixture({ onProgress: p => progress.push(p) });
        const result = await downloadUpdate(f.options);
        expect(f.contents()).toEqual(bytes);
        expect(progress).toEqual([0, 4, bytes.length].map(downloadedBytes => ({
            downloadedBytes, totalBytes: bytes.length,
        })));
        expect(result.installerPath).toBe(path.join(result.tempDir, macName));
        expect(f.close).toHaveBeenCalledOnce();
        expect(f.store.rm).not.toHaveBeenCalled();
        expect(f.fetchFn.mock.calls.map(([url]) => url)).toEqual([
            asset(`${macName}.sha256`).url, asset(macName).url,
        ]);
        await result.cleanup();
        expect(f.store.rm).toHaveBeenCalledWith(result.tempDir);
    });

    it('downloads the Windows asset and accepts a binary-mode sidecar', async () => {
        const f = fixture({ platform: 'win32', arch: 'x64' });
        f.fetchFn.mockResolvedValueOnce(new Response(`${digest.toUpperCase()} *${winName}\r\n`));
        const result = await downloadUpdate(f.options);
        expect(result.installerPath).toBe(path.join(result.tempDir, winName));
        expect(f.fetchFn.mock.calls[1][0]).toBe(asset(winName).url);
    });

    it('supports unknown length and bare SHA-256 sidecars', async () => {
        const onProgress = vi.fn();
        const f = fixture({ onProgress });
        f.fetchFn.mockResolvedValueOnce(new Response(digest));
        f.fetchFn.mockResolvedValueOnce(new Response(bytes));
        await downloadUpdate(f.options);
        expect(onProgress).toHaveBeenLastCalledWith({ downloadedBytes: bytes.length, totalBytes: undefined });
    });

    it('removes the download and closes the file on checksum mismatch', async () => {
        const f = fixture();
        f.fetchFn.mockResolvedValueOnce(new Response('0'.repeat(64)));
        await expect(downloadUpdate(f.options)).rejects.toThrow('checksum mismatch');
        expect(f.store.rm).toHaveBeenCalledOnce();
        expect(f.close).toHaveBeenCalledOnce();
    });

    it.each(['', 'bad hash', `${digest}  other.dmg\n`, `${digest}\n${digest}\n`])(
        'rejects invalid checksum contents before creating a temp directory: %s', async sidecar => {
            const f = fixture();
            f.fetchFn.mockResolvedValueOnce(new Response(sidecar));
            await expect(downloadUpdate(f.options)).rejects.toThrow('Invalid SHA-256');
            expect(f.store.mkdtemp).not.toHaveBeenCalled();
            expect(f.fetchFn).toHaveBeenCalledOnce();
        },
    );

    it('does not fetch when the checksum asset is missing', async () => {
        const f = fixture({ release: { ...release, assets: [asset(macName)] } });
        await expect(downloadUpdate(f.options)).rejects.toThrow('Missing SHA-256');
        expect(f.fetchFn).not.toHaveBeenCalled();
    });

    it.each(['checksum', 'installer'])('handles HTTP errors for the %s', async stage => {
        const f = fixture();
        if (stage === 'installer') f.fetchFn.mockResolvedValueOnce(new Response(digest));
        f.fetchFn.mockResolvedValueOnce(new Response('Not found', { status: 404 }));
        await expect(downloadUpdate(f.options)).rejects.toThrow('HTTP 404');
        expect(f.store.rm).toHaveBeenCalledTimes(stage === 'installer' ? 1 : 0);
    });

    it('removes the temp directory on a network failure', async () => {
        const f = fixture();
        f.fetchFn.mockResolvedValueOnce(new Response(digest));
        f.fetchFn.mockRejectedValueOnce(new Error('network offline'));
        await expect(downloadUpdate(f.options)).rejects.toThrow('network offline');
        expect(f.store.rm).toHaveBeenCalledOnce();
    });

    it('cleans up on a stream error', async () => {
        const f = fixture();
        f.fetchFn.mockResolvedValueOnce(new Response(digest));
        f.fetchFn.mockResolvedValueOnce(new Response(new ReadableStream({
            start(controller) { controller.error(new Error('connection lost')); },
        })));
        await expect(downloadUpdate(f.options)).rejects.toThrow('connection lost');
        expect(f.close).toHaveBeenCalledOnce();
        expect(f.store.rm).toHaveBeenCalledOnce();
    });

    it('closes and cleans up when writing fails', async () => {
        const f = fixture();
        vi.mocked(f.store.open).mockResolvedValueOnce({
            writeFile: async () => { throw new Error('disk full'); }, close: f.close,
        });
        await expect(downloadUpdate(f.options)).rejects.toThrow('disk full');
        expect(f.close).toHaveBeenCalledOnce();
        expect(f.store.rm).toHaveBeenCalledOnce();
    });

    it('cancels the response stream and cleans up when opening the file fails', async () => {
        const f = fixture();
        const cancel = vi.fn();
        f.fetchFn.mockResolvedValueOnce(new Response(digest));
        f.fetchFn.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
        vi.mocked(f.store.open).mockRejectedValueOnce(new Error('permission denied'));
        await expect(downloadUpdate(f.options)).rejects.toThrow('permission denied');
        expect(cancel).toHaveBeenCalledOnce();
        expect(f.store.rm).toHaveBeenCalledOnce();
    });

    it('rejects an empty HTTP body and removes the temp directory', async () => {
        const f = fixture();
        f.fetchFn.mockResolvedValueOnce(new Response(digest));
        f.fetchFn.mockResolvedValueOnce(new Response(null));
        await expect(downloadUpdate(f.options)).rejects.toThrow('empty body');
        expect(f.store.rm).toHaveBeenCalledOnce();
    });

    it('preserves a pre-existing abort reason without fetching', async () => {
        const controller = new AbortController();
        const reason = new Error('user cancelled');
        controller.abort(reason);
        const f = fixture({ signal: controller.signal });
        await expect(downloadUpdate(f.options)).rejects.toBe(reason);
        expect(f.fetchFn).not.toHaveBeenCalled();
    });

    it('passes cancellation to fetch and cleans up a partial download', async () => {
        const controller = new AbortController();
        const reason = new Error('app quitting');
        const f = fixture({
            signal: controller.signal,
            onProgress: p => { if (p.downloadedBytes > 0) controller.abort(reason); },
        });
        await expect(downloadUpdate(f.options)).rejects.toBe(reason);
        expect(f.contents()).toEqual(bytes.subarray(0, 4));
        expect(f.close).toHaveBeenCalledOnce();
        expect(f.store.rm).toHaveBeenCalledOnce();
        for (const [, init] of f.fetchFn.mock.calls) expect(init?.signal).toBe(controller.signal);
    });

    it('cleans up when cancellation interrupts the installer request', async () => {
        const controller = new AbortController();
        const reason = new Error('cancel request');
        const f = fixture({ signal: controller.signal });
        f.fetchFn.mockResolvedValueOnce(new Response(digest));
        f.fetchFn.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
            controller.abort(reason);
        }));
        await expect(downloadUpdate(f.options)).rejects.toBe(reason);
        expect(f.store.rm).toHaveBeenCalledOnce();
        expect(f.store.open).not.toHaveBeenCalled();
    });

    it('uses the default filesystem for multi-chunk writes and recursive cleanup', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-download-test-'));
        try {
            const f = fixture({ fs: undefined, tempDir });
            const result = await downloadUpdate(f.options);
            expect(await fs.readFile(result.installerPath)).toEqual(bytes);
            await result.cleanup();
            expect(await fs.readdir(tempDir)).toEqual([]);

            f.fetchFn.mockResolvedValueOnce(new Response('0'.repeat(64)));
            await expect(downloadUpdate(f.options)).rejects.toThrow('checksum mismatch');
            expect(await fs.readdir(tempDir)).toEqual([]);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
