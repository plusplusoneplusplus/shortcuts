import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkingTreeDiffProvider } from '../../src/diff/git-diff-provider';
import { execGitAsync } from '../../src/git/exec';

vi.mock('../../src/git/exec', () => ({ execGitAsync: vi.fn() }));
const root = '\\\\wsl$\\Ubuntu\\home\\repo';
const patch = (value: string) => `diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n-old\n+${value}`;
beforeEach(() => vi.clearAllMocks());

describe('working-tree WSL transport with Rust processing', () => {
    it.each(['staged', 'unstaged', 'all'] as const)('shares native planning for all five %s operations', async scope => {
        vi.mocked(execGitAsync).mockImplementation(async args => patch(args.includes('--cached') ? 'stage' : 'disk'));
        const provider = createWorkingTreeDiffProvider(root, scope);
        expect(provider.source).toEqual({ kind: 'working-tree', repositoryRoot: root, scope });
        expect(await provider.listFiles()).toEqual([{ path: 'café.txt', status: 'modified', additions: 1, deletions: 1, isBinary: false }]);
        const full = await provider.getFullDiff();
        expect(full.raw).toBe(scope === 'all' ? `${patch('stage')}\n${patch('disk')}` : patch(scope === 'staged' ? 'stage' : 'disk'));
        expect((await provider.prefetchAll()).get('café.txt')?.raw).toBe(full.raw);
        expect(await provider.getSummary()).toEqual({ filesChanged: 1, additions: 1, deletions: 1 });
        expect(await provider.getFileDiff('café.txt', { contextLines: 8, maxLines: 2 })).toEqual({ raw: full.raw.split('\n').slice(0, 2).join('\n'), totalLines: full.totalLines, truncated: true });
        const calls = vi.mocked(execGitAsync).mock.calls;
        calls.forEach(([args, cwd]) => {
            expect(cwd).toBe(root);
            expect(args).toEqual(expect.arrayContaining(['--literal-pathspecs', 'diff', '--no-color']));
        });
        const last = calls.at(-1)![0];
        expect(last).toContain('-U8');
        expect(last.at(-1)).toBe('café.txt');
    });

    it('propagates either command failure without installing a partial result', async () => {
        for (const failStaged of [true, false]) {
            vi.mocked(execGitAsync).mockImplementation(async args => {
                if (args.includes('--cached') === failStaged) throw new Error('transport failed');
                return patch('ok');
            });
            await expect(createWorkingTreeDiffProvider(root).getFullDiff()).rejects.toThrow('transport failed');
        }
    });
});
