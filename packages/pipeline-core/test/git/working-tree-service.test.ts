import { describe, it, expect, vi, afterEach } from 'vitest';
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
