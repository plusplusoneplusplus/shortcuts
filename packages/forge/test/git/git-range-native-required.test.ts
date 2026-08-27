/**
 * The native addon is a hard dependency of the range view.
 *
 * `detectCommitRange` answers null for every git failure, which is the right
 * answer for a branch with no base and the wrong one for a binary that is
 * missing or too old — there the range exists and nobody can see it. That case
 * has to reach the caller with the rebuild instruction intact rather than
 * arriving as an empty range view.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';

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

import { GitRangeService } from '../../src/git/git-range-service';

// The methods guard on the path existing before they load anything, so the
// failure needs somewhere real to point at.
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-range-required-')));

afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

const REBUILD = 'npm run build:native -w packages/coc-native';

describe('GitRangeService without a usable addon', () => {
    it('rejects a range instead of reporting there is none', async () => {
        await expect(new GitRangeService().detectCommitRange(repo)).rejects.toThrow(REBUILD);
    });

    it('rejects base-ref resolution instead of reporting no base', async () => {
        await expect(new GitRangeService().resolveBaseRef(repo)).rejects.toThrow(REBUILD);
    });

    it('rejects the default branch instead of reporting none', async () => {
        await expect(new GitRangeService().getDefaultRemoteBranch(repo)).rejects.toThrow(REBUILD);
    });

    it('rejects the changed-file list instead of reporting it empty', async () => {
        await expect(
            new GitRangeService().getChangedFiles(repo, 'origin/main', 'HEAD'),
        ).rejects.toThrow(REBUILD);
    });

    it('rejects the diff statistics instead of reporting zeroes', async () => {
        await expect(
            new GitRangeService().getDiffStats(repo, 'origin/main', 'HEAD'),
        ).rejects.toThrow(REBUILD);
    });
});
