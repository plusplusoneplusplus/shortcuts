import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';
import { registerQuickAskAnswerRoutes } from '../../src/server/processes/chat-sidenotes/quick-ask-answer-handler';
import type { SideNoteAIInvoke } from '../../src/server/processes/chat-sidenotes/chat-sidenotes-handler';
import { PAPERS_DIR } from '../../src/server/notes/paper-ingest-handler';

const WS_ID = 'ws-1';

function fakeStore(rootPath: string): any {
    return { getWorkspaces: async () => [{ id: WS_ID, name: 'Test', rootPath }] };
}

async function startServer(opts: {
    enabled?: boolean;
    invokeAI?: SideNoteAIInvoke;
    withStore?: boolean;
    /** Seed a default-root paper text sidecar `.papers/<id>.txt`. */
    paperText?: string;
    paperId?: string;
}): Promise<{ baseUrl: string; dataDir: string; lastPrompt: () => string | undefined; close: () => Promise<void> }> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-quick-ask-answer-'));
    if (opts.paperText !== undefined) {
        const papersDir = path.join(dataDir, 'repos', WS_ID, 'notes', PAPERS_DIR);
        fs.mkdirSync(papersDir, { recursive: true });
        fs.writeFileSync(path.join(papersDir, `${opts.paperId ?? '1802.05799'}.txt`), opts.paperText, 'utf-8');
    }
    const routes: Route[] = [];
    let lastPrompt: string | undefined;
    const invokeAI: SideNoteAIInvoke = opts.invokeAI ?? (async (prompt: string) => {
        lastPrompt = prompt;
        return { success: true, response: 'answer text' };
    });
    registerQuickAskAnswerRoutes({
        routes,
        dataDir,
        store: opts.withStore ?? true ? fakeStore('/tmp/ws') : undefined,
        getEnabled: () => opts.enabled ?? true,
        invokeAI,
    });
    const server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        dataDir,
        lastPrompt: () => lastPrompt,
        close: () => new Promise<void>((resolve, reject) => server.close(err => {
            fs.rmSync(dataDir, { recursive: true, force: true });
            err ? reject(err) : resolve();
        })),
    };
}

async function req(baseUrl: string, method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

describe('quick-ask answer route', () => {
    const servers: Array<{ close: () => Promise<void> }> = [];
    afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });

    const answerPath = '/api/quick-ask/answer?workspace=ws-1';
    const validBody = { selectedText: 'ring-allreduce', contextBefore: 'the ', contextAfter: ' algorithm' };

    it('returns 404 when the feature is disabled', async () => {
        const s = await startServer({ enabled: false });
        servers.push(s);
        expect((await req(s.baseUrl, 'POST', answerPath, validBody)).status).toBe(404);
    });

    it('returns 400 for a missing/invalid workspace', async () => {
        const s = await startServer({});
        servers.push(s);
        expect((await req(s.baseUrl, 'POST', '/api/quick-ask/answer', validBody)).status).toBe(400);
        expect((await req(s.baseUrl, 'POST', '/api/quick-ask/answer?workspace=bad id', validBody)).status).toBe(400);
    });

    it('returns 400 when the selection is too short', async () => {
        const s = await startServer({});
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', answerPath, { selectedText: ' ' });
        expect(r.status).toBe(400);
    });

    it('answers a selection without persisting anything', async () => {
        const s = await startServer({});
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', answerPath, validBody);
        expect(r.status).toBe(200);
        expect(r.body.answer).toBe('answer text');
        // Prompt is grounded: selection wrapped in ⟦ ⟧ with the surrounding context.
        expect(s.lastPrompt()).toContain('⟦ring-allreduce⟧');
        expect(s.lastPrompt()).toContain('the');
        expect(s.lastPrompt()).toContain('algorithm');
        // No sidecar/state files created for a stateless answer.
        expect(fs.readdirSync(s.dataDir)).toEqual([]);
    });

    it('forwards a custom question into the prompt', async () => {
        const s = await startServer({});
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', answerPath, { ...validBody, question: 'Why is this bandwidth-optimal?' });
        expect(r.status).toBe(200);
        expect(s.lastPrompt()).toContain('Why is this bandwidth-optimal?');
    });

    it('maps AI unavailability to 503 and failure to 502', async () => {
        const unavailable = await startServer({
            invokeAI: async () => ({ success: false, error: 'AI service unavailable', unavailable: true }),
        });
        servers.push(unavailable);
        expect((await req(unavailable.baseUrl, 'POST', answerPath, validBody)).status).toBe(503);

        const failed = await startServer({
            invokeAI: async () => ({ success: false, error: 'AI request failed', unavailable: false }),
        });
        servers.push(failed);
        expect((await req(failed.baseUrl, 'POST', answerPath, validBody)).status).toBe(502);
    });

    it('grounds on the full paper when useFullPaper is set and the sidecar is readable', async () => {
        const s = await startServer({ paperText: 'The full paper explains ring-allreduce in detail.' });
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', answerPath, {
            ...validBody,
            useFullPaper: true,
            paperPath: `${PAPERS_DIR}/1802.05799.pdf`,
        });
        expect(r.status).toBe(200);
        expect(r.body.usedFullPaper).toBe(true);
        // The whole-paper text is injected into the grounding prompt.
        expect(s.lastPrompt()).toContain('Full paper text:');
        expect(s.lastPrompt()).toContain('The full paper explains ring-allreduce in detail.');
    });

    it('falls back to selection-only when the paper sidecar is missing', async () => {
        // No paperText seeded → readPaperText returns null → cheap path.
        const s = await startServer({});
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', answerPath, {
            ...validBody,
            useFullPaper: true,
            paperPath: `${PAPERS_DIR}/1802.05799.pdf`,
        });
        expect(r.status).toBe(200);
        expect(r.body.usedFullPaper).toBe(false);
        expect(s.lastPrompt()).not.toContain('Full paper text:');
    });

    it('ignores the paper text when useFullPaper is not set (default cheap path)', async () => {
        const s = await startServer({ paperText: 'irrelevant full paper text' });
        servers.push(s);
        const r = await req(s.baseUrl, 'POST', answerPath, {
            ...validBody,
            paperPath: `${PAPERS_DIR}/1802.05799.pdf`,
        });
        expect(r.status).toBe(200);
        expect(r.body.usedFullPaper).toBe(false);
        expect(s.lastPrompt()).not.toContain('Full paper text:');
    });
});
