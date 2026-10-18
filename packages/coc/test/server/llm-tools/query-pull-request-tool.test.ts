import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, resolveAdoAccessTokenValue: vi.fn(async () => { throw new Error('no az account: secret-detail'); }) };
});

import { createQueryPullRequestTool, QUERY_PULL_REQUEST_TOOL_NAME } from '../../../src/server/llm-tools/query-pull-request-tool';
import {
    encodePrQueryCursor,
    parsePrQueryRequest,
    toPrQueryError,
    type PrProviderClient,
    type PrRepositoryIdentity,
} from '../../../src/server/git/query-pull-requests-service';

async function invoke(tool: { handler: (...a: any[]) => unknown }, args: unknown, signal?: AbortSignal): Promise<any> {
    const raw = await tool.handler(args, { sessionId: 's', toolCallId: 't', toolName: QUERY_PULL_REQUEST_TOOL_NAME, arguments: args, signal } as any);
    return JSON.parse(raw as string);
}

function stubClient(probe: () => Promise<void> = async () => undefined): PrProviderClient {
    return {
        probeRepository: vi.fn(probe),
        resolveCurrentUser: vi.fn(async () => 'octocat'),
        listPullRequests: vi.fn(async () => ({ items: [] })),
        getPullRequest: vi.fn(async (id: number) => ({
            candidate: { id, title: `PR ${id}`, url: `https://example.test/${id}`, author: {}, lifecycle: 'open' as const, isDraft: false, sourceBranch: 'x', targetBranch: 'main', headSha: 'sha' },
            description: '',
            inRepository: true,
        })),
        loadReviews: vi.fn(async () => []),
        loadChecks: vi.fn(async () => []),
    };
}

