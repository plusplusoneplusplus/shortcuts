import { describe, expect, it, vi } from 'vitest';
import { loadCommitShowPatch, loadCommitFiles } from '../../src/diff/local-patch';
import { createCommitDiffProvider, createWorkingTreeDiffProvider } from '../../src/diff/git-diff-provider';
import { GitLogService } from '../../src/git/git-log-service';
import { WorkingTreeService } from '../../src/git/working-tree-service';
import { execFileAsync } from '../../src/utils/exec-utils';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';

vi.mock('../../src/utils/workspace-execution', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../src/utils/workspace-execution')>(),
    getWslExecutablePath: () => 'C:\\Windows\\System32\\wsl.exe',
}));
vi.mock('../../src/utils/exec-utils', () => ({ execFileAsync: vi.fn() }));
vi.mock('../../src/git/safe-directory', () => ({ ensureGitSafeDirectoryAsync: vi.fn() }));
const raw = 'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n-old\n+new\n';

describe('commit WSL transport using Rust planning and processing', () => {
    it('routes concurrent roots/distro and uses one native plan for all five operations', async () => {
        vi.mocked(execFileAsync).mockImplementation(async (_exec, args) => ({
            stdout: raw.replace('+new', args?.includes('Debian') ? '+two' : '+one'), stderr: '',
        }));
        const roots = ['\\\\wsl$\\Ubuntu\\home\\one\\repo', '\\\\wsl$\\Debian\\home\\two\\repo'];
        const providers = roots.map(root => createCommitDiffProvider(root, 'HEAD'));
        const lists = await Promise.all(providers.map(provider => provider.listFiles()));
        lists.forEach(files => expect(files[0]).toMatchObject({ path: 'café.txt', additions: 1, deletions: 1 }));
        for (const [index, distro] of ['Ubuntu', 'Debian'].entries()) {
            const call = vi.mocked(execFileAsync).mock.calls.find(call => call[1]?.includes(distro))!;
            expect(call[1]).toContain(`/home/${index === 0 ? 'one' : 'two'}/repo`);
            expect(call[1]).toContain('diff-tree');
            expect(call[1]).toContain('--first-parent');
            expect(call[1]).toContain('--root');
            expect(call[1]).toContain('--literal-pathspecs');
        }
        const oneRaw = raw.replace('+new', '+one').slice(0, -1);
        const expected = await loadNativeGit().processGitPatch(oneRaw, 2);
        expect(await providers[0].getFileDiff('café.txt', { contextLines: 0, maxLines: 2 })).toEqual(expected.content);
        expect(vi.mocked(execFileAsync).mock.calls.at(-1)?.[1]).toContain('-U0');
        expect((await providers[0].getFullDiff()).raw).toBe(oneRaw);
        expect((await providers[0].prefetchAll()).get('café.txt')?.raw).toBe(oneRaw);
        expect(await providers[0].getSummary()).toEqual({ filesChanged: 1, additions: 1, deletions: 1 });
        expect((await providers[1].getFullDiff()).raw).toContain('+two');
    });

    it('uses git-show semantics for routes with native truncation', async () => {
        vi.mocked(execFileAsync).mockResolvedValue({ stdout: raw, stderr: '' });
        const result = await loadCommitShowPatch('\\\\wsl$\\Ubuntu\\home\\repo', 'HEAD', 'café.txt', { contextLines: 99999, maxLines: 2 });
        expect(result.content).toEqual((await loadNativeGit().processGitPatch(raw.slice(0, -1), 2)).content);
        const args = vi.mocked(execFileAsync).mock.calls.at(-1)?.[1];
        expect(args).toContain('show');
        expect(args).toContain('--format=');
        expect(args).toContain('-U99999');
        expect(args).not.toContain('--first-parent');
    });

    it('routes metadata batches by distro and joins literal paths in Rust', async () => {
        vi.mocked(execFileAsync).mockImplementation(async (_exec, args) => ({
            stdout: args?.includes('--name-status')
                ? 'R100\0old\0café\t\n.txt\0M\0bin\0'
                : `${args?.includes('Debian') ? 2 : 1}\t0\t\0old\0café\t\n.txt\0-\t-\tbin\0`,
            stderr: '',
        }));
        const roots = ['\\\\wsl$\\Ubuntu\\home\\one\\repo', '\\\\wsl$\\Debian\\home\\two\\repo'];
        const results = await Promise.all(roots.map(root => loadCommitFiles(root, 'HEAD')));
        results.forEach((files, index) => expect(files).toEqual([
            { path: 'café\t\n.txt', originalPath: 'old', status: 'renamed', additions: index + 1, deletions: 0 },
            { path: 'bin', status: 'modified' },
        ]));
        for (const distro of ['Ubuntu', 'Debian']) {
            const calls = vi.mocked(execFileAsync).mock.calls.filter(call => call[1]?.includes(distro) && call[1]?.includes('-z'));
            expect(calls).toHaveLength(2);
            calls.forEach(call => expect(call[1]).toEqual(expect.arrayContaining(['--root', '--first-parent', '--literal-pathspecs'])));
        }
    });

    it('does not report partial metadata after a numstat transport failure', async () => {
        vi.mocked(execFileAsync).mockImplementation(async (_exec, args) => {
            if (args?.includes('--numstat')) throw { stderr: 'numstat failed' };
            return { stdout: 'A\0a\0', stderr: '' };
        });
        await expect(loadCommitFiles('\\\\wsl$\\Ubuntu\\home\\repo', 'HEAD')).rejects.toThrow('numstat failed');
    });

    it('propagates transport errors' , async () => {
        vi.mocked(execFileAsync).mockRejectedValue({ stderr: 'WSL failed' });
        await expect(createCommitDiffProvider('\\\\wsl$\\Ubuntu\\home\\repo', 'HEAD').listFiles()).rejects.toThrow('WSL failed');
    });
});


