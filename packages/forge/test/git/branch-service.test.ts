/**
 * Tests for BranchService extracted to pipeline-core.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { execAsync, execFileAsync } from '../../src/utils/exec-utils';
import { BranchService } from '../../src/git/branch-service';
import { setLogger, nullLogger } from '../../src/logger';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
    execFileSync: vi.fn(),
}));

vi.mock('../../src/utils/exec-utils', () => ({
    execAsync: vi.fn(),
    execFileAsync: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectorySync: vi.fn(),
    ensureGitSafeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/workspace-execution', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/workspace-execution')>();
    return {
        ...actual,
        getWslExecutablePath: vi.fn().mockReturnValue('C:\\Windows\\System32\\wsl.exe'),
        resolveWorkspaceExecutionContext: vi.fn((workingDirectory?: string) => {
            if (workingDirectory?.startsWith('\\\\wsl$')) {
                return actual.resolveWorkspaceExecutionContext(workingDirectory);
            }
            return { kind: 'windows', workingDirectory };
        }),
    };
});

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(),
        mkdtempSync: vi.fn(),
        writeFileSync: vi.fn(),
        rmSync: vi.fn(),
    };
});

const mockedExecSync = execSync as Mock;
const mockedExecFileSync = execFileSync as Mock;
const mockedExecAsync = execAsync as Mock;
const mockedExecFileAsync = execFileAsync as Mock;

describe('BranchService', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    // ── getLocalBranches ─────────────────────────────────────────

    describe('getLocalBranches', () => {
        it('parses git branch --format output into GitBranch[]', () => {
            mockedExecSync.mockReturnValueOnce(
                '*|main|initial commit|2 hours ago\n |feature|add feature|1 hour ago\n'
            );

            const result = service.getLocalBranches('/repo');

            expect(result).toEqual([
                { name: 'main', isCurrent: true, isRemote: false, lastCommitSubject: 'initial commit', lastCommitDate: '2 hours ago' },
                { name: 'feature', isCurrent: false, isRemote: false, lastCommitSubject: 'add feature', lastCommitDate: '1 hour ago' },
            ]);
        });

        it('returns empty array on empty output', () => {
            mockedExecSync.mockReturnValueOnce('');

            expect(service.getLocalBranches('/repo')).toEqual([]);
        });

        it('returns empty array on error', () => {
            mockedExecSync.mockImplementationOnce(() => { throw new Error('fail'); });

            expect(service.getLocalBranches('/repo')).toEqual([]);
        });

        it.runIf(process.platform === 'win32')('routes WSL local branch reads through wsl.exe', () => {
            mockedExecFileSync.mockReturnValueOnce('*|main|initial commit|2 hours ago\n');

            const result = service.getLocalBranches(String.raw`\\wsl$\Ubuntu\home\tester\repo`);

            expect(result).toHaveLength(1);
            expect(mockedExecFileSync).toHaveBeenCalledWith(
                expect.stringContaining('wsl.exe'),
                ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'sh', '-lc', expect.stringContaining('git branch --format=')],
                expect.objectContaining({ windowsHide: true }),
            );
            expect(mockedExecSync).not.toHaveBeenCalled();
        });
    });

    // ── getRemoteBranches ────────────────────────────────────────

    describe('getRemoteBranches', () => {
        it('parses remote branch output and extracts remoteName', () => {
            mockedExecSync.mockReturnValueOnce(
                'origin/main|commit msg|3 days ago\norigin/dev|dev commit|1 day ago\n'
            );

            const result = service.getRemoteBranches('/repo');

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                name: 'origin/main',
                isCurrent: false,
                isRemote: true,
                remoteName: 'origin',
                lastCommitSubject: 'commit msg',
                lastCommitDate: '3 days ago',
            });
        });

        it('filters out HEAD entries', () => {
            mockedExecSync.mockReturnValueOnce(
                'origin/HEAD|head|now\norigin/main|msg|ago\n'
            );

            const result = service.getRemoteBranches('/repo');

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('origin/main');
        });

        it('returns empty array on error', () => {
            mockedExecSync.mockImplementationOnce(() => { throw new Error('fail'); });

            expect(service.getRemoteBranches('/repo')).toEqual([]);
        });
    });

    // ── getLocalBranchesPaginated ────────────────────────────────

    describe('getLocalBranchesPaginated', () => {
        it('returns correct totalCount, hasMore, and paginated branches', () => {
            // getLocalBranchCount
            mockedExecSync.mockReturnValueOnce('* main\n  feature\n  dev\n');
            // getLocalBranchesPaginated main query
            mockedExecSync.mockReturnValueOnce('*|main|init|2h ago\n |feature|feat|1h ago\n');

            const result = service.getLocalBranchesPaginated('/repo', { limit: 2, offset: 0 });

            expect(result.totalCount).toBe(3);
            expect(result.branches).toHaveLength(2);
            expect(result.hasMore).toBe(true);
        });

        it('applies searchPattern filtering (case-insensitive)', () => {
            // getLocalBranchCount with search (returns matching count)
            mockedExecSync.mockReturnValueOnce('* Feature-A\n  feature-b\n');
            // getLocalBranchesPaginated query
            mockedExecSync.mockReturnValueOnce('*|Feature-A|msg|ago\n |feature-b|msg|ago\n');

            const result = service.getLocalBranchesPaginated('/repo', { searchPattern: 'feature' });

            expect(result.totalCount).toBe(2);
            expect(result.branches).toHaveLength(2);
        });

        it('returns empty result when no branches match', () => {
            mockedExecSync.mockReturnValueOnce('');

            const result = service.getLocalBranchesPaginated('/repo', { searchPattern: 'nonexistent' });

            expect(result).toEqual({ branches: [], totalCount: 0, hasMore: false });
        });
    });

    // ── getRemoteBranchesPaginated ───────────────────────────────

    describe('getRemoteBranchesPaginated', () => {
        it('returns paginated remote branches with correct hasMore', () => {
            // getRemoteBranchCount
            mockedExecSync.mockReturnValueOnce('  origin/main\n  origin/dev\n  origin/staging\n');
            // getRemoteBranchesPaginated query
            mockedExecSync.mockReturnValueOnce('origin/main|msg|ago\norigin/dev|msg|ago\n');

            const result = service.getRemoteBranchesPaginated('/repo', { limit: 2, offset: 0 });

            expect(result.totalCount).toBe(3);
            expect(result.branches).toHaveLength(2);
            expect(result.hasMore).toBe(true);
        });

        it('applies search pattern filtering', () => {
            mockedExecSync.mockReturnValueOnce('  origin/feature-x\n');
            mockedExecSync.mockReturnValueOnce('origin/feature-x|msg|ago\n');

            const result = service.getRemoteBranchesPaginated('/repo', { searchPattern: 'feature' });

            expect(result.totalCount).toBe(1);
            expect(result.branches[0].name).toBe('origin/feature-x');
        });
    });

    // ── searchBranches ───────────────────────────────────────────

    describe('searchBranches', () => {
        it('combines local and remote paginated results', () => {
            // local: getLocalBranchCount + getLocalBranchesPaginated
            mockedExecSync.mockReturnValueOnce('* feat\n');
            mockedExecSync.mockReturnValueOnce('*|feat|msg|ago\n');
            // remote: getRemoteBranchCount + getRemoteBranchesPaginated
            mockedExecSync.mockReturnValueOnce('  origin/feat\n');
            mockedExecSync.mockReturnValueOnce('origin/feat|msg|ago\n');

            const result = service.searchBranches('/repo', 'feat', 10);

            expect(result.local).toHaveLength(1);
            expect(result.remote).toHaveLength(1);
        });
    });

    // ── switchBranch ─────────────────────────────────────────────

    describe('switchBranch', () => {
        it('returns { success: true } on successful checkout', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.switchBranch('/repo', 'main');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git checkout "main"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('passes -b flag when options.create is true', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.switchBranch('/repo', 'new-branch', { create: true });

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git checkout -b "new-branch"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('passes -f flag when options.force is true', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.switchBranch('/repo', 'main', { force: true });

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git checkout -f "main"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns { success: false, error: "..." } when git command fails', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('branch not found'));

            const result = await service.switchBranch('/repo', 'nonexistent');

            expect(result.success).toBe(false);
            expect(result.error).toBe('branch not found');
        });

        it.runIf(process.platform === 'win32')('routes WSL async git commands through wsl.exe', async () => {
            mockedExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.switchBranch(String.raw`\\wsl$\Ubuntu\home\tester\repo`, 'main');

            expect(result).toEqual({ success: true });
            expect(mockedExecFileAsync).toHaveBeenCalledWith(
                expect.stringContaining('wsl.exe'),
                ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'sh', '-lc', 'git checkout "main"'],
                expect.objectContaining({ windowsHide: true }),
            );
            expect(mockedExecAsync).not.toHaveBeenCalled();
        });
    });

    // ── createBranch ─────────────────────────────────────────────

    describe('createBranch', () => {
        it('uses git checkout -b when checkout is true (default)', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.createBranch('/repo', 'new-feature');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git checkout -b "new-feature"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('uses git branch when checkout is false', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.createBranch('/repo', 'new-feature', false);

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git branch "new-feature"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('already exists'));

            const result = await service.createBranch('/repo', 'existing');

            expect(result.success).toBe(false);
            expect(result.error).toBe('already exists');
        });
    });

    // ── deleteBranch ─────────────────────────────────────────────

    describe('deleteBranch', () => {
        it('uses -d by default', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.deleteBranch('/repo', 'old-branch');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git branch -d "old-branch"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('uses -D when force is true', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.deleteBranch('/repo', 'unmerged', true);

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git branch -D "unmerged"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('not fully merged'));

            const result = await service.deleteBranch('/repo', 'unmerged');

            expect(result.success).toBe(false);
            expect(result.error).toBe('not fully merged');
        });
    });

    // ── renameBranch ─────────────────────────────────────────────

    describe('renameBranch', () => {
        it('runs git branch -m "old" "new"', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.renameBranch('/repo', 'old-name', 'new-name');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git branch -m "old-name" "new-name"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('refname conflict'));

            const result = await service.renameBranch('/repo', 'a', 'b');

            expect(result.success).toBe(false);
        });
    });

    // ── mergeBranch ──────────────────────────────────────────────

    describe('mergeBranch', () => {
        it('runs git merge "branchName" with 10-minute timeout', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.mergeBranch('/repo', 'feature');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git merge "feature"',
                expect.objectContaining({ cwd: '/repo', timeout: 600000 })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('merge conflict'));

            const result = await service.mergeBranch('/repo', 'feature');

            expect(result.success).toBe(false);
            expect(result.error).toBe('merge conflict');
        });
    });

    // ── push ─────────────────────────────────────────────────────

    describe('push', () => {
        it('runs git push without upstream flag by default', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.push('/repo');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git push',
                expect.objectContaining({ cwd: '/repo', timeout: 600000 })
            );
        });

        it('runs git push -u origin "branchName" when setUpstream is true', async () => {
            // getCurrentBranchName (async)
            mockedExecAsync.mockResolvedValueOnce({ stdout: 'my-branch\n', stderr: '' });
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.push('/repo', true);

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git push -u origin "my-branch"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('rejected'));

            const result = await service.push('/repo');

            expect(result.success).toBe(false);
            expect(result.error).toBe('rejected');
        });

        it('sets GIT_TERMINAL_PROMPT=0 to prevent interactive credential prompts', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.push('/repo');

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git push',
                expect.objectContaining({
                    env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }),
                })
            );
        });
    });

    // ── pushUpTo ────────────────────────────────────────────────────

    describe('pushUpTo', () => {
        it('pushes up to the given commit hash on the current branch', async () => {
            // getCurrentBranchName
            mockedExecAsync.mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });
            // git push
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.pushUpTo('/repo', 'abc123');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git push origin "abc123":refs/heads/"main"',
                expect.objectContaining({ cwd: '/repo', timeout: 600000 })
            );
        });

        it('returns error when in detached HEAD state', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: 'HEAD\n', stderr: '' });

            const result = await service.pushUpTo('/repo', 'abc123');

            expect(result.success).toBe(false);
            expect(result.error).toContain('detached HEAD');
        });

        it('returns error result on push failure', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });
            mockedExecAsync.mockRejectedValueOnce(new Error('no remote'));

            const result = await service.pushUpTo('/repo', 'abc123');

            expect(result.success).toBe(false);
            expect(result.error).toBe('no remote');
        });

        it('returns error when getCurrentBranchName fails', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('git not found'));

            const result = await service.pushUpTo('/repo', 'abc123');

            expect(result.success).toBe(false);
            expect(result.error).toContain('detached HEAD');
        });
    });

    // ── pull ─────────────────────────────────────────────────────

    describe('pull', () => {
        it('runs git pull by default', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.pull('/repo');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git pull',
                expect.objectContaining({ cwd: '/repo', timeout: 600000 })
            );
        });

        it('runs git pull --rebase when rebase is true', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.pull('/repo', true);

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git pull --rebase',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('conflict'));

            const result = await service.pull('/repo');

            expect(result.success).toBe(false);
        });

        it('sets GIT_TERMINAL_PROMPT=0 to prevent interactive credential prompts', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.pull('/repo', true);

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git pull --rebase',
                expect.objectContaining({
                    env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }),
                })
            );
        });

        it('returns error result with message when killed (SIGTERM)', async () => {
            const killedErr = Object.assign(
                new Error('Command failed: git pull --rebase\nfatal: unable to access'),
                { code: null, killed: true, signal: 'SIGTERM', cmd: 'git pull --rebase' }
            );
            mockedExecAsync.mockRejectedValueOnce(killedErr);

            const result = await service.pull('/repo', true);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Command failed: git pull --rebase');
        });
    });

    // ── fetch ────────────────────────────────────────────────────

    describe('fetch', () => {
        it('runs git fetch --all by default', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.fetch('/repo');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git fetch --all',
                expect.objectContaining({ cwd: '/repo', timeout: 600000 })
            );
        });

        it('runs git fetch "remote" when remote name provided', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.fetch('/repo', 'upstream');

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git fetch "upstream"',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('network error'));

            const result = await service.fetch('/repo');

            expect(result.success).toBe(false);
        });
    });

    // ── stashChanges ─────────────────────────────────────────────

    describe('stashChanges', () => {
        it('runs git stash push without message', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.stashChanges('/repo');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git stash push',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('runs git stash push -m "msg" with message, escaping double quotes', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            await service.stashChanges('/repo', 'save "my work"');

            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git stash push -m "save \\"my work\\""',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('stash failed'));

            const result = await service.stashChanges('/repo');

            expect(result.success).toBe(false);
            expect(result.error).toBe('stash failed');
        });
    });

    // ── popStash ─────────────────────────────────────────────────

    describe('popStash', () => {
        it('runs git stash pop', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            const result = await service.popStash('/repo');

            expect(result).toEqual({ success: true });
            expect(mockedExecAsync).toHaveBeenCalledWith(
                'git stash pop',
                expect.objectContaining({ cwd: '/repo' })
            );
        });

        it('returns error result on failure', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('no stash entries'));

            const result = await service.popStash('/repo');

            expect(result.success).toBe(false);
            expect(result.error).toBe('no stash entries');
        });
    });

    // ── getAllBranches ────────────────────────────────────────────

    describe('getAllBranches', () => {
        it('returns { local, remote } combining both branch lists', () => {
            // getLocalBranches
            mockedExecSync.mockReturnValueOnce('*|main|msg|ago\n');
            // getRemoteBranches
            mockedExecSync.mockReturnValueOnce('origin/main|msg|ago\n');

            const result = service.getAllBranches('/repo');

            expect(result.local).toHaveLength(1);
            expect(result.remote).toHaveLength(1);
        });
    });

    // ── getLocalBranchCount / getRemoteBranchCount ───────────────

    describe('getLocalBranchCount', () => {
        it('returns correct count from git branch --list output', () => {
            mockedExecSync.mockReturnValueOnce('* main\n  dev\n  feature\n');

            expect(service.getLocalBranchCount('/repo')).toBe(3);
        });

        it('applies search pattern filtering', () => {
            mockedExecSync.mockReturnValueOnce('* main\n  dev\n  feature\n');

            expect(service.getLocalBranchCount('/repo', 'dev')).toBe(1);
        });

        it('returns 0 on error', () => {
            mockedExecSync.mockImplementationOnce(() => { throw new Error('fail'); });

            expect(service.getLocalBranchCount('/repo')).toBe(0);
        });
    });

    describe('getRemoteBranchCount', () => {
        it('returns correct count', () => {
            mockedExecSync.mockReturnValueOnce('  origin/main\n  origin/dev\n');

            expect(service.getRemoteBranchCount('/repo')).toBe(2);
        });

        it('applies search pattern filtering', () => {
            mockedExecSync.mockReturnValueOnce('  origin/main\n  origin/dev\n');

            expect(service.getRemoteBranchCount('/repo', 'dev')).toBe(1);
        });

        it('returns 0 on error', () => {
            mockedExecSync.mockImplementationOnce(() => { throw new Error('fail'); });

            expect(service.getRemoteBranchCount('/repo')).toBe(0);
        });
    });
});

// ── amendCommitMessage ───────────────────────────────────────
describe('BranchService.amendCommitMessage', () => {
    let service: BranchService;
    const mockedMkdtempSync = fs.mkdtempSync as Mock;
    const mockedWriteFileSync = fs.writeFileSync as Mock;
    const mockedRmSync = fs.rmSync as Mock;

    const MOCK_TMP_DIR = path.join('/repo', '.git', 'tmp-amend-xyz');
    const MOCK_MSG_PATH = path.join(MOCK_TMP_DIR, 'COMMIT_MSG');

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    function setupMocks() {
        mockedMkdtempSync.mockReturnValueOnce(MOCK_TMP_DIR);
        mockedWriteFileSync.mockReturnValue(undefined);
        mockedRmSync.mockReturnValue(undefined);
    }

    it('writes message to temp file and runs git commit --amend --only -F', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('abc1234\n');

        const result = await service.amendCommitMessage('/repo', 'Fix typo in README');

        expect(result).toEqual({ success: true, hash: 'abc1234' });
        expect(mockedWriteFileSync).toHaveBeenCalledWith(MOCK_MSG_PATH, 'Fix typo in README', 'utf-8');
        expect(mockedExecAsync).toHaveBeenCalledWith(
            `git commit --amend --only -F "${MOCK_MSG_PATH}"`,
            expect.objectContaining({ cwd: '/repo' })
        );
    });

    it('includes body separated by double newline in temp file', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('def5678\n');

        const result = await service.amendCommitMessage('/repo', 'feat: add button', 'Extended description here.');

        expect(result.success).toBe(true);
        expect(mockedWriteFileSync).toHaveBeenCalledWith(
            MOCK_MSG_PATH,
            'feat: add button\n\nExtended description here.',
            'utf-8'
        );
    });

    it('returns error when title is empty', async () => {
        const result = await service.amendCommitMessage('/repo', '');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/title.*empty/i);
        expect(mockedExecAsync).not.toHaveBeenCalled();
    });

    it('returns error when title is whitespace only', async () => {
        const result = await service.amendCommitMessage('/repo', '   ');

        expect(result.success).toBe(false);
        expect(mockedExecAsync).not.toHaveBeenCalled();
    });

    it('returns error result on git failure', async () => {
        setupMocks();
        mockedExecAsync.mockRejectedValueOnce(new Error('nothing to amend'));

        const result = await service.amendCommitMessage('/repo', 'Some title');

        expect(result.success).toBe(false);
        expect(result.error).toBe('nothing to amend');
    });

    it('handles messages with double quotes', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('aaa0001\n');

        await service.amendCommitMessage('/repo', 'Fix "the" bug');

        expect(mockedWriteFileSync).toHaveBeenCalledWith(MOCK_MSG_PATH, 'Fix "the" bug', 'utf-8');
    });

    it('handles messages with shell metacharacters ($, backticks, !)', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('bbb0002\n');

        const title = 'Fix $HOME expansion and `command` injection!';
        await service.amendCommitMessage('/repo', title);

        expect(mockedWriteFileSync).toHaveBeenCalledWith(MOCK_MSG_PATH, title, 'utf-8');
    });

    it('handles messages with Windows-specific characters (% and ^)', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('ccc0003\n');

        const title = 'Fix 100% of ^caret issues';
        await service.amendCommitMessage('/repo', title);

        expect(mockedWriteFileSync).toHaveBeenCalledWith(MOCK_MSG_PATH, title, 'utf-8');
    });

    it('handles messages with Unicode and emoji', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('ddd0004\n');

        const title = '🐛 Fix bug in über-feature — résumé handling';
        await service.amendCommitMessage('/repo', title);

        expect(mockedWriteFileSync).toHaveBeenCalledWith(MOCK_MSG_PATH, title, 'utf-8');
    });

    it('handles very long messages (>500 chars)', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('eee0005\n');

        const title = 'Fix: ' + 'a'.repeat(600);
        const result = await service.amendCommitMessage('/repo', title);

        expect(result.success).toBe(true);
        expect(mockedWriteFileSync).toHaveBeenCalledWith(MOCK_MSG_PATH, title, 'utf-8');
    });

    it('handles multi-line body with embedded quotes and special chars', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('fff0006\n');

        const title = 'feat: add "login" feature';
        const body = 'This fixes $HOME issues.\nAlso handles `backticks`.\n\n- item "one"\n- item \'two\'';
        await service.amendCommitMessage('/repo', title, body);

        expect(mockedWriteFileSync).toHaveBeenCalledWith(MOCK_MSG_PATH, `${title}\n\n${body}`, 'utf-8');
    });

    it('cleans up temp directory on success', async () => {
        setupMocks();
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('ggg0007\n');

        await service.amendCommitMessage('/repo', 'Some title');

        expect(mockedRmSync).toHaveBeenCalledWith(MOCK_TMP_DIR, { recursive: true });
    });

    it('cleans up temp directory on failure', async () => {
        setupMocks();
        mockedExecAsync.mockRejectedValueOnce(new Error('git error'));

        await service.amendCommitMessage('/repo', 'Some title');

        expect(mockedRmSync).toHaveBeenCalledWith(MOCK_TMP_DIR, { recursive: true });
    });
});

// ── cherryPick ──────────────────────────────────────────────
describe('BranchService.cherryPick', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('returns success when cherry-pick applies cleanly', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.cherryPick('/repo', 'abc1234');

        expect(result).toEqual({ success: true, conflicts: false, message: 'Cherry-pick applied successfully' });
        expect(mockedExecAsync).toHaveBeenCalledWith(
            'git cherry-pick abc1234',
            expect.objectContaining({ cwd: '/repo' })
        );
    });

    it('returns conflicts: true when CONFLICT appears in the error message', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('CONFLICT (content): Merge conflict in src/foo.ts'));

        const result = await service.cherryPick('/repo', 'deadbeef');

        expect(result.success).toBe(false);
        expect(result.conflicts).toBe(true);
        expect(result.message).toContain('CONFLICT');
    });

    it('returns conflicts: true when "conflict" (lowercase) appears in error', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('cherry-pick conflict detected'));

        const result = await service.cherryPick('/repo', 'deadbeef');

        expect(result.success).toBe(false);
        expect(result.conflicts).toBe(true);
    });

    it('returns conflicts: false for non-conflict errors (e.g. dirty working tree)', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('error: Your local changes would be overwritten by cherry-pick'));

        const result = await service.cherryPick('/repo', 'deadbeef');

        expect(result.success).toBe(false);
        expect(result.conflicts).toBe(false);
        expect(result.message).toContain('local changes');
    });

    it('handles unknown error objects gracefully', async () => {
        mockedExecAsync.mockRejectedValueOnce('non-error string');

        const result = await service.cherryPick('/repo', 'abc0000');

        expect(result.success).toBe(false);
        expect(result.conflicts).toBe(false);
        expect(result.message).toBe('Unknown error');
    });
});

// ── exportCommitPatch ──────────────────────────────────────────────
describe('BranchService.exportCommitPatch', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('exports a commit as a format-patch payload with metadata', async () => {
        const fullHash = 'abcdef1234567890abcdef1234567890abcdef12';
        const patch = 'From abcdef1234567890 Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Add thing\n';
        const metadata = [
            fullHash,
            'Add thing',
            'Ada Dev',
            'ada@example.test',
            '2026-06-04T04:00:00+00:00',
        ].join('\0') + '\n';
        mockedExecAsync
            .mockResolvedValueOnce({ stdout: `${fullHash}\n`, stderr: '' })
            .mockResolvedValueOnce({ stdout: metadata, stderr: '' })
            .mockResolvedValueOnce({ stdout: patch, stderr: '' });

        const result = await service.exportCommitPatch('/repo', 'abcdef1');

        expect(result).toEqual({
            success: true,
            commitHash: fullHash,
            subject: 'Add thing',
            authorName: 'Ada Dev',
            authorEmail: 'ada@example.test',
            authorDate: '2026-06-04T04:00:00+00:00',
            patch,
        });
        expect(mockedExecAsync).toHaveBeenCalledWith(
            'git rev-parse --verify abcdef1^{commit}',
            expect.objectContaining({ cwd: '/repo' })
        );
        expect(mockedExecAsync).toHaveBeenCalledWith(
            `git format-patch -1 --stdout --no-stat ${fullHash}`,
            expect.objectContaining({ cwd: '/repo', timeout: 600000 })
        );
    });

    it('rejects invalid commit hashes before invoking git', async () => {
        const result = await service.exportCommitPatch('/repo', 'main;rm -rf /');

        expect(result).toEqual({ success: false, error: 'Invalid commit hash' });
        expect(mockedExecAsync).not.toHaveBeenCalled();
    });

    it('returns a failure when git cannot resolve the commit', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('fatal: Needed a single revision'));

        const result = await service.exportCommitPatch('/repo', 'deadbeef');

        expect(result).toEqual({ success: false, error: 'fatal: Needed a single revision' });
    });
});

// ── rebaseAutosquash ──────────────────────────────────────────────
describe('BranchService.rebaseAutosquash', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('returns success when rebase applies cleanly', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.rebaseAutosquash('/repo');

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('calls git rebase -i --autosquash @{upstream} with GIT_SEQUENCE_EDITOR set', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        await service.rebaseAutosquash('/repo');

        expect(mockedExecAsync).toHaveBeenCalledWith(
            'git rebase -i --autosquash @{upstream}',
            expect.objectContaining({
                cwd: '/repo',
                timeout: 600000,
                env: expect.objectContaining({
                    GIT_SEQUENCE_EDITOR: process.platform === 'win32' ? 'true' : ':',
                }),
            })
        );
    });

    it('returns failure with error message when git rebase fails', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('no upstream configured'));

        const result = await service.rebaseAutosquash('/repo');

        expect(result.success).toBe(false);
        expect(result.error).toBe('no upstream configured');
    });

    it('handles unknown error objects gracefully', async () => {
        mockedExecAsync.mockRejectedValueOnce('non-error string');

        const result = await service.rebaseAutosquash('/repo');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown error');
    });
});

// ── getRepoState ──────────────────────────────────────────────────
describe('BranchService.getRepoState', () => {
    const mockedExistsSync = fs.existsSync as Mock;
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('returns operation=none when no sentinel files exist', () => {
        mockedExecSync.mockReturnValueOnce('.git\n'); // rev-parse --git-dir
        mockedExistsSync.mockReturnValue(false);

        const result = service.getRepoState('/repo');

        expect(result).toEqual({ operation: 'none', conflictFiles: [] });
    });

    it('returns operation=rebase when rebase-merge dir exists', () => {
        mockedExecSync
            .mockReturnValueOnce('.git\n') // rev-parse --git-dir
            .mockReturnValueOnce('file1.ts\nfile2.ts\n'); // diff --name-only
        mockedExistsSync.mockImplementation((p: string) =>
            typeof p === 'string' && p.includes('rebase-merge'));

        const result = service.getRepoState('/repo');

        expect(result.operation).toBe('rebase');
        expect(result.conflictFiles).toEqual(['file1.ts', 'file2.ts']);
    });

    it('returns operation=merge when MERGE_HEAD exists', () => {
        mockedExecSync
            .mockReturnValueOnce('.git\n')
            .mockReturnValueOnce('src/app.ts\n');
        mockedExistsSync.mockImplementation((p: string) =>
            typeof p === 'string' && p.includes('MERGE_HEAD'));

        const result = service.getRepoState('/repo');

        expect(result.operation).toBe('merge');
        expect(result.conflictFiles).toEqual(['src/app.ts']);
    });

    it('returns operation=cherry-pick when CHERRY_PICK_HEAD exists', () => {
        mockedExecSync
            .mockReturnValueOnce('.git\n')
            .mockReturnValueOnce('index.ts\n');
        mockedExistsSync.mockImplementation((p: string) =>
            typeof p === 'string' && p.includes('CHERRY_PICK_HEAD'));

        const result = service.getRepoState('/repo');

        expect(result.operation).toBe('cherry-pick');
        expect(result.conflictFiles).toEqual(['index.ts']);
    });

    it('returns operation=none with empty conflictFiles on error', () => {
        mockedExecSync.mockImplementationOnce(() => { throw new Error('not a git repo'); });

        const result = service.getRepoState('/not-a-repo');

        expect(result).toEqual({ operation: 'none', conflictFiles: [] });
    });
});

// ── rebaseContinue ────────────────────────────────────────────────
describe('BranchService.rebaseContinue', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('returns success when rebase continue succeeds', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.rebaseContinue('/repo');

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('returns failure with error message on failure', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('rebase conflict'));

        const result = await service.rebaseContinue('/repo');

        expect(result.success).toBe(false);
        expect(result.error).toBe('rebase conflict');
    });
});

// ── rebaseAbort ───────────────────────────────────────────────────
describe('BranchService.rebaseAbort', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('returns success when rebase abort succeeds', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.rebaseAbort('/repo');

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('returns failure with error message on failure', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('no rebase in progress'));

        const result = await service.rebaseAbort('/repo');

        expect(result.success).toBe(false);
        expect(result.error).toBe('no rebase in progress');
    });
});

// ── mergeContinue ─────────────────────────────────────────────────
describe('BranchService.mergeContinue', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('returns success when merge continue succeeds', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.mergeContinue('/repo');

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('returns failure with error message on failure', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('merge conflict'));

        const result = await service.mergeContinue('/repo');

        expect(result.success).toBe(false);
        expect(result.error).toBe('merge conflict');
    });
});

// ── mergeAbort ────────────────────────────────────────────────────
describe('BranchService.mergeAbort', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('returns success when merge abort succeeds', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.mergeAbort('/repo');

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('returns failure with error message on failure', async () => {
        mockedExecAsync.mockRejectedValueOnce(new Error('no merge in progress'));

        const result = await service.mergeAbort('/repo');

        expect(result.success).toBe(false);
        expect(result.error).toBe('no merge in progress');
    });
});

// ── rewordCommit ──────────────────────────────────────────────────
describe('BranchService.rewordCommit', () => {
    let service: BranchService;
    const mockedMkdtempSync = fs.mkdtempSync as Mock;
    const mockedWriteFileSync = fs.writeFileSync as Mock;
    const mockedRmSync = fs.rmSync as Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('returns error for empty hash', async () => {
        const result = await service.rewordCommit('/repo', '', 'New title');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/hash.*empty/i);
        expect(mockedExecAsync).not.toHaveBeenCalled();
    });

    it('returns error for empty title', async () => {
        const result = await service.rewordCommit('/repo', 'abc1234', '');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/title.*empty/i);
        expect(mockedExecAsync).not.toHaveBeenCalled();
    });

    it('returns error for whitespace-only title', async () => {
        const result = await service.rewordCommit('/repo', 'abc1234', '   ');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/title.*empty/i);
    });

    it('calls git rebase -i with GIT_SEQUENCE_EDITOR and GIT_EDITOR on success', async () => {
        mockedExecSync
            .mockReturnValueOnce('abc1234full\n')   // rev-parse hash
            .mockReturnValueOnce('parent000\n');      // rev-parse parent
        mockedMkdtempSync.mockReturnValueOnce('/repo/.git/tmp-reword-xyz');
        mockedWriteFileSync.mockReturnValue(undefined);
        mockedRmSync.mockReturnValue(undefined);
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.rewordCommit('/repo', 'abc1234', 'New title');

        expect(result.success).toBe(true);
        expect(mockedExecAsync).toHaveBeenCalledWith(
            expect.stringContaining('git rebase -i parent000'),
            expect.objectContaining({
                cwd: '/repo',
                timeout: 600000,
                env: expect.objectContaining({
                    GIT_SEQUENCE_EDITOR: expect.any(String),
                    GIT_EDITOR: expect.any(String),
                }),
            })
        );
    });

    it('writes message file with trimmed title', async () => {
        mockedExecSync
            .mockReturnValueOnce('abc1234full\n')
            .mockReturnValueOnce('parent000\n');
        mockedMkdtempSync.mockReturnValueOnce('/repo/.git/tmp-reword-xyz');
        mockedWriteFileSync.mockReturnValue(undefined);
        mockedRmSync.mockReturnValue(undefined);
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        await service.rewordCommit('/repo', 'abc1234', '  New title  ');

        // First writeFileSync call is the message file
        const msgCall = mockedWriteFileSync.mock.calls[0];
        expect(msgCall[1]).toBe('New title');
    });

    it('returns failure with error message on rebase failure', async () => {
        mockedExecSync
            .mockReturnValueOnce('abc1234full\n')
            .mockReturnValueOnce('parent000\n');
        mockedMkdtempSync.mockReturnValueOnce('/repo/.git/tmp-reword-xyz');
        mockedWriteFileSync.mockReturnValue(undefined);
        mockedRmSync.mockReturnValue(undefined);
        mockedExecAsync.mockRejectedValueOnce(new Error('rebase conflict'));

        const result = await service.rewordCommit('/repo', 'abc1234', 'New title');

        expect(result.success).toBe(false);
        expect(result.error).toBe('rebase conflict');
    });

    it('cleans up temp directory on success', async () => {
        mockedExecSync
            .mockReturnValueOnce('abc1234full\n')
            .mockReturnValueOnce('parent000\n');
        mockedMkdtempSync.mockReturnValueOnce('/repo/.git/tmp-reword-xyz');
        mockedWriteFileSync.mockReturnValue(undefined);
        mockedRmSync.mockReturnValue(undefined);
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        await service.rewordCommit('/repo', 'abc1234', 'New title');

        expect(mockedRmSync).toHaveBeenCalledWith('/repo/.git/tmp-reword-xyz', { recursive: true });
    });

    it('cleans up temp directory on failure', async () => {
        mockedExecSync
            .mockReturnValueOnce('abc1234full\n')
            .mockReturnValueOnce('parent000\n');
        mockedMkdtempSync.mockReturnValueOnce('/repo/.git/tmp-reword-xyz');
        mockedWriteFileSync.mockReturnValue(undefined);
        mockedRmSync.mockReturnValue(undefined);
        mockedExecAsync.mockRejectedValueOnce(new Error('rebase conflict'));

        await service.rewordCommit('/repo', 'abc1234', 'New title');

        expect(mockedRmSync).toHaveBeenCalledWith('/repo/.git/tmp-reword-xyz', { recursive: true });
    });

    it('handles title with special shell characters', async () => {
        mockedExecSync
            .mockReturnValueOnce('abc1234full\n')
            .mockReturnValueOnce('parent000\n');
        mockedMkdtempSync.mockReturnValueOnce('/repo/.git/tmp-reword-xyz');
        mockedWriteFileSync.mockReturnValue(undefined);
        mockedRmSync.mockReturnValue(undefined);
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

        const title = 'Fix $HOME and `cmd` and "quotes" and 100%!';
        await service.rewordCommit('/repo', 'abc1234', title);

        const msgCall = mockedWriteFileSync.mock.calls[0];
        expect(msgCall[1]).toBe(title.trim());
    });

    // ── getBranchStatus / hasUncommittedChanges (async) ─────────────────────────────────────────────

    describe('hasUncommittedChanges', () => {
        it('returns true when git status --porcelain produces output', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: ' M file.ts\n', stderr: '' });

            expect(await service.hasUncommittedChanges('/repo')).toBe(true);
        });

        it('returns false when git status --porcelain returns empty string', async () => {
            mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

            expect(await service.hasUncommittedChanges('/repo')).toBe(false);
        });

        it('returns false when git command rejects', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('fail'));

            expect(await service.hasUncommittedChanges('/repo')).toBe(false);
        });
    });

    describe('getBranchStatus', () => {
        it('returns BranchStatus with branch name, ahead/behind, and tracking branch', async () => {
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: 'abc1234def\n', stderr: '' })    // getHeadHash
                .mockResolvedValueOnce({ stdout: 'refs/heads/main\n', stderr: '' }) // isDetachedHead
                .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' })            // getCurrentBranchName
                .mockResolvedValueOnce({ stdout: 'origin/main\n', stderr: '' })     // upstream lookup
                .mockResolvedValueOnce({ stdout: '3\n', stderr: '' })               // ahead
                .mockResolvedValueOnce({ stdout: '1\n', stderr: '' });              // behind

            const result = await service.getBranchStatus('/repo', false);

            expect(result).toEqual({
                name: 'main',
                isDetached: false,
                ahead: 3,
                behind: 1,
                trackingBranch: 'origin/main',
                hasUncommittedChanges: false,
            });
        });

        it('returns detached HEAD status when symbolic-ref rejects', async () => {
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: 'deadbeef1234\n', stderr: '' }) // getHeadHash
                .mockRejectedValueOnce(new Error('not a symbolic ref'));          // isDetachedHead

            const result = await service.getBranchStatus('/repo', true);

            expect(result).toEqual({
                name: '',
                isDetached: true,
                detachedHash: 'deadbeef1234',
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: true,
            });
        });

        it('returns null when rev-parse HEAD fails (not a git repo)', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('not a git repo'));

            const result = await service.getBranchStatus('/not-a-repo', false);

            expect(result).toBeNull();
        });

        it('returns ahead: 0, behind: 0 when no upstream is configured', async () => {
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: 'abc1234\n', stderr: '' })       // getHeadHash
                .mockResolvedValueOnce({ stdout: 'refs/heads/feat\n', stderr: '' }) // isDetachedHead
                .mockResolvedValueOnce({ stdout: 'feat\n', stderr: '' })            // getCurrentBranchName
                .mockRejectedValueOnce(new Error('no upstream'));                    // upstream lookup

            const result = await service.getBranchStatus('/repo', false);

            expect(result).toEqual({
                name: 'feat',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false,
            });
        });

        it('runs ahead/behind counts in parallel', async () => {
            const callOrder: string[] = [];
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: 'abc1234\n', stderr: '' })       // getHeadHash
                .mockResolvedValueOnce({ stdout: 'refs/heads/main\n', stderr: '' }) // isDetachedHead
                .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' })            // getCurrentBranchName
                .mockResolvedValueOnce({ stdout: 'origin/main\n', stderr: '' })     // upstream lookup
                .mockImplementationOnce(async () => {                               // ahead
                    callOrder.push('ahead');
                    return { stdout: '2\n', stderr: '' };
                })
                .mockImplementationOnce(async () => {                               // behind
                    callOrder.push('behind');
                    return { stdout: '5\n', stderr: '' };
                });

            const result = await service.getBranchStatus('/repo', false);

            expect(result?.ahead).toBe(2);
            expect(result?.behind).toBe(5);
            // Both calls were made (parallel via Promise.all)
            expect(callOrder).toContain('ahead');
            expect(callOrder).toContain('behind');
        });
    });
});