describe('query_pull_request tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-pr-tool-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const make = (createClient = vi.fn(async (_identity: PrRepositoryIdentity) => stubClient())) => ({
        createClient,
        tool: createQueryPullRequestTool({ dataDir: tmpDir, workspaceId: 'ws-1', processId: 'p-1', createClient }).tool,
    });

    it('is named query_pull_request and never takes routing identity from arguments', () => {
        const { tool } = make();
        expect(tool.name).toBe('query_pull_request');
        const props = (tool.parameters as any).properties;
        expect(Object.keys(props).sort()).toEqual(['author', 'ci', 'cursor', 'ids', 'limit', 'provider', 'repository', 'status']);
        expect(props.workspaceId).toBeUndefined();
        expect(props.processId).toBeUndefined();
        expect((tool.parameters as any).required).toEqual(['provider', 'repository']);
        expect(tool.description).toMatch(/untrusted/i);
    });

    describe('invalid-input before any provider I/O', () => {
        it.each([
            ['missing provider', { repository: 'o/r' }],
            ['unknown provider', { provider: 'gitlab', repository: 'o/r' }],
            ['missing repository', { provider: 'github' }],
            ['one GitHub segment', { provider: 'github', repository: 'onlyone' }],
            ['three GitHub segments', { provider: 'github', repository: 'a/b/c' }],
            ['two ADO segments', { provider: 'ado', repository: 'org/project' }],
            ['empty segment', { provider: 'ado', repository: 'org/ /repo' }],
            ['ids mixed with status', { provider: 'github', repository: 'o/r', ids: [1], status: 'open' }],
            ['ids mixed with limit', { provider: 'github', repository: 'o/r', ids: 1, limit: 5 }],
            ['ids mixed with cursor', { provider: 'github', repository: 'o/r', ids: 1, cursor: 'abc' }],
            ['empty ids', { provider: 'github', repository: 'o/r', ids: [] }],
            ['too many ids', { provider: 'github', repository: 'o/r', ids: Array.from({ length: 21 }, (_, i) => i + 1) }],
            ['zero id', { provider: 'github', repository: 'o/r', ids: [0] }],
            ['fractional id', { provider: 'github', repository: 'o/r', ids: 1.5 }],
            ['string id', { provider: 'github', repository: 'o/r', ids: ['1'] }],
            ['limit above max', { provider: 'github', repository: 'o/r', limit: 101 }],
            ['limit zero', { provider: 'github', repository: 'o/r', limit: 0 }],
            ['bad status', { provider: 'github', repository: 'o/r', status: 'draft' }],
            ['bad ci', { provider: 'github', repository: 'o/r', ci: 'green' }],
            ['GitHub author with qualifier text', { provider: 'github', repository: 'o/r', author: 'me is:open' }],
            ['empty author', { provider: 'github', repository: 'o/r', author: '  ' }],
            ['unknown argument', { provider: 'github', repository: 'o/r', workspaceId: 'ws-2' }],
            ['non-object arguments', 'github o/r'],
        ])('%s', async (_label, args) => {
            const { tool, createClient } = make();
            const result = await invoke(tool, args);
            expect(result).toMatchObject({ success: false, code: 'invalid-input' });
            expect(typeof result.error).toBe('string');
            expect(createClient).not.toHaveBeenCalled();
        });
    });

    it('rejects a non-GUID ADO author as unsupported-filter without provider I/O', async () => {
        const { tool, createClient } = make();
        const result = await invoke(tool, { provider: 'ado', repository: 'org/proj/repo', author: 'Jane Doe' });
        expect(result).toMatchObject({ success: false, code: 'unsupported-filter' });
        expect(createClient).not.toHaveBeenCalled();
    });

    describe('cursor validation', () => {
        const identity = parsePrQueryRequest({ provider: 'github', repository: 'o/r' }).identity;

        it('rejects a malformed cursor', async () => {
            const { tool, createClient } = make();
            for (const cursor of ['not base64!', 'e30', Buffer.from('nope').toString('base64url')]) {
                const result = await invoke(tool, { provider: 'github', repository: 'o/r', cursor });
                expect(result).toMatchObject({ success: false, code: 'invalid-cursor' });
            }
            expect(createClient).not.toHaveBeenCalled();
        });

        it('rejects a cursor bound to different filters, repository or provider', async () => {
            const { tool, createClient } = make();
            const cursor = encodePrQueryCursor(identity, { status: 'merged' }, { offset: 5 });
            for (const args of [
                { provider: 'github', repository: 'o/r', status: 'open', cursor },
                { provider: 'github', repository: 'o/r', status: 'merged', author: 'octocat', cursor },
                { provider: 'github', repository: 'o/other', status: 'merged', cursor },
                { provider: 'ado', repository: 'o/r/x', status: 'merged', cursor },
            ]) {
                expect(await invoke(tool, args)).toMatchObject({ success: false, code: 'invalid-cursor' });
            }
            expect(createClient).not.toHaveBeenCalled();
        });

        it('accepts a cursor issued for the same arguments', () => {
            const cursor = encodePrQueryCursor(identity, { status: 'merged', ci: 'failing' }, { after: 'Y3Vyc29y', offset: 3 });
            const request = parsePrQueryRequest({ provider: 'github', repository: ' o / r ', status: 'merged', ci: 'failing', cursor });
            expect(request).toMatchObject({ mode: 'query', position: { after: 'Y3Vyc29y', offset: 3 }, limit: 20 });
        });
    });

    describe('credentials-missing', () => {
        it('reports a missing GitHub token from providers.json', async () => {
            const tool = createQueryPullRequestTool({ dataDir: tmpDir, workspaceId: 'ws-1', processId: 'p-1' }).tool;
            const result = await invoke(tool, { provider: 'github', repository: 'o/r' });
            expect(result).toMatchObject({ success: false, code: 'credentials-missing' });
        });

        it('reports a missing ADO token without leaking resolver details', async () => {
            const tool = createQueryPullRequestTool({ dataDir: tmpDir, workspaceId: 'ws-1', processId: 'p-1' }).tool;
            const result = await invoke(tool, { provider: 'ado', repository: 'org/proj/repo' });
            expect(result).toMatchObject({ success: false, code: 'credentials-missing' });
            expect(JSON.stringify(result)).not.toContain('secret-detail');
        });
    });

    describe('repository probe', () => {
        it.each([
            ['404', { status: 404 }, 'repository-not-found'],
            ['401', { status: 401 }, 'auth-failed'],
            ['403', { status: 403 }, 'auth-failed'],
            ['403 rate limit', { status: 403, response: { headers: { 'x-ratelimit-remaining': '0' } } }, 'provider-unavailable'],
            ['429', { status: 429 }, 'provider-unavailable'],
            ['500', { status: 500 }, 'provider-unavailable'],
            ['network', new Error('ECONNRESET'), 'provider-unavailable'],
        ])('maps a GitHub %s to %s', async (_label, failure, code) => {
            const { tool } = make(vi.fn(async () => stubClient(async () => { throw toPrQueryError(failure, 'github', 'repository'); })));
            expect(await invoke(tool, { provider: 'github', repository: 'o/missing' })).toMatchObject({ success: false, code });
        });

        it('probes the caller-named repository once per call', async () => {
            const client = stubClient();
            const createClient = vi.fn(async () => client);
            const { tool } = make(createClient);
            await invoke(tool, { provider: 'ado', repository: 'Org/Proj/Repo', ids: [1, 2] });
            expect(createClient).toHaveBeenCalledTimes(1);
            expect(createClient.mock.calls[0][0]).toEqual({ provider: 'ado', repository: 'Org/Proj/Repo', organization: 'Org', project: 'Proj', repo: 'Repo' });
            expect(client.probeRepository).toHaveBeenCalledTimes(1);
        });

        it('never echoes provider messages, tokens or bodies', async () => {
            const failure = Object.assign(new Error('Bad credentials ghp_secret123'), {
                status: 401, response: { data: { message: 'ghp_secret123' }, headers: { authorization: 'token ghp_secret123' } },
            });
            const { tool } = make(vi.fn(async () => stubClient(async () => { throw toPrQueryError(failure, 'github', 'repository'); })));
            const result = await invoke(tool, { provider: 'github', repository: 'o/r' });
            expect(result.code).toBe('auth-failed');
            expect(JSON.stringify(result)).not.toContain('ghp_secret123');
        });

        it('sanitizes unexpected client failures', async () => {
            const { tool } = make(vi.fn(async () => stubClient(async () => { throw new TypeError('boom token=abc'); })));
            const result = await invoke(tool, { provider: 'github', repository: 'o/r' });
            expect(result).toMatchObject({ success: false, code: 'provider-unavailable' });
            expect(JSON.stringify(result)).not.toContain('token=abc');
        });
    });

    it('returns get-mode results in input order as JSON', async () => {
        const client = stubClient();
        const { tool } = make(vi.fn(async () => client));
        const result = await invoke(tool, { provider: 'github', repository: 'o/r', ids: [2, 1, 2] });
        expect(result).toMatchObject({ success: true, mode: 'get', provider: 'github', repository: 'o/r' });
        expect(result.results.map((r: any) => [r.id, r.ok])).toEqual([[2, true], [1, true], [2, true]]);
        expect(client.getPullRequest).toHaveBeenCalledTimes(2);
    });

    it('returns a query-mode page as JSON', async () => {
        const client = stubClient();
        vi.mocked(client.listPullRequests).mockResolvedValue({
            items: [{
                id: 5, title: 'Fix', url: 'https://github.com/o/r/pull/5', author: { login: 'octocat' }, lifecycle: 'open',
                isDraft: false, sourceBranch: 'fix', targetBranch: 'main', ci: { state: 'passing', counts: { success: 1, failure: 0, pending: 0, other: 0 } },
            }],
        });
        const { tool } = make(vi.fn(async () => client));
        const result = await invoke(tool, { provider: 'github', repository: 'o/r', limit: 5 });
        expect(result).toMatchObject({
            success: true, mode: 'query', provider: 'github', repository: 'o/r', filters: { status: 'open' },
            items: [{ id: 5, ci: { state: 'passing' } }], scan: { truncated: false, candidatesScanned: 1 }, ciUnavailableExcluded: 0,
        });
        expect(result.nextCursor).toBeUndefined();
    });

    describe('cancellation', () => {
        it('returns cancelled without provider I/O when the signal is already aborted', async () => {
            const { tool, createClient } = make();
            const controller = new AbortController();
            controller.abort();
            expect(await invoke(tool, { provider: 'github', repository: 'o/r' }, controller.signal))
                .toMatchObject({ success: false, code: 'cancelled' });
            expect(createClient).not.toHaveBeenCalled();
        });

        it('returns cancelled as soon as the signal aborts mid-request and discards the late result', async () => {
            let release!: () => void;
            const probe = new Promise<void>(resolve => { release = resolve; });
            const client = stubClient(() => probe);
            const { tool } = make(vi.fn(async () => client));
            const controller = new AbortController();
            const pending = invoke(tool, { provider: 'github', repository: 'o/r' }, controller.signal);
            await vi.waitFor(() => expect(client.probeRepository).toHaveBeenCalled());
            controller.abort();
            expect(await pending).toMatchObject({ success: false, code: 'cancelled' });
            release();
        });
    });
});
