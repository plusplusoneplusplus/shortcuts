import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { loadComparisonPatch } from '@plusplusoneplusplus/forge';
import { loadPullRequestPatch } from '../../src/server/repos/pr-patch';
import { getFullContextFileDiff } from '../../src/server/repos/pr-routes';
import type { RepoInfo } from '../../src/server/repos/types';

vi.mock('@plusplusoneplusplus/coc-native', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>();
    return { ...actual, loadNativeGit: vi.fn(actual.loadNativeGit) };
});
vi.mock('@plusplusoneplusplus/forge', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, loadComparisonPatch: vi.fn(actual.loadComparisonPatch) };
});

const repo: RepoInfo = {
    id: 'workspace', name: 'fixture', localPath: path.resolve('patch-fixture'),
    remoteUrl: 'https://github.com/fixture/repository.git', clonedAt: '', headSha: '',
};
const raw = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(ready => { resolve = ready; });
    return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('PR patch cancellation boundaries', () => {
    it.each([true, false])('rejects pre-aborted reads before native loading or I/O (root=%s)', async root => {
        const controller = new AbortController();
        const reason = new Error('caller stopped');
        controller.abort(reason);
        vi.mocked(loadNativeGit).mockClear();
        const fetchDiff = vi.fn(async () => raw);
        await expect(loadPullRequestPatch({ ...repo, localPath: root ? repo.localPath : undefined },
            'workspace', 42, { providers: {} }, fetchDiff, controller.signal)).rejects.toBe(reason);
        expect(loadNativeGit).not.toHaveBeenCalled();
        expect(fetchDiff).not.toHaveBeenCalled();
    });

    it.each([false, true])('rejects delayed remote-only transport without processing (failure=%s)', async failure => {
        const addon = loadNativeGit();
        const process = vi.spyOn(addon, 'processGitPatch');
        const ready = deferred<void>();
        const controller = new AbortController();
        const reason = new Error('caller stopped');
        const pending = loadPullRequestPatch({ ...repo, localPath: undefined }, 'workspace', 42,
            { providers: {} }, async () => {
                await ready.promise;
                if (failure) throw new Error('late transport failure');
                return raw;
            }, controller.signal);
        const rejected = expect(pending).rejects.toBe(reason);
        controller.abort(reason);
        ready.resolve();
        await rejected;
        expect(process).not.toHaveBeenCalled();
    });

    it.each([true, false])('rejects cancellation after native processing and retires listeners (root=%s)', async root => {
        const addon = loadNativeGit();
        const controller = new AbortController();
        const reason = new Error('caller stopped');
        const started = deferred<void>();
        const ready = deferred<void>();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const original = addon.processGitPatch.bind(addon);
        const delayed = async (text: string) => {
            const patch = await original(text);
            started.resolve();
            await ready.promise;
            return patch;
        };
        const scope = addon.openRemoteGitPatchStore('workspace', repo.localPath!, {
            provider: 'github', host: 'github.com', repository: 'github:fixture/repository', sourceId: '42',
        });
        const ticket = scope.beginTransport();
        const cancel = vi.spyOn(ticket, 'cancel');
        vi.spyOn(ticket, 'process').mockImplementation(delayed);
        vi.spyOn(scope, 'beginTransport').mockReturnValueOnce(ticket);
        vi.spyOn(addon, 'openRemoteGitPatchStore').mockReturnValue(scope);
        vi.spyOn(addon, 'processGitPatch').mockImplementation(delayed);
        try {
            const pending = loadPullRequestPatch({ ...repo, localPath: root ? repo.localPath : undefined },
                'workspace', 42, { providers: {} }, async () => raw, controller.signal);
            const rejected = expect(pending).rejects.toBe(reason);
            await started.promise;
            controller.abort(reason);
            if (root) expect(cancel).toHaveBeenCalledTimes(1);
            ready.resolve();
            await rejected;
            expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
            if (root) {
                expect(() => scope.beginTransport()).toThrow(/closed/i);
            }
        } finally {
            ready.resolve();
            scope.dispose();
        }
    });

    it('propagates full-context cancellation rather than fetching or degrading to hunks', async () => {
        const controller = new AbortController();
        const reason = new Error('caller stopped');
        vi.mocked(loadNativeGit).mockClear();
        vi.mocked(loadComparisonPatch).mockImplementationOnce(async (_root, _base, _head, _path, options) => {
            expect(options?.signal).toBe(controller.signal);
            controller.abort(reason);
            throw new Error('fatal: bad object head');
        });
        await expect(getFullContextFileDiff(repo.localPath!, 'origin', '42', {
            id: 42, number: 42, title: '', description: '', author: { id: 'fixture', displayName: 'Fixture' },
            sourceBranch: 'feature', targetBranch: 'main', status: 'open', isDraft: false,
            createdAt: new Date(0), updatedAt: new Date(0), url: '', repositoryId: 'fixture',
            baseSha: 'base', headSha: 'head',
        }, 'file.txt', controller.signal)).rejects.toBe(reason);
        expect(loadNativeGit).not.toHaveBeenCalled();
    });
});
