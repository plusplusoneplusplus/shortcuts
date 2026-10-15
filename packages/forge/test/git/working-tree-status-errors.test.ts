import { describe, expect, it, vi } from 'vitest';

const status = vi.hoisted(() => vi.fn());
vi.mock('@plusplusoneplusplus/coc-native', () => ({
    loadNativeGit: () => ({ gitStatusEntries: status }),
}));
vi.mock('../../src/utils/workspace-execution', () => ({
    resolveWorkspaceExecutionContext: () => ({ kind: 'native' }),
}));

import { WorkingTreeService } from '../../src/git/working-tree-service';

describe('strict working-tree status reads', () => {
    it('propagates the original status failure instead of an empty clean snapshot', async () => {
        const error = new Error('Git status unavailable');
        status.mockRejectedValue(error);
        await expect(new WorkingTreeService().getAllChanges('repo', { throwOnError: true })).rejects.toBe(error);
    });

    it('preserves ordinary caller fallback behavior', async () => {
        status.mockRejectedValue(new Error('Not a repository'));
        await expect(new WorkingTreeService().getAllChanges('repo')).resolves.toEqual([]);
    });

    it('accepts a genuinely clean strict status read', async () => {
        status.mockResolvedValue([]);
        await expect(new WorkingTreeService().getAllChanges('repo', { throwOnError: true })).resolves.toEqual([]);
    });
});
