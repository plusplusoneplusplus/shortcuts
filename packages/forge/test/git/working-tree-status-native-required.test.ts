/**
 * The native addon is a hard dependency of the working tree.
 *
 * `getAllChanges` answers "no changes" and `getFileDiff` answers "no diff" for
 * every git failure, which is the right answer for a path that is not a
 * repository — and the wrong one for a binary that is missing or too old, where
 * the repository may be full of changes nobody can see. Those two cases have to
 * reach the caller with the rebuild instruction intact.
 *
 * The mutating methods are deliberately not in that set: they answer with
 * `{ success: false, error }`, so the load error reaches the user as the
 * message rather than as silence.
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

import { WorkingTreeService } from '../../src/git/working-tree-service';

describe('WorkingTreeService without a usable addon', () => {
    it('getAllChanges rejects with the load error instead of reporting a clean tree', async () => {
        await expect(new WorkingTreeService().getAllChanges('/repo')).rejects.toThrow(
            'npm run build:native -w packages/coc-native',
        );
    });

    it('getFileDiff rejects with the load error instead of reporting no diff', async () => {
        await expect(new WorkingTreeService().getFileDiff('/repo', '/repo/a.ts', false)).rejects.toThrow(
            'npm run build:native -w packages/coc-native',
        );
    });

    it('stageFile reports the load error as the failure message', async () => {
        const result = await new WorkingTreeService().stageFile('/repo', '/repo/a.ts');
        expect(result.success).toBe(false);
        expect(result.error).toContain('npm run build:native -w packages/coc-native');
    });
});
