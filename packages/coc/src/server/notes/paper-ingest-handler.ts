/**
 * Paper Ingest REST API Handler (Goal 3, AC-01 + AC-02).
 *
 * Recognizes a pasted arXiv URL, fetches the PDF **once**, and caches it locally
 * (link-rot proof, offline-capable) alongside a one-time text-extraction sidecar
 * used for whole-paper grounding.
 *
 * Storage mirrors the notes-image handler: a `.papers/` directory under the
 * resolved notes root (co-located for repo-folder roots, under the managed root
 * for the default). The cached PDF is `<arxiv-id>.pdf` and the extracted text is
 * `<arxiv-id>.txt`. Both are idempotent — a second ingest of the same paper reuses
 * the cache and never re-fetches or re-extracts.
 *
 * The network fetch and PDF text extraction are injectable so the handler is fully
 * unit-testable without real network or pdfjs.
 *
 * Pure Node.js; cross-platform (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { resolveNotesRoot, isRootResolveError } from './notes-root-resolver';
import type { ResolvedNotesRoot } from './notes-root-resolver';
import { resolveSafeNotesPath, isNotesPathSafetyError } from './notes-path-safety';
import { readRepoPreferences } from '../preferences-handler';
import { recognizeArxivUrl } from './arxiv-url';
import { extractPdfText } from './pdf-text-extract';

/** Cache directory (relative to the notes root) for ingested papers. */
export const PAPERS_DIR = '.papers';
/** Hard cap on a fetched PDF, matching the notes-image PDF cap. */
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Injectable side-effects — overridden in tests. */
export interface PaperIngestDeps {
    /** Fetch a PDF by URL and return its bytes. Throws on network / HTTP error. */
    fetchPdf: (url: string) => Promise<Buffer>;
    /** Extract the full text of a PDF buffer (defaults to pdfjs extraction). */
    extractText: (buffer: Buffer) => Promise<string>;
}

/** Default fetch using the global fetch (Node 18+), with a size guard. */
async function defaultFetchPdf(pdfUrl: string): Promise<Buffer> {
    const res = await fetch(pdfUrl, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`Fetch failed with HTTP ${res.status}`);
    }
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length > MAX_PDF_SIZE_BYTES) {
        throw new Error(`PDF too large (${Math.round(buffer.length / 1024 / 1024)}MB)`);
    }
    return buffer;
}

export interface PaperIngestRouteOptions {
    routes: Route[];
    store: ProcessStore;
    dataDir: string;
    /** Live getter for the admin `features.quickAskSidenotes` flag. */
    getEnabled: () => boolean;
    /** Optional dependency overrides (tests inject stubs). */
    deps?: Partial<PaperIngestDeps>;
}

/** Resolve the absolute `.papers` cache directory for a notes root, path-safely. */
async function resolvePapersDir(
    resolved: ResolvedNotesRoot,
): Promise<string | { error: string; statusCode: number }> {
    if (resolved.isDefault) {
        return path.join(resolved.absolutePath, PAPERS_DIR);
    }
    const safe = await resolveSafeNotesPath(resolved.absolutePath, PAPERS_DIR);
    if (isNotesPathSafetyError(safe)) {
        return { error: safe.error, statusCode: safe.statusCode };
    }
    return safe.absolutePath;
}

/**
 * Register the paper-ingest route on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerPaperIngestRoutes(opts: PaperIngestRouteOptions): void {
    const { routes, store, dataDir, getEnabled } = opts;
    const fetchPdf = opts.deps?.fetchPdf ?? defaultFetchPdf;
    const extractText = opts.deps?.extractText ?? extractPdfText;

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/paper-ingest
    // Body: { url, root? }
    // → 200 { arxivId, pdfPath, textPath, cached }
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/paper-ingest$/,
        handler: async (req, res, match) => {
            if (!getEnabled()) return sendError(res, 404, 'Quick Ask is disabled');

            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { url: inputUrl, root: rootParam } = body || {};
            const arxiv = recognizeArxivUrl(inputUrl);
            if (!arxiv) {
                return sendError(res, 400, 'Not a recognized arXiv URL');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const resolved = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(resolved)) {
                return sendError(res, resolved.statusCode, resolved.error);
            }

            const papersDir = await resolvePapersDir(resolved);
            if (typeof papersDir !== 'string') {
                return sendError(res, papersDir.statusCode, papersDir.error);
            }

            const pdfFileName = `${arxiv.filename}.pdf`;
            const textFileName = `${arxiv.filename}.txt`;
            const pdfAbsPath = path.join(papersDir, pdfFileName);
            const textAbsPath = path.join(papersDir, textFileName);
            const pdfPath = `${PAPERS_DIR}/${pdfFileName}`;
            const textPath = `${PAPERS_DIR}/${textFileName}`;

            try {
                await fs.promises.mkdir(papersDir, { recursive: true });

                // AC-01: fetch + cache the PDF once. Reuse the cache if present so a
                // re-paste is offline-capable and link-rot proof.
                let cached = true;
                if (!fs.existsSync(pdfAbsPath)) {
                    cached = false;
                    const buffer = await fetchPdf(arxiv.pdfUrl);
                    if (!buffer || buffer.length === 0) {
                        return sendError(res, 502, 'Fetched an empty PDF');
                    }
                    await fs.promises.writeFile(pdfAbsPath, buffer);
                }

                // AC-02: extract the paper text once into a sidecar for grounding.
                if (!fs.existsSync(textAbsPath)) {
                    try {
                        const pdfBuffer = await fs.promises.readFile(pdfAbsPath);
                        const text = await extractText(pdfBuffer);
                        await fs.promises.writeFile(textAbsPath, text ?? '', 'utf-8');
                    } catch {
                        // Text extraction is best-effort — a cached PDF with no text
                        // sidecar still satisfies AC-01 and can be re-extracted later.
                    }
                }

                sendJSON(res, 200, {
                    arxivId: arxiv.arxivId,
                    pdfUrl: arxiv.pdfUrl,
                    absUrl: arxiv.absUrl,
                    pdfPath,
                    textPath: fs.existsSync(textAbsPath) ? textPath : null,
                    rootId: resolved.rootId,
                    cached,
                });
            } catch (err: any) {
                return sendError(res, 502, 'Failed to ingest paper: ' + (err?.message || String(err)));
            }
        },
    });
}
