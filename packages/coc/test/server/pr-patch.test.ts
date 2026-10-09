import { afterEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { loadPullRequestPatch } from '../../src/server/repos/pr-patch';
import type { RepoInfo } from '../../src/server/repos/types';

vi.mock('@plusplusoneplusplus/coc-native', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>();
    return { ...actual, loadNativeGit: vi.fn(actual.loadNativeGit) };
});
vi.mock('@plusplusoneplusplus/forge', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, resolveWorkspaceExecutionContext: vi.fn(actual.resolveWorkspaceExecutionContext) };
});
import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { resolveWorkspaceExecutionContext } from '@plusplusoneplusplus/forge';

const repo: RepoInfo = {
    id: 'clone', name: 'sample', localPath: path.join(os.tmpdir(), 'pr-patch-sample'),
    remoteUrl: 'https://github.com/example/sample.git', clonedAt: '2026-01-01T00:00:00Z',
};
const config = { providers: {} };
const raw = [
    'diff --git "a/tab\\tfile.txt" "b/tab\\tfile.txt"',
    '--- "a/tab\\tfile.txt"', '+++ "b/tab\\tfile.txt"',
    '@@ -1 +1 @@', '-before', '+after', '',
].join('\n');

afterEach(() => vi.restoreAllMocks());

