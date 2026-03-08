import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveTaskRoot, ensureTaskRoot } from '../../src/server/task-root-resolver';
import { computeRepoId } from '../../src/server/queue-persistence';

describe('task-root-resolver', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-root-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns correct path structure', () => {
        const info = resolveTaskRoot({ dataDir: '/data', rootPath: '/my/repo' });
        const expectedId = computeRepoId('/my/repo');
        expect(info.absolutePath).toBe(path.join('/data', 'repos', expectedId, 'tasks'));
    });

    it('produces deterministic repoId', () => {
        const a = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/stable/path' });
        const b = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/stable/path' });
        expect(a.repoId).toBe(b.repoId);
    });

    it('produces different repoIds for different rootPaths', () => {
        const a = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/repo/one' });
        const b = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/repo/two' });
        expect(a.repoId).not.toBe(b.repoId);
    });

    it('repoId is consistent with computeRepoId', () => {
        const rootPath = '/some/project';
        const info = resolveTaskRoot({ dataDir: tmpDir, rootPath });
        expect(info.repoId).toBe(computeRepoId(rootPath));
    });

    it('relativeFolderPath equals absolutePath', () => {
        const info = resolveTaskRoot({ dataDir: tmpDir, rootPath: '/any/repo' });
        expect(info.relativeFolderPath).toBe(info.absolutePath);
    });

    it('resolves relative rootPath the same as absolute', () => {
        const abs = path.resolve('./my-repo');
        const fromRelative = resolveTaskRoot({ dataDir: tmpDir, rootPath: './my-repo' });
        const fromAbsolute = resolveTaskRoot({ dataDir: tmpDir, rootPath: abs });
        expect(fromRelative.repoId).toBe(fromAbsolute.repoId);
        expect(fromRelative.absolutePath).toBe(fromAbsolute.absolutePath);
    });

    it('ensureTaskRoot creates the directory', async () => {
        const info = await ensureTaskRoot({ dataDir: tmpDir, rootPath: '/test/repo' });
        expect(fs.existsSync(info.absolutePath)).toBe(true);
    });

    it('ensureTaskRoot is idempotent', async () => {
        const opts = { dataDir: tmpDir, rootPath: '/test/repo' };
        await ensureTaskRoot(opts);
        await expect(ensureTaskRoot(opts)).resolves.toBeDefined();
    });

    it('resolveTaskRoot performs no I/O (non-existent dataDir does not throw)', () => {
        const nonExistent = path.join(tmpDir, 'does', 'not', 'exist');
        expect(() => resolveTaskRoot({ dataDir: nonExistent, rootPath: '/any' })).not.toThrow();
    });
});
