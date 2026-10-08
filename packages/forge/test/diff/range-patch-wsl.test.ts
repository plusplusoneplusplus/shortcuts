import { describe, expect, it, vi } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { createRangeDiffProvider } from '../../src/diff/git-diff-provider';
import { execFileAsync } from '../../src/utils/exec-utils';

vi.mock('../../src/utils/workspace-execution', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../src/utils/workspace-execution')>(),
    getWslExecutablePath: () => 'C:\\Windows\\System32\\wsl.exe',
}));
vi.mock('../../src/utils/exec-utils', () => ({ execFileAsync: vi.fn() }));
vi.mock('../../src/git/safe-directory', () => ({ ensureGitSafeDirectoryAsync: vi.fn() }));
const raw = 'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n-old\n+new\n';

describe('range WSL transport with actual Rust planning and processing', () => {
    it('routes each repo/distro and shares native processing across all operations', async () => {
        vi.mocked(execFileAsync).mockImplementation(async (_executable, args) => ({
            stdout: raw.replace('+new', args?.includes('Debian') ? '+two' : '+one'), stderr: '',
        }));
        const oneRaw = raw.replace('+new', '+one');
        const roots = ['\\\\wsl$\\Ubuntu\\home\\one\\repo', '\\\\wsl$\\Debian\\home\\two\\repo'];
        const providers = roots.map(root => createRangeDiffProvider(root, 'base', 'head'));
        const lists = await Promise.all(providers.map(provider => provider.listFiles()));
        expect(lists[0][0]).toMatchObject({ path: 'café.txt', additions: 1, deletions: 1, isBinary: false });
        expect(lists[1]).toEqual(lists[0]);
        const calls = vi.mocked(execFileAsync).mock.calls;
        for (const [index, distro] of ['Ubuntu', 'Debian'].entries()) {
            const call = calls.find(call => call[1]?.includes(distro))!;
            expect(call[0]).toMatch(/wsl/i);
            expect(call[1]).toContain(distro);
            expect(call[1]).toContain(`/home/${index === 0 ? 'one' : 'two'}/repo`);
            expect(call[1]).toContain('base...head');
            expect(call[1]).toContain('--literal-pathspecs');
        }
        const provider = providers[0];
        const supplied = await loadNativeGit().processGitPatch(oneRaw.slice(0, -1), 2);
        expect(await provider.getFileDiff('café.txt', { contextLines: 0, maxLines: 2 })).toEqual(supplied.content);
        expect(vi.mocked(execFileAsync).mock.calls.at(-1)?.[1]).toContain('-U0');
        expect((await provider.getFullDiff()).raw).toBe(oneRaw.slice(0, -1));
        expect((await provider.prefetchAll()).get('café.txt')?.raw).toBe(oneRaw.slice(0, -1));
        expect((await providers[1].getFullDiff()).raw).toContain('+two');
        expect(await provider.getSummary()).toEqual({ filesChanged: 1, additions: 1, deletions: 1 });
    });

    it('propagates external transport errors', async () => {
        vi.mocked(execFileAsync).mockRejectedValue({ stderr: 'WSL failed' });
        await expect(createRangeDiffProvider('\\\\wsl$\\Ubuntu\\home\\one\\repo', 'base', 'head').getFullDiff()).rejects.toThrow('WSL failed');
    });
});
