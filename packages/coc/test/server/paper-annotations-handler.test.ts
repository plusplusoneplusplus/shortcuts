/**
 * Paper Annotations Handler Tests (Goal 2).
 *
 * Exercises the dual-anchor sidecar CRUD endpoints end-to-end over a real HTTP
 * server, plus the pure validate/normalize helpers. A lightweight fake store
 * supplies the workspace so we avoid the full server bootstrap while still
 * hitting the real path-safety + access-control code.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';
import { registerPaperAnnotationsRoutes } from '../../src/server/notes/paper-annotations-handler';
import {
    validateAnnotationDraft,
    normalizeAnnotationDraft,
} from '../../src/server/notes/paper-annotations-types';

const WS_ID = 'ws-1';

function fakeStore(rootPath: string): any {
    return {
        getWorkspaces: async () => [{ id: WS_ID, name: 'Test', rootPath }],
    };
}

async function startServer(opts: { enabled?: boolean } = {}): Promise<{
    baseUrl: string;
    dataDir: string;
    notesRoot: string;
    close: () => Promise<void>;
}> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-paper-annot-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-paper-annot-ws-'));
    const routes: Route[] = [];
    registerPaperAnnotationsRoutes({
        routes,
        store: fakeStore(workspaceDir),
        dataDir,
        getEnabled: () => opts.enabled ?? true,
    });
    const server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        dataDir,
        notesRoot: path.join(dataDir, 'repos', WS_ID, 'notes'),
        close: () => new Promise<void>((resolve, reject) => server.close(err => {
            fs.rmSync(dataDir, { recursive: true, force: true });
            fs.rmSync(workspaceDir, { recursive: true, force: true });
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

const listPath = `/api/workspaces/${WS_ID}/notes/paper-annotations`;
const createPath = `${listPath}/annotation`;

const validAnnotation = {
    pdfUrl: 'https://arxiv.org/pdf/1802.05799',
    quote: { selectedText: 'ring-allreduce', contextBefore: 'the ', contextAfter: ' algorithm' },
    position: { page: 3, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }] },
    question: 'Why is this bandwidth-optimal?',
    answer: 'Because each node sends/receives an equal share.',
    model: 'claude-opus-4-8',
};

describe('paper-annotations handler', () => {
    const servers: Array<{ close: () => Promise<void> }> = [];
    afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });

    it('returns 404 for every route when the feature is disabled', async () => {
        const s = await startServer({ enabled: false });
        servers.push(s);
        expect((await req(s.baseUrl, 'GET', `${listPath}?path=paper.md`)).status).toBe(404);
        expect((await req(s.baseUrl, 'POST', createPath, { path: 'paper.md', annotation: validAnnotation })).status).toBe(404);
    });

    it('GET returns an empty sidecar for a note with no annotations', async () => {
        const s = await startServer();
        servers.push(s);
        const r = await req(s.baseUrl, 'GET', `${listPath}?path=paper.md`);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ version: 1, annotations: {} });
    });

    it('GET without a path is 400', async () => {
        const s = await startServer();
        servers.push(s);
        expect((await req(s.baseUrl, 'GET', listPath)).status).toBe(400);
    });

    it('POST creates a dual-anchor annotation and GET returns it', async () => {
        const s = await startServer();
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', createPath, { path: 'paper.md', annotation: validAnnotation });
        expect(created.status).toBe(201);
        const a = created.body.annotation;
        expect(a.id).toBeDefined();
        expect(a.createdAt).toBeDefined();
        expect(a.quote.selectedText).toBe('ring-allreduce');
        expect(a.position.page).toBe(3);
        expect(a.position.rects).toHaveLength(1);
        expect(a.question).toBe('Why is this bandwidth-optimal?');
        expect(a.answer).toContain('equal share');

        const get = await req(s.baseUrl, 'GET', `${listPath}?path=paper.md`);
        expect(get.status).toBe(200);
        expect(get.body.annotations[a.id].pdfUrl).toBe(validAnnotation.pdfUrl);
    });

    it('a created annotation survives a fresh server over the same dataDir (restart, AC-05)', async () => {
        const s = await startServer();
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', createPath, { path: 'paper.md', annotation: validAnnotation });
        const id = created.body.annotation.id;

        // Re-mount a new router/server against the same dataDir & workspace.
        const routes: Route[] = [];
        registerPaperAnnotationsRoutes({
            routes,
            store: fakeStore(path.join(s.dataDir, '..', 'unused')),
            dataDir: s.dataDir,
            getEnabled: () => true,
        });
        // Reuse the same workspace rootPath by reading it back is unnecessary for
        // the default managed root; the sidecar lives under dataDir/repos/WS_ID/notes.
        const server2 = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server2.listen(0, '127.0.0.1', resolve));
        const addr = server2.address() as any;
        const base2 = `http://127.0.0.1:${addr.port}`;
        try {
            const get = await req(base2, 'GET', `${listPath}?path=paper.md`);
            expect(get.status).toBe(200);
            expect(get.body.annotations[id]).toBeDefined();
            expect(get.body.annotations[id].answer).toContain('equal share');
        } finally {
            await new Promise<void>(r => server2.close(() => r()));
        }
    });

    it('POST without a valid quote/answer/pdfUrl is 400', async () => {
        const s = await startServer();
        servers.push(s);
        expect((await req(s.baseUrl, 'POST', createPath, { path: 'p.md', annotation: { answer: 'x', quote: { selectedText: 'y' } } })).status).toBe(400); // no pdfUrl
        expect((await req(s.baseUrl, 'POST', createPath, { path: 'p.md', annotation: { pdfUrl: 'u', quote: { selectedText: 'y' } } })).status).toBe(400); // no answer
        expect((await req(s.baseUrl, 'POST', createPath, { path: 'p.md', annotation: { pdfUrl: 'u', answer: 'a', quote: { selectedText: '' } } })).status).toBe(400); // empty selection
    });

    it('PUT replaces the whole annotation map', async () => {
        const s = await startServer();
        servers.push(s);
        const put = await req(s.baseUrl, 'PUT', listPath, {
            path: 'paper.md',
            annotations: { 'a1': { id: 'a1', createdAt: 't', pdfUrl: 'u', quote: { selectedText: 's', contextBefore: '', contextAfter: '' }, answer: 'x' } },
        });
        expect(put.status).toBe(200);
        const get = await req(s.baseUrl, 'GET', `${listPath}?path=paper.md`);
        expect(Object.keys(get.body.annotations)).toEqual(['a1']);
    });

    it('PATCH marks an annotation resolved, then reopens it', async () => {
        const s = await startServer();
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', createPath, { path: 'paper.md', annotation: validAnnotation });
        const id = created.body.annotation.id;

        // Resolve it.
        const resolved = await req(s.baseUrl, 'PATCH', `${listPath}/annotation/${id}`, { path: 'paper.md', resolved: true });
        expect(resolved.status).toBe(200);
        expect(resolved.body.annotation.resolved).toBe(true);
        expect(resolved.body.annotation.resolvedAt).toBeDefined();
        expect(resolved.body.annotation.updatedAt).toBeDefined();

        // Persisted resolved state is visible via GET.
        let get = await req(s.baseUrl, 'GET', `${listPath}?path=paper.md`);
        expect(get.body.annotations[id].resolved).toBe(true);
        expect(get.body.annotations[id].resolvedAt).toBeDefined();

        // Reopen it — resolved/resolvedAt are cleared.
        const reopened = await req(s.baseUrl, 'PATCH', `${listPath}/annotation/${id}`, { path: 'paper.md', resolved: false });
        expect(reopened.status).toBe(200);
        expect(reopened.body.annotation.resolved).toBeUndefined();
        expect(reopened.body.annotation.resolvedAt).toBeUndefined();

        get = await req(s.baseUrl, 'GET', `${listPath}?path=paper.md`);
        expect(get.body.annotations[id].resolved).toBeUndefined();
        expect(get.body.annotations[id].resolvedAt).toBeUndefined();
    });

    it('PATCH requires a boolean resolved field, an existing annotation, and the flag', async () => {
        const s = await startServer();
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', createPath, { path: 'paper.md', annotation: validAnnotation });
        const id = created.body.annotation.id;

        // Non-boolean / missing resolved → 400.
        expect((await req(s.baseUrl, 'PATCH', `${listPath}/annotation/${id}`, { path: 'paper.md' })).status).toBe(400);
        expect((await req(s.baseUrl, 'PATCH', `${listPath}/annotation/${id}`, { path: 'paper.md', resolved: 'yes' })).status).toBe(400);
        // Missing note path → 400.
        expect((await req(s.baseUrl, 'PATCH', `${listPath}/annotation/${id}`, { resolved: true })).status).toBe(400);
        // Unknown annotation id → 404.
        expect((await req(s.baseUrl, 'PATCH', `${listPath}/annotation/nope`, { path: 'paper.md', resolved: true })).status).toBe(404);
    });

    it('PATCH returns 404 when the feature is disabled', async () => {
        const s = await startServer({ enabled: false });
        servers.push(s);
        expect((await req(s.baseUrl, 'PATCH', `${listPath}/annotation/x`, { path: 'paper.md', resolved: true })).status).toBe(404);
    });

    it('a resolved annotation survives a restart over the same dataDir (AC-02/AC-05)', async () => {
        const s = await startServer();
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', createPath, { path: 'paper.md', annotation: validAnnotation });
        const id = created.body.annotation.id;
        await req(s.baseUrl, 'PATCH', `${listPath}/annotation/${id}`, { path: 'paper.md', resolved: true });

        const routes: Route[] = [];
        registerPaperAnnotationsRoutes({
            routes,
            store: fakeStore(path.join(s.dataDir, '..', 'unused')),
            dataDir: s.dataDir,
            getEnabled: () => true,
        });
        const server2 = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server2.listen(0, '127.0.0.1', resolve));
        const addr = server2.address() as any;
        const base2 = `http://127.0.0.1:${addr.port}`;
        try {
            const get = await req(base2, 'GET', `${listPath}?path=paper.md`);
            expect(get.body.annotations[id].resolved).toBe(true);
        } finally {
            await new Promise<void>(r => server2.close(() => r()));
        }
    });

    it('DELETE removes an annotation; unknown id is 404', async () => {
        const s = await startServer();
        servers.push(s);
        const created = await req(s.baseUrl, 'POST', createPath, { path: 'paper.md', annotation: validAnnotation });
        const id = created.body.annotation.id;

        expect((await req(s.baseUrl, 'DELETE', `${listPath}/annotation/${id}?path=paper.md`)).status).toBe(204);
        const get = await req(s.baseUrl, 'GET', `${listPath}?path=paper.md`);
        expect(get.body.annotations[id]).toBeUndefined();

        expect((await req(s.baseUrl, 'DELETE', `${listPath}/annotation/nope?path=paper.md`)).status).toBe(404);
    });
});

describe('paper-annotations helpers', () => {
    it('validateAnnotationDraft accepts a minimal valid draft (no position)', () => {
        expect(validateAnnotationDraft({ pdfUrl: 'u', answer: 'a', quote: { selectedText: 's' } })).toBeUndefined();
    });

    it('validateAnnotationDraft rejects bad shapes', () => {
        expect(validateAnnotationDraft(null)).toBeDefined();
        expect(validateAnnotationDraft({ answer: 'a', quote: { selectedText: 's' } })).toContain('pdfUrl');
        expect(validateAnnotationDraft({ pdfUrl: 'u', quote: { selectedText: 's' } })).toContain('answer');
        expect(validateAnnotationDraft({ pdfUrl: 'u', answer: 'a' })).toContain('quote');
        expect(validateAnnotationDraft({ pdfUrl: 'u', answer: 'a', quote: {} })).toContain('selectedText');
        expect(validateAnnotationDraft({ pdfUrl: 'u', answer: 'a', quote: { selectedText: 's' }, position: { page: 0, rects: [] } })).toContain('page');
        expect(validateAnnotationDraft({ pdfUrl: 'u', answer: 'a', quote: { selectedText: 's' }, position: { page: 1, rects: 'x' } })).toContain('rects');
    });

    it('normalizeAnnotationDraft keeps only known fields and coerces rects', () => {
        const a = normalizeAnnotationDraft(
            {
                pdfUrl: 'u', answer: 'a', question: '  q  ', model: ' m ', evil: 'drop-me',
                quote: { selectedText: 's', contextBefore: 'b', contextAfter: 'c', extra: 'x' },
                position: { page: 2, rects: [{ x: '0.1', y: 0.2, width: 0.3, height: 0.4, junk: 1 }, null] },
            } as any,
            'id-1',
            'created-1',
        );
        expect(a).toEqual({
            id: 'id-1',
            createdAt: 'created-1',
            pdfUrl: 'u',
            quote: { selectedText: 's', contextBefore: 'b', contextAfter: 'c' },
            answer: 'a',
            question: 'q',
            model: 'm',
            position: { page: 2, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }] },
        });
        expect((a as any).evil).toBeUndefined();
    });
});
