import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveTaskRoot, ensureTaskRoot } from '../../src/server/task-root-resolver';

describe('task-root-resolver', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-root-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns correct path structure', () => {
        const info = resolveTaskRoot({ dataDir: '/data', rootPath: '/my/repo', workspaceId: 'ws-test' });
        expect(info.absolutePath).toBe(path.join('/data', 'repos', 'ws-test', 'tasks'));
    });

    it('produces deterministic repoId', () => {
        const a = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/stable/path', workspaceId: 'ws-test' });
        const b = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/stable/path', workspaceId: 'ws-test' });
        expect(a.repoId).toBe(b.repoId);
    });

    it('produces different repoIds for different workspaceIds', () => {
        const a = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/repo/one', workspaceId: 'ws-one' });
        const b = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/repo/two', workspaceId: 'ws-two' });
        expect(a.repoId).not.toBe(b.repoId);
    });

    it('repoId equals workspaceId', () => {
        const info = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/some/project', workspaceId: 'ws-abc123' });
        expect(info.repoId).toBe('ws-abc123');
    });

    it('relativeFolderPath equals absolutePath', () => {
        const info = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/any/repo', workspaceId: 'ws-test' });
        expect(info.relativeFolderPath).toBe(info.absolutePath);
    });

    it('same workspaceId produces same result regardless of rootPath', () => {
        const fromRelative = resolveTaskRoot({ dataDir: tmpDir, rootPath: './my-repo', workspaceId: 'ws-test' });
        const fromAbsolute = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/other/path', workspaceId: 'ws-test' });
        expect(fromRelative.repoId).toBe(fromAbsolute.repoId);
        expect(fromRelative.absolutePath).toBe(fromAbsolute.absolutePath);
    });

    it('ensureTaskRoot creates the directory', async () => {
        const info = await ensureTaskRoot({ dataDir: tmpDir, rootPath: '/test/repo', workspaceId: 'ws-test' });
        expect(fs.existsSync(info.absolutePath)).toBe(true);
    });

    it('ensureTaskRoot is idempotent', async () => {
        const opts = { dataDir: tmpDir, rootPath: '/test/repo', workspaceId: 'ws-test' };
        await ensureTaskRoot(opts);
        await expect(ensureTaskRoot(opts)).resolves.toBeDefined();
    });

    it('resolveTaskRoot performs no I/O (non-existent dataDir does not throw)', () => {
        const nonExistent = path.join(tmpDir, 'does', 'not', 'exist');
        expect(() => resolveTaskRoot({ dataDir: nonExistent, rootPath: '/any', workspaceId: 'ws-test' })).not.toThrow();
    });
});
