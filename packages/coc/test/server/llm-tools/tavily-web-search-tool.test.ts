/**
 * Tavily Web Search Tool Tests
 *
 * Validates the caller side of `createTavilyWebSearchTool` against:
 *   - schema/shape assertions
 *   - key resolution (options + providers.json + missing)
 *   - request body construction (defaults, custom args, clamping)
 *   - response mapping (incl. raw_content stripping)
 *   - error envelopes (non-2xx, timeout, missing key)
 *
 * Most tests use a mocked `fetchImpl` for deterministic body inspection. A final
 * end-to-end test runs against the in-process mock Tavily HTTP server in
 * `./tavily-mock-server.ts` to prove the wire-level contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    createTavilyWebSearchTool,
    type TavilyWebSearchSuccess,
    type TavilyWebSearchError,
    type TavilyWebSearchResult,
} from '../../../src/server/llm-tools/tavily-web-search-tool';
import { startMockTavilyServer, type MockTavilyServer } from './tavily-mock-server';

// Minimal invocation stub (handler signature accepts a second arg from the SDK).
const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'tavily_web_search',
    arguments: {},
};

const TAVILY_RESPONSE = {
    query: 'react server components',
    answer: 'RSC are a feature shipped in React 18+.',
    results: [
        {
            title: 'React Docs',
            url: 'https://react.dev/rsc',
            content: 'RSC overview snippet…',
            score: 0.92,
            published_date: '2026-03-15',
            raw_content: 'Long full-page text for React docs.',
        },
        {
            title: 'Vercel Blog',
            url: 'https://vercel.com/blog/rsc',
            content: 'Why RSC matters…',
            score: 0.81,
            raw_content: 'Long full-page text for Vercel post.',
        },
    ],
};

function makeMockFetch(response: {
    status?: number;
    body?: unknown;
    throws?: Error;
}) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (response.throws) throw response.throws;
        const status = response.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => response.body ?? TAVILY_RESPONSE,
        } as unknown as Response;
    }) as unknown as typeof fetch & { calls: typeof calls };
    (fn as any).calls = calls;
    return fn as typeof fetch & { calls: typeof calls };
}

async function makeTmpDataDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'coc-tavily-test-'));
}

async function writeProvidersJson(dataDir: string, content: unknown): Promise<void> {
    await fs.writeFile(
        path.join(dataDir, 'providers.json'),
        JSON.stringify(content, null, 2),
        'utf8',
    );
}

// ============================================================================
// Schema / shape
// ============================================================================

describe('createTavilyWebSearchTool — shape', () => {
    it('returns a tool named "tavily_web_search" with description, params, handler', () => {
        const { tool } = createTavilyWebSearchTool({ dataDir: '/tmp', apiKey: 'k' });
        expect(tool.name).toBe('tavily_web_search');
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('parameters declare `query` as required and the optional fields', () => {
        const { tool } = createTavilyWebSearchTool({ dataDir: '/tmp', apiKey: 'k' });
        const params = tool.parameters as Record<string, any>;
        expect(params.type).toBe('object');
        expect(params.required).toEqual(['query']);
        const props = params.properties as Record<string, unknown>;
        for (const key of [
            'query',
            'searchDepth',
            'topic',
            'maxResults',
            'includeAnswer',
            'includeRawContent',
            'includeDomains',
            'excludeDomains',
            'days',
        ]) {
            expect(props[key], `missing property: ${key}`).toBeDefined();
        }
    });
});

// ============================================================================
// Key resolution
// ============================================================================

describe('createTavilyWebSearchTool — key resolution', () => {
    let tmpDir: string;
    beforeEach(async () => { tmpDir = await makeTmpDataDir(); });
    afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    it('uses options.apiKey when provided (skips providers.json read)', async () => {
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({
            dataDir: tmpDir,
            apiKey: 'override-key',
            fetchImpl,
        });
        await tool.handler({ query: 'q' }, invocationStub);
        const body = JSON.parse(((fetchImpl as any).calls[0].init.body) as string);
        expect(body.api_key).toBe('override-key');
    });

    it('falls back to providers.json → providers.tavily.apiKey', async () => {
        await writeProvidersJson(tmpDir, {
            providers: { tavily: { apiKey: 'from-disk' } },
        });
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({ dataDir: tmpDir, fetchImpl });
        await tool.handler({ query: 'q' }, invocationStub);
        const body = JSON.parse(((fetchImpl as any).calls[0].init.body) as string);
        expect(body.api_key).toBe('from-disk');
    });

    it('returns error envelope and does NOT call fetch when no key is configured', async () => {
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({ dataDir: tmpDir, fetchImpl });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchError;
        expect(result.error).toMatch(/not configured/i);
        expect((fetchImpl as any).calls.length).toBe(0);
    });

    it('treats empty providers.tavily.apiKey as missing', async () => {
        await writeProvidersJson(tmpDir, { providers: { tavily: { apiKey: '' } } });
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({ dataDir: tmpDir, fetchImpl });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchError;
        expect(result.error).toMatch(/not configured/i);
        expect((fetchImpl as any).calls.length).toBe(0);
    });
});

// ============================================================================
// Request body construction
// ============================================================================

describe('createTavilyWebSearchTool — request body', () => {
    it('uses sensible defaults: search_depth=basic, topic=general, max_results=5, include_answer=true, include_raw_content=false', async () => {
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        await tool.handler({ query: 'hello world' }, invocationStub);
        const call = (fetchImpl as any).calls[0];
        expect(call.url).toBe('https://api.tavily.com/search');
        expect(call.init.method).toBe('POST');
        expect(call.init.headers['Content-Type']).toBe('application/json');
        const body = JSON.parse(call.init.body as string);
        expect(body).toMatchObject({
            api_key: 'k',
            query: 'hello world',
            search_depth: 'basic',
            topic: 'general',
            max_results: 5,
            include_answer: true,
            include_raw_content: false,
        });
        expect(body.include_domains).toBeUndefined();
        expect(body.exclude_domains).toBeUndefined();
        expect(body.days).toBeUndefined();
    });

    it('passes through explicit args (depth, topic, domains, days, raw)', async () => {
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        await tool.handler(
            {
                query: 'recent js news',
                searchDepth: 'advanced',
                topic: 'news',
                maxResults: 10,
                includeAnswer: false,
                includeRawContent: true,
                includeDomains: ['developer.mozilla.org'],
                excludeDomains: ['spam.example'],
                days: 7,
            },
            invocationStub,
        );
        const body = JSON.parse(((fetchImpl as any).calls[0].init.body) as string);
        expect(body).toMatchObject({
            search_depth: 'advanced',
            topic: 'news',
            max_results: 10,
            include_answer: false,
            include_raw_content: true,
            include_domains: ['developer.mozilla.org'],
            exclude_domains: ['spam.example'],
            days: 7,
        });
    });

    it('drops `days` when topic !== "news"', async () => {
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        await tool.handler(
            { query: 'q', topic: 'general', days: 3 },
            invocationStub,
        );
        const body = JSON.parse(((fetchImpl as any).calls[0].init.body) as string);
        expect(body.days).toBeUndefined();
    });

    it('clamps maxResults into [1, 20]', async () => {
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        await tool.handler({ query: 'q', maxResults: 0 }, invocationStub);
        await tool.handler({ query: 'q', maxResults: 999 }, invocationStub);
        const calls = (fetchImpl as any).calls as Array<{ init: { body: string } }>;
        expect(JSON.parse(calls[0].init.body).max_results).toBe(1);
        expect(JSON.parse(calls[1].init.body).max_results).toBe(20);
    });

    it('returns error envelope for empty query and skips fetch', async () => {
        const fetchImpl = makeMockFetch({});
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        const result = (await tool.handler(
            { query: '   ' },
            invocationStub,
        )) as TavilyWebSearchError;
        expect(result.error).toMatch(/non-empty/);
        expect((fetchImpl as any).calls.length).toBe(0);
    });
});

// ============================================================================
// Response mapping
// ============================================================================

describe('createTavilyWebSearchTool — response mapping', () => {
    it('maps results to {title, url, snippet, score, publishedDate?} and keeps the answer', async () => {
        const fetchImpl = makeMockFetch({ body: TAVILY_RESPONSE });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        const result = (await tool.handler(
            { query: 'react server components' },
            invocationStub,
        )) as TavilyWebSearchSuccess;
        expect(result.query).toBe('react server components');
        expect(result.answer).toBe(TAVILY_RESPONSE.answer);
        expect(result.totalResults).toBe(2);
        expect(result.results[0]).toEqual({
            title: 'React Docs',
            url: 'https://react.dev/rsc',
            snippet: 'RSC overview snippet…',
            score: 0.92,
            publishedDate: '2026-03-15',
        });
        expect(result.results[1].publishedDate).toBeUndefined();
    });

    it('strips raw_content by default', async () => {
        const fetchImpl = makeMockFetch({ body: TAVILY_RESPONSE });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchSuccess;
        for (const r of result.results) {
            expect(r.rawContent).toBeUndefined();
        }
    });

    it('keeps rawContent when includeRawContent=true', async () => {
        const fetchImpl = makeMockFetch({ body: TAVILY_RESPONSE });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        const result = (await tool.handler(
            { query: 'q', includeRawContent: true },
            invocationStub,
        )) as TavilyWebSearchSuccess;
        expect(result.results[0].rawContent).toBe('Long full-page text for React docs.');
        expect(result.results[1].rawContent).toBe('Long full-page text for Vercel post.');
    });

    it('handles a payload with no answer / empty results gracefully', async () => {
        const fetchImpl = makeMockFetch({ body: { results: [] } });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchSuccess;
        expect(result.answer).toBeUndefined();
        expect(result.totalResults).toBe(0);
        expect(result.results).toEqual([]);
    });
});

// ============================================================================
// Error envelopes
// ============================================================================

describe('createTavilyWebSearchTool — errors', () => {
    it('returns {error, status} on non-2xx', async () => {
        const fetchImpl = makeMockFetch({
            status: 401,
            body: { error: 'invalid api key' },
        });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchError;
        expect(result.error).toBe('invalid api key');
        expect(result.status).toBe(401);
    });

    it('returns error envelope on AbortError (timeout)', async () => {
        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';
        const fetchImpl = makeMockFetch({ throws: abortErr });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
            timeoutMs: 100,
        });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchError;
        expect(result.error).toMatch(/timed out/i);
    });

    it('returns generic error envelope on fetch throw (network)', async () => {
        const fetchImpl = makeMockFetch({ throws: new Error('ECONNREFUSED') });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            fetchImpl,
        });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchError;
        expect(result.error).toMatch(/ECONNREFUSED/);
    });
});

// ============================================================================
// End-to-end via mock Tavily HTTP server
// ============================================================================

describe('createTavilyWebSearchTool — integration with mock Tavily server', () => {
    let mock: MockTavilyServer;

    beforeEach(async () => {
        mock = await startMockTavilyServer();
    });

    afterEach(async () => {
        await mock.close();
    });

    it('hits POST {baseUrl}/search with the right body and parses the response', async () => {
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'integration-key',
            baseUrl: mock.baseUrl,
        });
        const result = (await tool.handler(
            { query: 'mock query', searchDepth: 'advanced', maxResults: 3 },
            invocationStub,
        )) as TavilyWebSearchResult;

        expect('error' in result).toBe(false);
        const success = result as TavilyWebSearchSuccess;
        expect(success.totalResults).toBe(2);
        expect(success.answer).toBe('Mock Tavily answer.');
        expect(success.results[0].title).toBe('Mock Result 1');
        expect(success.results[0].snippet).toBe('First mock snippet.');
        expect(success.results[0].rawContent).toBeUndefined();

        expect(mock.requests.length).toBe(1);
        const req = mock.requests[0];
        expect(req.method).toBe('POST');
        expect(req.url).toBe('/search');
        expect(req.body).toMatchObject({
            api_key: 'integration-key',
            query: 'mock query',
            search_depth: 'advanced',
            max_results: 3,
            include_answer: true,
            include_raw_content: false,
        });
    });

    it('surfaces a non-2xx mock response as an error envelope', async () => {
        mock.setResponse({ status: 500, payload: { error: 'mock boom' } });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            baseUrl: mock.baseUrl,
        });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchError;
        expect(result.status).toBe(500);
        expect(result.error).toBe('mock boom');
    });

    it('times out when the mock server delays past timeoutMs', async () => {
        mock.setResponse({ delayMs: 200 });
        const { tool } = createTavilyWebSearchTool({
            dataDir: '/tmp',
            apiKey: 'k',
            baseUrl: mock.baseUrl,
            timeoutMs: 50,
        });
        const result = (await tool.handler(
            { query: 'q' },
            invocationStub,
        )) as TavilyWebSearchError;
        expect(result.error).toMatch(/timed out/i);
    });
});
