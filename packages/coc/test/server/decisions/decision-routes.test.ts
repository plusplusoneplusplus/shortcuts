import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { ISDKService } from '@plusplusoneplusplus/forge';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { createRouter } from '../../../src/server/shared/router';
import { registerDecisionRoutes } from '../../../src/server/decisions/decision-routes';
import { DecisionService } from '../../../src/server/decisions/decision-service';
import { COPILOT_DECISION_MODEL, CopilotDecisionBackend } from '../../../src/server/decisions/copilot-decision-backend';
import { TypeSafeDecisionBackend } from '../../../src/server/decisions/typesafe-decision-backend';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { Route } from '../../../src/server/types';

const body = {
    state: { note: 'hi' },
    questions: { ok: { type: 'noul', instructions: 'Is it fine?' } },
};

function answerFor(value: number) {
    return { success: true, text: JSON.stringify({ answers: { ok: { type: 'noul', value } } }), effectiveModel: COPILOT_DECISION_MODEL };
}

describe('decision routes', () => {
    let server: http.Server;
    let baseUrl: string;
    let transform: ReturnType<typeof vi.fn>;
    let isAvailable: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        transform = vi.fn(async () => answerFor(0.7));
        isAvailable = vi.fn().mockResolvedValue({ available: true });
        const copilot = { transform, isAvailable } as unknown as ISDKService;
        const routes: Route[] = [];
        registerDecisionRoutes({
            routes,
            store: createMockProcessStore({
                initialWorkspaces: [
                    { id: 'ws-one', name: 'One', rootPath: '/repo/one' },
                    { id: 'ws two/é', name: 'Two', rootPath: '/repo/two' },
                ],
            }),
            service: new DecisionService([new CopilotDecisionBackend(copilot), new TypeSafeDecisionBackend()]),
            maxBodyBytes: 4096,
        });
        server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    async function post(workspaceId: string, payload: unknown): Promise<{ status: number; body: any }> {
        const response = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/decisions/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: typeof payload === 'string' ? payload : JSON.stringify(payload),
        });
        return { status: response.status, body: await response.json() };
    }

    it('resolves the workspace and uses its root as cwd with no MCP or permission approval', async () => {
        const res = await post('ws-one', body);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ model: 'gpt-5.4-mini', backend: 'copilot', answers: { ok: { type: 'noul', value: 0.7 } } });
        expect(transform).toHaveBeenCalledTimes(1);
        const options = transform.mock.calls[0][1];
        expect(options).toMatchObject({ model: 'gpt-5.4-mini', cwd: '/repo/one', loadDefaultMcpConfig: false });
        expect(options.onPermissionRequest({ kind: 'write' }, { sessionId: 's' })).toEqual({ kind: 'reject' });
    });

    it('returns 404 for an unknown workspace without calling Copilot', async () => {
        const res = await post('missing', body);
        expect(res.status).toBe(404);
        expect(transform).not.toHaveBeenCalled();
    });

    it('keeps cwd and answers separate for two concurrent workspaces', async () => {
        const releases: Array<() => void> = [];
        transform.mockImplementation((_prompt: string, options: { cwd: string }) => new Promise(resolve => {
            releases.push(() => resolve(answerFor(options.cwd === '/repo/one' ? 0.1 : 0.9)));
            // Release in reverse arrival order once both calls are in flight.
            if (releases.length === 2) releases.reverse().forEach(release => release());
        }));
        const [one, two] = await Promise.all([post('ws-one', body), post('ws two/é', body)]);
        expect(one.body.answers.ok.value).toBe(0.1);
        expect(two.body.answers.ok.value).toBe(0.9);
        expect(transform.mock.calls.map(call => call[1].cwd).sort()).toEqual(['/repo/one', '/repo/two']);
    });

    it('maps request errors: invalid JSON 400, contract violation 400, oversized body 413', async () => {
        expect((await post('ws-one', '{not json')).status).toBe(400);
        const invalid = await post('ws-one', { state: 's', questions: {} });
        expect(invalid).toMatchObject({ status: 400, body: { code: 'DECISION_INVALID_REQUEST', details: { errors: ['questions must not be empty'] } } });
        const large = await post('ws-one', { ...body, state: 'x'.repeat(5000) });
        expect(large).toMatchObject({ status: 413, body: { code: 'DECISION_REQUEST_TOO_LARGE' } });
        expect(transform).not.toHaveBeenCalled();
    });

    it('maps typesafe to 501', async () => {
        const res = await post('ws-one', { ...body, backend: 'typesafe' });
        expect(res).toMatchObject({ status: 501, body: { code: 'DECISION_BACKEND_NOT_IMPLEMENTED', error: 'The TypeSafe decision backend is not implemented.' } });
    });

    it('maps Copilot unavailable to 503 and failed invocation to 502', async () => {
        isAvailable.mockResolvedValueOnce({ available: false, error: 'not installed' });
        expect(await post('ws-one', body)).toMatchObject({ status: 503, body: { code: 'DECISION_BACKEND_UNAVAILABLE' } });
        transform.mockResolvedValueOnce({ success: false, text: '', error: 'boom' });
        expect(await post('ws-one', body)).toMatchObject({ status: 502, body: { code: 'DECISION_UPSTREAM_FAILED' } });
    });

    it('aborts the Copilot call when the client disconnects', async () => {
        let seenSignal: AbortSignal | undefined;
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        transform.mockImplementation((_prompt: string, options: { signal: AbortSignal }) => {
            seenSignal = options.signal;
            markStarted();
            return new Promise(() => {});
        });
        const controller = new AbortController();
        const pending = fetch(`${baseUrl}/api/workspaces/ws-one/decisions/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        }).catch(() => undefined);
        await started;
        controller.abort();
        await pending;
        await vi.waitFor(() => expect(seenSignal?.aborted).toBe(true));
    });

    it('round-trips through CocClient.decisions.evaluate with an encoded workspace id', async () => {
        const client = new CocClient({ baseUrl, fetch: globalThis.fetch });
        const response = await client.decisions.evaluate('ws two/é', {
            state: { note: 'hi' },
            questions: { ok: { type: 'noul', instructions: 'Is it fine?' } },
        });
        expect(response.answers.ok).toMatchObject({ type: 'noul', value: 0.7 });
        expect(response.metadata.confidenceKind).toBe('self_reported');
        expect(transform.mock.calls[0][1].cwd).toBe('/repo/two');
    });
});
