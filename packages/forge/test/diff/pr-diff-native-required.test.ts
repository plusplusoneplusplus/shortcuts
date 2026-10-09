import { describe, expect, it, vi } from 'vitest';

vi.mock('@plusplusoneplusplus/coc-native', () => ({
    loadNativeGit: () => { throw new Error('Missing/stale addon; npm run build:native -w packages/coc-native'); },
}));

import { createPullRequestDiffProvider, createPullRequestIterationDiffProvider } from '../../src/diff/pr-diff-provider';
import type { IDiffProvider } from '../../src/diff/types';
import type { IPullRequestsService } from '../../src/providers/interfaces';

const operations: Array<[string, (provider: IDiffProvider) => Promise<unknown>]> = [
    ['listFiles', p => p.listFiles()],
    ['getFileDiff', p => p.getFileDiff('file.txt')],
    ['getFullDiff', p => p.getFullDiff()],
    ['prefetchAll', p => p.prefetchAll()],
    ['getSummary', p => p.getSummary()],
];

describe.each(['pr', 'pr-iteration'] as const)('%s requires native processing', kind => {
    it.each(operations)('%s exposes rebuild diagnostics before authenticated I/O', async (_name, call) => {
        const fetch = vi.fn().mockResolvedValue('');
        const source = { repositoryRoot: '/repo', provider: 'github' as const, remoteRepositoryId: 'owner/repo', pullRequestId: 1 };
        const context = { workspaceId: 'workspace-a', host: 'provider.example', repository: 'owner/repo' };
        const provider = kind === 'pr'
            ? createPullRequestDiffProvider({ ...source, kind }, { getDiff: fetch } as unknown as IPullRequestsService, context)
            : createPullRequestIterationDiffProvider({ ...source, kind, iterationId: 3, baseIterationId: 1 }, fetch, context);
        await expect(call(provider)).rejects.toThrow('npm run build:native -w packages/coc-native');
        expect(fetch).not.toHaveBeenCalled();
    });
});

// Production ADO patch construction must expose the same required-native failure.
import { AdoPullRequestsAdapter } from '../../src/ado/ado-pull-requests-adapter';
import type { AdoPullRequestsService } from '../../src/ado/pull-requests-service';

it('ADO rejects missing native construction before authenticated transport', async () => {
    const getPullRequestIterations = vi.fn();
    const adapter = new AdoPullRequestsAdapter({ getPullRequestIterations } as unknown as AdoPullRequestsService);
    await expect(adapter.getDiff('remote-repo', 42)).rejects.toThrow('npm run build:native');
    expect(getPullRequestIterations).not.toHaveBeenCalled();
});
