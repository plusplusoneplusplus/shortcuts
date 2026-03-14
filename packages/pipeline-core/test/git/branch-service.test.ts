/**
 * Tests for BranchService extracted to pipeline-core.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { execSync } from 'child_process';
import { execAsync } from '../../src/utils/exec-utils';
import { BranchService } from '../../src/git/branch-service';
import { setLogger, nullLogger } from '../../src/logger';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

vi.mock('../../src/utils/exec-utils', () => ({
    execAsync: vi.fn(),
}));

const mockedExecSync = execSync as Mock;
const mockedExecAsync = execAsync as Mock;

describe('BranchService', () => {
    let service: BranchService;

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    // ── getBranchStatus ──────────────────────────────────────────

    describe('getBranchStatus', () => {
        it('returns BranchStatus with branch name, ahead/behind, and tracking branch', () => {
            // rev-parse HEAD → hash
            mockedExecSync
                .mockReturnValueOnce('abc1234def\n')    // getHeadHash
                .mockReturnValueOnce('refs/heads/main\n') // isDetachedHead (symbolic-ref succeeds)
                .mockReturnValueOnce('main\n')            // getCurrentBranchName
                .mockReturnValueOnce('origin/main\n')     // upstream lookup
                .mockReturnValueOnce('3\n')               // ahead
                .mockReturnValueOnce('1\n');              // behind

            const result = service.getBranchStatus('/repo', false);

            expect(result).toEqual({
                name: 'main',
                isDetached: false,
                ahead: 3,
                behind: 1,
                trackingBranch: 'origin/main',
                hasUncommittedChanges: false,
            });
        });

        it('returns detached HEAD status when symbolic-ref throws', () => {
            mockedExecSync
                .mockReturnValueOnce('deadbeef1234\n')  // getHeadHash
                .mockImplementationOnce(() => { throw new Error('not a symbolic ref'); }); // isDetachedHead

            const result = service.getBranchStatus('/repo', true);

            expect(result).toEqual({
                name: '',
                isDetached: true,
                detachedHash: 'deadbeef1234',
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: true,
            });
        });

        it('returns null when rev-parse HEAD fails (not a git repo)', () => {
            mockedExecSync.mockImplementationOnce(() => { throw new Error('not a git repo'); });

            const result = service.getBranchStatus('/not-a-repo', false);

            expect(result).toBeNull();
        });

        it('sets hasUncommittedChanges to the value passed in (passthrough)', () => {
            mockedExecSync
                .mockReturnValueOnce('abc1234\n')
                .mockReturnValueOnce('refs/heads/main\n')
                .mockReturnValueOnce('main\n')
                .mockReturnValueOnce('origin/main\n')
                .mockReturnValueOnce('0\n')
                .mockReturnValueOnce('0\n');

            const result = service.getBranchStatus('/repo', true);

            expect(result?.hasUncommittedChanges).toBe(true);
        });

        it('returns ahead: 0, behind: 0 when no upstream is configured', () => {
            mockedExecSync
                .mockReturnValueOnce('abc1234\n')         // getHeadHash
                .mockReturnValueOnce('refs/heads/feat\n') // isDetachedHead
                .mockReturnValueOnce('feat\n')            // getCurrentBranchName
                .mockImplementationOnce(() => { throw new Error('no upstream'); }); // upstream lookup

            const result = service.getBranchStatus('/repo', false);

            expect(result).toEqual({
                name: 'feat',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false,
            });
        });
    });

    // ── hasUncommittedChanges ────────────────────────────────────

    describe('hasUncommittedChanges', () => {
        it('returns true when git status --porcelain produces output', () => {
            mockedExecSync.mockReturnValueOnce(' M file.ts\n');

            expect(service.hasUncommittedChanges('/repo')).toBe(true);
        });

        it('returns false when git status --porcelain returns empty string', () => {
            mockedExecSync.mockReturnValueOnce('');

            expect(service.hasUncommittedChanges('/repo')).toBe(false);
        });

        it('returns false when git command throws', () => {
            mockedExecSync.mockImplementationOnce(() => { throw new Error('fail'); });

            expect(service.hasUncommittedChanges('/repo')).toBe(false);
        });
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
            // getCurrentBranchName
            mockedExecSync.mockReturnValueOnce('my-branch\n');
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

    beforeEach(() => {
        vi.clearAllMocks();
        setLogger(nullLogger);
        service = new BranchService();
    });

    it('runs git commit --amend --only -m with title only', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('abc1234\n');

        const result = await service.amendCommitMessage('/repo', 'Fix typo in README');

        expect(result).toEqual({ success: true, hash: 'abc1234' });
        expect(mockedExecAsync).toHaveBeenCalledWith(
            'git commit --amend --only -m "Fix typo in README"',
            expect.objectContaining({ cwd: '/repo' })
        );
    });

    it('includes body separated by double newline', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('def5678\n');

        const result = await service.amendCommitMessage('/repo', 'feat: add button', 'Extended description here.');

        expect(result.success).toBe(true);
        expect(mockedExecAsync).toHaveBeenCalledWith(
            'git commit --amend --only -m "feat: add button\n\nExtended description here."',
            expect.objectContaining({ cwd: '/repo' })
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
        mockedExecAsync.mockRejectedValueOnce(new Error('nothing to amend'));

        const result = await service.amendCommitMessage('/repo', 'Some title');

        expect(result.success).toBe(false);
        expect(result.error).toBe('nothing to amend');
    });

    it('escapes double quotes in the message', async () => {
        mockedExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockedExecSync.mockReturnValueOnce('aaa0001\n');

        await service.amendCommitMessage('/repo', 'Fix "the" bug');

        expect(mockedExecAsync).toHaveBeenCalledWith(
            'git commit --amend --only -m "Fix \\"the\\" bug"',
            expect.anything()
        );
    });
});
