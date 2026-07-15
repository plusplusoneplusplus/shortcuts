import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    resolveTaskRoot,
    ensureTaskRoot,
    buildRootLabel,
    resolveAllTaskRoots,
    resolveExistingTaskRoots,
    taskRootPathComparisonKey,
} from '../../src/server/tasks/task-root-resolver';

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

    describe('buildRootLabel', () => {
        it('includes parent and basename segments', () => {
            const label = buildRootLabel(path.join('/home', 'user', '.coc', 'repos', 'ws-kss6a7', 'tasks'));
            expect(label).toBe(path.join('ws-kss6a7', 'tasks'));
        });

        it('distinguishes roots with same basename', () => {
            const a = buildRootLabel(path.join('/data', 'repos', 'ws-abc', 'tasks'));
            const b = buildRootLabel(path.join('/project', '.vscode', 'tasks'));
            expect(a).not.toBe(b);
            expect(a).toBe(path.join('ws-abc', 'tasks'));
            expect(b).toBe(path.join('.vscode', 'tasks'));
        });
    });

    describe('resolveAllTaskRoots', () => {
        it('returns parent/basename labels instead of bare basename', () => {
            const roots = resolveAllTaskRoots(
                { dataDir: '/data', rootPath: '/my/repo', workspaceId: 'ws-test' },
                ['.vscode/tasks'],
            );
            expect(roots).toHaveLength(2);
            expect(roots[0].label).toBe(path.join('ws-test', 'tasks'));
            expect(roots[1].label).toBe(path.join('.vscode', 'tasks'));
        });

        it('returns a single root when no additional paths provided', () => {
            const roots = resolveAllTaskRoots(
                { dataDir: '/data', rootPath: '/my/repo', workspaceId: 'ws-test' },
                [],
            );
            expect(roots).toHaveLength(1);
            expect(roots[0].label).toBe(path.join('ws-test', 'tasks'));
        });
    });

    describe('resolveExistingTaskRoots', () => {
        it('returns only existing directories with source-specific labels', () => {
            const workspaceRoot = path.join(tmpDir, 'workspace');
            const options = { dataDir: tmpDir, rootPath: workspaceRoot, workspaceId: 'ws-test' };
            const primary = resolveTaskRoot(options).absolutePath;
            const legacy = path.join(workspaceRoot, '.vscode', 'tasks');
            const configured = path.join(workspaceRoot, 'plans');
            fs.mkdirSync(primary, { recursive: true });
            fs.mkdirSync(legacy, { recursive: true });
            fs.mkdirSync(configured, { recursive: true });

            expect(resolveExistingTaskRoots(options, ['plans', 'missing'])).toEqual([
                { absolutePath: fs.realpathSync.native(primary), label: 'Task Plans', source: 'primary' },
                { absolutePath: fs.realpathSync.native(legacy), label: 'Legacy Plans (.vscode/tasks)', source: 'legacy' },
                { absolutePath: fs.realpathSync.native(configured), label: 'plans', source: 'configured' },
            ]);
        });

        it('deduplicates canonical directories in source priority order', () => {
            const workspaceRoot = path.join(tmpDir, 'workspace');
            const options = { dataDir: tmpDir, rootPath: workspaceRoot, workspaceId: 'ws-test' };
            const legacy = path.join(workspaceRoot, '.vscode', 'tasks');
            fs.mkdirSync(legacy, { recursive: true });

            expect(resolveExistingTaskRoots(options, ['.vscode/tasks', legacy, '.vscode/tasks/.'])).toEqual([
                {
                    absolutePath: fs.realpathSync.native(legacy),
                    label: 'Legacy Plans (.vscode/tasks)',
                    source: 'legacy',
                },
            ]);
        });

        it('uses platform-appropriate path comparison keys', () => {
            expect(taskRootPathComparisonKey('/Repo/Plans', 'linux')).not.toBe(
                taskRootPathComparisonKey('/repo/plans', 'linux'),
            );
            expect(taskRootPathComparisonKey('/Repo/Plans', 'darwin')).not.toBe(
                taskRootPathComparisonKey('/repo/plans', 'darwin'),
            );
            expect(taskRootPathComparisonKey('C:\\Repo\\Plans', 'win32')).toBe(
                taskRootPathComparisonKey('c:\\repo\\plans', 'win32'),
            );
        });
    });
});
