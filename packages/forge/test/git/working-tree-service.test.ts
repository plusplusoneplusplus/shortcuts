import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GitChange, GitChangeStage, GitChangeStatus } from '../../src/git/types';
import { WorkingTreeService } from '../../src/git/working-tree-service';

const ROOT = process.platform === 'win32' ? 'C:\\repo' : '/repo';

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.getFileDiff
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/utils/exec-utils', () => ({
    execFileAsync: vi.fn(),
}));

import { execFileAsync } from '../../src/utils/exec-utils';

const mockExecFileAsync = vi.mocked(execFileAsync);

describe('WorkingTreeService.getFileDiff', () => {
    afterEach(() => {
        mockExecFileAsync.mockReset();
    });

    const service = new WorkingTreeService();
    const repoRoot = ROOT;
    const filePath = path.join(ROOT, 'src', 'foo.ts');

    it('calls git diff --staged for staged=true', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: 'diff output', stderr: '' } as any);
        const result = await service.getFileDiff(repoRoot, filePath, true);
        expect(result).toBe('diff output');
        expect(mockExecFileAsync).toHaveBeenCalledWith(
            'git',
            expect.arrayContaining(['diff', '-U99999', '--staged', '--', filePath]),
            expect.objectContaining({ cwd: repoRoot }),
        );
    });

    it('calls git diff without --staged for staged=false', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: 'unstaged diff', stderr: '' } as any);
        const result = await service.getFileDiff(repoRoot, filePath, false);
        expect(result).toBe('unstaged diff');
        const args = mockExecFileAsync.mock.calls[0][1] as string[];
        expect(args).not.toContain('--staged');
    });

    it('returns empty string on error', async () => {
        mockExecFileAsync.mockRejectedValue(new Error('git failed'));
        const result = await service.getFileDiff(repoRoot, filePath, false);
        expect(result).toBe('');
    });

    it('returns empty string when diff is empty', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const result = await service.getFileDiff(repoRoot, filePath, true);
        expect(result).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.getAllChanges
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.stageFile
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkingTreeService.stageFile', () => {
    afterEach(() => {
        mockExecFileAsync.mockReset();
    });

    const service = new WorkingTreeService();
    const repoRoot = ROOT;

    it('stages a regular file successfully', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const result = await service.stageFile(repoRoot, path.join(ROOT, 'src', 'foo.ts'));
        expect(result).toEqual({ success: true });
    });

    it('returns error on git failure', async () => {
        mockExecFileAsync.mockRejectedValue(new Error('fatal: pathspec did not match'));
        const result = await service.stageFile(repoRoot, path.join(ROOT, 'missing.ts'));
        expect(result.success).toBe(false);
        expect(result.error).toContain('pathspec did not match');
    });

    it.runIf(process.platform === 'win32')('routes WSL repos through wsl.exe', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const repo = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        const file = String.raw`\\wsl$\Ubuntu\home\tester\repo\src\foo.ts`;
        await service.stageFile(repo, file);
        expect(mockExecFileAsync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'git', '-C', '/home/tester/repo', 'add', '--', '/home/tester/repo/src/foo.ts'],
            expect.any(Object),
        );
    });

    it('supports directory paths with trailing separators', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const dirPath = process.platform === 'win32'
            ? 'D:\\projects\\shortcuts\\.github\\coc\\'
            : '/repo/some/dir/';
        await service.stageFile(repoRoot, dirPath);
        expect(mockExecFileAsync).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.stageFiles
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkingTreeService.stageFiles', () => {
    afterEach(() => {
        mockExecFileAsync.mockReset();
    });

    const service = new WorkingTreeService();
    const repoRoot = ROOT;

    it('returns success with staged=0 for empty array', async () => {
        const result = await service.stageFiles(repoRoot, []);
        expect(result).toEqual({ success: true, staged: 0, errors: [] });
        expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('stages all files in a single git add command', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts', 'src/b.ts'];
        const result = await service.stageFiles(repoRoot, files);
        expect(result).toEqual({ success: true, staged: 2, errors: [] });
        expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
        expect(mockExecFileAsync.mock.calls[0][0]).toBe('git');
        expect(mockExecFileAsync.mock.calls[0][1]).toEqual(expect.arrayContaining(['add', '--']));
    });

    it('falls back to individual staging on batch error', async () => {
        // First call (batch) fails, subsequent individual calls succeed
        mockExecFileAsync
            .mockRejectedValueOnce(new Error('batch failed'))
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts', 'src/b.ts'];
        const result = await service.stageFiles(repoRoot, files);
        expect(result.success).toBe(true);
        expect(result.staged).toBe(2);
        expect(result.errors).toHaveLength(0);
        // 1 batch call + 2 individual calls
        expect(mockExecFileAsync).toHaveBeenCalledTimes(3);
    });

    it('collects errors from individual fallback failures', async () => {
        mockExecFileAsync
            .mockRejectedValueOnce(new Error('batch failed'))
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
            .mockRejectedValueOnce(new Error('permission denied'));
        const files = ['src/a.ts', 'src/b.ts'];
        const result = await service.stageFiles(repoRoot, files);
        expect(result.success).toBe(false);
        expect(result.staged).toBe(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('permission denied');
    });

    it('supports trailing separators in batch staging', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const dirWithTrailingSep = process.platform === 'win32'
            ? 'D:\\projects\\shortcuts\\.github\\coc\\'
            : '/repo/some/dir/';
        const result = await service.stageFiles(repoRoot, [dirWithTrailingSep]);
        expect(result.success).toBe(true);
        expect(mockExecFileAsync).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.unstageFiles
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkingTreeService.unstageFiles', () => {
    afterEach(() => {
        mockExecFileAsync.mockReset();
    });

    const service = new WorkingTreeService();
    const repoRoot = ROOT;

    it('returns success with unstaged=0 for empty array', async () => {
        const result = await service.unstageFiles(repoRoot, []);
        expect(result).toEqual({ success: true, unstaged: 0, errors: [] });
        expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('unstages all files in a single git reset command', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts', 'src/b.ts'];
        const result = await service.unstageFiles(repoRoot, files);
        expect(result).toEqual({ success: true, unstaged: 2, errors: [] });
        expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
        expect(mockExecFileAsync.mock.calls[0][1]).toEqual(expect.arrayContaining(['reset', 'HEAD', '--']));
    });

    it('falls back to individual unstaging on batch error', async () => {
        mockExecFileAsync
            .mockRejectedValueOnce(new Error('batch failed'))
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts', 'src/b.ts'];
        const result = await service.unstageFiles(repoRoot, files);
        expect(result.success).toBe(true);
        expect(result.unstaged).toBe(2);
        expect(result.errors).toHaveLength(0);
    });

    it('falls back to git rm --cached when reset HEAD fails', async () => {
        // batch fails, first individual reset fails, then rm --cached succeeds
        mockExecFileAsync
            .mockRejectedValueOnce(new Error('batch failed'))
            .mockRejectedValueOnce(new Error('reset failed'))
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts'];
        const result = await service.unstageFiles(repoRoot, files);
        expect(result.success).toBe(true);
        expect(result.unstaged).toBe(1);
        // 1 batch + 1 reset + 1 rm --cached
        expect(mockExecFileAsync).toHaveBeenCalledTimes(3);
    });

    it('collects errors when all fallbacks fail', async () => {
        mockExecFileAsync
            .mockRejectedValueOnce(new Error('batch failed'))
            .mockRejectedValueOnce(new Error('reset failed'))
            .mockRejectedValueOnce(new Error('rm failed'));
        const files = ['src/a.ts'];
        const result = await service.unstageFiles(repoRoot, files);
        expect(result.success).toBe(false);
        expect(result.unstaged).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('rm failed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.deleteUntrackedFile
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(),
        statSync: vi.fn(),
        unlinkSync: vi.fn(),
        rmSync: vi.fn(),
    };
});

const mockFs = vi.mocked(fs);

describe('WorkingTreeService.deleteUntrackedFile', () => {
    const service = new WorkingTreeService();
    const repoRoot = ROOT;
    const filePath = path.join(ROOT, 'src', 'foo.ts');
    const dirPath = path.join(ROOT, '__snapshots__');

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('returns error when file does not exist', async () => {
        mockFs.existsSync.mockReturnValue(false);
        const result = await service.deleteUntrackedFile(repoRoot, filePath);
        expect(result.success).toBe(false);
        expect(result.error).toContain('does not exist');
        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
        expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('calls unlinkSync for a regular file', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);
        const result = await service.deleteUntrackedFile(repoRoot, filePath);
        expect(result.success).toBe(true);
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(filePath);
        expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('calls rmSync with recursive:true for a directory', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
        const result = await service.deleteUntrackedFile(repoRoot, dirPath);
        expect(result.success).toBe(true);
        expect(mockFs.rmSync).toHaveBeenCalledWith(dirPath, { recursive: true });
        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('returns error when unlinkSync throws (e.g. EPERM on Windows)', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);
        mockFs.unlinkSync.mockImplementation(() => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); });
        const result = await service.deleteUntrackedFile(repoRoot, filePath);
        expect(result.success).toBe(false);
        expect(result.error).toContain('EPERM');
    });

    it('returns error when rmSync throws', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
        mockFs.rmSync.mockImplementation(() => { throw new Error('permission denied'); });
        const result = await service.deleteUntrackedFile(repoRoot, dirPath);
        expect(result.success).toBe(false);
        expect(result.error).toContain('permission denied');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.discardAll
// ─────────────────────────────────────────────────────────────────────────────

/** One row of a working tree, as `getAllChanges` would report it. */
function change(name: string, status: GitChangeStatus, stage: GitChangeStage): GitChange {
    return {
        filePath: path.join(ROOT, name),
        status,
        stage,
        repositoryRoot: ROOT,
        repositoryName: path.basename(ROOT),
    };
}

// discardAll orchestrates three phases over the change list. The list itself
// now comes from the native addon, so it is stubbed at the method — there is no
// porcelain text in TypeScript left to fake.
describe('WorkingTreeService.discardAll', () => {
    const service = new WorkingTreeService();
    const repoRoot = ROOT;
    let changes: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetAllMocks();
        changes = vi.spyOn(service, 'getAllChanges');
    });

    afterEach(() => {
        changes.mockRestore();
    });

    /** Queue the successive `getAllChanges` results discardAll will read. */
    function reports(...results: GitChange[][]): void {
        for (const result of results) changes.mockResolvedValueOnce(result as never);
    }

    it('returns success with discarded=0 when there are no changes', async () => {
        reports([]);
        const result = await service.discardAll(repoRoot);
        expect(result).toEqual({ success: true, discarded: 0, errors: [] });
        // Nothing to unstage/discard/delete, so no git command runs at all.
        expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('unstages, discards, and deletes a mixed working tree', async () => {
        reports(
            [
                change('staged.ts', 'modified', 'staged'),
                change('unstaged.ts', 'modified', 'unstaged'),
                change('untracked.txt', 'untracked', 'untracked'),
            ],
            // Re-read after unstaging: the staged file is now an unstaged edit.
            [
                change('staged.ts', 'modified', 'unstaged'),
                change('unstaged.ts', 'modified', 'unstaged'),
                change('untracked.txt', 'untracked', 'untracked'),
            ],
        );
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

        const result = await service.discardAll(repoRoot);

        expect(result.success).toBe(true);
        expect(result.errors).toEqual([]);
        // 2 tracked files reverted + 1 untracked deleted.
        expect(result.discarded).toBe(3);
        const commands = mockExecFileAsync.mock.calls.map(c => (c[1] as string[]).join(' '));
        expect(commands.some(c => c.includes('reset HEAD'))).toBe(true);
        expect(commands.some(c => c.includes('checkout --'))).toBe(true);
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join(ROOT, 'untracked.txt'));
    });

    it('deletes a staged-added file after unstaging turns it untracked', async () => {
        // A staged "added" file becomes untracked once unstaged, so it is deleted, not checked out.
        reports(
            [change('brand-new.ts', 'added', 'staged')],
            [change('brand-new.ts', 'untracked', 'untracked')],
        );
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

        const result = await service.discardAll(repoRoot);

        expect(result.success).toBe(true);
        expect(result.discarded).toBe(1);
        // No checkout needed — nothing tracked remained after unstaging.
        const commands = mockExecFileAsync.mock.calls.map(c => (c[1] as string[]).join(' '));
        expect(commands.some(c => c.includes('checkout --'))).toBe(false);
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join(ROOT, 'brand-new.ts'));
    });

    it('surfaces a phase-prefixed error when discarding a tracked file fails', async () => {
        // No staged paths → no re-read. checkout batch fails, then per-file checkout fails.
        reports([change('a.ts', 'modified', 'unstaged'), change('b.txt', 'untracked', 'untracked')]);
        mockExecFileAsync
            .mockRejectedValueOnce(new Error('batch checkout failed'))
            .mockRejectedValueOnce(new Error('checkout: pathspec error'));
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

        const result = await service.discardAll(repoRoot);

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('discard');
        expect(result.errors[0]).toContain('pathspec');
        // Untracked file is still deleted despite the discard failure (no hidden partial failure).
        expect(result.discarded).toBe(1);
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join(ROOT, 'b.txt'));
    });

    it('surfaces a delete-phase error when an untracked file cannot be removed', async () => {
        reports([change('c.txt', 'untracked', 'untracked')]);
        mockFs.existsSync.mockReturnValue(false); // delete fails: file does not exist

        const result = await service.discardAll(repoRoot);

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('delete');
        expect(result.discarded).toBe(0);
        // Nothing tracked to check out, so no git command ran.
        expect(mockExecFileAsync).not.toHaveBeenCalled();
    });
});
