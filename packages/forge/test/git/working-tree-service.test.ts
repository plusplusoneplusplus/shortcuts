/**
 * `WorkingTreeService`'s two paths that do not run git on the native host.
 *
 * Everything that drives a real repository lives in `working-tree-write.test.ts`
 * and `working-tree-status.test.ts` — this file mocks `fs` module-wide, so it
 * cannot write to a temp directory. What is left here is:
 *
 * - `deleteUntrackedFile`, which is `fs` and never was git;
 * - `discardAll`'s three-phase orchestration, with the change list and the
 *   addon both stubbed so the phase ordering is what is under test;
 * - the WSL routing, which is real TypeScript behaviour and still spawns
 *   `wsl.exe` from Node.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GitChange, GitChangeStage, GitChangeStatus } from '../../src/git/types';
import { WorkingTreeService } from '../../src/git/working-tree-service';

const ROOT = process.platform === 'win32' ? 'C:\\repo' : '/repo';

// The WSL path still spawns; the native one does not, so `execGit` is what the
// mutating methods reach on every other platform.
vi.mock('../../src/utils/exec-utils', () => ({
    execFileAsync: vi.fn(),
}));

// Spread the real module: `exec.ts` narrows on `NativeAddonLoadError` with
// `instanceof`, and a stub would leave that comparing against `undefined`.
vi.mock('@plusplusoneplusplus/coc-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>();
    return { ...actual, loadNativeGit: vi.fn() };
});

import { execFileAsync } from '../../src/utils/exec-utils';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';

const mockExecFileAsync = vi.mocked(execFileAsync);
const mockExecGit = vi.fn<(args: string[], repoRoot: string, options?: unknown) => Promise<string>>();
vi.mocked(loadNativeGit).mockReturnValue({ execGit: mockExecGit } as never);

/** The git command lines the addon was asked to run, one per call. */
function nativeCommands(): string[] {
    return mockExecGit.mock.calls.map(call => call[0].join(' '));
}

// ─────────────────────────────────────────────────────────────────────────────
// WSL routing
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkingTreeService WSL routing', () => {
    afterEach(() => {
        mockExecFileAsync.mockReset();
    });

    const service = new WorkingTreeService();

    it.runIf(process.platform === 'win32')('routes WSL repos through wsl.exe', async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as never);
        const repo = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        const file = String.raw`\\wsl$\Ubuntu\home\tester\repo\src\foo.ts`;
        await service.stageFile(repo, file);
        expect(mockExecFileAsync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'git', '-C', '/home/tester/repo', 'add', '--', '/home/tester/repo/src/foo.ts'],
            expect.any(Object),
        );
        // The addon runs git on the host and never learns that WSL exists.
        expect(mockExecGit).not.toHaveBeenCalled();
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
        vi.mocked(loadNativeGit).mockReturnValue({ execGit: mockExecGit } as never);
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
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as never);
        const result = await service.deleteUntrackedFile(repoRoot, filePath);
        expect(result.success).toBe(true);
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(filePath);
        expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('calls rmSync with recursive:true for a directory', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => true } as never);
        const result = await service.deleteUntrackedFile(repoRoot, dirPath);
        expect(result.success).toBe(true);
        expect(mockFs.rmSync).toHaveBeenCalledWith(dirPath, { recursive: true });
        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('returns error when unlinkSync throws (e.g. EPERM on Windows)', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as never);
        mockFs.unlinkSync.mockImplementation(() => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); });
        const result = await service.deleteUntrackedFile(repoRoot, filePath);
        expect(result.success).toBe(false);
        expect(result.error).toContain('EPERM');
    });

    it('returns error when rmSync throws', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => true } as never);
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

// discardAll orchestrates three phases over the change list. The list comes
// from the native addon and so do the commands, so both are stubbed at the
// seam — what is under test is the ordering, not what git did.
describe('WorkingTreeService.discardAll', () => {
    const service = new WorkingTreeService();
    const repoRoot = ROOT;
    let changes: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(loadNativeGit).mockReturnValue({ execGit: mockExecGit } as never);
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
        expect(mockExecGit).not.toHaveBeenCalled();
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
        mockExecGit.mockResolvedValue('');
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as never);

        const result = await service.discardAll(repoRoot);

        expect(result.success).toBe(true);
        expect(result.errors).toEqual([]);
        // 2 tracked files reverted + 1 untracked deleted.
        expect(result.discarded).toBe(3);
        const commands = nativeCommands();
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
        mockExecGit.mockResolvedValue('');
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as never);

        const result = await service.discardAll(repoRoot);

        expect(result.success).toBe(true);
        expect(result.discarded).toBe(1);
        // No checkout needed — nothing tracked remained after unstaging.
        expect(nativeCommands().some(c => c.includes('checkout --'))).toBe(false);
        expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join(ROOT, 'brand-new.ts'));
    });

    it('surfaces a phase-prefixed error when discarding a tracked file fails', async () => {
        // No staged paths → no re-read. checkout batch fails, then per-file checkout fails.
        reports([change('a.ts', 'modified', 'unstaged'), change('b.txt', 'untracked', 'untracked')]);
        mockExecGit
            .mockRejectedValueOnce(new Error('batch checkout failed'))
            .mockRejectedValueOnce(new Error('checkout: pathspec error'));
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as never);

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
        expect(mockExecGit).not.toHaveBeenCalled();
    });
});
