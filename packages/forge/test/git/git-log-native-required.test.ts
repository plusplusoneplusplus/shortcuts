/**
 * The native addon is a hard dependency of the commit list.
 *
 * `getCommits` answers "no commits" for every git failure, which is the right
 * answer for a path that is not a repository — and the wrong one for a binary
 * that is missing or too old, where the repository is full of history nobody
 * can see. That case has to reach the caller with the rebuild instruction
 * intact.
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
});
