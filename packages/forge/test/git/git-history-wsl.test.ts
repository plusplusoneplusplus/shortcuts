import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { loadGitHistory } from '../../src/git/git-history';
import { GitLogService } from '../../src/git/git-log-service';
import { execFileAsync } from '../../src/utils/exec-utils';

vi.mock('../../src/utils/workspace-execution', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../src/utils/workspace-execution')>(),
    getWslExecutablePath: () => 'C:\\Windows\\System32\\wsl.exe',
}));
vi.mock('../../src/utils/exec-utils', () => ({ execFileAsync: vi.fn() }));
vi.mock('../../src/git/safe-directory', () => ({ ensureGitSafeDirectoryAsync: vi.fn() }));

const row = (hash: string, parents = '') =>
    `${hash}\n${hash.slice(0, 7)}\nsubject\nExample Author\nauthor@example.test\n2026-01-01T12:00:00+00:00\n${parents}\n2 days ago\nHEAD -> main, tag: sample\nfirst body\n\nsecond body\n\0`;
const roots = ['\\\\wsl$\\Ubuntu\\home\\example\\one', '\\\\wsl$\\Debian\\home\\example\\two'];

beforeEach(() => vi.clearAllMocks());

describe('history WSL routing with real Rust planning and decoding', () => {
    it('never opens WSL paths with host gix and keeps distro/root identity', async () => {
        const native = loadNativeGit();
        const host = vi.spyOn(native, 'gitHistory');
        const gixPage = vi.spyOn(native, 'gitLogCommits');
        const gixCommit = vi.spyOn(native, 'gitLogCommit');
        vi.mocked(execFileAsync).mockImplementation(async (_executable, args) => ({
            stdout: row(args?.includes('Debian') ? 'bbbbbbb' : 'aaaaaaa', 'parent1 parent2'), stderr: '',
        }));
        try {
            const pages = await Promise.all(roots.map(root => loadGitHistory(root, { maxCount: 2, skip: 1, search: '^subject' })));
            pages.forEach((commits, index) => expect(commits[0]).toMatchObject({
                hash: index ? 'bbbbbbb' : 'aaaaaaa', parentHashes: 'parent1 parent2',
                body: 'first body\n\nsecond body', refs: ['HEAD -> main', 'tag: sample'],
            }));
            for (const [index, distro] of ['Ubuntu', 'Debian'].entries()) {
                expect(vi.mocked(execFileAsync).mock.calls[index][1]).toEqual(expect.arrayContaining([
                    distro, `/home/example/${index ? 'two' : 'one'}`, '--skip=1', '--max-count=2',
                    '--grep=^subject', '--regexp-ignore-case',
                ]));
                expect(vi.mocked(execFileAsync).mock.calls[index][1]?.some(arg => arg.includes('%D'))).toBe(false);
            }
            const service = new GitLogService();
            await service.getCommits(roots[0], { maxCount: 1, skip: 0, search: 'subject.*' });
            expect(vi.mocked(execFileAsync).mock.calls.some(call => call[1]?.includes('--fixed-strings'))).toBe(true);
            expect(vi.mocked(execFileAsync).mock.calls.some(call =>
                call[1]?.some(arg => arg.includes('%ar%n%D')))).toBe(true);
            const detail = await service.getCommit(roots[1], 'bbbbbbb');
            expect(detail).toMatchObject({ hash: 'bbbbbbb', repositoryRoot: roots[1] });
            expect(detail).not.toHaveProperty('isAheadOfRemote');
            expect(host).not.toHaveBeenCalled();
            expect(gixPage).not.toHaveBeenCalled();
            expect(gixCommit).not.toHaveBeenCalled();
        } finally {
            host.mockRestore();
            gixPage.mockRestore();
            gixCommit.mockRestore();
        }
    });

    it('hash search excludes parents and ignores paging; detail reads one commit', async () => {
        vi.mocked(execFileAsync).mockResolvedValue({ stdout: row('aaaaaaa'), stderr: '' });
        const [commit] = await loadGitHistory(roots[0], { maxCount: 1, skip: 200, search: 'aaaaaaa' });
        expect(commit.parentHashes).toBe('');
        let args = vi.mocked(execFileAsync).mock.calls.at(-1)?.[1];
        expect(args).toContain('aaaaaaa^!');
        expect(args).not.toContain('--skip=200');
        await loadGitHistory(roots[1], { maxCount: 1, skip: 0 }, 'bbbbbbb');
        args = vi.mocked(execFileAsync).mock.calls.at(-1)?.[1];
        expect(args).toEqual(expect.arrayContaining(['--max-count=1', '--end-of-options', 'bbbbbbb']));
        expect(args).not.toContain('bbbbbbb^!');
    });

    it('preserves missing hash results but rejects other transport failures', async () => {
        vi.mocked(execFileAsync).mockRejectedValue({ stderr: 'bad revision' });
        expect(await loadGitHistory(roots[0], { maxCount: 1, skip: 0, search: 'deadbeef' })).toEqual([]);
        await expect(loadGitHistory(roots[0], { maxCount: 1, skip: 0, search: 'subject' })).rejects.toThrow();
    });
});
