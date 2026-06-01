import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RemoteServerStore } from '../../src/server/servers/remote-server-store';

describe('RemoteServerStore', () => {
    let dataDir: string;
    let store: RemoteServerStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-server-store-'));
        store = new RemoteServerStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('creates, lists, updates, and deletes URL entries', () => {
        const created = store.create({ kind: 'url', label: 'Lab', url: ' http://127.0.0.1:4000/// ' });
        expect(created.kind).toBe('url');
        expect(created.label).toBe('Lab');
        expect(created.url).toBe('http://127.0.0.1:4000');
        expect(created.updatedAt).toBe(created.addedAt);

        const updated = store.update(created.id, { label: 'Lab 2', url: 'https://box.example.com/' });
        expect(updated).toMatchObject({ kind: 'url', label: 'Lab 2', url: 'https://box.example.com' });
        expect(updated.addedAt).toBe(created.addedAt);
        expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

        expect(store.list()).toHaveLength(1);
        expect(store.remove(created.id)?.id).toBe(created.id);
        expect(store.list()).toEqual([]);
    });

    it('creates, lists, updates, and deletes DevTunnel entries', () => {
        const created = store.create({ kind: 'devtunnel', label: 'VM', tunnelId: 'my-remote-coc' });
        expect(created).toMatchObject({ kind: 'devtunnel', label: 'VM', tunnelId: 'my-remote-coc' });

        const updated = store.update(created.id, { label: 'VM 2', tunnelId: 'my-remote-coc-2' });
        expect(updated).toMatchObject({ kind: 'devtunnel', label: 'VM 2', tunnelId: 'my-remote-coc-2' });

        expect(store.list()).toHaveLength(1);
        expect(store.remove(created.id)?.id).toBe(created.id);
        expect(store.list()).toEqual([]);
    });

    it('creates, lists, updates, and deletes SSH entries', () => {
        const created = store.create({ kind: 'ssh', label: 'Dev VM', host: 'ubuntu-arm', localPort: 4000 });
        expect(created).toMatchObject({ kind: 'ssh', label: 'Dev VM', host: 'ubuntu-arm', localPort: 4000 });
        expect(created.updatedAt).toBe(created.addedAt);

        const updated = store.update(created.id, { label: 'Dev VM 2', host: 'ubuntu-x86', localPort: 5000 });
        expect(updated).toMatchObject({ kind: 'ssh', label: 'Dev VM 2', host: 'ubuntu-x86', localPort: 5000 });
        expect(updated.addedAt).toBe(created.addedAt);
        expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

        expect(store.list()).toHaveLength(1);
        expect(store.remove(created.id)?.id).toBe(created.id);
        expect(store.list()).toEqual([]);
    });

    it('rejects invalid URL and DevTunnel inputs', () => {
        expect(() => store.create({ kind: 'url', label: 'Bad', url: 'ftp://example.com' })).toThrow(/http or https/);
        expect(() => store.create({ kind: 'devtunnel', label: 'Bad', tunnelId: '../bad' })).toThrow(/tunnelId/);
        expect(() => store.create({ kind: 'url', label: '', url: 'http://example.com' })).toThrow(/label/);
    });

    it('rejects invalid SSH inputs', () => {
        expect(() => store.create({ kind: 'ssh', label: 'Bad', host: '', localPort: 4000 })).toThrow(/host/);
        expect(() => store.create({ kind: 'ssh', label: 'Bad', host: 'myhost', localPort: 0 })).toThrow(/localPort/);
        expect(() => store.create({ kind: 'ssh', label: 'Bad', host: 'myhost', localPort: 65536 })).toThrow(/localPort/);
        expect(() => store.create({ kind: 'ssh', label: 'Bad', host: 'myhost', localPort: 1.5 })).toThrow(/localPort/);
    });    it('persists the registry under the global data directory', () => {
        const created = store.create({ kind: 'url', label: 'A', url: 'http://a.example.com' });
        const reloaded = new RemoteServerStore(dataDir);
        expect(reloaded.list()[0]).toEqual(created);
        expect(fs.existsSync(path.join(dataDir, 'remote-servers.json'))).toBe(true);
    });

    it('persists SSH entries across store reloads', () => {
        const created = store.create({ kind: 'ssh', label: 'Arm Box', host: 'ubuntu-arm', localPort: 4000 });
        const reloaded = new RemoteServerStore(dataDir);
        expect(reloaded.list()[0]).toEqual(created);
    });
});
