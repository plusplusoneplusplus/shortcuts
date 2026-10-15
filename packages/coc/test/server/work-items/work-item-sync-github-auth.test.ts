import { describe, expect, it, vi } from 'vitest';
import { AuthError, NativeAddonLoadError, type readGitHubCredential } from '@plusplusoneplusplus/coc-native';
import {
    GhCliGitHubWorkItemIssueTransport,
    createGitHubWorkItemSyncProviderAdapter,
    type AvailableGitHubWorkItemSyncRepo,
} from '../../../src/server/work-items/work-item-sync-github-provider';
import { resolveGitHubWorkItemSyncRepo } from '../../../src/server/work-items/work-item-sync-github-repo';

const repo: AvailableGitHubWorkItemSyncRepo = {
    available: true, provider: 'github', owner: 'example-org', repo: 'example-repo',
    url: 'https://github.com/example-org/example-repo', source: 'workspaceRemote', login: 'account-a',
};
const issue = { number: 12, title: 'Epic', body: 'Description', state: 'open', labels: ['coc:type:epic'] };

function fixture() {
    const read = vi.fn<typeof readGitHubCredential>().mockResolvedValue({
        host: 'github.com', login: 'account-a', token: 'synthetic-token-a',
    });
    const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(issue));
    return { read, request, transport: new GhCliGitHubWorkItemIssueTransport(request, read) };
}

