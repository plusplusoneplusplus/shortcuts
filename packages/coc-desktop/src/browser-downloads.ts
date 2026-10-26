import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DOWNLOADS_QUERY_CHANNEL = 'coc-desktop:browser-downloads-query';
export const DOWNLOADS_ACTION_CHANNEL = 'coc-desktop:browser-downloads-action';
export const DOWNLOADS_CHANGED_CHANNEL = 'coc-desktop:browser-downloads-changed';
export const MAX_DOWNLOAD_RECORDS = 500;
export const MAX_ACTIVE_DOWNLOADS = 20;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export type DownloadState = 'downloading' | 'paused' | 'completed' | 'cancelled' | 'interrupted' | 'failed';
export type DownloadAction = 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove' | 'clear';
export interface DownloadProgress {
    state: DownloadState;
    received: number;
    total: number;
    canPause: boolean;
    canResume: boolean;
}
export interface DownloadRecord extends DownloadProgress {
    id: string;
    engine: 'electron';
    filename: string;
    source: string;
    started: number;
    updated: number;
    fileAvailable: boolean;
    active: boolean;
}
interface FileIdentity { size: number; mtimeMs: number; dev: number; ino: number }
interface StoredDownload extends DownloadRecord { filePath?: string; identity?: FileIdentity }
/** Main-only adapter. URLs, headers, cookies and save paths never cross the renderer API. */
export interface DownloadHandle {
    pause(): void;
    resume(): void;
    cancel(): void;
    dispose(): void;
}
const states: DownloadState[] = ['downloading', 'paused', 'completed', 'cancelled', 'interrupted', 'failed'];
export function downloadSource(raw: string): string {
    try { const url = new URL(raw); return ['https:', 'http:'].includes(url.protocol) ? url.host.slice(0, 256) : 'Local or private source'; }
    catch { return 'Unknown source'; }
}
export function downloadFilename(raw: string): string {
    // Strip both OS path separators, control/bidi characters and Windows reserved names.
    let name = raw.split(/[\\/]/).pop()!.replace(/[<>:"|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').slice(0, 180).replace(/[\uD800-\uDBFF]$/, '');
    while (Buffer.byteLength(name, 'utf8') > 180) { name = Array.from(name).slice(0, -1).join(''); }
    name = name.replace(/[. ]+$/g, '');
    return !name || /^\.+$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name) ? 'download' : name;
}
function bytes(value: number): number { return Number.isSafeInteger(value) && value > 0 ? value : 0; }
function publicRecord(record: StoredDownload): DownloadRecord {
    const { filePath: _path, identity: _identity, ...visible } = record;
    return visible;
}
function identity(file: string): FileIdentity | undefined {
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) { return; }
        return { size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino };
    } catch { return; }
}
async function currentIdentity(file: string): Promise<FileIdentity | undefined> {
    try {
        const stat = await fs.promises.lstat(file);
        if (stat.isFile() && !stat.isSymbolicLink()) { return { size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino }; }
    } catch { /* missing and inaccessible files have no file capability */ }
}
function sameFile(a: FileIdentity | undefined, b: FileIdentity | undefined): boolean {
    return !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs && a.dev === b.dev && a.ino === b.ino;
}

/** Installation-wide metadata; live handles belong to this process, never to a tab/workspace. */
export class BrowserDownloadStore {
    readonly filename: string;
    private records = new Map<string, StoredDownload>();
    private live = new Map<string, DownloadHandle>();
    private pending: Promise<void> = Promise.resolve();
    private timer?: ReturnType<typeof setTimeout>;
    private error: string | null = null;
    private closing = false;

