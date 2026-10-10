import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { loadSuppliedPatch, openRemotePatchStore } from '../../src/diff/remote-patch';

const source = { provider: 'github', host: 'github.com', repository: 'github:example/repo', sourceId: '42' };
const raw = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n';
afterEach(() => vi.restoreAllMocks());

describe('shared supplied patch transport', () => {
    it.each([true, false])('rejects a pre-aborted read before transport admission (scoped=%s)', async scoped => {
        const store = scoped ? openRemotePatchStore('workspace', { kind: 'windows', workingDirectory: path.resolve('fixture') }, source) : undefined;
        const begin = store && vi.spyOn(store, 'beginTransport');
        const fetch = vi.fn(async () => raw);
        const reason = new Error('caller stopped');
        try {
            await expect(loadSuppliedPatch(fetch, store, AbortSignal.abort(reason))).rejects.toBe(reason);
            expect(fetch).not.toHaveBeenCalled();
            if (begin) expect(begin).not.toHaveBeenCalled();
        } finally { store?.dispose(); }
    });

    it.each([true, false])('rejects abandoned transport without publishing or processing it (scoped=%s)', async scoped => {
        const store = scoped ? openRemotePatchStore('workspace', { kind: 'windows', workingDirectory: path.resolve('fixture') }, source) : undefined;
        const controller = new AbortController(), reason = new Error('caller stopped');
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const process = vi.spyOn(loadNativeGit(), 'processGitPatch');
        let finish!: (raw: string) => void;
        const pending = loadSuppliedPatch(() => new Promise(resolve => { finish = resolve; }), store, controller.signal);
        const rejected = expect(pending).rejects.toBe(reason);
        try {
            controller.abort(reason);
            finish(raw);
            await rejected;
            expect(process).not.toHaveBeenCalled();
            expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
            expect((await loadSuppliedPatch(async () => raw, store)).content.raw).toBe(raw);
        } finally { store?.dispose(); }
    });

    it('retires failed requests without disposing another read in the same scope', async () => {
        const store = openRemotePatchStore('workspace', { kind: 'windows', workingDirectory: path.resolve('fixture') }, source);
        const begin = vi.spyOn(store, 'beginTransport');
        const failure = new Error('authenticated read failed');
        try {
            await expect(loadSuppliedPatch(async () => { throw failure; }, store)).rejects.toBe(failure);
            expect(() => begin.mock.results[0].value.process(raw)).toThrow('Closed');
            expect((await loadSuppliedPatch(async () => raw, store)).summary).toEqual({
                filesChanged: 1, additions: 1, deletions: 1,
            });
        } finally { store.dispose(); }
    });

    it('supports remote-only patches without inventing a checkout scope', async () => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        expect((await loadSuppliedPatch(async () => '')).content.raw).toBe('');
        expect((await loadSuppliedPatch(async () => raw)).files[0].path).toBe('file.txt');
        expect(open).not.toHaveBeenCalled();
    });

    it.each(['refresh', 'dispose'] as const)('rejects per-file completion revoked by %s after the full snapshot arrives', async action => {
        const store = openRemotePatchStore('workspace', { kind: 'windows', workingDirectory: path.resolve('fixture') }, source);
        const begin = store.beginTransport.bind(store);
        let first = true;
        vi.spyOn(store, 'beginTransport').mockImplementation(() => {
            const request = begin();
            if (first) {
                first = false;
                const process = request.process.bind(request);
                vi.spyOn(request, 'process').mockImplementation(async (...args) => {
                    const result = await process(...args);
                    store[action]();
                    return result;
                });
            }
            return request;
        });
        try {
            await expect(loadSuppliedPatch(async () => raw, store, undefined, { path: 'file.txt', maxLines: 2 }))
                .rejects.toThrow(action === 'refresh' ? 'Stale' : 'Closed');
        } finally { store.dispose(); }
    });

    it('shares per-file selection, truncation and missing-file behavior with stateless reads', async () => {
        const store = openRemotePatchStore('workspace', { kind: 'windows', workingDirectory: path.resolve('fixture') }, source);
        try {
            for (const scope of [store, undefined]) {
                const result = await loadSuppliedPatch(async () => raw, scope, undefined, { path: 'file.txt', maxLines: 2 });
                expect(result.content).toEqual({ raw: 'diff --git a/file.txt b/file.txt\n--- a/file.txt', truncated: true, totalLines: 7 });
                expect(result.summary).toEqual({ filesChanged: 1, additions: 1, deletions: 1 });
                expect((await loadSuppliedPatch(async () => raw, scope, undefined, { path: 'missing' })).content.raw).toBe('');
            }
        } finally { store.dispose(); }
    });

    it('requires a resolved execution root and WSL distro before opening a scope', () => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        expect(() => openRemotePatchStore('workspace', { kind: 'windows' }, source)).toThrow('repository root');
        expect(() => openRemotePatchStore('workspace', {
            kind: 'wsl', linuxWorkingDirectory: '/fixture', originalWorkingDirectory: '/fixture',
        }, source)).toThrow('resolved WSL distro');
        expect(open).not.toHaveBeenCalled();
    });
});
