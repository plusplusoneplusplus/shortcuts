import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { createPullRequestGit, pullRequestGit } from '../../src/git/pull-request-git';
import { ensureGitSafeDirectoryAsync } from '../../src/git/safe-directory';
import { execFileAsync } from '../../src/utils/exec-utils';
import { resolveWorkspaceExecutionContext, translatePathForHostFilesystem } from '../../src/utils/workspace-execution';

vi.mock('@plusplusoneplusplus/coc-native', async original => ({
    ...await original<typeof import('@plusplusoneplusplus/coc-native')>(),
    loadNativeGit: vi.fn(() => ({ execGit: vi.fn() })),
}));
vi.mock('../../src/git/safe-directory', () => ({ ensureGitSafeDirectoryAsync: vi.fn() }));
vi.mock('../../src/utils/exec-utils', () => ({ execFileAsync: vi.fn() }));
vi.mock('../../src/utils/workspace-execution', async original => ({
    ...await original<typeof import('../../src/utils/workspace-execution')>(),
    resolveWorkspaceExecutionContext: vi.fn(),
    translatePathForHostFilesystem: vi.fn((filePath: string) => filePath),
    getWslExecutablePath: vi.fn(() => 'wsl.exe'),
}));

const native = vi.fn();
const repo = '/repo';
const wsl = { kind: 'wsl' as const, distro: 'Ubuntu', linuxWorkingDirectory: repo, originalWorkingDirectory: repo };
beforeEach(() => {
    vi.clearAllMocks();
    native.mockReset().mockResolvedValue('');
    vi.mocked(loadNativeGit).mockReturnValue({ execGit: native } as unknown as ReturnType<typeof loadNativeGit>);
    vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue({ kind: 'windows', workingDirectory: repo });
    vi.mocked(ensureGitSafeDirectoryAsync).mockResolvedValue(undefined);
    vi.mocked(execFileAsync).mockReset().mockResolvedValue({ stdout: '', stderr: '' });
});

const cases: Array<[string, () => Promise<unknown>, string[], number, boolean]> = [
    ['remote URL', () => pullRequestGit.remoteUrl(repo), ['config', '--get', 'remote.origin.url'], 30_000, false],
    ['range', () => pullRequestGit.commitsInRange(repo, 'a..b'), ['rev-list', '--reverse', 'a..b'], 30_000, false],
    ['commit', () => pullRequestGit.resolveCommit(repo, 'a'), ['rev-parse', '--verify', 'a^{commit}'], 30_000, false],
    ['order', () => pullRequestGit.orderCommits(repo, ['b', 'a']), ['rev-list', '--reverse', '--topo-order', 'b', 'a'], 30_000, false],
    ['ref', () => pullRequestGit.refExists(repo, 'refs/heads/x'), ['rev-parse', '--verify', '--quiet', 'refs/heads/x'], 30_000, false],
    ['fetch', () => pullRequestGit.fetchBranch(repo, 'main'), ['fetch', 'origin', 'main'], 600_000, true],
    ['short SHA', () => pullRequestGit.shortSha(repo, 'a'), ['rev-parse', '--short', 'a'], 30_000, false],
    ['subject', () => pullRequestGit.commitSubject(repo, 'a'), ['log', '-1', '--pretty=%s', 'a'], 30_000, false],
    ['add worktree', () => pullRequestGit.addWorktree(repo, 'topic', '/temp/worktree', 'main'), ['worktree', 'add', '-b', 'topic', '/temp/worktree', 'origin/main'], 600_000, false],
    ['remove worktree', () => pullRequestGit.removeWorktree(repo, '/temp/worktree'), ['worktree', 'remove', '--force', '/temp/worktree'], 30_000, false],
    ['delete branch', () => pullRequestGit.deleteBranch(repo, 'topic'), ['branch', '-D', 'topic'], 30_000, false],
    ['pick', () => pullRequestGit.cherryPick(repo, 'a'), ['cherry-pick', 'a'], 600_000, false],
    ['skip', () => pullRequestGit.skipCherryPick(repo), ['cherry-pick', '--skip'], 600_000, false],
    ['abort pick', () => pullRequestGit.abortCherryPick(repo), ['cherry-pick', '--abort'], 30_000, false],
    ['status', () => pullRequestGit.status(repo), ['status', '--porcelain'], 30_000, false],
    ['rebase', () => pullRequestGit.rebase(repo, 'main'), ['rebase', 'origin/main'], 600_000, false],
    ['abort rebase', () => pullRequestGit.abortRebase(repo), ['rebase', '--abort'], 30_000, false],
    ['push', () => pullRequestGit.pushBranch(repo, 'topic'), ['push', '-u', 'origin', 'topic'], 600_000, true],
    ['current branch', () => pullRequestGit.currentBranch(repo), ['rev-parse', '--abbrev-ref', 'HEAD'], 30_000, false],
    ['HEAD', () => pullRequestGit.headSha(repo), ['rev-parse', 'HEAD'], 30_000, false],
    ['remote SHA', () => pullRequestGit.remoteBranchSha(repo, 'topic'), ['ls-remote', '--heads', 'origin', 'refs/heads/topic'], 15_000, true],
];

