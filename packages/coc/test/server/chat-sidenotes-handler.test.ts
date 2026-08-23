import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';
import { registerChatSidenotesRoutes, type SideNoteAIInvoke } from '../../src/server/processes/chat-sidenotes/chat-sidenotes-handler';
import { MAX_TURNS_PER_SIDENOTE } from '../../src/server/processes/chat-sidenotes/chat-sidenotes-manager';

const KNOWN_PROCESS = 'queue_p1';

function makeStore(knownIds: string[] = [KNOWN_PROCESS, 'p1']): ProcessStore {
    return {
        getProcess: async (id: string) => (knownIds.includes(id) ? ({ id } as any) : undefined),
    } as unknown as ProcessStore;
}

async function startServer(opts: {
    enabled?: boolean;
    invokeAI?: SideNoteAIInvoke;
    store?: ProcessStore;
}): Promise<{ baseUrl: string; dataDir: string; close: () => Promise<void> }> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sidenote-routes-'));
    const routes: Route[] = [];
    registerChatSidenotesRoutes({
        routes,
        store: opts.store ?? makeStore(),
        dataDir,
        getEnabled: () => opts.enabled ?? true,
        invokeAI: opts.invokeAI ?? (async () => ({ success: true, response: 'answer text' })),
    });
    const server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        dataDir,
        close: () => new Promise<void>((resolve, reject) => server.close(err => {
            fs.rmSync(dataDir, { recursive: true, force: true });
            err ? reject(err) : resolve();
        })),
    };
}

async function req(baseUrl: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

describe('chat side-notes routes', () => {
    const servers: Array<{ close: () => Promise<void> }> = [];
    afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });

    const listPath = `/api/processes/${KNOWN_PROCESS}/sidenotes?workspace=ws-1`;
    const validBody = { turnIndex: 1, selectedText: 'Daly formula', contextBefore: 'the ', contextAfter: ' metric' };

    it('returns 404 for all verbs when the feature is disabled', async () => {
        const s = await startServer({ enabled: false });
        servers.push(s);
        expect((await req(s.baseUrl, 'GET', listPath)).status).toBe(404);
        expect((await req(s.baseUrl, 'POST', listPath, validBody)).status).toBe(404);
        expect((await req(s.baseUrl, 'DELETE', `/api/processes/${KNOWN_PROCESS}/sidenotes/x?workspace=ws-1`)).status).toBe(404);
    });

    it('lists empty then creates, persists, and re-lists a side-note', async () => {
        const s = await startServer({});
        servers.push(s);

        const empty = await req(s.baseUrl, 'GET', listPath);
        expect(empty.status).toBe(200);
        expect(empty.body.sidenotes).toEqual([]);

        const created = await req(s.baseUrl, 'POST', listPath, validBody);
        expect(created.status).toBe(201);
        expect(created.body.sidenote.answer).toBe('answer text');
        expect(created.body.sidenote.label).toBe('Daly formula');
        expect(created.body.sidenote.anchor.fingerprint).toBeTruthy();

        const after = await req(s.baseUrl, 'GET', listPath);
        expect(after.body.sidenotes).toHaveLength(1);
        expect(after.body.sidenotes[0].id).toBe(created.body.sidenote.id);
    });

    it('passes the built prompt and resolved model to the invoker', async () => {
        const calls: Array<{ prompt: string; model?: string }> = [];
        const invokeAI: SideNoteAIInvoke = async (prompt, model) => {
            calls.push({ prompt, model });
            return { success: true, response: 'ok' };
        };
        const s = await startServer({ invokeAI });
        servers.push(s);
        await req(s.baseUrl, 'POST', listPath, validBody);
        expect(calls).toHaveLength(1);
        expect(calls[0].prompt).toContain('⟦Daly formula⟧');
        // No repo preference set → model resolves to undefined.
        expect(calls[0].model).toBeUndefined();
    });

    it('rejects an invalid turnIndex', async () => {
        const s = await startServer({});
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', listPath, { ...validBody, turnIndex: -1 });
        expect(r.status).toBe(400);
    });

    it('rejects a too-short selection', async () => {
        const s = await startServer({});
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', listPath, { ...validBody, selectedText: 'a' });
        expect(r.status).toBe(400);
    });

    it('requires a workspaceId', async () => {
        const s = await startServer({});
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', `/api/processes/${KNOWN_PROCESS}/sidenotes`, validBody);
        expect(r.status).toBe(400);
    });

    it('returns 404 when the process does not exist', async () => {
        const s = await startServer({ store: makeStore(['other']) });
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', listPath, validBody);
        expect(r.status).toBe(404);
    });

    it('maps AI unavailability to 503 and AI failure to 502', async () => {
        const unavailable = await startServer({ invokeAI: async () => ({ success: false, error: 'down', unavailable: true }) });
        servers.push(unavailable);
        expect((await req(unavailable.baseUrl, 'POST', listPath, validBody)).status).toBe(503);

        const failed = await startServer({ invokeAI: async () => ({ success: false, error: 'bad', unavailable: false }) });
        servers.push(failed);
        expect((await req(failed.baseUrl, 'POST', listPath, validBody)).status).toBe(502);
    });

    it('deletes a persisted side-note and 404s on a missing id', async () => {
        const s = await startServer({});
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', listPath, validBody);
        const id = created.body.sidenote.id;

        const del = await req(s.baseUrl, 'DELETE', `/api/processes/${KNOWN_PROCESS}/sidenotes/${id}?workspace=ws-1`);
        expect(del.status).toBe(204);
        expect((await req(s.baseUrl, 'GET', listPath)).body.sidenotes).toEqual([]);

        const missing = await req(s.baseUrl, 'DELETE', `/api/processes/${KNOWN_PROCESS}/sidenotes/${id}?workspace=ws-1`);
        expect(missing.status).toBe(404);
    });
});