    constructor(dataDir: string, private readonly changed: () => void = () => {}, private readonly now = Date.now) {
        this.filename = path.join(dataDir, 'browser', 'downloads.json');
        try {
            if (fs.statSync(this.filename).size > 32 * 1024 * 1024) { throw new Error('oversized'); }
            const data = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
            if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > MAX_DOWNLOAD_RECORDS) { throw new Error('invalid'); }
            for (const value of data.entries) {
                if (!value || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || value.engine !== 'electron'
                    || !states.includes(value.state) || typeof value.filename !== 'string' || typeof value.source !== 'string'
                    || !Number.isSafeInteger(value.started) || value.started < 0 || !Number.isSafeInteger(value.updated)
                    || value.updated < this.now() - RETENTION_MS || value.started > this.now() + 86400000 || value.updated > this.now() + 86400000) {continue; }
                const active = value.active === true || value.state === 'downloading' || value.state === 'paused';
                // File capabilities require an exact native-selected path and its completion identity.
                const filePath = typeof value.filePath === 'string' && value.filePath.length <= 32768 && path.isAbsolute(value.filePath) && !value.filePath.includes('\0') ? value.filePath : undefined;
                const fileIdentity = value.identity && ['size', 'mtimeMs', 'dev', 'ino'].every(key =>
                    typeof value.identity[key] === 'number' && Number.isFinite(value.identity[key]) && value.identity[key] >= 0) ? value.identity : undefined;
                this.records.set(value.id, {
                    id: value.id, engine: 'electron', filename: downloadFilename(value.filename), source: ['Unknown source', 'Local or private source'].includes(value.source) ? value.source : downloadSource(`https://${value.source}`),
                    started: value.started, updated: value.updated, state: active ? 'interrupted' : value.state,
                    received: bytes(value.received), total: bytes(value.total), canPause: false, canResume: false,
                    active: false, fileAvailable: false,
                    ...(value.state === 'completed' && !active && filePath && fileIdentity ? { filePath, identity: fileIdentity } : {}),
                });
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {this.error = 'Could not read download history.'; }
        }
    }

    /** Admission happens before Chromium starts saving; excess downloads are cancelled, never replayed. */
    start(filename: string, url: string, handle: DownloadHandle): { id: string; update(progress: DownloadProgress, final?: boolean, filePath?: string): void } | null {
        if (this.closing || this.live.size >= MAX_ACTIVE_DOWNLOADS) { return null; }
        const id = randomUUID();
        const record: StoredDownload = { id, engine: 'electron', filename: downloadFilename(filename), source: downloadSource(url),
            started: this.now(), updated: this.now(), state: 'downloading', received: 0, total: 0,
            canPause: false, canResume: false, active: true, fileAvailable: false };
        this.records.set(id, record);
        this.live.set(id, handle);
        this.schedule(true);
        return { id, update: (progress, final = false, filePath) => {
            // Removed, terminal and shutdown handles cannot publish late state.
            if (this.closing || this.live.get(id) !== handle || this.records.get(id) !== record) { return; }
            record.state = progress.state;
            record.received = bytes(progress.received);
            record.total = bytes(progress.total);
            record.canPause = !final && progress.state === 'downloading' && progress.canPause;
            record.canResume = !final && progress.state === 'paused' && progress.canResume;
            record.updated = this.now();
            if (final) {
                this.live.delete(id);
                record.active = false;
                handle.dispose();
                if (progress.state === 'completed' && filePath && filePath.length <= 32768 && path.isAbsolute(filePath)) {
                    record.filename = downloadFilename(path.basename(filePath));
                    const completed = identity(filePath);
                    if (completed) {
                        try { record.filePath = fs.realpathSync(filePath); record.identity = completed; }
                        catch { /* completion remains real, but file actions are unavailable */ }
                    }
                }
                record.fileAvailable = !!record.filePath;
            }
            this.schedule(final);
        } };
    }

    async query() {
        await this.pending;
        const entries = [...this.records.values()].reverse().sort((a, b) => b.started - a.started);
        await Promise.all(entries.map(async record => {
            record.fileAvailable = record.state === 'completed' && !!record.filePath && sameFile(record.identity, await currentIdentity(record.filePath));
        }));
        return { ok: true as const, entries: entries.filter(record => this.records.get(record.id) === record).map(publicRecord), storageError: this.error,
            engines: { electron: { managed: true, message: 'Downloads use a native Save dialog.' },
                webview2: { managed: false, message: 'WebView2 cannot manage downloads here. Use Open in system browser to download from the source page.' } } };
    }

