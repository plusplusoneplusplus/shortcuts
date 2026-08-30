/**
 * The native addon is a hard dependency of the Git tab's branch reads.
 *
 * Every read method here answers a git failure with a null or an empty list —
 * the right answer for a directory that is not a repository, and the wrong one
 * for a binary that is missing or too old. There the branches exist and nobody
 * can see them, so that case has to reach the caller with the rebuild
 * instruction intact rather than arriving as an empty branch list.
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

import { BranchService, parsePorcelainV2BranchStatus } from '../../src/git/branch-service';

const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-branch-required-')));

afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

const REBUILD = 'npm run build:native -w packages/coc-native';
const service = new BranchService();

describe('BranchService without a usable addon', () => {
    it('rejects the repository status instead of reporting none', async () => {
        await expect(service.getRepositoryStatus(repo)).rejects.toThrow(REBUILD);
    });

    it('rejects the branch status instead of reporting none', async () => {
        await expect(service.getBranchStatus(repo, false)).rejects.toThrow(REBUILD);
    });

    it('rejects the branch list instead of reporting it empty', async () => {
        await expect(service.getLocalBranches(repo)).rejects.toThrow(REBUILD);
        await expect(service.getRemoteBranchesPaginated(repo)).rejects.toThrow(REBUILD);
    });

    it('rejects the branch count instead of reporting zero', async () => {
        await expect(service.getLocalBranchCount(repo)).rejects.toThrow(REBUILD);
    });

    it('rejects the porcelain parser the WSL path depends on', async () => {
        await expect(parsePorcelainV2BranchStatus('')).rejects.toThrow(REBUILD);
    });

    it('rejects the repository state instead of reporting a clean repository', async () => {
        await expect(service.getRepoState(repo)).rejects.toThrow(REBUILD);
        await expect(service.hasUncommittedChanges(repo)).rejects.toThrow(REBUILD);
    });

    it('names the rebuild in the error a write operation reports', async () => {
        // A write returns { success: false } rather than throwing, so unlike a
        // read it cannot hide the load error behind a plausible answer — but the
        // instruction still has to survive into the message the UI shows.
        expect((await service.createBranch(repo, 'feature')).error).toContain(REBUILD);
        expect((await service.mergeBranch(repo, 'main')).error).toContain(REBUILD);
        expect((await service.push(repo)).error).toContain(REBUILD);
    });
});
