/**
 * The native addon is a hard dependency of every method on the service.
 *
 * Each of them answers a git failure with silence — "no commits", "no files",
 * an empty diff, an absent hash — which is the right answer for a path that is
 * not a repository and the wrong one for a binary that is missing or too old,
 * where the repository is full of history nobody can see. That case has to
 * reach the caller with the rebuild instruction intact, so `loadNativeGit()`
 * sits outside every try/catch in the file.
 */

import { describe, expect, it, vi } from 'vitest';

const LOAD_ERROR = new Error(
    'coc-native.node loaded but does not export the git capability.\n' +
        'The binary predates the git capability, or a part of it — rebuild it with ' +
        '`npm run build:native -w packages/coc-native`.',
);

vi.mock('@plusplusoneplusplus/coc-native', () => ({
    loadNativeGit: () => {
        throw LOAD_ERROR;
    },
}));

import { GitLogService } from '../../src/git/git-log-service';

describe('GitLogService without a usable addon', () => {
    it('rejects a page instead of reporting an empty history', async () => {
        await expect(
            new GitLogService().getCommits('/repo', { maxCount: 5, skip: 0 }),
        ).rejects.toThrow('npm run build:native -w packages/coc-native');
    });

    it('rejects a single commit instead of reporting it missing', async () => {
        await expect(new GitLogService().getCommit('/repo', 'HEAD')).rejects.toThrow(
            'npm run build:native -w packages/coc-native',
        );
    });

    // Every remaining method, one per silent answer it would otherwise give.
    const REBUILD = 'npm run build:native -w packages/coc-native';

    it.each([
        ['getCommitFiles', (s: GitLogService) => s.getCommitFiles('/repo', 'HEAD')],
        ['getCommitDiff', (s: GitLogService) => s.getCommitDiff('/repo', 'HEAD')],
        ['getPendingChangesDiff', (s: GitLogService) => s.getPendingChangesDiff('/repo')],
        ['getStagedChangesDiff', (s: GitLogService) => s.getStagedChangesDiff('/repo')],
        ['hasPendingChanges', (s: GitLogService) => s.hasPendingChanges('/repo')],
        ['hasStagedChanges', (s: GitLogService) => s.hasStagedChanges('/repo')],
        ['hasMoreCommits', (s: GitLogService) => s.hasMoreCommits('/repo', 0)],
        ['getFileContentAtCommit', (s: GitLogService) => s.getFileContentAtCommit('/repo', 'HEAD', 'a.txt')],
        ['fileExistsAtCommit', (s: GitLogService) => s.fileExistsAtCommit('/repo', 'HEAD', 'a.txt')],
        ['validateRef', (s: GitLogService) => s.validateRef('/repo', 'HEAD')],
        ['getBranches', (s: GitLogService) => s.getBranches('/repo')],
    ])('rejects from %s rather than answering with silence', async (_name, call) => {
        await expect(call(new GitLogService())).rejects.toThrow(REBUILD);
    });

    // `hasStagedChanges` is the one that used to say *yes* on a failure: its
    // catch treats a non-zero exit as "there are staged changes", so a swallowed
    // load error would have claimed a clean tree was dirty.
    it('does not read a load failure as staged changes', async () => {
        await expect(new GitLogService().hasStagedChanges('/repo')).rejects.toThrow(REBUILD);
    });
});
