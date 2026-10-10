import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import {
    getRepoPreferences, patchRepoPreferences, updateRepoPreferences, peekRepoPreferences,
    REPO_PREFERENCES_TTL_MS,
} from '../../../../src/server/spa/client/react/api/repoPreferences';
import { _clearConfigCache } from '../../../../src/server/spa/client/react/api/staticConfigCache';

const response = (value: unknown) => new Response(JSON.stringify(value), {
    status: 200, headers: { 'Content-Type': 'application/json' },
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
function owner(baseUrl = '', apiBasePath = '/api') {
    const fetch = vi.fn().mockImplementation(async () => response({ defaultModel: 'initial' }));
    return { client: new CocClient({ baseUrl, apiBasePath, fetch }), fetch };
}

beforeEach(() => {
    _clearConfigCache();
    vi.restoreAllMocks();
});

describe('shared repo preference reads', () => {
    it('deduplicates concurrent readers and warm reopen reads', async () => {
        const { client, fetch } = owner();
        const pending = deferred<Response>();
        fetch.mockReturnValueOnce(pending.promise);
        const first = getRepoPreferences(client, 'ws-1');
        const second = getRepoPreferences(client, 'ws-1');
        expect(first).toBe(second);
        pending.resolve(response({ lastChatProvider: 'codex' }));
        expect(await first).toEqual({ lastChatProvider: 'codex' });
        expect(await getRepoPreferences(client, 'ws-1')).toEqual(await second);
        expect(peekRepoPreferences(client, 'ws-1')).toEqual(await first);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('isolates workspaces, remote servers, and same-origin container API prefixes', async () => {
        const local = owner();
        const remoteA = owner('https://a.example');
        const remoteB = owner('https://b.example');
        const container = owner('', '/api/agents/other');
        for (const [index, item] of [local, remoteA, remoteB, container].entries()) {
            item.fetch.mockImplementation(async () => response({ defaultModel: `model-${index}` }));
            expect(await getRepoPreferences(item.client, 'ws-1')).toEqual({ defaultModel: `model-${index}` });
        }
        await getRepoPreferences(local.client, 'ws-2');
        expect(local.fetch).toHaveBeenCalledTimes(2);
        expect(remoteA.fetch).toHaveBeenCalledTimes(1);
        expect(remoteB.fetch).toHaveBeenCalledTimes(1);
        expect(container.fetch).toHaveBeenCalledTimes(1);
    });

    it('shares independently created clients routed to the same normalized owner', async () => {
        const first = owner('https://a.example/');
        const second = owner('https://a.example');
        await getRepoPreferences(first.client, 'ws-1');
        await getRepoPreferences(second.client, 'ws-1');
        expect(first.fetch).toHaveBeenCalledTimes(1);
        expect(second.fetch).not.toHaveBeenCalled();
    });

    it('isolates optionless client facades and shares aliases of the same preference owner', async () => {
        const getFirst = vi.fn().mockResolvedValue({ defaultModel: 'first' });
        const getSecond = vi.fn().mockResolvedValue({ defaultModel: 'second' });
        const first = { preferences: { getRepo: getFirst } as unknown as CocClient['preferences'] };
        const second = { preferences: { getRepo: getSecond } as unknown as CocClient['preferences'] };
        expect(await getRepoPreferences(first, 'ws-1')).toEqual({ defaultModel: 'first' });
        expect(await getRepoPreferences(second, 'ws-1')).toEqual({ defaultModel: 'second' });
        expect(await getRepoPreferences({ preferences: first.preferences }, 'ws-1')).toEqual({ defaultModel: 'first' });
        expect(getFirst).toHaveBeenCalledTimes(1);
        expect(getSecond).toHaveBeenCalledTimes(1);
        _clearConfigCache();
        await getRepoPreferences(first, 'ws-1');
        expect(getFirst).toHaveBeenCalledTimes(2);
    });

    it('expires warm reads after a short freshness window', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
        const { client, fetch } = owner();
        await getRepoPreferences(client, 'ws-1');
        now.mockReturnValue(1000 + REPO_PREFERENCES_TTL_MS);
        expect(peekRepoPreferences(client, 'ws-1')).toBeUndefined();
        await getRepoPreferences(client, 'ws-1');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not cache read failures', async () => {
        const { client, fetch } = owner();
        fetch.mockRejectedValueOnce(new Error('offline'));
        await expect(getRepoPreferences(client, 'ws-1')).rejects.toThrow();
        expect(peekRepoPreferences(client, 'ws-1')).toBeUndefined();
        await getRepoPreferences(client, 'ws-1');
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});

describe('repo preference mutation invalidation', () => {
    it.each([patchRepoPreferences, updateRepoPreferences])('invalidates only the mutated owner/workspace after success', async mutate => {
        const local = owner();
        const remote = owner('https://remote.example');
        await getRepoPreferences(local.client, 'ws-1');
        await getRepoPreferences(local.client, 'ws-2');
        await getRepoPreferences(remote.client, 'ws-1');
        local.fetch.mockImplementation(async () => response({ defaultModel: 'updated' }));
        await mutate(local.client, 'ws-1', { defaultModel: 'updated' });
        expect(peekRepoPreferences(local.client, 'ws-1')).toBeUndefined();
        expect(peekRepoPreferences(local.client, 'ws-2')).toEqual({ defaultModel: 'initial' });
        expect(peekRepoPreferences(remote.client, 'ws-1')).toEqual({ defaultModel: 'initial' });
        expect(await getRepoPreferences(local.client, 'ws-1')).toEqual({ defaultModel: 'updated' });
    });

    it('keeps a cached value when mutation fails', async () => {
        const { client, fetch } = owner();
        await getRepoPreferences(client, 'ws-1');
        fetch.mockResolvedValueOnce(new Response('failed', { status: 500 }));
        await expect(patchRepoPreferences(client, 'ws-1', { defaultModel: 'changed' })).rejects.toThrow();
        expect(await getRepoPreferences(client, 'ws-1')).toEqual({ defaultModel: 'initial' });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each(['resolve', 'reject'] as const)('a superseded read cannot poison or remove a post-mutation pending read (%s)', async settle => {
        const { client, fetch } = owner();
        const old = deferred<Response>();
        const fresh = deferred<Response>();
        fetch.mockReturnValueOnce(old.promise);
        const oldRead = getRepoPreferences(client, 'ws-1').catch(() => undefined);
        await patchRepoPreferences(client, 'ws-1', { defaultModel: 'updated' });
        fetch.mockReturnValueOnce(fresh.promise);
        const freshRead = getRepoPreferences(client, 'ws-1');
        if (settle === 'resolve') old.resolve(response({ defaultModel: 'stale' }));
        else old.reject(new Error('old read failed'));
        await oldRead;
        expect(peekRepoPreferences(client, 'ws-1')).toBeUndefined();
        expect(getRepoPreferences(client, 'ws-1')).toBe(freshRead);
        fresh.resolve(response({ defaultModel: 'updated' }));
        await freshRead;
        expect(peekRepoPreferences(client, 'ws-1')).toEqual({ defaultModel: 'updated' });
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('a pre-mutation read settling last cannot overwrite the fresh cached value', async () => {
        const { client, fetch } = owner();
        const old = deferred<Response>();
        fetch.mockReturnValueOnce(old.promise);
        const oldRead = getRepoPreferences(client, 'ws-1');
        await patchRepoPreferences(client, 'ws-1', { defaultModel: 'updated' });
        fetch.mockResolvedValueOnce(response({ defaultModel: 'updated' }));
        await getRepoPreferences(client, 'ws-1');
        old.resolve(response({ defaultModel: 'stale' }));
        await oldRead;
        expect(peekRepoPreferences(client, 'ws-1')).toEqual({ defaultModel: 'updated' });
    });
});
