/**
 * Unit tests for the PR-by-URL identity parser and the server-credential PR
 * status fetcher used by Sentinel To-do merge watches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const forgeMocks = vi.hoisted(() => ({
    github: vi.fn(),
    ado: vi.fn(),
    adoToken: vi.fn(),
    readConfig: vi.fn(),
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@plusplusoneplusplus/forge')>()),
    createGitHubPullRequestsAdapter: forgeMocks.github,
    createAdoPullRequestsAdapter: forgeMocks.ado,
    resolveAdoAccessTokenValue: forgeMocks.adoToken,
}));
vi.mock('../../../src/server/providers/providers-config', () => ({ readProvidersConfig: forgeMocks.readConfig }));

import { createPrStatusFetcher, parsePullRequestUrl, PrCredentialsError } from '../../../src/server/triggers/pr-status-fetcher';

describe('parsePullRequestUrl', () => {
    it('parses GitHub PR URLs, ignoring sub-pages, queries and fragments', () => {
        expect(parsePullRequestUrl('https://github.com/Owner/my.repo/pull/42/files?x=1#y')).toEqual({
            provider: 'github', host: 'github.com', repoPath: 'Owner/my.repo', number: 42,
            url: 'https://github.com/Owner/my.repo/pull/42',
        });
    });

    it('parses dev.azure.com and visualstudio.com PR URLs', () => {
        expect(parsePullRequestUrl('https://dev.azure.com/org/My%20Proj/_git/repo/pullrequest/9?_a=files')).toEqual({
            provider: 'ado', host: 'dev.azure.com', repoPath: 'org/My Proj/repo', number: 9,
            url: 'https://dev.azure.com/org/My%20Proj/_git/repo/pullrequest/9',
        });
        expect(parsePullRequestUrl('https://Contoso.visualstudio.com/DefaultCollection/proj/_git/repo/pullrequest/3')).toEqual({
            provider: 'ado', host: 'contoso.visualstudio.com', repoPath: 'contoso/proj/repo', number: 3,
            url: 'https://contoso.visualstudio.com/proj/_git/repo/pullrequest/3',
        });
    });

    it.each([
        'not a url',
        'http://github.com/o/r/pull/1',
        'https://github.com/o/r/issues/1',
        'https://github.com/o/r/pull/0',
        'https://github.com/o/r/pull/12abc',
        'https://gitlab.com/o/r/pull/1',
        'https://dev.azure.com/org/proj/_git/repo',
        'https://evil.example.com/github.com/o/r/pull/1',
    ])('rejects %s', (input) => {
        expect(parsePullRequestUrl(input)).toBeNull();
    });
});

describe('createPrStatusFetcher', () => {
    const getPullRequest = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        forgeMocks.github.mockReturnValue({ getPullRequest });
        forgeMocks.ado.mockReturnValue({ getPullRequest });
        forgeMocks.adoToken.mockResolvedValue('ado-token');
        forgeMocks.readConfig.mockResolvedValue({ providers: { github: { token: 'gh-token' } } });
    });

    it('reads a merged GitHub PR with the server token and merge commit', async () => {
        getPullRequest.mockResolvedValue({
            status: 'merged', title: 'Add feature', mergedAt: new Date('2026-02-01T00:00:00Z'),
            raw: { merge_commit_sha: 'abc123' },
        });
        const fetcher = createPrStatusFetcher({ dataDir: '/data' });
        const pr = parsePullRequestUrl('https://github.com/o/r/pull/5')!;
        await expect(fetcher(pr)).resolves.toEqual({
            status: 'merged', title: 'Add feature', url: pr.url, mergeCommit: 'abc123', mergedAt: '2026-02-01T00:00:00.000Z',
        });
        expect(forgeMocks.github).toHaveBeenCalledWith({ token: 'gh-token', owner: 'o', repo: 'r' });
        expect(getPullRequest).toHaveBeenCalledWith('o/r', 5);
    });

    it('uses the organization from the ADO URL, not a configured default org', async () => {
        forgeMocks.readConfig.mockResolvedValue({ providers: { ado: { orgUrl: 'https://dev.azure.com/other' } } });
        getPullRequest.mockResolvedValue({ status: 'open', title: 'WIP', raw: { lastMergeCommit: { commitId: 'zzz' } } });
        const fetcher = createPrStatusFetcher({ dataDir: '/data' });
        const pr = parsePullRequestUrl('https://dev.azure.com/org/proj/_git/repo/pullrequest/9')!;
        await expect(fetcher(pr)).resolves.toEqual({ status: 'open', title: 'WIP', url: pr.url });
        expect(forgeMocks.ado).toHaveBeenCalledWith({ orgUrl: 'https://dev.azure.com/org', token: 'ado-token', project: 'proj', repo: 'repo' });
    });

    it('fails with a credentials error when GitHub is not configured', async () => {
        forgeMocks.readConfig.mockResolvedValue({ providers: {} });
        const fetcher = createPrStatusFetcher({ dataDir: '/data' });
        await expect(fetcher(parsePullRequestUrl('https://github.com/o/r/pull/5')!)).rejects.toBeInstanceOf(PrCredentialsError);
    });
});
