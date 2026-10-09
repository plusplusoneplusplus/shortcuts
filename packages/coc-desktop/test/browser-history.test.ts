import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserHistoryStore, BROWSER_HISTORY_MAX_ENTRIES, BROWSER_HISTORY_RETENTION_MS } from '../src/browser-history';

const directories: string[] = [];
function directory(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-browser-history-'));
    directories.push(dir);
    return dir;
}
function seed(dir: string, entries: unknown[], recording = true): void {
    fs.mkdirSync(path.join(dir, 'browser'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'browser', 'history.json'), JSON.stringify({ version: 1, recording, entries }));
}
function entry(url: string, lastVisited: number, title = 'Page') {
    return { url, engines: { electron: { title, lastVisited, visitCount: 1 } } };
}
afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of directories) fs.rmSync(dir, { recursive: true, force: true });
    directories.length = 0;
});

describe('desktop browser history store', () => {
    it('notifies only committed mutations or visible failures and tolerates broken subscribers', async () => {
        const dir = directory();
        const changed = vi.fn(() => {
            const saved = JSON.parse(fs.readFileSync(path.join(dir, 'browser/history.json'), 'utf8'));
            expect(saved.entries).toHaveLength(1);
        });
        const store = new BrowserHistoryStore(dir, Date.now, changed);
        await store.recordVisit('electron', 'https://example.test/', 'Page');
        expect(changed).toHaveBeenCalledOnce();
        await store.updateTitle('electron', 'https://example.test/', 'Page');
        expect(changed).toHaveBeenCalledOnce();
        const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('Disk full'));
        await expect(store.setRecording(false)).rejects.toThrow('Disk full');
        expect(changed).toHaveBeenCalledTimes(2);
        expect(await store.query()).toMatchObject({ recording: true, storageError: expect.stringContaining('Disk full') });
        rename.mockRestore();
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        changed.mockImplementationOnce(() => { throw new Error('Window closed'); });
        await expect(store.setRecording(false)).resolves.toBe(true);
        expect(await store.query()).toMatchObject({ recording: false, storageError: null });
        expect(log).toHaveBeenCalledWith('[coc-desktop] Browser history notification failed:', expect.any(Error));
    });

    it('starts enabled and empty without creating files until a mutation', async () => {
        const dir = directory();
        const store = new BrowserHistoryStore(dir);
        expect(await store.query()).toEqual({ entries: [], total: 0, recording: true, storageError: null });
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('deduplicates sanitized final URLs, preserves case/query/fragment, and persists on restart', async () => {
        const dir = directory();
        let now = 100;
        const store = new BrowserHistoryStore(dir, () => now);
        await store.recordVisit('electron', 'https://name:secret@example.com/Path?q=Case#Part', 'Initial');
        now = 200;
        await store.recordVisit('electron', 'https://example.com/Path?q=Case#Part', 'Latest');
        await store.recordVisit('webview2', 'https://example.com/path?q=Case#Part', 'Different path');
        const restarted = new BrowserHistoryStore(dir, () => now);
        const result = await restarted.query('LATEST');
        expect(result.entries).toEqual([{ url: 'https://example.com/Path?q=Case#Part', title: 'Latest', lastVisited: 200, visitCount: 2 }]);
        expect((await restarted.query()).total).toBe(2);
        const disk = fs.readFileSync(store.filename, 'utf8');
        expect(disk).not.toContain('secret');
        expect(disk).not.toContain('name:');
        expect(JSON.parse(disk).version).toBe(1);
        expect(fs.readdirSync(path.join(dir, 'browser'))).toEqual(['history.json']);
    });

    it('rejects non-HTTP URLs and records localhost and private-network URLs', async () => {
        const store = new BrowserHistoryStore(directory());
        for (const url of ['file:///tmp/page.html', 'about:blank', 'data:text/html,hello', 'javascript:alert(1)', 'not a URL', '', null, 'https://example.com/\n', 'https://example.com/' + 'x'.repeat(8192)]) {
            expect(await store.recordVisit('electron', url, 'Ignored')).toBe(false);
        }
        for (const url of ['http://localhost:4000/page?query=1#part', 'http://192.168.1.2/', 'http://[::1]/']) {
            expect(await store.recordVisit('electron', url, 'Local')).toBe(true);
        }
        expect((await store.query()).total).toBe(3);
    });

    it('updates titles without visits or recency changes and never creates missing entries', async () => {
        let now = 100;
        const store = new BrowserHistoryStore(directory(), () => now);
        await store.recordVisit('electron', 'https://example.com/', 'Initial');
        now = 200;
        expect(await store.updateTitle('electron', 'https://example.com/', 'Updated')).toBe(true);
        expect(await store.updateTitle('electron', 'https://example.com/', 'Updated')).toBe(false);
        expect(await store.updateTitle('webview2', 'https://example.com/', 'Foreign engine')).toBe(false);
        expect(await store.updateTitle('electron', 'https://missing.example/', 'Missing')).toBe(false);
        expect((await store.query()).entries).toEqual([{ url: 'https://example.com/', title: 'Updated', lastVisited: 100, visitCount: 1 }]);
    });

    it('retains the other engine contribution, title, time and counts during cleanup', async () => {
        const dir = directory();
        let now = 100;
        const store = new BrowserHistoryStore(dir, () => now);
        await store.recordVisit('electron', 'https://example.com/', 'Electron title');
        await store.recordVisit('electron', 'https://example.com/', 'Electron title');
        now = 200;
        await store.recordVisit('webview2', 'https://example.com/', 'WebView title');
        await store.recordVisit('webview2', 'https://exclusive.example/', 'WebView only');
        expect((await store.query('https://example.com/')).entries[0].visitCount).toBe(3);
        expect(await store.clearEngine('webview2')).toBe(true);
        expect((await new BrowserHistoryStore(dir, () => now).query()).entries).toEqual([
            { url: 'https://example.com/', title: 'Electron title', lastVisited: 100, visitCount: 2 },
        ]);
        expect(await store.updateTitle('webview2', 'https://example.com/', 'Late title')).toBe(false);
        expect(await store.clearEngine('electron')).toBe(true);
        expect((await store.query()).total).toBe(0);
        expect(await store.clearEngine('electron')).toBe(false);
    });

    it('expires at 90 days from the latest URL visit and filters expiry while running', async () => {
        const dir = directory();
        let now = BROWSER_HISTORY_RETENTION_MS + 1000;
        seed(dir, [entry('https://expired.example/', 1000), entry('https://recent.example/', 1001),
            { url: 'https://shared.example/', engines: {
                electron: { title: 'Old contribution', lastVisited: 1, visitCount: 2 },
                webview2: { title: 'Recent', lastVisited: now, visitCount: 1 },
            } }]);
        const store = new BrowserHistoryStore(dir, () => now);
        expect((await store.query()).entries.map(item => item.url)).toEqual(['https://shared.example/', 'https://recent.example/']);
        expect((await store.query('shared')).entries[0].visitCount).toBe(3);
        now += 1;
        expect((await store.query()).total).toBe(1);
        await store.recordVisit('electron', 'https://new.example/', 'New');
        expect(JSON.parse(fs.readFileSync(store.filename, 'utf8')).entries).toHaveLength(2);
        now += BROWSER_HISTORY_RETENTION_MS;
        expect((await store.query()).total).toBe(0);
        expect(await store.pruneExpired()).toBe(true);
        expect(JSON.parse(fs.readFileSync(store.filename, 'utf8')).entries).toEqual([]);
    });

    it('caps unique URLs at 10,000 and evicts the least recently visited', async () => {
        const dir = directory();
        seed(dir, Array.from({ length: BROWSER_HISTORY_MAX_ENTRIES + 1 }, (_, index) =>
            entry(`https://example.com/${index}`, index + 1)));
        const store = new BrowserHistoryStore(dir, () => 20_000);
        expect((await store.query()).total).toBe(BROWSER_HISTORY_MAX_ENTRIES);
        expect((await store.query('https://example.com/0')).total).toBe(0);
        await store.recordVisit('electron', 'https://new.example/', 'New');
        const persisted = JSON.parse(fs.readFileSync(store.filename, 'utf8')).entries;
        expect(persisted).toHaveLength(BROWSER_HISTORY_MAX_ENTRIES);
        expect(persisted.some((item: { url: string }) => item.url === 'https://example.com/1')).toBe(false);
        expect(persisted[0].url).toBe('https://new.example/');
    });

    it('recovers malformed/versioned storage and skips invalid entries safely', async () => {
        const dir = directory();
        const filename = path.join(dir, 'browser', 'history.json');
        seed(dir, []);
        for (const raw of ['{broken', 'null', '{}', '{"version":2,"recording":true,"entries":[]}']) {
            fs.writeFileSync(filename, raw);
            const store = new BrowserHistoryStore(dir, () => 100);
            expect(await store.query()).toMatchObject({ total: 0, recording: true, storageError: expect.any(String) });
            await store.recordVisit('electron', 'https://example.com/', 'Recovered');
            expect((await store.query()).storageError).toBeNull();
            expect((await new BrowserHistoryStore(dir, () => 100).query()).total).toBe(1);
        }
        seed(dir, [null, {}, entry('file:///tmp/test.html', 10),
            entry('https://user:password@example.com/', 10), entry('https://example.com/', 20, 'Latest'),
            { url: 'https://invalid.example/', engines: { electron: { title: 'Bad', lastVisited: '20', visitCount: -1 } } }]);
        expect((await new BrowserHistoryStore(dir, () => 100).query()).entries).toEqual([
            { url: 'https://example.com/', title: 'Latest', lastVisited: 20, visitCount: 1 },
        ]);
    });

    it('bounds case-insensitive search and pagination without exposing mutable state', async () => {
        const store = new BrowserHistoryStore(directory(), () => 100);
        await store.recordVisit('electron', 'https://b.example/Case', 'Some title');
        await store.recordVisit('electron', 'https://a.example/', 'SOME TITLE');
        expect((await store.query('some', 1, 1)).entries[0].url).toBe('https://b.example/Case');
        expect((await store.query('CASE')).total).toBe(1);
        const result = await store.query();
        result.entries[0].title = 'Modified outside';
        expect((await store.query()).entries[0].title).toBe('SOME TITLE');
        for (const args of [['', -1, 5], ['', 0, 101], ['', 0, 0], ['', 0.5, 5], ['x'.repeat(8193), 0, 5]] as const) {
            await expect(store.query(...args)).rejects.toThrow('Invalid history query');
        }
        expect(() => store.setRecording('true' as never)).toThrow();
        expect(() => store.clearEngine('unknown' as never)).toThrow();
        expect(() => store.recordVisit('unknown' as never, 'https://example.com/', '')).toThrow();
    });

    it('serializes overlapping window writes and prevents queued title updates from resurrecting deletions', async () => {
        const dir = directory();
        const store = new BrowserHistoryStore(dir);
        // All desktop windows/workspaces call this same main-process store.
        const calls = Array.from({ length: 20 }, (_, index) =>
            store.recordVisit(index % 2 ? 'webview2' : 'electron', 'https://example.com/', `Window ${index}`));
        calls.push(store.recordVisit('electron', 'https://other.example/', 'Other workspace'));
        await Promise.all(calls);
        expect((await new BrowserHistoryStore(dir).query('https://example.com/')).entries[0].visitCount).toBe(20);
        await Promise.all([
            store.recordVisit('electron', 'https://example.com/', 'Queued visit'),
            store.delete('https://example.com/'),
            store.updateTitle('electron', 'https://example.com/', 'Late title'),
        ]);
        expect((await new BrowserHistoryStore(dir).query('https://example.com/')).total).toBe(0);
        await store.recordVisit('webview2', 'https://example.com/', 'New navigation');
        expect((await store.query('https://example.com/')).entries[0].visitCount).toBe(1);
    });

    it('persists pause/resume and keeps queries and recording preference across clear', async () => {
        const dir = directory();
        const store = new BrowserHistoryStore(dir);
        await store.recordVisit('electron', 'https://example.com/', 'Existing');
        await store.setRecording(false);
        const restarted = new BrowserHistoryStore(dir);
        expect(await restarted.recordVisit('webview2', 'https://new.example/', 'Paused')).toBe(false);
        expect((await restarted.query()).total).toBe(1);
        expect(await restarted.clear()).toBe(true);
        expect((await restarted.query()).recording).toBe(false);
        expect(await restarted.clear()).toBe(true);
        await restarted.setRecording(true);
        await restarted.recordVisit('electron', 'https://new.example/', 'Resumed');
        expect((await new BrowserHistoryStore(dir).query()).recording).toBe(true);
    });

    it('reports write failures without publishing a mutation and recovers on the next save', async () => {
        const dir = directory();
        const store = new BrowserHistoryStore(dir);
        await store.recordVisit('electron', 'https://example.com/', 'Saved');
        const disk = fs.readFileSync(store.filename, 'utf8');
        const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValue(new Error('Disk unavailable'));
        await expect(store.delete('https://example.com/')).rejects.toThrow('Disk unavailable');
        await expect(store.setRecording(false)).rejects.toThrow('Disk unavailable');
        expect(await store.query()).toMatchObject({ total: 1, recording: true, storageError: expect.stringContaining('Disk unavailable') });
        expect(fs.readFileSync(store.filename, 'utf8')).toBe(disk);
        expect(fs.readdirSync(path.join(dir, 'browser'))).toEqual(['history.json']);
        rename.mockRestore();
        await store.delete('https://example.com/');
        expect(await store.query()).toMatchObject({ total: 0, storageError: null });
    });

    it.each(['mkdir', 'writeFile'] as const)('reports %s failures and allows a later successful save', async method => {
        const store = new BrowserHistoryStore(directory());
        const failure = vi.spyOn(fs.promises, method).mockRejectedValue(new Error('Save failed'));
        await expect(store.recordVisit('electron', 'https://example.com/', 'Unsaved')).rejects.toThrow('Save failed');
        expect(await store.query()).toMatchObject({ total: 0, storageError: expect.stringContaining('Save failed') });
        failure.mockRestore();
        await store.recordVisit('electron', 'https://example.com/', 'Saved');
        expect((await store.query()).entries[0].visitCount).toBe(1);
    });

    it('clears corrupt storage even when the in-memory history is empty', async () => {
        const dir = directory();
        seed(dir, []);
        const filename = path.join(dir, 'browser', 'history.json');
        fs.writeFileSync(filename, '{broken');
        const store = new BrowserHistoryStore(dir);
        await store.clear();
        expect(JSON.parse(fs.readFileSync(filename, 'utf8'))).toEqual({ version: 1, recording: true, entries: [] });
        expect((await store.query()).storageError).toBeNull();
    });

    it('finishes each atomic write before beginning the next one', async () => {
        const store = new BrowserHistoryStore(directory());
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const realRename = fs.promises.rename;
        const rename = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async (...args) => {
            entered();
            await gate;
            return realRename(...args);
        });
        const first = store.recordVisit('electron', 'https://example.com/', 'First window');
        const second = store.recordVisit('webview2', 'https://example.com/', 'Second window');
        let flushed = false;
        const flush = store.flush().then(() => { flushed = true; });
        await started;
        expect(rename).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(store.filename)).toBe(false);
        expect(flushed).toBe(false);
        release();
        await Promise.all([first, second, flush]);
        expect(flushed).toBe(true);
        expect(rename).toHaveBeenCalledTimes(2);
        expect((await new BrowserHistoryStore(path.dirname(path.dirname(store.filename))).query()).entries[0].visitCount).toBe(2);
    });

    it('does not modify engine profiles or sign-in data during history deletion', async () => {
        const dir = directory();
        for (const engine of ['electron', 'webview2']) {
            const profile = path.join(dir, 'browser', engine);
            fs.mkdirSync(profile, { recursive: true });
            fs.writeFileSync(path.join(profile, 'Cookies'), 'Signed in');
        }
        const store = new BrowserHistoryStore(dir);
        await store.recordVisit('electron', 'https://example.com/', 'Page');
        await store.clear();
        for (const engine of ['electron', 'webview2']) {
            expect(fs.readFileSync(path.join(dir, 'browser', engine, 'Cookies'), 'utf8')).toBe('Signed in');
        }
    });
});