    async action(id: unknown, action: unknown, files: { open(file: string): Promise<string>; show(file: string): void }, current = () => true) {
        if (this.closing) { throw new Error('Downloads are shutting down.'); }
        if (typeof action !== 'string' || !['pause', 'resume', 'cancel', 'open', 'show', 'remove', 'clear'].includes(action)) { throw new TypeError('Invalid download action.'); }
        if (action === 'clear') {
            if (id !== null) { throw new TypeError('Invalid download ID.'); }
            for (const [key, record] of this.records) {if (!record.active) {this.records.delete(key); }}
            this.schedule(true); await this.pending;
            if (this.error) { throw new Error('Could not save download history.'); }
            return;
        }
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) { throw new TypeError('Invalid download ID.'); }
        const record = this.records.get(id);
        if (!record) { throw new TypeError('Download no longer exists.'); }
        const handle = this.live.get(id);
        if (action === 'remove' && !record.active) {
            this.records.delete(id); this.schedule(true); await this.pending;
            if (this.error) { throw new Error('Could not save download history.'); }
            return;
        }
        if (action === 'cancel' && handle) { handle.cancel(); return; }
        if (action === 'pause' && handle && record.canPause) { handle.pause(); return; }
        if (action === 'resume' && handle && record.canResume) { handle.resume(); return; }
        if ((action === 'open' || action === 'show') && record.state === 'completed' && record.filePath) {
            const observed = await currentIdentity(record.filePath);
            if (!current() || this.closing || this.records.get(id) !== record || !sameFile(record.identity, observed)) { throw new Error('Downloaded file is missing or has changed.'); }
            if (action === 'open') {
                const result = await files.open(record.filePath);
                if (result) { throw new Error('Could not open downloaded file.'); }
            } else {files.show(record.filePath); }
            return;
        }
        throw new Error('This action is unavailable for this download.');
    }

    private schedule(immediate: boolean): void {
        if (immediate) { clearTimeout(this.timer); this.timer = undefined; this.save(); }
        else if (!this.timer) { this.timer = setTimeout(() => { this.timer = undefined; this.save(); }, 500); this.timer.unref(); }
    }

    private save(): void {
        const cutoff = this.now() - RETENTION_MS;
        const retained = [...this.records.values()].reverse().filter(record => record.active || record.updated >= cutoff)
            .sort((a, b) => Number(b.active) - Number(a.active) || b.started - a.started).slice(0, MAX_DOWNLOAD_RECORDS);
        this.records = new Map(retained.map(record => [record.id, record]));
        const data = JSON.stringify({ version: 1, entries: retained });
        this.pending = this.pending.then(async () => {
            const temp = `${this.filename}.${randomUUID()}.tmp`;
            try {
                await fs.promises.mkdir(path.dirname(this.filename), { recursive: true });
                await fs.promises.writeFile(temp, data, { mode: 0o600, flag: 'wx' });
                await fs.promises.rename(temp, this.filename);
                this.error = null;
            } catch {
                this.error = 'Could not save download history. Changes may be lost on restart.';
                await fs.promises.unlink(temp).catch(() => {});
            }
            this.changed();
        });
    }

    async dispose(): Promise<void> {
        if (this.closing) { await this.pending; return; }
        this.closing = true;
        clearTimeout(this.timer); this.timer = undefined;
        for (const [id, handle] of this.live) {
            const record = this.records.get(id)!;
            record.state = 'interrupted'; record.active = false; record.canPause = false; record.canResume = false;
            record.updated = this.now();
            try { handle.cancel(); } catch { /* shutdown must retire every handle */ }
            handle.dispose();
        }
        this.live.clear(); this.save(); await this.pending;
    }
}
