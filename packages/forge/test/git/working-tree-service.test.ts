import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parsePorcelain, WorkingTreeService } from '../../src/git/working-tree-service';

const ROOT = process.platform === 'win32' ? 'C:\\repo' : '/repo';

describe('parsePorcelain', () => {
    it('returns empty array for empty output', () => {
        expect(parsePorcelain('', ROOT)).toEqual([]);
    });

    it('parses a staged modification', () => {
        const out = 'M  src/foo.ts';
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('modified');
        expect(result[0].stage).toBe('staged');
        expect(result[0].filePath).toBe(path.join(ROOT, 'src/foo.ts'));
    });

    it('parses an unstaged modification', () => {
        const out = ' M src/foo.ts';
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('modified');
        expect(result[0].stage).toBe('unstaged');
    });

    it('parses both staged and unstaged for same file', () => {
        const out = 'MM src/foo.ts';
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(2);
        expect(result.find(c => c.stage === 'staged')?.status).toBe('modified');
        expect(result.find(c => c.stage === 'unstaged')?.status).toBe('modified');
    });

    it('parses an untracked file', () => {
        const out = '?? newfile.txt';
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('untracked');
        expect(result[0].stage).toBe('untracked');
    });

    it('ignores ignored files (!!)', () => {
        const out = '!! dist/bundle.js';
        expect(parsePorcelain(out, ROOT)).toHaveLength(0);
    });

    it('parses staged added file', () => {
        const out = 'A  new-feature.ts';
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('added');
        expect(result[0].stage).toBe('staged');
    });

    it('parses deleted file (staged)', () => {
        const out = 'D  old.ts';
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('deleted');
        expect(result[0].stage).toBe('staged');
    });

    it('parses a renamed file', () => {
        const out = 'R  new.ts -> old.ts';
        const result = parsePorcelain(out, ROOT);
        // The format for rename in porcelain is "R  old -> new"
        // but our parser reads filePath from after ' -> '
        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('renamed');
        expect(result[0].stage).toBe('staged');
        expect(result[0].filePath).toBe(path.join(ROOT, 'old.ts'));
        expect(result[0].originalPath).toBe(path.join(ROOT, 'new.ts'));
    });

    it('parses conflict (UU)', () => {
        const out = 'UU conflicted.ts';
        const result = parsePorcelain(out, ROOT);
        // U in X column → staged conflict, U in Y column → unstaged conflict
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.some(c => c.status === 'conflict')).toBe(true);
    });

    it('handles multiple lines', () => {
        const out = [
            'M  staged.ts',
            ' M unstaged.ts',
            '?? new.txt',
        ].join('\n');
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(3);
    });

    it('sets repositoryRoot and repositoryName', () => {
        const out = 'M  foo.ts';
        const result = parsePorcelain(out, ROOT);
        expect(result[0].repositoryRoot).toBe(ROOT);
        expect(result[0].repositoryName).toBe(path.basename(ROOT));
    });

    it('handles Windows CRLF line endings', () => {
        const out = 'M  foo.ts\r\n M bar.ts\r\n';
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(2);
    });

    it('skips lines that are too short', () => {
        const out = 'M\n M  ts';
        // "M\n" is too short (< 4 chars), " M  ts" is long enough
        const result = parsePorcelain(out, ROOT);
        expect(result).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.getFileDiff
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/utils/exec-utils', () => ({
    execAsync: vi.fn(),
}));

import { execAsync } from '../../src/utils/exec-utils';

const mockExecAsync = vi.mocked(execAsync);