for (const transport of ['host', 'wsl']) {
    describe(`PR git ${transport} routing`, () => {
        beforeEach(() => {
            if (transport === 'wsl') vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue(wsl);
        });
        it.each(cases)('%s ensures safe.directory and dispatches with its deadline', async (_label, call, args, timeout, noPrompt) => {
            await call();
            expect(ensureGitSafeDirectoryAsync).toHaveBeenCalledWith(repo);
            if (transport === 'host') {
                expect(native).toHaveBeenCalledWith(args, repo, expect.objectContaining({ timeout,
                    env: noPrompt ? { GIT_TERMINAL_PROMPT: '0' } : undefined }));
                expect(execFileAsync).not.toHaveBeenCalled();
            } else {
                expect(execFileAsync).toHaveBeenCalledWith('wsl.exe', [
                    '-d', 'Ubuntu', '--cd', repo, '--',
                    ...(noPrompt ? ['env', 'GIT_TERMINAL_PROMPT=0'] : []),
                    'git', '-C', repo, ...args,
                ], expect.objectContaining({ timeout }));
                expect(native).not.toHaveBeenCalled();
            }
        });
        it('prefers symbolic origin HEAD without probing main or master', async () => {
            native.mockResolvedValue('origin/release\n');
            vi.mocked(execFileAsync).mockResolvedValue({ stdout: 'origin/release\n', stderr: '' });
            expect(await pullRequestGit.defaultBranch(repo)).toBe('release');
            expect(transport === 'host' ? native : execFileAsync).toHaveBeenCalledTimes(1);
        });
        it('propagates worktree creation failures without running follow-up commands', async () => {
            native.mockRejectedValue(new Error('worktree failed'));
            vi.mocked(execFileAsync).mockRejectedValue({ stderr: 'worktree failed' });
            await expect(pullRequestGit.addWorktree(repo, 'topic', '/temp/worktree', 'main'))
                .rejects.toThrow('worktree failed');
            expect(transport === 'host' ? native : execFileAsync).toHaveBeenCalledTimes(1);
        });
        it('probes remote HEAD with no prompt and a 15s deadline', async () => {
            native.mockRejectedValueOnce(new Error('no ref')).mockResolvedValueOnce('ref: refs/heads/trunk\tHEAD\nsha\tHEAD');
            vi.mocked(execFileAsync).mockRejectedValueOnce(new Error('no ref')).mockResolvedValueOnce({ stdout: 'ref: refs/heads/trunk\tHEAD\nsha\tHEAD', stderr: '' });
            expect(await pullRequestGit.defaultBranch(repo)).toBe('trunk');
            if (transport === 'host') expect(native).toHaveBeenLastCalledWith(['ls-remote', '--symref', 'origin', 'HEAD'], repo,
                expect.objectContaining({ timeout: 15_000, env: { GIT_TERMINAL_PROMPT: '0' } }));
            else expect(execFileAsync).toHaveBeenLastCalledWith('wsl.exe', expect.arrayContaining(['env', 'GIT_TERMINAL_PROMPT=0', 'git', '-C', repo, 'ls-remote', '--symref', 'origin', 'HEAD']), expect.objectContaining({ timeout: 15_000 }));
        });
        it('falls back to main when both probes fail or return malformed output', async () => {
            native.mockRejectedValue(new Error('offline'));
            vi.mocked(execFileAsync).mockRejectedValue(new Error('offline'));
            expect(await pullRequestGit.defaultBranch(repo)).toBe('main');
            native.mockResolvedValue('unexpected');
            vi.mocked(execFileAsync).mockResolvedValue({ stdout: 'unexpected', stderr: '' });
            expect(await pullRequestGit.defaultBranch(repo)).toBe('main');
        });
    });
}

