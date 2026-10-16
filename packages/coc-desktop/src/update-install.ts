/** Electron-free installer download and mandatory SHA-256 verification. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ReleaseAsset, ReleaseInfo } from './update-check';

export interface UpdateAssets {
    installer: ReleaseAsset;
    checksum: ReleaseAsset;
}

/** Never select a container installer or an explicitly incompatible architecture. */
export function selectUpdateAssets(
    release: ReleaseInfo,
    platform: NodeJS.Platform,
    arch: string = process.arch,
): UpdateAssets {
    const candidates = release.assets.filter(({ name }) => {
        const n = name.toLowerCase();
        if (platform === 'darwin' && arch === 'arm64') {
            return n.startsWith('coc-') && n.endsWith('.dmg') && !/x64|x86_64/.test(n);
        }
        if (platform === 'win32' && arch === 'x64') {
            return n.startsWith('coc.setup.') && n.endsWith('.exe') && !/arm64|ia32/.test(n);
        }
        return false;
    });
    const installer = candidates.find(a => a.name.toLowerCase().includes('arm64')) ?? candidates[0];
    if (!installer) throw new Error('No supported CoC installer is attached to this release.');
    if (/[\\/\r\n]/.test(installer.name)) throw new Error('Invalid installer filename.');
    const checksum = release.assets.find(a => a.name === `${installer.name}.sha256`);
    if (!checksum) throw new Error(`Missing SHA-256 checksum: ${installer.name}.sha256`);
    return { installer, checksum };
}

export interface DownloadProgress {
    downloadedBytes: number;
    /** Absent when the server does not report a content length. */
    totalBytes?: number;
}

/** Small filesystem seam; writes must finish before resolving. */
export interface UpdateDownloadFileSystem {
    mkdtemp(prefix: string): Promise<string>;
    open(file: string): Promise<{
        writeFile(bytes: Uint8Array): Promise<void>;
        close(): Promise<void>;
    }>;
    rm(dir: string): Promise<void>;
}

const downloadFs: UpdateDownloadFileSystem = {
    mkdtemp: prefix => fs.mkdtemp(prefix),
    open: file => fs.open(file, 'wx', 0o600),
    rm: dir => fs.rm(dir, { recursive: true, force: true }),
};

export interface DownloadUpdateOptions {
    release: ReleaseInfo;
    platform?: NodeJS.Platform;
    arch?: string;
    /** App temp path; each attempt owns an isolated directory beneath it. */
    tempDir: string;
    fetchFn?: typeof fetch;
    fs?: UpdateDownloadFileSystem;
    signal?: AbortSignal;
    onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadedUpdate {
    installerPath: string;
    tempDir: string;
    /** Caller retains the verified download for Later, then cleans up after installation. */
    cleanup(): Promise<void>;
}

export async function downloadUpdate(opts: DownloadUpdateOptions): Promise<DownloadedUpdate> {
    opts.signal?.throwIfAborted();
    const { installer, checksum } = selectUpdateAssets(
        opts.release, opts.platform ?? process.platform, opts.arch,
    );
    const fetchFn = opts.fetchFn ?? globalThis.fetch;
    const store = opts.fs ?? downloadFs;
    const request = async (url: string): Promise<Response> => {
        opts.signal?.throwIfAborted();
        const response = await fetchFn(url, { signal: opts.signal });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Update download failed: HTTP ${response.status}`);
        }
        return response;
    };
    // Validate the sidecar before spending bandwidth or creating installer files.
    const sidecar = await (await request(checksum.url)).text();
    opts.signal?.throwIfAborted();
    const match = /^([a-fA-F0-9]{64})(?:[ \t]+[ *](.+))?\r?\n?$/.exec(sidecar);
    if (!match || (match[2] !== undefined && match[2] !== installer.name)) {
        throw new Error(`Invalid SHA-256 checksum for ${installer.name}`);
    }
    const tempDir = await store.mkdtemp(path.join(opts.tempDir, 'coc-update-'));
    const cleanup = () => store.rm(tempDir);
    const installerPath = path.join(tempDir, installer.name);
    try {
        const response = await request(installer.url);
        if (!response.body) throw new Error('Update download returned an empty body.');
        const reader = response.body.getReader();
        try {
            const file = await store.open(installerPath);
            try {
                const hash = createHash('sha256');
                const length = Number(response.headers.get('content-length'));
                const totalBytes = Number.isSafeInteger(length) && length > 0 ? length : undefined;
                let downloadedBytes = 0;
                opts.onProgress?.({ downloadedBytes, totalBytes });
                while (true) {
                    opts.signal?.throwIfAborted();
                    const { done, value } = await reader.read();
                    opts.signal?.throwIfAborted();
                    if (done) break;
                    await file.writeFile(value);
                    hash.update(value);
                    downloadedBytes += value.byteLength;
                    opts.onProgress?.({ downloadedBytes, totalBytes });
                }
                if (hash.digest('hex') !== match[1].toLowerCase()) {
                    throw new Error('Update SHA-256 checksum mismatch.');
                }
            } finally {
                await file.close();
            }
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
        opts.signal?.throwIfAborted();
        return { installerPath, tempDir, cleanup };
    } catch (error) {
        await cleanup();
        throw error;
    }
}