describe('WorkingTreeService.getFileDiff', () => {
    afterEach(() => {
        mockExecAsync.mockReset();
    });

    const service = new WorkingTreeService();
    const repoRoot = ROOT;
    const filePath = path.join(ROOT, 'src', 'foo.ts');

    it('calls git diff --staged for staged=true', async () => {
        mockExecAsync.mockResolvedValue({ stdout: 'diff output', stderr: '' } as any);
        const result = await service.getFileDiff(repoRoot, filePath, true);
        expect(result).toBe('diff output');
        expect(mockExecAsync).toHaveBeenCalledWith(
            expect.stringContaining('--staged'),
            expect.objectContaining({ cwd: repoRoot }),
        );
    });

    it('calls git diff without --staged for staged=false', async () => {
        mockExecAsync.mockResolvedValue({ stdout: 'unstaged diff', stderr: '' } as any);
        const result = await service.getFileDiff(repoRoot, filePath, false);
        expect(result).toBe('unstaged diff');
        const call = mockExecAsync.mock.calls[0][0] as string;
        expect(call).not.toContain('--staged');
    });

    it('returns empty string on error', async () => {
        mockExecAsync.mockRejectedValue(new Error('git failed'));
        const result = await service.getFileDiff(repoRoot, filePath, false);
        expect(result).toBe('');
    });

    it('returns empty string when diff is empty', async () => {
        mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const result = await service.getFileDiff(repoRoot, filePath, true);
        expect(result).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.stageFile
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkingTreeService.stageFile', () => {
    afterEach(() => {
        mockExecAsync.mockReset();
    });

    const service = new WorkingTreeService();
    const repoRoot = ROOT;

    it('stages a regular file successfully', async () => {
        mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const result = await service.stageFile(repoRoot, path.join(ROOT, 'src', 'foo.ts'));
        expect(result).toEqual({ success: true });
    });

    it('returns error on git failure', async () => {
        mockExecAsync.mockRejectedValue(new Error('fatal: pathspec did not match'));
        const result = await service.stageFile(repoRoot, path.join(ROOT, 'missing.ts'));
        expect(result.success).toBe(false);
        expect(result.error).toContain('pathspec did not match');
    });

    it('strips trailing path separator so Windows directory paths are quoted correctly', async () => {
        mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const dirPath = process.platform === 'win32'
            ? 'D:\\projects\\shortcuts\\.github\\coc\\'
            : '/repo/some/dir/';
        await service.stageFile(repoRoot, dirPath);
        const cmd = mockExecAsync.mock.calls[0][0] as string;
        expect(cmd).not.toMatch(/[/\\]"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.stageFiles
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkingTreeService.stageFiles', () => {
    afterEach(() => {
        mockExecAsync.mockReset();
    });

    const service = new WorkingTreeService();
    const repoRoot = ROOT;

    it('returns success with staged=0 for empty array', async () => {
        const result = await service.stageFiles(repoRoot, []);
        expect(result).toEqual({ success: true, staged: 0, errors: [] });
        expect(mockExecAsync).not.toHaveBeenCalled();
    });

    it('stages all files in a single git add command', async () => {
        mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts', 'src/b.ts'];
        const result = await service.stageFiles(repoRoot, files);
        expect(result).toEqual({ success: true, staged: 2, errors: [] });
        expect(mockExecAsync).toHaveBeenCalledTimes(1);
        expect(mockExecAsync.mock.calls[0][0]).toContain('git -C');
        expect(mockExecAsync.mock.calls[0][0]).toContain('add --');
    });

    it('falls back to individual staging on batch error', async () => {
        // First call (batch) fails, subsequent individual calls succeed
        mockExecAsync
            .mockRejectedValueOnce(new Error('batch failed'))
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts', 'src/b.ts'];
        const result = await service.stageFiles(repoRoot, files);
        expect(result.success).toBe(true);
        expect(result.staged).toBe(2);
        expect(result.errors).toHaveLength(0);
        // 1 batch call + 2 individual calls
        expect(mockExecAsync).toHaveBeenCalledTimes(3);
    });

    it('collects errors from individual fallback failures', async () => {
        mockExecAsync
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

    it('strips trailing path separator from directory path (Windows regression)', async () => {
        mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const dirWithTrailingSep = process.platform === 'win32'
            ? 'D:\\projects\\shortcuts\\.github\\coc\\'
            : '/repo/some/dir/';
        const result = await service.stageFiles(repoRoot, [dirWithTrailingSep]);
        expect(result.success).toBe(true);
        const cmd = mockExecAsync.mock.calls[0][0] as string;
        // The trailing separator must NOT appear immediately before the closing quote
        expect(cmd).not.toMatch(/[/\\]"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService.unstageFiles
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkingTreeService.unstageFiles', () => {
    afterEach(() => {
        mockExecAsync.mockReset();
    });

    const service = new WorkingTreeService();
    const repoRoot = ROOT;

    it('returns success with unstaged=0 for empty array', async () => {
        const result = await service.unstageFiles(repoRoot, []);
        expect(result).toEqual({ success: true, unstaged: 0, errors: [] });
        expect(mockExecAsync).not.toHaveBeenCalled();
    });

    it('unstages all files in a single git reset command', async () => {
        mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts', 'src/b.ts'];
        const result = await service.unstageFiles(repoRoot, files);
        expect(result).toEqual({ success: true, unstaged: 2, errors: [] });
        expect(mockExecAsync).toHaveBeenCalledTimes(1);
        expect(mockExecAsync.mock.calls[0][0]).toContain('reset HEAD --');
    });

    it('falls back to individual unstaging on batch error', async () => {
        mockExecAsync
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
        mockExecAsync
            .mockRejectedValueOnce(new Error('batch failed'))
            .mockRejectedValueOnce(new Error('reset failed'))
            .mockResolvedValueOnce({ stdout: '', stderr: '' } as any);
        const files = ['src/a.ts'];
        const result = await service.unstageFiles(repoRoot, files);
        expect(result.success).toBe(true);
        expect(result.unstaged).toBe(1);
        // 1 batch + 1 reset + 1 rm --cached
        expect(mockExecAsync).toHaveBeenCalledTimes(3);
    });

    it('collects errors when all fallbacks fail', async () => {
        mockExecAsync
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
