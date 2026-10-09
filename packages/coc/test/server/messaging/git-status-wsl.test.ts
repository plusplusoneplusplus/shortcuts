import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { resolveWorkspaceExecutionContext, runGitViaWsl, translatePathForExecution } from '@plusplusoneplusplus/forge';
import { readMessagingGitStatus } from '../../../src/server/messaging/git-status';

vi.mock('@plusplusoneplusplus/forge', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/forge')>(),
    resolveWorkspaceExecutionContext: vi.fn(),
    runGitViaWsl: vi.fn(),
    translatePathForExecution: vi.fn(),
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('messaging Git status WSL routing', () => {
    it('uses the existing argv runner and native parsers, with translated roots and no writes', async () => {
        const root = String.raw`\\wsl$\Fixture\repo`;
        const linuxRoot = path.posix.join(path.posix.sep, 'repo');
        const execution = { kind: 'wsl' as const, linuxWorkingDirectory: linuxRoot, originalWorkingDirectory: root, distro: 'Fixture' };
        vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue(execution);
        vi.mocked(translatePathForExecution).mockReturnValue(linuxRoot);
        vi.mocked(runGitViaWsl)
            .mockResolvedValueOnce('# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +8 -2\n')
            .mockResolvedValueOnce('MM both.txt\n?? new.txt\n');
        const exec = vi.spyOn(loadNativeGit(), 'execGit');
        const status = await readMessagingGitStatus(root);
        expect(status.branch).toMatchObject({ branch: 'main', trackingBranch: 'origin/main', ahead: 8, behind: 2 });
        expect(status.trackingAvailable).toBe(true);
        expect(status.entries.map(entry => entry.stage)).toEqual(['staged', 'unstaged', 'untracked']);
        expect(translatePathForExecution).toHaveBeenCalledWith(root, execution);
        expect(vi.mocked(runGitViaWsl).mock.calls.map(call => call[1])).toEqual([
            ['-C', linuxRoot, '--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--untracked-files=all'],
            ['-C', linuxRoot, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'],
        ]);
        expect(exec).not.toHaveBeenCalled();
    });

    it('propagates WSL read failures instead of returning clean status', async () => {
        vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue({
            kind: 'wsl', linuxWorkingDirectory: 'repo', originalWorkingDirectory: 'repo',
        });
        vi.mocked(runGitViaWsl).mockRejectedValueOnce(new Error('read failed'));
        await expect(readMessagingGitStatus('repo')).rejects.toThrow('read failed');
    });
});