it('routes working-tree batches by distro/root with Rust composition', async () => {
    vi.mocked(execFileAsync).mockClear();
    vi.mocked(execFileAsync).mockImplementation(async (_exec, args) => ({
        stdout: raw.replace('+new', args?.includes('Debian') ? '+two' : '+one'), stderr: '',
    }));
    const roots = ['\\\\wsl$\\Ubuntu\\home\\one\\repo', '\\\\wsl$\\Debian\\home\\two\\repo'];
    const results = await Promise.all(roots.map(root => createWorkingTreeDiffProvider(root).getFullDiff()));
    expect(results[0].raw).toContain('+one');
    expect(results[0].raw).not.toContain('+two');
    expect(results[1].raw).toContain('+two');
    for (const [index, distro] of ['Ubuntu', 'Debian'].entries()) {
        const calls = vi.mocked(execFileAsync).mock.calls.filter(call => call[1]?.includes(distro) && call[1]?.includes('diff'));
        expect(calls).toHaveLength(2);
        calls.forEach(call => expect(call[1]).toEqual(expect.arrayContaining([`/home/${index === 0 ? 'one' : 'two'}/repo`, '--literal-pathspecs', 'diff'])));
        expect(calls.filter(call => call[1]?.includes('--cached'))).toHaveLength(1);
    }
});

it('routes production per-file working-tree patches through WSL with native context planning', async () => {
    vi.mocked(execFileAsync).mockClear();
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: raw, stderr: '' });
    const root = '\\\\wsl$\\Ubuntu\\home\\repo';
    const service = new WorkingTreeService();
    for (const staged of [true, false]) {
        expect(await service.getFileDiff(root, 'café.txt', staged)).toBe(raw.slice(0, -1));
        const args = vi.mocked(execFileAsync).mock.calls.at(-1)?.[1];
        expect(args).toEqual(expect.arrayContaining(['Ubuntu', '/home/repo', '--literal-pathspecs', '-U99999', '--', 'café.txt']));
        expect(args?.includes('--cached')).toBe(staged);
    }
});

it('GitLogService pending/staged patches route WSL batches and compose headings in Rust', async () => {
    vi.mocked(execFileAsync).mockClear();
    vi.mocked(execFileAsync).mockImplementation(async (_exec, args) => ({
        stdout: raw.replace('+new', `+${args?.includes('Debian') ? 'two' : 'one'}-${args?.includes('--cached') ? 'stage' : 'disk'}`), stderr: '',
    }));
    const roots = ['\\\\wsl$\\Ubuntu\\home\\one\\repo', '\\\\wsl$\\Debian\\home\\two\\repo'];
    const service = new GitLogService();
    const results = await Promise.all(roots.map(root => service.getPendingChangesDiff(root)));
    for (const [index, marker] of ['one', 'two'].entries()) {
        expect(results[index]).toBe(`# Staged Changes\n\n${raw.replace('+new', `+${marker}-stage`).slice(0, -1)}\n\n# Unstaged Changes\n\n${raw.replace('+new', `+${marker}-disk`).slice(0, -1)}`);
        const calls = vi.mocked(execFileAsync).mock.calls.filter(call => call[1]?.includes(index ? 'Debian' : 'Ubuntu'));
        expect(calls).toHaveLength(2);
        calls.forEach(call => expect(call[1]).toContain(`/home/${marker}/repo`));
    }
    expect(await service.getStagedChangesDiff(roots[0])).toBe(raw.replace('+new', '+one-stage').slice(0, -1));
    for (const staged of [true, false]) {
        vi.mocked(execFileAsync).mockImplementation(async (_exec, args) => {
            if (args?.includes('--cached') === staged) throw { stderr: 'batch failed' };
            return { stdout: raw, stderr: '' };
        });
        expect(await service.getPendingChangesDiff(roots[0])).toBe('');
    }
    expect(await service.getStagedChangesDiff(roots[0])).toBe(raw.slice(0, -1));
    vi.mocked(execFileAsync).mockRejectedValue({ stderr: 'staged failed' });
    expect(await service.getStagedChangesDiff(roots[0])).toBe('');
});
