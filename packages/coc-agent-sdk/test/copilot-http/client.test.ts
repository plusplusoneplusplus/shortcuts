import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CopilotHttpClient, type CopilotHttpConfig, type CopilotCompletionInput } from '../../src/copilot-http';
import { MAX_DIRECT_REQUEST_BYTES, MAX_DIRECT_RESPONSE_BYTES } from '../../src/copilot-http/transport';
import { serializeCompletion, parseCompletion } from '../../src/copilot-http/wire-adapters';
import { COPILOT_HTTP_BINDINGS } from '../../src/copilot-http/config';
import { validateCatalog } from '../../src/copilot-http/catalog';

const model = 'gpt-5.4-mini';
const catalog = { data: [
    { id: model, supported_endpoints: ['/responses'], policy: { state: 'enabled' } },
    { id: 'gpt-4.1', supported_endpoints: ['/chat/completions'] },
] };
const input = (text = 'hello'): CopilotCompletionInput => ({ model, api: 'responses', messages: [{ role: 'user', content: text }] });
const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 } };
const answer = (text = 'answer'): any => ({ model: 'gpt-5.4-mini-2026-03-17', status: 'completed',
    output: [{ type: 'reasoning', encrypted_content: 'private' }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }], usage });
const chatAnswer = (): any => ({ model: 'gpt-4.1-2025-04-14', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'chat answer' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 } } });

