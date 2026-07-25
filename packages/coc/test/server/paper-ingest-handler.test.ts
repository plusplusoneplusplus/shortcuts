/**
 * Paper Ingest Handler tests (Goal 3, AC-01 + AC-02).
 *
 * Exercises the arXiv ingest route end-to-end over a real HTTP server with the
 * network fetch and PDF text extraction injected as stubs, so the test is fully
 * deterministic and never touches the network or pdfjs. A lightweight fake store
 * supplies the workspace.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';
import { registerPaperIngestRoutes, PAPERS_DIR } from '../../src/server/notes/paper-ingest-handler';

const WS_ID = 'ws-1';

function fakeStore(rootPath: string): any {
    return { getWorkspaces: async () => [{ id: WS_ID, name: 'Test', rootPath }] };
}

interface Started {
    baseUrl: string;
    dataDir: string;
    papersDir: string;
    fetchPdf: ReturnType<typeof vi.fn>;
    extractText: ReturnType<typeof vi.fn>;
    close: () => Promise<void>;
}

async function startServer(opts: {
    enabled?: boolean;
    fetchPdf?: (url: string) => Promise<Buffer>;
    extractText?: (buffer: Buffer) => Promise<string>;
} = {}): Promise<Started> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-paper-ingest-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-paper-ingest-ws-'));
    const fetchPdf = vi.fn(opts.fetchPdf ?? (async () => Buffer.from('%PDF-1.4 fake')));
    const extractText = vi.fn(opts.extractText ?? (async () => 'extracted paper text'));
    const routes: Route[] = [];
    registerPaperIngestRoutes({
        routes,
        store: fakeStore(workspaceDir),
        dataDir,
        getEnabled: () => opts.enabled ?? true,
        deps: { fetchPdf, extractText },
    });
    const server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        dataDir,
        papersDir: path.join(dataDir, 'repos', WS_ID, 'notes', PAPERS_DIR),
        fetchPdf,
        extractText,
        close: () => new Promise<void>((resolve, reject) => server.close(err => {
            fs.rmSync(dataDir, { recursive: true, force: true });
            fs.rmSync(workspaceDir, { recursive: true, force: true });
            err ? reject(err) : resolve();
        })),
    };
}

async function ingest(baseUrl: string, url: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}/api/workspaces/${WS_ID}/notes/paper-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

describe('paper-ingest handler', () => {
    const servers: Started[] = [];
    afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });

    it('returns 404 when the feature is disabled', async () => {
        const s = await startServer({ enabled: false });
        servers.push(s);
        expect((await ingest(s.baseUrl, 'https://arxiv.org/pdf/1802.05799')).status).toBe(404);
    });

    it('rejects a non-arXiv URL with 400', async () => {
        const s = await startServer();
        servers.push(s);
        const r = await ingest(s.baseUrl, 'https://example.com/foo.pdf');
        expect(r.status).toBe(400);
        expect(s.fetchPdf).not.toHaveBeenCalled();
    });

    it('fetches + caches the PDF and extracts text on first ingest (AC-01 + AC-02)', async () => {
        const s = await startServer();
        servers.push(s);
        const r = await ingest(s.baseUrl, 'https://arxiv.org/pdf/1802.05799v3');
        expect(r.status).toBe(200);
        expect(r.body.arxivId).toBe('1802.05799v3');
        expect(r.body.cached).toBe(false);
        expect(r.body.pdfPath).toBe(`${PAPERS_DIR}/1802.05799v3.pdf`);
        expect(r.body.textPath).toBe(`${PAPERS_DIR}/1802.05799v3.txt`);
        // Fetched the canonical PDF URL, not the raw input.
        expect(s.fetchPdf).toHaveBeenCalledWith('https://arxiv.org/pdf/1802.05799v3');
        // Both cache files exist on disk.
        expect(fs.existsSync(path.join(s.papersDir, '1802.05799v3.pdf'))).toBe(true);
        expect(fs.readFileSync(path.join(s.papersDir, '1802.05799v3.txt'), 'utf-8')).toBe('extracted paper text');
    });

    it('is idempotent — a second ingest reuses the cache and never re-fetches (AC-01)', async () => {
        const s = await startServer();
        servers.push(s);
        await ingest(s.baseUrl, 'https://arxiv.org/abs/1802.05799');
        expect(s.fetchPdf).toHaveBeenCalledTimes(1);
        expect(s.extractText).toHaveBeenCalledTimes(1);

        const second = await ingest(s.baseUrl, 'https://arxiv.org/abs/1802.05799');
        expect(second.status).toBe(200);
        expect(second.body.cached).toBe(true);
        // No new fetch / extraction — the cache was reused.
        expect(s.fetchPdf).toHaveBeenCalledTimes(1);
        expect(s.extractText).toHaveBeenCalledTimes(1);
    });

    it('old-style identifiers get a slash-free cache filename', async () => {
        const s = await startServer();
        servers.push(s);
        const r = await ingest(s.baseUrl, 'https://arxiv.org/abs/hep-th/9901001');
        expect(r.status).toBe(200);
        expect(r.body.pdfPath).toBe(`${PAPERS_DIR}/hep-th_9901001.pdf`);
        expect(fs.existsSync(path.join(s.papersDir, 'hep-th_9901001.pdf'))).toBe(true);
    });

    it('still caches the PDF when text extraction fails (best-effort AC-02)', async () => {
        const s = await startServer({ extractText: async () => { throw new Error('bad pdf'); } });
        servers.push(s);
        const r = await ingest(s.baseUrl, 'https://arxiv.org/pdf/2301.00001');
        expect(r.status).toBe(200);
        expect(r.body.textPath).toBeNull();
        expect(fs.existsSync(path.join(s.papersDir, '2301.00001.pdf'))).toBe(true);
        expect(fs.existsSync(path.join(s.papersDir, '2301.00001.txt'))).toBe(false);
    });

    it('returns 502 when the fetch fails', async () => {
        const s = await startServer({ fetchPdf: async () => { throw new Error('network down'); } });
        servers.push(s);
        const r = await ingest(s.baseUrl, 'https://arxiv.org/pdf/1802.05799');
        expect(r.status).toBe(502);
    });

    it('returns 502 when the fetched PDF is empty', async () => {
        const s = await startServer({ fetchPdf: async () => Buffer.alloc(0) });
        servers.push(s);
        const r = await ingest(s.baseUrl, 'https://arxiv.org/pdf/1802.05799');
        expect(r.status).toBe(502);
    });
});
