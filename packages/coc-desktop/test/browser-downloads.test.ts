import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserDownloadStore, downloadFilename, downloadSource, MAX_ACTIVE_DOWNLOADS, MAX_DOWNLOAD_RECORDS, type DownloadProgress } from '../src/browser-downloads';

const dirs: string[] = [];
const stores: BrowserDownloadStore[] = [];
const files = () => ({ open: vi.fn(async () => ''), show: vi.fn() });
const handle = () => ({ pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), dispose: vi.fn() });
const progress = (state: DownloadProgress['state'], received = 5): DownloadProgress => ({ state, received, total: 10, canPause: state === 'downloading', canResume: state === 'paused' });
function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-downloads-')); dirs.push(dir);
    const changed = vi.fn();
    const store = new BrowserDownloadStore(dir, changed); stores.push(store);
    return { store, dir, changed };
}
afterEach(async () => {
    for (const store of stores.splice(0)) await store.dispose();
    vi.restoreAllMocks(); vi.useRealTimers();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('desktop download metadata and lifecycle', () => {
    it('sanitizes source credentials, query, fragment and unsafe cross-platform filenames', () => {
        expect(downloadSource('https://user:password@files.test:443/path?token=secret#key')).toBe('files.test');
        expect(downloadSource('blob:https://files.test/id')).toBe('Local or private source');
        expect(downloadSource('bad')).toBe('Unknown source');
        for (const name of ['CON.exe', 'nul', '../', 'LPT1.zip', '..']) expect(downloadFilename(name)).toBe('download');
        expect(downloadFilename('C:\\folder\\report?.pdf')).toBe('report_.pdf');
        expect(downloadFilename('a\u202eb.exe')).toBe('a_b.exe');
        expect(Buffer.byteLength(downloadFilename('文'.repeat(180)), 'utf8')).toBeLessThanOrEqual(180);
        expect(downloadFilename('a'.repeat(179) + '.tail')).toBe('a'.repeat(179));
    });
    it('tracks live actions, terminal states and stale callbacks without persisting request secrets or exposing paths', async () => {
        const { store, dir } = setup();
        const native = handle(), shell = files();
        const transfer = store.start('../file.txt', 'https://user:password@files.test/download?token=secret', native)!;
        transfer.update(progress('downloading'));
        await store.action(transfer.id, 'pause', shell); expect(native.pause).toHaveBeenCalledOnce();
        transfer.update(progress('paused'));
        await store.action(transfer.id, 'resume', shell); expect(native.resume).toHaveBeenCalledOnce();
        await store.action(transfer.id, 'cancel', shell); expect(native.cancel).toHaveBeenCalledOnce();
        transfer.update(progress('cancelled'), true);
        transfer.update(progress('completed'), true, path.join(dir, 'stale'));
        const query = await store.query();
        expect(query.entries[0]).toMatchObject({ state: 'cancelled', active: false, canPause: false, canResume: false });
        expect(native.dispose).toHaveBeenCalledOnce();
        expect(shell.open).not.toHaveBeenCalled();
        const persisted = fs.readFileSync(store.filename, 'utf8');
        for (const secret of ['password', 'token', 'secret', 'https://', 'user:']) expect(persisted).not.toContain(secret);
        await expect(store.action(transfer.id, 'resume', shell)).rejects.toThrow('unavailable');
    });
    it('opens or reveals only the exact completed existing regular file; clear/remove retain files', async () => {
        const { store, dir } = setup(); const shell = files();
        const file = path.join(dir, 'download.txt'); fs.writeFileSync(file, 'safe');
        const transfer = store.start('download.txt', 'https://files.test/', handle())!;
        transfer.update(progress('completed', 4), true, file);
        const record = (await store.query()).entries[0];
        expect(record.fileAvailable).toBe(true);
        expect(record).not.toHaveProperty('filePath'); expect(record).not.toHaveProperty('identity');
        await store.action(transfer.id, 'open', shell); expect(shell.open).toHaveBeenCalledWith(fs.realpathSync(file));
        await store.action(transfer.id, 'show', shell); expect(shell.show).toHaveBeenCalledWith(fs.realpathSync(file));
        await expect(store.action(transfer.id, 'open', shell, () => false)).rejects.toThrow();
        fs.writeFileSync(file, 'replacement contents');
        expect((await store.query()).entries[0].fileAvailable).toBe(false);
        await expect(store.action(transfer.id, 'open', shell)).rejects.toThrow('missing or has changed');
        await store.action(transfer.id, 'remove', shell);
        expect((await store.query()).entries).toEqual([]); expect(fs.existsSync(file)).toBe(true);
        await expect(store.action(transfer.id, 'show', shell)).rejects.toThrow('no longer exists');
    });
    it('rejects symlink capabilities and missing files and reports shell failures', async () => {
        const { store, dir } = setup(); const shell = files();
        const file = path.join(dir, 'file'); fs.writeFileSync(file, 'safe');
        const transfer = store.start('file', 'https://files.test', handle())!;
        transfer.update(progress('completed'), true, file);
        shell.open.mockResolvedValue('OS error with private data');
        await expect(store.action(transfer.id, 'open', shell)).rejects.toThrow('Could not open downloaded file.');
        fs.unlinkSync(file);
        await expect(store.action(transfer.id, 'show', shell)).rejects.toThrow();
        if (process.platform !== 'win32') {
            const target = path.join(dir, 'target'); fs.writeFileSync(target, 'content'); fs.symlinkSync(target, file);
            const symlink = store.start('file', 'https://files.test', handle())!;
            symlink.update(progress('completed'), true, file);
            expect((await store.query()).entries.find(item => item.id === symlink.id)!.fileAvailable).toBe(false);
        }
    });
    it('requires managed IDs and allowed actions; unfinished rows cannot be removed or opened', async () => {
        const { store } = setup(); const shell = files();
        const transfer = store.start('file', 'https://files.test', handle())!;
        for (const [id, action] of [['/tmp/file', 'open'], [transfer.id, 'retry'], [null, 'open'], [transfer.id, 'clear'], [{ id: transfer.id }, 'show']]) {
            await expect(store.action(id, action, shell)).rejects.toThrow();
        }
        for (const action of ['open', 'show', 'remove', 'pause', 'resume']) await expect(store.action(transfer.id, action, shell)).rejects.toThrow();
        await store.action(null, 'clear', shell);
        expect((await store.query()).entries).toHaveLength(1);
        expect(shell.open).not.toHaveBeenCalled(); expect(shell.show).not.toHaveBeenCalled();
    });
    it('honestly interrupts all active transfers on shutdown/restart and ignores late completion', async () => {
        const { store, dir } = setup(); const native = handle();
        const transfer = store.start('unfinished', 'https://files.test?secret=token', native)!;
        transfer.update(progress('paused'));
        await store.dispose(); transfer.update(progress('completed'), true);
        expect(native.cancel).toHaveBeenCalledOnce(); expect(native.dispose).toHaveBeenCalledOnce();
        const restarted = new BrowserDownloadStore(dir); stores.push(restarted);
        expect((await restarted.query()).entries[0]).toMatchObject({ state: 'interrupted', active: false, canResume: false, fileAvailable: false });
        expect(store.start('late', 'https://files.test', handle())).toBeNull();
        // Simulate process death before orderly dispose.
        const data = JSON.parse(fs.readFileSync(store.filename, 'utf8'));
        data.entries[0].state = 'downloading'; data.entries[0].active = true;
        fs.writeFileSync(store.filename, JSON.stringify(data));
        const crashed = new BrowserDownloadStore(dir); stores.push(crashed);
        expect((await crashed.query()).entries[0].state).toBe('interrupted');
    });
    it('bounds active admission, terminal retention and progress persistence', async () => {
        const { store, changed } = setup();
        const transfers = Array.from({ length: MAX_ACTIVE_DOWNLOADS }, () => store.start('file', 'https://files.test', handle())!);
        expect(store.start('overflow', 'https://files.test', handle())).toBeNull();
        for (const transfer of transfers) transfer.update(progress('cancelled'), true);
        for (let i = 0; i < MAX_DOWNLOAD_RECORDS + 1; i++) store.start('file', 'https://files.test', handle())!.update(progress('cancelled'), true);
        expect((await store.query()).entries).toHaveLength(MAX_DOWNLOAD_RECORDS);
        changed.mockClear();
        const live = store.start('progress', 'https://files.test', handle())!; await store.query(); changed.mockClear();
        for (let i = 0; i < 100; i++) live.update(progress('downloading', i));
        await store.query(); expect(changed).not.toHaveBeenCalled();
        await store.dispose(); expect(changed).toHaveBeenCalledOnce();
    });
    it('surfaces corrupted/oversized and write/rename errors, recovers on a later save, and removes temp files', async () => {
        const { store, dir } = setup();
        fs.mkdirSync(path.dirname(store.filename), { recursive: true }); fs.writeFileSync(store.filename, '{bad');
        const corrupt = new BrowserDownloadStore(dir); stores.push(corrupt);
        expect((await corrupt.query()).storageError).toContain('read');
        const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('sensitive/path'));
        const transfer = store.start('file', 'https://files.test', handle())!;
        expect((await store.query()).storageError).toContain('save');
        expect(fs.readdirSync(path.dirname(store.filename))).toEqual(['downloads.json']);
        transfer.update(progress('completed'), true);
        expect((await store.query()).storageError).toBeNull();
        expect(rename).toHaveBeenCalledTimes(2);
        fs.truncateSync(store.filename, 32 * 1024 * 1024 + 1);
        const oversized = new BrowserDownloadStore(dir); stores.push(oversized);
        expect((await oversized.query()).storageError).toContain('read');
    });
});

it('restores completed file capabilities, native Save As filename, and prunes stale or invalid persisted metadata', async () => {
    const { store, dir } = setup(); const shell = files();
    const selected = path.join(dir, 'saved-as.txt'); fs.writeFileSync(selected, 'file');
    const transfer = store.start('suggested.txt', 'https://files.test?auth=secret', handle())!;
    transfer.update(progress('completed'), true, selected); await store.query();
    const data = JSON.parse(fs.readFileSync(store.filename, 'utf8'));
    data.entries.push({ ...data.entries[0], id: '00000000-0000-0000-0000-000000000000', updated: 0 });
    data.entries.push({ ...data.entries[0], id: '10000000-0000-0000-0000-000000000000', started: Number.MAX_SAFE_INTEGER });
    data.entries.push({ ...data.entries[0], id: '20000000-0000-0000-0000-000000000000', state: 'forged' });
    fs.writeFileSync(store.filename, JSON.stringify(data));
    const restarted = new BrowserDownloadStore(dir); stores.push(restarted);
    expect((await restarted.query()).entries).toEqual([expect.objectContaining({ id: transfer.id, filename: 'saved-as.txt', state: 'completed', fileAvailable: true, active: false })]);
    await restarted.action(transfer.id, 'show', shell); expect(shell.show).toHaveBeenCalledWith(fs.realpathSync(selected));
    await restarted.action(null, 'clear', shell); expect((await restarted.query()).entries).toEqual([]);
    expect(fs.readFileSync(selected, 'utf8')).toBe('file');
});

it('reports failed metadata removal persistence without deleting the downloaded file', async () => {
    const { store, dir } = setup(); const shell = files();
    const file = path.join(dir, 'kept.txt'); fs.writeFileSync(file, 'keep');
    const transfer = store.start('kept.txt', 'https://files.test', handle())!;
    transfer.update(progress('completed'), true, file); await store.query();
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('unavailable'));
    await expect(store.action(transfer.id, 'remove', shell)).rejects.toThrow('Could not save');
    expect((await store.query()).storageError).toContain('save');
    expect(fs.readFileSync(file, 'utf8')).toBe('keep');
});

it('revokes file actions removed or detached while asynchronous file validation is pending', async () => {
    const { store, dir } = setup(); const shell = files();
    const file = path.join(dir, 'ready.txt'); fs.writeFileSync(file, 'ready');
    const transfer = store.start('ready.txt', 'https://files.test', handle())!;
    transfer.update(progress('completed'), true, file); await store.query();
    let resolve!: (value: fs.Stats) => void;
    const check = vi.spyOn(fs.promises, 'lstat').mockImplementationOnce(() => new Promise<fs.Stats>(r => { resolve = r; }) as any);
    const opening = store.action(transfer.id, 'open', shell);
    // Attach rejection before allowing asynchronous interleavings.
    const rejected = expect(opening).rejects.toThrow();
    await store.action(transfer.id, 'remove', shell);
    resolve(fs.lstatSync(file)); await rejected;
    expect(shell.open).not.toHaveBeenCalled(); check.mockRestore();
});