let server: Server;
let base: string;
let client: CopilotHttpClient;
let handler: (req: IncomingMessage, res: ServerResponse, body: any) => void;
let calls: { path: string; method: string; headers: IncomingMessage['headers']; body: any }[];
let resolveCredential: ReturnType<typeof vi.fn>;
const json = (res: ServerResponse, value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
function config(extra: Partial<CopilotHttpConfig> = {}): CopilotHttpConfig {
    return { endpoint: base, endpointPolicy: url => url.origin === base, credential: { source: 'resolver', resolve: resolveCredential }, ...extra };
}
beforeEach(async () => {
    calls = [];
    resolveCredential = vi.fn(async () => ({ token: 'gho_fake_test', host: 'github.com', login: 'test' }));
    handler = (req, res, body) => json(res, req.url === '/models' ? catalog : req.url === '/responses' ? answer(body.input[0].content) : chatAnswer());
    server = createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : undefined;
        calls.push({ path: req.url!, method: req.method!, headers: req.headers, body });
        handler(req, res, body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    client = new CopilotHttpClient(config());
});
afterEach(async () => {
    client.dispose(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.restoreAllMocks();
});

describe('real buffered HTTP', () => {
    it('uses the default Luna Responses binding and verifies its reported identity', async () => {
        const luna = 'gpt-6-luna';
        handler = (req, res) => json(res, req.url === '/models'
            ? { data: [{ id: luna, supported_endpoints: ['/responses'] }] }
            : { ...answer(), model: luna });
        const result = await client.complete({ ...input(), model: luna });
        expect(result).toMatchObject({ effectiveModel: luna, diagnostics: { transport: 'direct', reportedModel: luna } });
        expect(calls.map(c => c.path)).toEqual(['/models', '/responses']);
        expect(calls[1].body.model).toBe(luna);
    });
    it.each(['gpt-5.4-mini', 'gpt-6-luna-2099-01-01'])('rejects unreviewed Luna response identity %s', async reportedModel => {
        handler = (req, res) => json(res, req.url === '/models'
            ? { data: [{ id: 'gpt-6-luna', supported_endpoints: ['/responses'] }] }
            : { ...answer(), model: reportedModel });
        await expect(client.complete({ ...input(), model: 'gpt-6-luna' })).rejects.toMatchObject({ code: 'DIRECT_MODEL_MISMATCH' });
        expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    });
    it('uses Responses, verifies model identity, normalizes usage and preserves native billing units', async () => {
        handler = (req, res) => { res.setHeader('x-github-request-id', 'safe-id'); json(res, req.url === '/models' ? catalog : { ...answer(), copilot_usage: { total_nano_aiu: 123 } }); };
        const result = await client.complete({ ...input(), maxOutputTokens: 32, messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }],
            jsonSchema: { name: 'test', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } });
        expect(result).toMatchObject({ text: 'answer', effectiveModel: model, tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 2, cacheWriteTokens: 0, turnCount: 1 },
            diagnostics: { reportedModel: 'gpt-5.4-mini-2026-03-17', requestId: 'safe-id', totalNanoAiu: 123, transport: 'direct' } });
        expect(result.tokenUsage).not.toHaveProperty('cost'); expect(result.tokenUsage).not.toHaveProperty('tokenLimit');
        expect(calls.map(c => [c.method, c.path])).toEqual([['GET', '/models'], ['POST', '/responses']]);
        expect(calls[1].body).toMatchObject({ instructions: 'system', input: [{ role: 'user', content: 'hello' }], store: false, stream: false, model, max_output_tokens: 32, text: { format: { type: 'json_schema', strict: true } } });
        expect(calls[1].body).not.toHaveProperty('previous_response_id');
        expect(calls[1].headers).toMatchObject({ authorization: 'Bearer gho_fake_test', 'copilot-integration-id': 'copilot-developer-cli', 'user-agent': 'copilot/1.0.78', 'x-github-api-version': '2026-07-01' });
        expect(calls[0].headers['x-interaction-id']).not.toEqual(calls[1].headers['x-interaction-id']);
    });
    it('uses only Chat Completions for its explicit binding', async () => {
        const result = await client.complete({ ...input(), model: 'gpt-4.1', api: 'chat-completions', maxOutputTokens: 16 });
        expect(result.text).toBe('chat answer'); expect(result.effectiveModel).toBe('gpt-4.1');
        expect(calls[1].path).toBe('/chat/completions');
        expect(calls[1].body).toEqual({ model: 'gpt-4.1', stream: false, messages: input().messages, max_tokens: 16 });
    });
    it('maps explicitly configured Chat schema, reasoning and output-limit capabilities', async () => {
        client = new CopilotHttpClient(config({ bindings: { 'gpt-4.1': { ...COPILOT_HTTP_BINDINGS['gpt-4.1'], outputLimitField: 'max_completion_tokens', jsonSchema: true, reasoningEfforts: ['low'] } } }));
        handler = (req, res) => json(res, req.url === '/models' ? { data: [{ id: 'gpt-4.1', supported_endpoints: ['/chat/completions'], capabilities: { supports: { reasoning_effort: true } } }] } : chatAnswer());
        const messages = [{ role: 'system' as const, content: 'system' }, { role: 'user' as const, content: 'first' }, { role: 'assistant' as const, content: 'previous' }, { role: 'user' as const, content: 'last' }];
        await client.complete({ ...input(), model: 'gpt-4.1', api: 'chat-completions', messages, reasoningEffort: 'low', maxOutputTokens: 20,
            jsonSchema: { name: 'answer', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } });
        expect(calls[1].body).toMatchObject({ messages, reasoning_effort: 'low', max_completion_tokens: 20, response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true } } });
        expect(calls[1].body).not.toHaveProperty('max_tokens');
    });
    it('preserves known cache read usage when cache write counts are unavailable', async () => {
        handler = (req, res) => json(res, req.url === '/models' ? catalog : { ...answer(), usage: { ...usage, input_tokens_details: { cached_tokens: 2 } } });
        const result = await client.complete(input());
        expect(result.tokenUsage).toBeUndefined(); expect(result.diagnostics.tokenCounts).toMatchObject({ cacheReadTokens: 2, turnCount: 1 });
        expect(result.diagnostics.tokenCounts).not.toHaveProperty('cacheWriteTokens');
    });
    it('shares catalog acquisition, caches success and reads credentials every time', async () => {
        await Promise.all([client.complete(input('A')), client.complete(input('B'))]);
        const third = await client.complete(input('C'));
        expect(third.diagnostics.cacheHit).toBe(true);
        expect(calls.filter(c => c.path === '/models')).toHaveLength(1);
        expect(calls.filter(c => c.path === '/responses').map(c => c.body.input[0].content).sort()).toEqual(['A', 'B', 'C']);
        expect(resolveCredential).toHaveBeenCalledTimes(3);
    });
    it('invalidates the catalog after token/account changes, with stable in-flight credentials', async () => {
        let release!: () => void;
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        handler = (req, res, body) => {
            if (req.url === '/models' && req.headers.authorization === 'Bearer gho_fake_test') { started(); void gate.then(() => json(res, catalog)); }
            else json(res, req.url === '/models' ? catalog : answer(body.input[0].content));
        };
        const first = client.complete(input('A'));
        await ready;
        resolveCredential.mockResolvedValue({ token: 'gho_other', host: 'github.com', login: 'other' });
        expect((await client.complete(input('B'))).text).toBe('B'); release();
        expect((await first).text).toBe('A');
        expect(calls.filter(c => c.path === '/responses').map(c => [c.body.input[0].content, c.headers.authorization])).toEqual([['B', 'Bearer gho_other'], ['A', 'Bearer gho_fake_test']]);
    });
    it('does local readiness without any HTTP request', async () => {
        expect(await client.isAvailable(model)).toEqual({ available: true }); expect(calls).toHaveLength(0);
    });
    it.each([[401, 'DIRECT_AUTH_FAILED'], [403, 'DIRECT_POLICY_DENIED'], [429, 'DIRECT_RATE_LIMITED'], [500, 'DIRECT_UPSTREAM_FAILED']])('returns HTTP %s without replay or leaking error text', async (status, code) => {
        handler = (req, res) => {
            if (req.url === '/models') return json(res, catalog);
            res.statusCode = status as number; res.setHeader('Retry-After', '30'); res.setHeader('x-request-id', 'req-1');
            json(res, { error: { message: 'gho_secret prompt contents' } });
        };
        const error = await client.complete(input()).catch(e => e);
        expect(error).toMatchObject({ code, inferenceDispatched: true, requestId: 'req-1' });
        expect(error.message).not.toContain('secret'); expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
        expect(resolveCredential).toHaveBeenCalledTimes(1);
        if (status === 429) expect(error.message).toContain('Retry after 30 seconds');
    });
    it('invalidates cached catalog on 401 for a future explicitly requested operation', async () => {
        await client.complete(input());
        handler = (req, res) => { res.statusCode = req.url === '/models' ? 200 : 401; json(res, req.url === '/models' ? catalog : {}); };
        await expect(client.complete(input())).rejects.toMatchObject({ code: 'DIRECT_AUTH_FAILED' });
        handler = (req, res) => json(res, req.url === '/models' ? catalog : answer());
        await client.complete(input()); expect(calls.filter(c => c.path === '/models')).toHaveLength(2);
    });
    it.each(['redirect', 'disconnect', 'bad-json', 'unsupported-api'])('does not replay %s after inference dispatch', async mode => {
        handler = (req, res) => {
            if (req.url === '/models') return json(res, catalog);
            if (mode === 'redirect') { res.statusCode = 307; res.setHeader('Location', `${base}/other`); res.end(); }
            else if (mode === 'disconnect') req.socket.destroy();
            else if (mode === 'bad-json') res.end('{bad');
            else { res.statusCode = 400; json(res, { error: { code: 'unsupported_api_for_model' } }); }
        };
        await expect(client.complete(input())).rejects.toMatchObject({ inferenceDispatched: true });
        expect(calls.filter(c => c.method === 'POST')).toHaveLength(1); expect(calls.some(c => c.path === '/other')).toBe(false);
    });
    it('uses status categories even with malformed error JSON', async () => {
        handler = (req, res) => { if (req.url === '/models') return json(res, catalog); res.statusCode = 403; res.end('not-json'); };
        await expect(client.complete(input())).rejects.toMatchObject({ code: 'DIRECT_POLICY_DENIED' });
    });
    it.each(['headers', 'body'])('aborts stalled %s within the same deadline', async mode => {
        handler = (req, res) => {
            if (req.url === '/models') return json(res, catalog);
            if (mode === 'body') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); }
        };
        await expect(client.complete({ ...input(), timeoutMs: 60 })).rejects.toMatchObject({ code: 'DIRECT_TIMEOUT', inferenceDispatched: true });
        expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    });
    it('cancels one catalog waiter independently of its peer', async () => {
        let release!: () => void; let started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const ready = new Promise<void>(resolve => { started = resolve; });
        handler = (req, res, body) => { if (req.url === '/models') { started(); void gate.then(() => json(res, catalog)); } else json(res, answer(body.input[0].content)); };
        const controller = new AbortController();
        const one = client.complete({ ...input('A'), signal: controller.signal }).catch(e => e);
        const two = client.complete(input('B')); await ready; controller.abort(); release();
        expect(await one).toMatchObject({ code: 'DIRECT_CANCELLED', inferenceDispatched: false });
        expect((await two).text).toBe('B'); expect(calls.filter(c => c.path === '/models')).toHaveLength(1);
    });
    it('one caller cancellation does not abort concurrent inference', async () => {
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        handler = (req, res, body) => { if (req.url === '/models') json(res, catalog); else if (body.input[0].content === 'A') { started(); } else json(res, answer('B')); };
        const controller = new AbortController();
        const first = client.complete({ ...input('A'), signal: controller.signal }).catch(e => e);
        const second = client.complete(input('B')); await ready; controller.abort();
        expect(await first).toMatchObject({ code: 'DIRECT_CANCELLED', inferenceDispatched: true }); expect((await second).text).toBe('B');
    });
    it('rejects oversized chunked bodies without relying on Content-Length', async () => {
        handler = (req, res) => { if (req.url === '/models') return json(res, catalog); res.write('"'); res.end('x'.repeat(MAX_DIRECT_RESPONSE_BYTES)); };
        await expect(client.complete(input())).rejects.toMatchObject({ code: 'DIRECT_INVALID_RESPONSE' });
    });
    it('rejects oversized requests before credential acquisition', async () => {
        await expect(client.complete(input('x'.repeat(MAX_DIRECT_REQUEST_BYTES)))).rejects.toMatchObject({ code: 'DIRECT_NOT_ELIGIBLE', inferenceDispatched: false });
        expect(resolveCredential).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
    });
    it('already-aborted calls and invalid options do no external work', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(client.complete({ ...input(), signal: controller.signal })).rejects.toMatchObject({ code: 'DIRECT_CANCELLED' });
        await expect(client.complete({ ...input(), api: 'chat-completions' })).rejects.toMatchObject({ code: 'DIRECT_UNSUPPORTED_MODEL' });
        await expect(client.complete({ ...input(), model: 'unknown' })).rejects.toMatchObject({ code: 'DIRECT_UNSUPPORTED_MODEL' });
        expect(calls).toHaveLength(0); expect(resolveCredential).not.toHaveBeenCalled();
    });
    it('rejects unapproved endpoints before reading credentials', async () => {
        client = new CopilotHttpClient(config({ endpointPolicy: undefined }));
        await expect(client.complete(input())).rejects.toMatchObject({ code: 'DIRECT_UNSUPPORTED_HOST' });
        expect(resolveCredential).not.toHaveBeenCalled();
    });
    it('bounds uncooperative credential acquisition by the overall deadline', async () => {
        resolveCredential.mockImplementation(() => new Promise(() => {}));
        await expect(client.complete({ ...input(), timeoutMs: 20 })).rejects.toMatchObject({ code: 'DIRECT_TIMEOUT', inferenceDispatched: false }); expect(calls).toHaveLength(0);
    });
    it('rejects catalog contradictions, invalid metadata and denied policy before POST', async () => {
        for (const [data, code] of [[{ data: [{ id: model, supported_endpoints: ['/chat/completions'] }] }, 'DIRECT_UNSUPPORTED_MODEL'],
            [{ data: [] }, 'DIRECT_UNSUPPORTED_MODEL'], [{ data: [{ id: model, policy: { state: 'disabled' } }] }, 'DIRECT_POLICY_DENIED'], [{ invalid: [] }, 'DIRECT_INVALID_RESPONSE']] as const) {
            client.cleanup(); handler = (_req, res) => json(res, data);
            await expect(client.complete(input())).rejects.toMatchObject({ code, inferenceDispatched: false });
        }
        expect(calls.some(c => c.method === 'POST')).toBe(false);
    });
    it('expires successful metadata and never uses stale data after refresh fails', async () => {
        let now = 0; client = new CopilotHttpClient(config({ now: () => now }));
        await client.complete(input()); now = 300_001;
        handler = (req, res) => { res.statusCode = 500; json(res, {}); };
        await expect(client.complete(input())).rejects.toMatchObject({ code: 'DIRECT_UPSTREAM_FAILED', inferenceDispatched: false });
        expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    });
    it('cleanup aborts active work, clears metadata and allows future requests; disposal prevents work', async () => {
        await client.complete(input());
        let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
        handler = () => started(); const pending = client.complete(input()).catch(e => e);
        await ready; client.cleanup(); expect(await pending).toMatchObject({ code: 'DIRECT_CANCELLED' });
        handler = (req, res) => json(res, req.url === '/models' ? catalog : answer()); await client.complete(input());
        expect(calls.filter(c => c.path === '/models')).toHaveLength(2);
        client.dispose(); await expect(client.complete(input())).rejects.toMatchObject({ code: 'DIRECT_CANCELLED' });
    });
});

