/**
 * Paper Annotations Markdown Export Tests (Goal 4 AC-03).
 *
 * Two layers:
 *  - pure `formatPaperAnnotationsMarkdown` / `paperDisplayLabel` unit tests, and
 *  - the `GET /paper-annotations/export` route end-to-end over a real HTTP server
 *    (same lightweight fake-store harness the CRUD handler tests use).
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
    formatPaperAnnotationsMarkdown,
    paperDisplayLabel,
} from '../../src/server/notes/paper-annotations-export';
import type { PaperAnnotation } from '../../src/server/notes/paper-annotations-types';

const WS_ID = 'ws-1';

function annotation(over: Partial<PaperAnnotation> = {}): PaperAnnotation {
    return {
        id: over.id ?? 'a1',
        createdAt: over.createdAt ?? '2026-07-25T10:00:00.000Z',
        pdfUrl: over.pdfUrl ?? 'https://arxiv.org/pdf/1802.05799.pdf',
        quote: over.quote ?? { selectedText: 'ring-allreduce', contextBefore: '', contextAfter: '' },
        answer: over.answer ?? 'Because each node sends and receives an equal share.',
        ...over,
    };
}

// ============================================================================
// Pure formatter
// ============================================================================

describe('formatPaperAnnotationsMarkdown', () => {
    it('renders an empty document when there are no annotations', () => {
        const md = formatPaperAnnotationsMarkdown([]);
        expect(md).toContain('# Paper annotations');
        expect(md).toContain('_No annotations yet._');
    });

    it('accepts a list, an id→annotation map, and the raw sidecar shape alike', () => {
        const a = annotation();
        const fromList = formatPaperAnnotationsMarkdown([a]);
        const fromMap = formatPaperAnnotationsMarkdown({ [a.id]: a });
        const fromSidecar = formatPaperAnnotationsMarkdown({ version: 1, annotations: { [a.id]: a } });
        expect(fromList).toBe(fromMap);
        expect(fromMap).toBe(fromSidecar);
        expect(fromList).toContain('> ring-allreduce');
    });

    it('emits the anchored quote as a blockquote, the question, the answer and metadata', () => {
        const md = formatPaperAnnotationsMarkdown([
            annotation({
                question: 'Why is this bandwidth-optimal?',
                answer: 'Because each node sends/receives an equal share.',
                position: { page: 3, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }] },
                model: 'claude-opus-4-8',
            }),
        ]);
        expect(md).toContain('### Why is this bandwidth-optimal?');
        expect(md).toContain('> ring-allreduce');
        expect(md).toContain('Because each node sends/receives an equal share.');
        expect(md).toContain('Page 3');
        expect(md).toContain('claude-opus-4-8');
        expect(md).toContain('2026-07-25'); // short date from ISO createdAt
        expect(md).toContain('_1 annotation_');
    });

    it('falls back to a "Highlight N" heading when there is no question', () => {
        const md = formatPaperAnnotationsMarkdown([
            annotation({ id: 'a1', question: undefined }),
            annotation({ id: 'a2', question: undefined, quote: { selectedText: 'x', contextBefore: '', contextAfter: '' }, position: { page: 5, rects: [] } }),
        ]);
        expect(md).toContain('### Highlight 1');
        expect(md).toContain('### Highlight 2');
    });

    it('groups annotations by paper and orders each group by page then time', () => {
        const md = formatPaperAnnotationsMarkdown([
            annotation({ id: 'b', pdfUrl: 'https://arxiv.org/pdf/2000.11111.pdf', quote: { selectedText: 'beta', contextBefore: '', contextAfter: '' } }),
            annotation({ id: 'a2', question: 'second', position: { page: 9, rects: [] } }),
            annotation({ id: 'a1', question: 'first', position: { page: 2, rects: [] } }),
        ]);
        // Two paper sections.
        expect(md).toContain('## 1802.05799.pdf');
        expect(md).toContain('## 2000.11111.pdf');
        // Within the first paper, page 2 ("first") precedes page 9 ("second").
        expect(md.indexOf('### first')).toBeGreaterThan(-1);
        expect(md.indexOf('### first')).toBeLessThan(md.indexOf('### second'));
    });

    it('blockquotes multi-line selected text line-by-line', () => {
        const md = formatPaperAnnotationsMarkdown([
            annotation({ quote: { selectedText: 'line one\nline two', contextBefore: '', contextAfter: '' } }),
        ]);
        expect(md).toContain('> line one\n> line two');
    });

    it('honors a custom title and subtitle', () => {
        const md = formatPaperAnnotationsMarkdown([annotation()], { title: 'My export', subtitle: 'notes/paper.md' });
        expect(md).toContain('# My export');
        expect(md).toContain('_notes/paper.md_');
    });

    it('does not leave a trailing separator', () => {
        const md = formatPaperAnnotationsMarkdown([annotation()]);
        expect(md.trimEnd().endsWith('---')).toBe(false);
    });
});

describe('paperDisplayLabel', () => {
    it('takes the basename and strips query/hash', () => {
        expect(paperDisplayLabel('https://arxiv.org/pdf/1802.05799.pdf?x=1#y')).toBe('1802.05799.pdf');
        expect(paperDisplayLabel('.papers/2000.11111.pdf')).toBe('2000.11111.pdf');
        expect(paperDisplayLabel('')).toBe('Paper');
    });
});

// ============================================================================
// Export route
// ============================================================================

function fakeStore(rootPath: string): any {
    return { getWorkspaces: async () => [{ id: WS_ID, name: 'Test', rootPath }] };
}

async function startServer(opts: { enabled?: boolean } = {}): Promise<{
    baseUrl: string;
    dataDir: string;
    close: () => Promise<void>;
}> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-paper-export-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-paper-export-ws-'));
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
const exportPath = `${listPath}/export`;

const validAnnotation = {
    pdfUrl: 'https://arxiv.org/pdf/1802.05799',
    quote: { selectedText: 'ring-allreduce', contextBefore: 'the ', contextAfter: ' algorithm' },
    position: { page: 3, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }] },
    question: 'Why is this bandwidth-optimal?',
    answer: 'Because each node sends/receives an equal share.',
    model: 'claude-opus-4-8',
};

describe('paper-annotations export route', () => {
    const servers: Array<{ close: () => Promise<void> }> = [];
    afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });

    it('returns 404 when the feature is disabled', async () => {
        const s = await startServer({ enabled: false });
        servers.push(s);
        expect((await req(s.baseUrl, 'GET', `${exportPath}?path=paper.md`)).status).toBe(404);
    });

    it('returns 400 without a path', async () => {
        const s = await startServer();
        servers.push(s);
        expect((await req(s.baseUrl, 'GET', exportPath)).status).toBe(400);
    });

    it('exports an empty document for a note with no annotations', async () => {
        const s = await startServer();
        servers.push(s);
        const r = await req(s.baseUrl, 'GET', `${exportPath}?path=paper.md`);
        expect(r.status).toBe(200);
        expect(r.body.count).toBe(0);
        expect(r.body.markdown).toContain('_No annotations yet._');
    });

    it('exports created annotations as Markdown with the quote and answer', async () => {
        const s = await startServer();
        servers.push(s);
        await req(s.baseUrl, 'POST', createPath, { path: 'paper.md', annotation: validAnnotation });

        const r = await req(s.baseUrl, 'GET', `${exportPath}?path=paper.md&title=${encodeURIComponent('Ring Allreduce notes')}`);
        expect(r.status).toBe(200);
        expect(r.body.count).toBe(1);
        expect(r.body.markdown).toContain('# Ring Allreduce notes');
        expect(r.body.markdown).toContain('> ring-allreduce');
        expect(r.body.markdown).toContain('### Why is this bandwidth-optimal?');
        expect(r.body.markdown).toContain('Because each node sends/receives an equal share.');
        expect(r.body.markdown).toContain('Page 3');
    });
});
