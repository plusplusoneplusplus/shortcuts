import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPatchDiffProvider } from '../../src/diff/diff-utils';
import type { DiffSource, IDiffProvider } from '../../src/diff/types';

const source: DiffSource = { kind: 'commit', repositoryRoot: path.resolve('fixture-repo'), commitHash: 'HEAD' };
function snapshot(marker: string) {
    const content = { raw: marker, totalLines: 1, truncated: false };
    return {
        files: [{ path: '[ab].txt', status: 'modified' as const, additions: 1, deletions: 1 }],
        contentByPath: new Map([['[ab].txt', content]]),
        content,
        summary: { filesChanged: 1, additions: 1, deletions: 1 },
    };
}
const operations = [
    ['listFiles', (provider: IDiffProvider) => provider.listFiles(), 'files'],
    ['getFullDiff', (provider: IDiffProvider) => provider.getFullDiff(), 'content'],
    ['prefetchAll', (provider: IDiffProvider) => provider.prefetchAll(), 'contentByPath'],
    ['getSummary', (provider: IDiffProvider) => provider.getSummary(), 'summary'],
] as const;

describe('shared patch provider facade', () => {
    it('keeps construction lazy and preserves the source descriptor', () => {
        const descriptor = Object.freeze({ ...source });
        const load = vi.fn();
        const provider = createPatchDiffProvider(descriptor, load);
        expect(provider.source).toBe(descriptor);
        expect(Object.isFrozen(provider.source)).toBe(true);
        expect(load).not.toHaveBeenCalled();
    });

    it.each(operations)('%s projects one fresh loader result without changing its wire shape', async (_name, call, field) => {
        const first = snapshot('first'), second = snapshot('second');
        const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        const provider = createPatchDiffProvider(source, load);
        expect(await call(provider)).toBe(first[field]);
        expect(await call(provider)).toBe(second[field]);
        expect(load.mock.calls).toEqual([[], []]);
    });

    it('delegates literal per-file paths and options rather than selecting prefetched content', async () => {
        const complete = snapshot('complete'), selected = snapshot('selected');
        selected.content = { raw: 'truncated', totalLines: 7, truncated: true };
        const load = vi.fn().mockResolvedValueOnce(complete).mockResolvedValue(selected);
        const provider = createPatchDiffProvider(source, load);
        expect(await provider.prefetchAll()).toBe(complete.contentByPath);
        const options = { full: true, maxLines: 2.9, contextLines: 0 };
        expect(await provider.getFileDiff('[ab].txt', options)).toBe(selected.content);
        expect(load.mock.calls[1][0]).toBe('[ab].txt');
        expect(load.mock.calls[1][1]).toBe(options);
        await provider.getFileDiff('');
        expect(load).toHaveBeenLastCalledWith('', undefined);
    });

    it.each([
        ...operations.map(([name, call]) => [name, call] as const),
        ['getFileDiff', (provider: IDiffProvider) => provider.getFileDiff('missing')],
    ] as const)('%s preserves exact failures and permits a later retry', async (_name, call) => {
        const error = new Error('patch transport failed');
        const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(snapshot('retry'));
        const provider = createPatchDiffProvider(source, load);
        await expect(call(provider)).rejects.toBe(error);
        await expect(call(provider)).resolves.toBeDefined();
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('isolates concurrent loaders across workspaces with identical relative paths', async () => {
        let finish!: (result: ReturnType<typeof snapshot>) => void;
        const pending = new Promise<ReturnType<typeof snapshot>>(resolve => { finish = resolve; });
        const one = createPatchDiffProvider(source, () => pending);
        const two = createPatchDiffProvider({ ...source, repositoryRoot: path.resolve('other-repo') },
            async () => snapshot('two'));
        const first = one.getFileDiff('[ab].txt');
        expect((await two.getFileDiff('[ab].txt')).raw).toBe('two');
        finish(snapshot('one'));
        expect((await first).raw).toBe('one');
    });
});