describe('wire validation', () => {
    const binding = COPILOT_HTTP_BINDINGS[model];
    it.each(['', 'gpt-5.4-mini-2099-01-01', 'gpt-5.4', 'gpt-4.1', undefined])('rejects unverified reported model %s', reported => {
        expect(() => parseCompletion({ ...answer(), model: reported }, input(), binding)).toThrow(expect.objectContaining({ code: 'DIRECT_MODEL_MISMATCH' }));
    });
    it.each(['incomplete', 'failed', 'in_progress'])('rejects Responses status %s', status => {
        expect(() => parseCompletion({ ...answer(), status }, input(), binding)).toThrow(expect.objectContaining({ code: 'DIRECT_INVALID_RESPONSE' }));
    });
    it.each([
        { output: [] }, { output: [{ type: 'function_call', arguments: 'secret' }] },
        { output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }] }] },
        { usage: { ...usage, total_tokens: 16 } }, { usage: { ...usage, input_tokens: -1 } },
        { usage: { ...usage, output_tokens: '5' } }, { usage: { ...usage, input_tokens_details: { cached_tokens: 11 } } },
    ])('rejects malformed response %#', patch => {
        expect(() => parseCompletion({ ...answer(), ...patch }, input(), binding)).toThrow(expect.objectContaining({ code: 'DIRECT_INVALID_RESPONSE' }));
    });
    it('preserves usage absence and unknown cache counts without synthesizing zeros', () => {
        expect(parseCompletion({ ...answer(), usage: undefined }, input(), binding)).toMatchObject({ usageUnavailableReason: expect.any(String) });
        const parsed = parseCompletion({ ...answer(), usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }, input(), binding);
        expect(parsed.tokenUsage).toBeUndefined();
        expect(parsed.tokenCounts).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15, turnCount: 1 });
        expect(parsed.usageUnavailableReason).toContain('cache');
    });
    it('ignores unrelated choices and extracts only the first completed assistant choice', () => {
        const response = chatAnswer(); response.choices.push({ message: { content: 'private' } });
        expect(parseCompletion(response, { ...input(), model: 'gpt-4.1', api: 'chat-completions' }, COPILOT_HTTP_BINDINGS['gpt-4.1']).text).toBe('chat answer');
        response.choices[0].finish_reason = 'length';
        expect(() => parseCompletion(response, { ...input(), model: 'gpt-4.1', api: 'chat-completions' }, COPILOT_HTTP_BINDINGS['gpt-4.1'])).toThrow();
    });
    it('rejects late system messages, schema/reasoning unsupported options and agent inputs', () => {
        for (const patch of [{ messages: [{ role: 'user', content: 'hi' }, { role: 'system', content: 'late' }] }, { reasoningEffort: 'high' },
            { tools: [] }, { previous_response_id: 'id' }, { messages: [{ role: 'user', content: [{ type: 'image', url: 'file' }] }] },
            { maxOutputTokens: 0 }, { jsonSchema: { name: 'test', strict: true, schema: { type: 'string', pattern: '.*' } } }])
            expect(() => serializeCompletion({ ...input(), ...patch } as any, binding)).toThrow();
    });
    it('unknown endpoint metadata requires the explicit binding, never grants arbitrary protocol support', () => {
        expect(() => validateCatalog({ data: [{ id: model }] }, model, binding)).not.toThrow();
        expect(() => validateCatalog(catalog, model, { ...binding, api: 'chat-completions' })).toThrow();
    });
});
