/**
 * Client-side Markdown export for paper annotations (Goal 4 AC-03, client half).
 *
 * The server route
 *   GET /api/workspaces/:id/notes/paper-annotations/export?path=&root=&title=
 * renders the per-note annotation sidecar into a portable Markdown document (see
 * server `paper-annotations-export.ts`, which returns `{ markdown, count }`). This
 * module builds that request URL and downloads the returned document as a `.md`
 * file from the browser.
 *
 * The URL/filename helpers are pure so they can be unit-tested without a DOM; the
 * download itself is a thin transient-`<a download>` click, mirroring the canvas
 * HTML export's `browserDownload`.
 */

/** Shape of the export route's JSON response. */
export interface PaperAnnotationsExportResponse {
    markdown: string;
    count: number;
}

/** Build the flag-gated export route URL for a note's paper annotations. */
export function paperAnnotationsExportUrl(
    workspaceId: string,
    notePath: string,
    root?: string,
    title?: string,
): string {
    const params = new URLSearchParams({ path: notePath });
    if (root) { params.set('root', root); }
    if (title) { params.set('title', title); }
    return `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/paper-annotations/export?${params.toString()}`;
}

/**
 * A friendly `.md` filename derived from the note path basename, e.g.
 * `papers/deep-dive.md` → `deep-dive.annotations.md`. Falls back to `paper` when
 * the path is empty so the download always has a sensible name.
 */
export function exportAnnotationsFilename(notePath: string | null | undefined): string {
    const base = (notePath || '').split(/[\\/]/).filter(Boolean).pop() || '';
    const stem = base.replace(/\.md$/i, '').trim();
    return `${stem || 'paper'}.annotations.md`;
}

/**
 * Download `markdown` as a `.md` file via a transient `<a download>` click.
 * Browser-only; guards keep it from throwing in non-DOM contexts (SSR/tests).
 */
export function downloadMarkdown(filename: string, markdown: string): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
        return;
    }
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