describe('chat side-note follow-up route', () => {
    const servers: Array<{ close: () => Promise<void> }> = [];
    afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });

    const listPath = `/api/processes/${KNOWN_PROCESS}/sidenotes?workspace=ws-1`;
    const createBody = { turnIndex: 1, selectedText: 'causal conv1d', contextBefore: 'a short ', contextAfter: ' kernel' };
    const followUpPath = (id: string) =>
        `/api/processes/${KNOWN_PROCESS}/sidenotes/${encodeURIComponent(id)}/follow-up?workspace=ws-1`;

    /** Create one side-note and return its id plus the prompts the AI saw. */
    async function seed(opts: { answers?: string[] } = {}) {
        const prompts: string[] = [];
        const answers = opts.answers ?? [];
        let call = 0;
        const s = await startServer({
            invokeAI: async (prompt: string) => {
                prompts.push(prompt);
                return { success: true, response: answers[call++] ?? `answer ${call}` };
            },
        });
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', listPath, createBody);
        return { s, prompts, id: created.body.sidenote.id as string };
    }

    it('answers a follow-up, appends it to the thread, and persists it', async () => {
        const { s, id } = await seed({ answers: ['first answer', 'second answer'] });

        const res = await req(s.baseUrl, 'POST', followUpPath(id), { question: 'why kernel width 4?' });
        expect(res.status).toBe(200);
        expect(res.body.sidenote.turns).toEqual([
            { question: undefined, answer: 'first answer' },
            { question: 'why kernel width 4?', answer: 'second answer' },
        ]);
        // Turn 0's mirror fields stay authoritative for the chip/preview.
        expect(res.body.sidenote.answer).toBe('first answer');

        // Survives a reload: the thread is on disk, not just in the response.
        const listed = await req(s.baseUrl, 'GET', listPath);
        expect(listed.body.sidenotes[0].turns).toHaveLength(2);
    });

    it('grounds the follow-up on the prior turns and the original selection', async () => {
        const { s, prompts, id } = await seed({ answers: ['first answer'] });
        await req(s.baseUrl, 'POST', followUpPath(id), { question: 'why kernel width 4?' });

        const followUpPrompt = prompts[1];
        expect(followUpPrompt).toContain('Conversation so far:');
        expect(followUpPrompt).toContain('A: first answer');
        expect(followUpPrompt).toContain('why kernel width 4?');
        // Original selection stays the grounding anchor.
        expect(followUpPrompt).toContain('⟦causal conv1d⟧');
    });

    it('rejects an empty question, an unknown note, and a bad workspace', async () => {
        const { s, id } = await seed();
        expect((await req(s.baseUrl, 'POST', followUpPath(id), { question: '   ' })).status).toBe(400);
        expect((await req(s.baseUrl, 'POST', followUpPath(id), {})).status).toBe(400);
        expect((await req(s.baseUrl, 'POST', followUpPath('nope'), { question: 'hi' })).status).toBe(404);
        expect((await req(
            s.baseUrl,
            'POST',
            `/api/processes/${KNOWN_PROCESS}/sidenotes/${id}/follow-up`,
            { question: 'hi' },
        )).status).toBe(400);
    });

    it('stops accepting follow-ups at the turn cap', async () => {
        const { s, id } = await seed();
        // Turn 0 already exists, so 9 follow-ups fill the 10-turn thread.
        for (let i = 0; i < MAX_TURNS_PER_SIDENOTE - 1; i++) {
            const ok = await req(s.baseUrl, 'POST', followUpPath(id), { question: `q${i}` });
            expect(ok.status).toBe(200);
        }
        const overflow = await req(s.baseUrl, 'POST', followUpPath(id), { question: 'one too many' });
        expect(overflow.status).toBe(409);
    });

    it('surfaces AI failures without touching the persisted thread', async () => {
        const s = await startServer({
            invokeAI: (() => {
                let call = 0;
                return async () => (call++ === 0
                    ? { success: true as const, response: 'first answer' }
                    : { success: false as const, error: 'CLI missing', unavailable: true });
            })(),
        });
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', listPath, createBody);
        const id = created.body.sidenote.id;

        const failed = await req(s.baseUrl, 'POST', followUpPath(id), { question: 'why?' });
        expect(failed.status).toBe(503);

        const listed = await req(s.baseUrl, 'GET', listPath);
        expect(listed.body.sidenotes[0].turns).toBeUndefined();
    });

    it('returns 404 for the follow-up route when the feature is disabled', async () => {
        const s = await startServer({ enabled: false });
        servers.push(s);
        expect((await req(s.baseUrl, 'POST', followUpPath('any'), { question: 'hi' })).status).toBe(404);
    });
});