it('parses ranges, filters topological output and extracts the remote SHA', async () => {
    native.mockResolvedValueOnce('a\nb\n').mockResolvedValueOnce('ancestor\na\nb\n').mockResolvedValueOnce('b\trefs/heads/topic\n');
    expect(await pullRequestGit.commitsInRange(repo, 'a..b')).toEqual(['a', 'b']);
    expect(await pullRequestGit.orderCommits(repo, ['b', 'a'])).toEqual(['a', 'b']);
    expect(await pullRequestGit.remoteBranchSha(repo, 'topic')).toBe('b');
});
it('returns false for missing refs and propagates ordinary operation errors', async () => {
    native.mockRejectedValue(new Error('git failed: missing'));
    expect(await pullRequestGit.refExists(repo, 'absent')).toBe(false);
    await expect(pullRequestGit.resolveCommit(repo, 'absent')).rejects.toThrow('missing');
});
it('translates Windows worktree paths and returns the distro alias for later operations', async () => {
    vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue(wsl);
    const filePath = String.raw`C:\Temp\work tree`;
    const alias = String.raw`\\wsl.localhost\Ubuntu\mnt\c\Temp\work tree`;
    vi.mocked(translatePathForHostFilesystem).mockReturnValueOnce(alias);
    expect(await pullRequestGit.addWorktree(repo, 'topic', filePath, 'main')).toBe(alias);
    expect(execFileAsync).toHaveBeenLastCalledWith('wsl.exe', expect.arrayContaining(['-b', 'topic', '/mnt/c/Temp/work tree', 'origin/main']), expect.anything());
    await pullRequestGit.removeWorktree(repo, alias);
    expect(execFileAsync).toHaveBeenLastCalledWith('wsl.exe', expect.arrayContaining(['worktree', 'remove', '--force', '/mnt/c/Temp/work tree']), expect.anything());
});
it('never shares the repository root between operations', async () => {
    await pullRequestGit.headSha('/first');
    await pullRequestGit.headSha('/second');
    expect(native.mock.calls.map(call => call[1])).toEqual(['/first', '/second']);
});

it('rejects a worktree from another distro before creating a branch', async () => {
    vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue(wsl);
    await expect(pullRequestGit.addWorktree(repo, 'topic', String.raw`\\wsl$\Debian\tmp\worktree`, 'main'))
        .rejects.toThrow('expected "Ubuntu"');
    expect(execFileAsync).not.toHaveBeenCalled();
});

it('keeps the exact commands and deadlines when a caller injects its own runner', async () => {
    const run = vi.fn().mockResolvedValueOnce('origin/release').mockResolvedValueOnce('');
    const git = createPullRequestGit(run);
    expect(await git.defaultBranch(repo)).toBe('release');
    await git.pushBranch(repo, 'topic');
    expect(await git.addWorktree(repo, 'topic', '/temp/worktree', 'release')).toBe('/temp/worktree');
    expect(run.mock.calls).toEqual([
        [repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']],
        [repo, ['push', '-u', 'origin', 'topic'], { timeout: 600_000, env: { GIT_TERMINAL_PROMPT: '0' } }],
        [repo, ['worktree', 'add', '-b', 'topic', '/temp/worktree', 'origin/release'], { timeout: 600_000 }],
    ]);
    expect(native).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
});
