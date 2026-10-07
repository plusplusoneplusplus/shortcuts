import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CopilotSDKService } from '@plusplusoneplusplus/coc-agent-sdk';
import { CopilotDecisionBackend } from '../../../src/server/decisions/copilot-decision-backend';
import { validateDecisionRequest } from '../../../src/server/decisions/decision-validation';
import { createDecisionService } from '../../../src/server/decisions/decision-service';
import { createSystemOneTool } from '../../../src/server/llm-tools/system-one-tool';
import { TitleGenerationService } from '../../../src/server/executors/title-generator';
import { rankAndCacheSuggestions } from '../../../src/server/repos/pr-suggestions';

const model = 'gpt-5.4-mini';
const valid = JSON.stringify({ answers: { ok: { type: 'noul', value: 0.9 } } });
const body = { state: 'workspace A source', questions: { ok: { type: 'noul', instructions: 'Is this safe?' } } };
const context = { workspaceId: 'ws-A', workingDirectory: '/repo/A' };
let server: Server;
let service: CopilotSDKService;
let dir: string;
let requests: { path: string; body: any }[];
let complete: (data: any, res: ServerResponse) => void;
function response(text: string, extra: Record<string, unknown> = {}) {
    return { model: 'gpt-5.4-mini-2026-03-17', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 2 } }, ...extra };
}
function json(res: ServerResponse, data: unknown) { res.end(JSON.stringify(data)); }
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'direct-copilot-products-')); requests = [];
    complete = (_data, res) => json(res, response(valid));
    server = createServer(async (req, res) => {
        let text = ''; for await (const chunk of req) text += chunk;
        const data = text ? JSON.parse(text) : undefined; requests.push({ path: req.url!, body: data });
        if (req.url === '/models') json(res, { data: [{ id: model, supported_endpoints: ['/responses'] }, { id: 'gpt-4.1', supported_endpoints: ['/chat/completions'] }] });
        else complete(data, res);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    service = new CopilotSDKService({ transformTransport: 'direct', direct: { endpoint, endpointPolicy: url => url.origin === endpoint,
        credential: { source: 'resolver', resolve: async () => ({ host: 'github.com', login: 'test', token: 'gho_test' }) } } });
    vi.spyOn(service, 'isAvailable').mockImplementation(() => { throw new Error('Agent readiness must not run'); });
    vi.spyOn(service, 'createClient').mockImplementation(() => { throw new Error('Copilot must not spawn'); });
});
afterEach(async () => { service.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('direct Copilot product integration', () => {
    it('system_one uses direct readiness and HTTP with denied permissions and existing output schema', async () => {
        const { tool } = createSystemOneTool({ service: createDecisionService(service), ...context, getLedger: () => ({ list: async () => [] } as any) });
        const args = { sources: [{ text: 'workspace A source' }], questions: body.questions };
        const raw = await tool.handler!(args, { sessionId: 's', toolCallId: 't', toolName: 'system_one', arguments: args });
        expect(JSON.parse(raw as string)).toMatchObject({ model, answers: { ok: { type: 'noul', value: 0.9 } }, sources: [{ ref: 'text' }] });
        expect(requests.map(r => r.path)).toEqual(['/models', '/responses']); expect(service.createClient).not.toHaveBeenCalled(); expect(service.isAvailable).not.toHaveBeenCalled();
    });
    it('repairs only successful malformed decision text once, summing known usage without fabricating cache writes', async () => {
        let count = 0; complete = (_data, res) => json(res, response(++count === 1 ? 'not JSON' : valid));
        const result = await new CopilotDecisionBackend(service).evaluate(validateDecisionRequest(body), context);
        expect(result.metadata.attempts).toBe(2); expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
        expect(requests.filter(r => r.path === '/responses')).toHaveLength(2);
    });
    it.each(['model', 'usage', 'auth', 'protocol'])('does not repair %s transport failures', async failure => {
        complete = (_data, res) => {
            if (failure === 'auth') { res.statusCode = 401; json(res, {}); }
            else json(res, response(valid, failure === 'model' ? { model: 'gpt-5.4-mini-2099-01-01' }
                : failure === 'usage' ? { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 99 } } : { status: 'incomplete' }));
        };
        const error = await new CopilotDecisionBackend(service).evaluate(validateDecisionRequest(body), context).catch(e => e);
        expect(error).toMatchObject({ code: 'DECISION_UPSTREAM_FAILED', details: { providerErrorCode: expect.stringMatching(/^DIRECT_/), inferenceDispatched: true } });
        expect(requests.filter(r => r.path === '/responses')).toHaveLength(1);
    });
    it('system_one preserves the provider failure category in its error details', async () => {
        complete = (_data, res) => { res.statusCode = 429; json(res, {}); };
        const { tool } = createSystemOneTool({ service: createDecisionService(service), ...context, getLedger: () => ({ list: async () => [] } as any) });
        const args = { sources: [{ text: 'source' }], questions: body.questions };
        const raw = await tool.handler!(args, { sessionId: 's', toolCallId: 't', toolName: 'system_one', arguments: args });
        expect(JSON.parse(raw as string)).toMatchObject({ error: 'DECISION_UPSTREAM_FAILED', details: { providerErrorCode: 'DIRECT_RATE_LIMITED' } });
    });
    it('concurrent workspace decisions preserve distinct source content and cancellation', async () => {
        let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
        complete = (data, res) => { if (data.input[0].content.includes('workspace A source')) ready(); else json(res, response(valid)); };
        const controller = new AbortController();
        const first = new CopilotDecisionBackend(service).evaluate(validateDecisionRequest(body), { ...context, signal: controller.signal }).catch(e => e);
        const second = new CopilotDecisionBackend(service).evaluate(validateDecisionRequest({ ...body, state: 'workspace B source' }), { workspaceId: 'ws-B', workingDirectory: '/repo/B' });
        await started; controller.abort(); expect(await first).toMatchObject({ code: 'DECISION_CANCELLED' });
        expect((await second).answers.ok).toMatchObject({ value: 0.9 });
        const prompts = requests.filter(r => r.path === '/responses').map(r => r.body.input[0].content);
        expect(prompts).toHaveLength(2); expect(prompts.some(p => p.includes('workspace A source') && p.includes('workspace B source'))).toBe(false);
    });
    it.each(['gpt-5.4-mini', 'gpt-5.4-mini-2026-03-17'])('titles accept reviewed identity %s through the transport', async reportedModel => {
        complete = (_data, res) => json(res, response('Useful Title', { model: reportedModel }));
        const title = new TitleGenerationService({ store: {} as any, aiService: service });
        expect(await (title as any).generateTitle('title prompt')).toBe('Useful Title');
    });
    it.each([undefined, 'gpt-5.4-mini-2099-01-01', 'gpt-4.1'])('titles reject missing/unlisted/mismatched identity %s', async reportedModel => {
        complete = (_data, res) => json(res, response('Useful Title', { model: reportedModel }));
        const title = new TitleGenerationService({ store: {} as any, aiService: service });
        await expect((title as any).generateTitle('title prompt')).rejects.toThrow('model identity');
    });
    it('PR ranking selects Chat Completions and writes only workspace-scoped results', async () => {
        complete = (_data, res) => json(res, { model: 'gpt-4.1-2025-04-14', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify([{ prNumber: 1, score: 90 }]) } }] });
        const result = await rankAndCacheSuggestions(dir, 'ws-A', service, { fetchedAt: new Date().toISOString(), reviews: [] }, [{ number: 1, title: 'Fix', author: { id: 'test', displayName: 'Test' }, reviewers: [], filesChanged: [], labels: [], description: '' }] as any);
        expect(requests.map(r => r.path)).toEqual(['/models', '/chat/completions']); expect(result.suggestions).toHaveLength(1);
    });
    it('missing explicit transform readiness fails the contract without calling generic agent availability', async () => {
        const isAvailable = vi.fn(async () => ({ available: true }));
        const invalid = { isAvailable, transform: vi.fn() } as any;
        await expect(new CopilotDecisionBackend(invalid).evaluate(validateDecisionRequest(body), context)).rejects.toMatchObject({ code: 'DECISION_BACKEND_UNAVAILABLE' });
        expect(isAvailable).not.toHaveBeenCalled(); expect(invalid.transform).not.toHaveBeenCalled();
    });
});
