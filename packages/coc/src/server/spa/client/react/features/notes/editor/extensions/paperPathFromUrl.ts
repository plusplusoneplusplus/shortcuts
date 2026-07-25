/**
 * paperPathFromPdfUrl — recover the cached `.papers/<id>.pdf` relpath from a
 * rendered PDF embed URL (Goal 3, AC-04 client half).
 *
 * A PDF embedded from an ingested arXiv paper renders through the notes image
 * API — the node's `url` attr (inline) or the resolved href (full-window) looks
 * like `/api/workspaces/<ws>/notes/image?path=.papers%2F1802.05799.pdf&root=…`.
 * The whole-paper grounding path on `POST /api/quick-ask/answer` needs the plain
 * cache relpath (`.papers/1802.05799.pdf`) so it can locate the sibling `.txt`
 * sidecar. This pulls that relpath back out of the URL, or returns `undefined`
 * when the URL is not a cached-paper embed (an arbitrary uploaded PDF, an
 * external hotlink, a malformed URL) — in which case the "use full paper" toggle
 * is simply not offered.
 *
 * The check mirrors the server's `paperTextSidecarRelPath` guard (single
 * basename under the papers cache, `.pdf` extension, no traversal) so the client
 * never shows the toggle for a paper the server would reject anyway. The server
 * re-validates regardless — this is purely a UI affordance gate.
 *
 * Pure; no DOM, no imports.
 */

/** The papers cache dir the arXiv ingest handler writes into (mirrors server `PAPERS_DIR`). */
const PAPERS_PREFIX = '.papers/';

export function paperPathFromPdfUrl(pdfUrl: string | undefined | null): string | undefined {
    if (!pdfUrl) {return undefined;}
    let query: string | null;
    try {
        // pdfUrl may be relative (inline node attr) or absolute (full-window
        // href); a base makes both parse. The base host is irrelevant — only the
        // `path` query param is read.
        const parsed = new URL(pdfUrl, 'http://localhost');
        query = parsed.searchParams.get('path');
    } catch {
        return undefined;
    }
    if (!query) {return undefined;}
    const norm = query.replace(/\\/g, '/').trim();
    if (!norm.startsWith(PAPERS_PREFIX)) {return undefined;}
    if (!/\.pdf$/i.test(norm)) {return undefined;}
    const base = norm.slice(PAPERS_PREFIX.length);
    // Single plain basename only — no nested dirs, no traversal (server rejects
    // these too, but keep the toggle honest).
    if (!base || base.includes('/') || base.includes('..')) {return undefined;}
    return norm;
}
