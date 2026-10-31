import { describe, expect, it, vi } from 'vitest';
import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import { ReviewContentSearchController } from '../../../src/server/spa/client/react/features/git/diff/reviewContentSearchController';
import { DEFAULT_CONTENT_SEARCH_MODES as modes } from '../../../src/server/spa/client/react/features/repo-detail/explorer/types';

function content(old: string | null = 'old target', next: string | null = 'new target'): GitFileDiffContentResponse {
    return {
        path: 'a', fileName: 'a', language: 'text', binary: false, tooLarge: false,
        base: { content: old ?? '', exists: old !== null, ref: 'base' },
        head: { content: next ?? '', exists: next !== null, ref: 'head' },
    };
}
function deferred() {
    let resolve!: (value: GitFileDiffContentResponse) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<GitFileDiffContentResponse>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const files = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(index), path: `file-${index}.ts` }));
async function settle() {
    // Drain loader, response, catch and worker-finally promise steps.
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('review content loading controller', () => {
    it('loads lazily, with four workers, stable order and completed-attempt progress', async () => {
        const reads = files(7).map(() => deferred());
        const load = vi.fn(file => reads[Number(file.id)].promise);
        const controller = new ReviewContentSearchController(files(7), load);
        expect(load).not.toHaveBeenCalled();
        controller.start('target', modes);
        await settle();
        expect(load).toHaveBeenCalledTimes(4);
        expect(controller.getSnapshot()).toMatchObject({ running: true, searched: 0, total: 7 });
        reads[2].resolve(content());
        await settle();
        expect(load).toHaveBeenCalledTimes(5);
        expect(controller.getSnapshot().searched).toBe(1);
        reads[0].resolve(content()); reads[1].resolve(content()); reads[3].resolve(content());
        await settle();
        expect(load).toHaveBeenCalledTimes(7);
        reads.slice(4).forEach(read => read.resolve(content()));
        await settle();
        expect(controller.getSnapshot()).toMatchObject({ running: false, searched: 7, total: 7 });
        expect(controller.getSnapshot().files.map(entry => entry.file.id)).toEqual(files(7).map(file => file.id));
        expect(controller.getSnapshot().files.every(entry => entry.matches.length === 2)).toBe(true);
    });

    it('stops further reads, retains in-flight successes and resumes from cache', async () => {
        const reads = files(6).map(() => deferred());
        const load = vi.fn(file => reads[Number(file.id)].promise);
        const controller = new ReviewContentSearchController(files(6), load);
        controller.start('target', modes);
        await settle();
        controller.stop();
        reads.slice(0, 4).forEach(read => read.resolve(content()));
        await settle();
        expect(load).toHaveBeenCalledTimes(4);
        expect(controller.getSnapshot()).toMatchObject({ running: false, searched: 4, total: 6 });
        controller.start('new', modes, 'new');
        await settle();
        expect(load).toHaveBeenCalledTimes(6);
        reads.slice(4).forEach(read => read.resolve(content()));
        await settle();
        expect(controller.getSnapshot().files.every(entry => entry.matches.length === 1 && entry.matches[0].side === 'new')).toBe(true);
        controller.start('missing', modes);
        expect(controller.getSnapshot().running).toBe(false);
        expect(controller.getSnapshot().files.every(entry => entry.matches.length === 0)).toBe(true);
        expect(load).toHaveBeenCalledTimes(6);
    });

    it('uses the latest query/filter without duplicate reads or exceeding four in flight', async () => {
        const reads = files(8).map(() => deferred());
        const load = vi.fn(file => reads[Number(file.id)].promise);
        const controller = new ReviewContentSearchController(files(8), load);
        controller.start('old', modes);
        await settle();
        controller.start('new', modes, 'new', file => Number(file.id) >= 4);
        await settle();
        expect(load).toHaveBeenCalledTimes(4);
        reads.slice(0, 4).forEach(read => read.resolve(content()));
        await settle();
        expect(load).toHaveBeenCalledTimes(8);
        reads.slice(4).forEach(read => read.resolve(content()));
        await settle();
        expect(controller.getSnapshot()).toMatchObject({ total: 4, searched: 4, running: false });
        expect(controller.getSnapshot().files.every(entry => entry.matches[0].text === 'new target')).toBe(true);
        controller.start('old', modes, 'old');
        expect(controller.getSnapshot().files.every(entry => entry.matches[0].side === 'old')).toBe(true);
        expect(load).toHaveBeenCalledTimes(8);
    });

    it('shows binary and oversized skips, retries errors only on request', async () => {
        const load = vi.fn()
            .mockResolvedValueOnce({ ...content(), binary: true })
            .mockResolvedValueOnce({ ...content(), tooLarge: true })
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(content());
        const controller = new ReviewContentSearchController(files(3), load);
        controller.start('target', modes);
        await settle();
        expect(controller.getSnapshot()).toMatchObject({ searched: 3, running: false });
        expect(controller.getSnapshot().files.map(entry => entry.state)).toEqual([
            { status: 'skipped', reason: 'binary' }, { status: 'skipped', reason: 'tooLarge' },
            { status: 'error', message: 'offline' },
        ]);
        controller.start('old', modes);
        controller.retry('0'); controller.retry('missing');
        expect(load).toHaveBeenCalledTimes(3);
        controller.retry('2');
        await settle();
        expect(load).toHaveBeenCalledTimes(4);
        expect(controller.getSnapshot().files[2].matches[0].text).toBe('old target');
        expect(controller.getSnapshot()).toMatchObject({ searched: 3, running: false });
    });

    it('turns synchronous throws and malformed responses into retryable errors', async () => {
        const load = vi.fn().mockImplementationOnce(() => { throw new Error('sync failure'); })
            .mockResolvedValueOnce({}).mockResolvedValueOnce(content());
        const controller = new ReviewContentSearchController(files(2), load);
        controller.start('target', modes);
        await settle();
        expect(controller.getSnapshot().files.map(entry => entry.state)).toEqual([
            { status: 'error', message: 'sync failure' }, { status: 'error', message: 'Invalid file content response' },
        ]);
        controller.retry('1');
        await settle();
        expect(controller.getSnapshot().files[1].state.status).toBe('loaded');
    });

    it('keeps empty/invalid queries idle and matches an absent side correctly', async () => {
        const load = vi.fn().mockResolvedValue(content(null, ''));
        const controller = new ReviewContentSearchController(files(1), load);
        controller.start('', modes);
        controller.start('[', { ...modes, regex: true });
        await settle();
        expect(load).not.toHaveBeenCalled();
        expect(controller.getSnapshot()).toMatchObject({ running: false, total: 0, error: expect.any(String) });
        controller.start('^$', { ...modes, regex: true });
        await settle();
        expect(controller.getSnapshot().files[0].matches.map(match => match.side)).toEqual(['new']);
    });

    it('clears old matches immediately when a query becomes invalid during loading', async () => {
        const read = deferred();
        const controller = new ReviewContentSearchController(files(1), () => read.promise);
        controller.start('target', modes);
        await settle();
        controller.start('[', { ...modes, regex: true });
        read.resolve(content());
        await settle();
        expect(controller.getSnapshot()).toMatchObject({ files: [], total: 0, running: false, error: expect.any(String) });
        controller.start('target', modes);
        expect(controller.getSnapshot().files[0].matches).toHaveLength(2);
    });

    it('disposes pending successes and errors without notifying or scheduling more reads', async () => {
        const reads = files(5).map(() => deferred());
        const load = vi.fn(file => reads[Number(file.id)].promise);
        const controller = new ReviewContentSearchController(files(5), load);
        const listener = vi.fn();
        controller.subscribe(listener);
        controller.start('target', modes);
        await settle();
        controller.dispose();
        const count = listener.mock.calls.length;
        reads[0].reject(new Error('late failure'));
        reads.slice(1, 4).forEach(read => read.resolve(content()));
        await settle();
        controller.start('target', modes); controller.retry('0'); controller.stop();
        expect(listener).toHaveBeenCalledTimes(count);
        expect(load).toHaveBeenCalledTimes(4);
        expect(controller.getSnapshot()).toEqual({ running: false, error: null, searched: 0, total: 0, files: [] });
    });

    it('separates review owners and same-path staged entries, preserving prior snapshots', async () => {
        const samePath = [{ id: 'staged:a', path: 'a' }, { id: 'unstaged:a', path: 'a' }];
        const loadA = vi.fn(file => Promise.resolve(content(file.id, null)));
        const loadB = vi.fn().mockResolvedValue(content('other owner', null));
        const a = new ReviewContentSearchController(samePath, loadA);
        const b = new ReviewContentSearchController(samePath, loadB);
        const unsubscribe = a.subscribe(vi.fn());
        a.start('staged', modes); b.start('owner', modes);
        const before = a.getSnapshot();
        await settle();
        expect(before.files.every(entry => entry.state.status === 'loading')).toBe(true);
        expect(a.getSnapshot().files.map(entry => entry.matches[0].text)).toEqual(['staged:a', 'unstaged:a']);
        expect(b.getSnapshot().files.every(entry => entry.matches[0].text === 'other owner')).toBe(true);
        expect(loadA).toHaveBeenCalledTimes(2); expect(loadB).toHaveBeenCalledTimes(2);
        unsubscribe();
    });
});