describe('native GitHub work-item sync authentication', () => {
    it('routes every sync operation through fresh SDK credentials and preserves REST fields', async () => {
        const { read, request, transport } = fixture();
        await transport.getRepository(repo);
        request.mockResolvedValueOnce(Response.json([issue, { ...issue, number: 13, pull_request: {} }]));
        expect(await transport.listIssues(repo, { labels: [' coc:type:epic '], q: 'Epic' })).toHaveLength(1);
        expect(await transport.getIssue(repo, 12)).toMatchObject({ number: 12, title: 'Epic', state: 'open' });
        const input = { title: 'New title', body: 'Keep metadata\nand prose', labels: ['custom', 'coc:type:epic'] };
        await transport.createIssue(repo, input);
        await transport.updateIssue(repo, 12, { ...input, state: 'closed' });

        expect(read).toHaveBeenCalledTimes(5);
        for (const [options, signal] of read.mock.calls) {
            expect(options).toEqual({ source: 'gh-cli', account: { host: 'github.com', login: 'account-a' } });
            expect(signal).toBeInstanceOf(AbortSignal);
        }
        for (const [url, options] of request.mock.calls) {
            expect(String(url)).toMatch(/^https:\/\/api\.github\.com\/repos\/example-org\/example-repo/);
            expect(options).toMatchObject({
                headers: { Authorization: 'Bearer synthetic-token-a' }, redirect: 'error', signal: expect.any(AbortSignal),
            });
        }
        const listUrl = new URL(String(request.mock.calls[1][0]));
        expect(Object.fromEntries(listUrl.searchParams)).toEqual({
            state: 'all', per_page: '100', page: '1', labels: 'coc:type:epic',
        });
        expect(request.mock.calls[3][1]).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
        expect(request.mock.calls[4][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ ...input, state: 'closed' }) });
    });

    it('preserves pagination, pull-request exclusion and result caps', async () => {
        const { request, read, transport } = fixture();
        request.mockResolvedValueOnce(Response.json(Array.from({ length: 100 }, (_, index) => ({ ...issue, number: index + 1 }))))
            .mockResolvedValueOnce(Response.json([{ ...issue, number: 101 }, { ...issue, number: 102 }]));
        const issues = await transport.listIssues(repo, { limit: 101 });
        expect(issues).toHaveLength(101);
        expect(new URL(String(request.mock.calls[1][0])).searchParams.get('page')).toBe('2');
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('keeps concurrent workspaces and owning-server transports isolated without caching accounts or tokens', async () => {
        const local = fixture();
        const remote = fixture();
        remote.read.mockResolvedValue({ host: 'github.example', login: 'account-b', token: 'synthetic-token-b' });
        const otherRepo = { ...repo, url: 'https://github.example/example-org/example-repo', login: 'account-b' };
        await Promise.all([local.transport.getRepository(repo), remote.transport.getRepository(otherRepo)]);
        expect(remote.read).toHaveBeenCalledWith({
            source: 'gh-cli', account: { host: 'github.example', login: 'account-b' },
        }, expect.any(AbortSignal));
        expect(remote.request).toHaveBeenCalledWith('https://github.example/api/v3/repos/example-org/example-repo',
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token-b' }) }));
        local.read.mockResolvedValueOnce({ host: 'github.com', login: 'account-a', token: 'rotated-token' });
        await local.transport.getRepository(repo);
        expect(local.request.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer rotated-token' });
        expect(remote.read).toHaveBeenCalledTimes(1);
    });

    it('shares a transport across workspaces without sharing their credential selections', async () => {
        const { read, request, transport } = fixture();
        read.mockImplementation(async options => {
            if (options.account === 'active-cli-account') throw new Error('Explicit account required');
            return { ...options.account, token: `synthetic-${options.account.login}` };
        });
        await Promise.all([
            transport.getRepository(repo),
            transport.getRepository({ ...repo, login: 'account-b' }),
        ]);
        expect(read.mock.calls.map(([options]) => options.account)).toEqual([
            { host: 'github.com', login: 'account-a' }, { host: 'github.com', login: 'account-b' },
        ]);
        expect(request.mock.calls.map(([, options]) => options?.headers)).toEqual([
            expect.objectContaining({ Authorization: 'Bearer synthetic-account-a' }),
            expect.objectContaining({ Authorization: 'Bearer synthetic-account-b' }),
        ]);
    });

    it.each([undefined, '', 'bad account', 'bad\naccount'])('rejects unselected/invalid login %j without invoking auth or HTTP', async login => {
        const { read, request, transport } = fixture();
        await expect(transport.getRepository({ ...repo, login })).rejects.toThrow('workItems.sync.github.login');
        expect(read).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it.each([
        new AuthError('LoginRequired'), new AuthError('CliUnavailable'), new AuthError('TimedOut'),
        new AuthError('AccountMismatch'), new AuthError('StorageDenied'),
        new NativeAddonLoadError('synthetic-private-path'),
        new Error('synthetic-secret-in-stderr'),
    ])('surfaces actionable, redacted auth failures without retry/fallback: %s', async error => {
        const { read, request, transport } = fixture();
        read.mockRejectedValueOnce(error);
        await expect(transport.createIssue(repo, { title: 'Epic', body: '', labels: [] }))
            .rejects.toThrow(/owning server/);
        expect(read).toHaveBeenCalledTimes(1);
        expect(request).not.toHaveBeenCalled();
        read.mockRejectedValueOnce(error);
        const provider = createGitHubWorkItemSyncProviderAdapter({ transport });
        const status = await provider.getStatus({
            workspaceId: 'workspace-a',
            workspace: { id: 'workspace-a', name: 'Example', rootPath: '', remoteUrl: repo.url },
            preferences: { workItems: { sync: { github: { login: 'account-a' } } } },
        });
        expect(status).toMatchObject({ available: false, reason: 'auth-unavailable', auth: { authenticated: false } });
        expect(status.message).toContain('gh auth login --hostname <host>');
        expect(JSON.stringify(status)).not.toMatch(/synthetic-private-path|synthetic-secret-in-stderr|synthetic-token/);
    });

    it.each([
        { host: 'other.example', login: 'account-a', token: 'synthetic-secret' },
        { host: 'github.com', login: 'account-b', token: 'synthetic-secret' },
        { host: 'github.com', login: 'account-a', token: '' },
        { host: 'github.com', login: 'account-a', token: 'synthetic-secret\r\nheader' },
    ])('rejects mismatched or invalid SDK snapshots without sending a request', async credential => {
        const { read, request, transport } = fixture();
        read.mockResolvedValueOnce(credential);
        await expect(transport.getRepository(repo)).rejects.toThrow('invalid or mismatched credential');
        expect(request).not.toHaveBeenCalled();
    });

    it.each([401, 403, 429, 500, 302])('redacts HTTP %i payloads and does not fall back or retry', async status => {
        const { request, read, transport } = fixture();
        request.mockResolvedValueOnce(new Response('synthetic-secret-server-body', { status }));
        await expect(transport.getIssue(repo, 12)).rejects.toThrow(`HTTP ${status}`);
        expect(read).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('treats only an actual issue HTTP 404 as missing, not an auth error containing 404', async () => {
        const { request, read, transport } = fixture();
        request.mockResolvedValueOnce(new Response('private response', { status: 404 }));
        expect(await transport.getIssue(repo, 12)).toBeUndefined();
        read.mockRejectedValueOnce(new Error('404 credential not found synthetic-secret'));
        await expect(transport.getIssue(repo, 12)).rejects.toThrow('authentication failed');
        request.mockRejectedValueOnce(new Error('404 synthetic-secret-network'));
        await expect(transport.getIssue(repo, 12)).rejects.toThrow('request failed or timed out');
        request.mockResolvedValueOnce(new Response('synthetic-secret-invalid-json'));
        await expect(transport.getRepository(repo)).rejects.toThrow('invalid JSON');
    });

    it('resolves account selection anew from each concrete workspace, not a shared origin', async () => {
        const workspace = { remoteUrl: repo.url };
        const preferences = (login: string) => ({ workItems: { sync: { github: { login } } } });
        const first = await resolveGitHubWorkItemSyncRepo({ workspace, preferences: preferences('account-a') });
        const second = await resolveGitHubWorkItemSyncRepo({ workspace, preferences: preferences('account-b') });
        expect(first).toMatchObject({ available: true, login: 'account-a', url: repo.url });
        expect(second).toMatchObject({ available: true, login: 'account-b', url: repo.url });
    });
});