describe('request-owned PR patch scopes', () => {
    it('retains bytes, decoded paths and statistics through the actual Rust store', async () => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        const patch = await loadPullRequestPatch(repo, 'workspace', 42, config, async () => raw);
        expect(patch.content.raw).toBe(raw);
        expect(patch.files[0]).toMatchObject({ path: 'tab\tfile.txt', raw });
        expect(patch.summary).toEqual({ filesChanged: 1, additions: 1, deletions: 1 });
        expect(open).toHaveBeenCalledWith('workspace', repo.localPath, {
            provider: 'github', host: 'github.com', repository: 'github:example/sample', sourceId: '42',
        }, undefined);
        expect(() => open.mock.results[0].value.beginTransport()).toThrow(/closed/i);
    });

    it('captures before I/O, retires the ticket and disposes after processing', async () => {
        const addon = loadNativeGit();
        const original = addon.openRemoteGitPatchStore;
        const events: string[] = [];
        vi.spyOn(addon, 'openRemoteGitPatchStore').mockImplementation((...args) => {
            const store = original(...args);
            const begin = store.beginTransport.bind(store);
            const dispose = store.dispose.bind(store);
            vi.spyOn(store, 'beginTransport').mockImplementation(() => {
                events.push('begin');
                const request = begin();
                const cancel = request.cancel.bind(request);
                vi.spyOn(request, 'cancel').mockImplementation(() => { events.push('cancel'); cancel(); });
                return request;
            });
            vi.spyOn(store, 'dispose').mockImplementation(() => { events.push('dispose'); dispose(); });
            return store;
        });
        await loadPullRequestPatch(repo, 'workspace', 42, config, async () => {
            events.push('fetch');
            return raw;
        });
        expect(events).toEqual(['begin', 'fetch', 'cancel', 'dispose']);
    });

    it('disposes transport failures and retries freshly without a result cache', async () => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        const failure = new Error('provider read failed');
        await expect(loadPullRequestPatch(repo, 'workspace', 42, config, async () => { throw failure; }))
            .rejects.toBe(failure);
        expect(() => open.mock.results[0].value.beginTransport()).toThrow(/closed/i);
        const result = await loadPullRequestPatch(repo, 'workspace', 42, config, async () => raw);
        expect(result.content.raw).toBe(raw);
        expect(open).toHaveBeenCalledTimes(2);
    });

    it('releases the store when processing fails', async () => {
        const addon = loadNativeGit();
        const original = addon.openRemoteGitPatchStore;
        const failure = new Error('processing failed');
        const open = vi.spyOn(addon, 'openRemoteGitPatchStore').mockImplementation((...args) => {
            const store = original(...args);
            const begin = store.beginTransport.bind(store);
            vi.spyOn(store, 'beginTransport').mockImplementation(() => {
                const request = begin();
                vi.spyOn(request, 'process').mockRejectedValue(failure);
                return request;
            });
            return store;
        });
        await expect(loadPullRequestPatch(repo, 'workspace', 42, config, async () => raw)).rejects.toBe(failure);
        expect(() => open.mock.results[0].value.beginTransport()).toThrow(/closed/i);
    });

    it.each(['refresh', 'dispose'] as const)('rejects %s during authenticated I/O', async action => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        await expect(loadPullRequestPatch(repo, 'workspace', 42, config, async () => {
            open.mock.results[0].value[action]();
            return raw;
        })).rejects.toThrow(action === 'refresh' ? /stale/i : /closed/i);
    });

    it('isolates concurrent workspace roots, PR IDs and changing bytes', async () => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        const other = { ...repo, localPath: path.join(os.tmpdir(), 'pr-patch-other') };
        const [one, two] = await Promise.all([
            loadPullRequestPatch(repo, 'workspace-one', 42, config, async () => {
                await Promise.resolve();
                return raw;
            }),
            loadPullRequestPatch(other, 'workspace-two', 43, config, async () => raw.replace('+after', '+different')),
        ]);
        expect(one.content.raw).toBe(raw);
        expect(two.content.raw).toContain('+different');
        expect(open.mock.calls.map(([workspace, root, source]) => [workspace, root, source.sourceId]))
            .toEqual([['workspace-one', repo.localPath, '42'], ['workspace-two', other.localPath, '43']]);
        const changedBase = await loadPullRequestPatch(repo, 'workspace-one', 42, config,
            async () => raw.replace('-before', '-changed base'));
        expect(changedBase.content.raw).toContain('-changed base');
    });

    it.each([
        ['https://dev.azure.com/example/project/_git/sample', config,
            'dev.azure.com', 'ado:/example/project/sample'],
        ['https://example.visualstudio.com/project/_git/sample', config,
            'example.visualstudio.com', 'ado:/project/sample'],
        ['https://dev.azure.com/example/project/_git/sample',
            { providers: { ado: { orgUrl: 'https://other.visualstudio.com/collection/' } } },
            'other.visualstudio.com', 'ado:/collection/project/sample'],
    ])('uses the effective ADO transport identity for %s', async (remoteUrl, cfg, host, repository) => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        await loadPullRequestPatch({ ...repo, remoteUrl }, 'workspace', 42, cfg, async () => raw);
        expect(open.mock.calls[0][2]).toEqual({ provider: 'ado', host, repository, sourceId: '42' });
    });

    it('routes explicit WSL identity without executing Git on the host', async () => {
        vi.mocked(resolveWorkspaceExecutionContext).mockReturnValueOnce({
            kind: 'wsl', distro: 'SampleDistro', linuxWorkingDirectory: '/repos/sample',
            originalWorkingDirectory: repo.localPath,
        });
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        expect((await loadPullRequestPatch(repo, 'workspace', 42, config, async () => raw)).content.raw).toBe(raw);
        expect(open).toHaveBeenCalledWith('workspace', '/repos/sample', expect.any(Object), 'SampleDistro');
    });

    it('rejects unresolved WSL scope before provider I/O', async () => {
        vi.mocked(resolveWorkspaceExecutionContext).mockReturnValueOnce({
            kind: 'wsl', linuxWorkingDirectory: '/repos/sample', originalWorkingDirectory: repo.localPath,
        });
        const fetchDiff = vi.fn().mockResolvedValue(raw);
        await expect(loadPullRequestPatch(repo, 'workspace', 42, config, fetchDiff)).rejects.toThrow(/resolved WSL/);
        expect(fetchDiff).not.toHaveBeenCalled();
    });

    it('preserves remote-only hunks with stateless Rust processing and no invented root', async () => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        const patch = await loadPullRequestPatch({ ...repo, localPath: '' }, 'workspace', 42, config, async () => raw);
        expect(patch.content.raw).toBe(raw);
        expect(open).not.toHaveBeenCalled();
    });

    it('fails native loading before transport', async () => {
        vi.mocked(loadNativeGit).mockImplementationOnce(() => { throw new NativeAddonLoadError('rebuild required'); });
        const fetchDiff = vi.fn().mockResolvedValue(raw);
        await expect(loadPullRequestPatch(repo, 'workspace', 42, config, fetchDiff)).rejects.toThrow(/rebuild/);
        expect(fetchDiff).not.toHaveBeenCalled();
    });

    it('rejects unknown provider identity before transport', async () => {
        const fetchDiff = vi.fn().mockResolvedValue(raw);
        await expect(loadPullRequestPatch({ ...repo, remoteUrl: 'https://example.invalid/sample' },
            'workspace', 42, config, fetchDiff)).rejects.toThrow(/provider identity/);
        expect(fetchDiff).not.toHaveBeenCalled();
    });
});
