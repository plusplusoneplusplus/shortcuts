/**
 * The shape `previewWorkspaceFile` hands back, and how to read text out of it.
 *
 * Lives apart from `useSourceCanvasContent` because it describes the transport,
 * not the hook: the server may answer with whole `content` or with a `lines`
 * array, and every field is best-effort, so the hook shouldn't have to carry
 * that shape around.
 */

/** What `previewWorkspaceFile` may hand back — every field is best-effort. */
export interface PreviewResponse {
    content?: unknown;
    lines?: unknown;
    language?: unknown;
    /** Absolute path the server settled on (a repo-group ref is sent relative). */
    path?: unknown;
    /** Member workspace that actually owns the file, for repo attribution. */
    resolvedWorkspaceId?: unknown;
}

/** Reconstruct full text from a `previewWorkspaceFile` response. */
export function extractContent(res: PreviewResponse): string {
    if (typeof res.content === 'string') {
        return res.content;
    }
    if (Array.isArray(res.lines)) {
        return (res.lines as unknown[])
            .map((line) => (typeof line === 'string' ? line : ''))
            .join('\n');
    }
    return '';
}
