/**
 * The shape `previewWorkspaceFile` hands back, and how to preserve its file type.
 *
 * Lives apart from `useSourceCanvasContent` because it describes the transport,
 * not the hook: the server may answer with whole `content` or with a `lines`
 * array, and every field is best-effort, so the hook shouldn't have to carry
 * that shape around.
 */
import type { FileBlob } from '../../../shared/file-viewer/types';

/** What `previewWorkspaceFile` may hand back — every field is best-effort. */
export interface PreviewResponse {
    type?: unknown;
    mimeType?: unknown;
    content?: unknown;
    lines?: unknown;
    language?: unknown;
    /** Absolute path the server settled on (a repo-group ref is sent relative). */
    path?: unknown;
    /** Member workspace that actually owns the file, for repo attribution. */
    resolvedWorkspaceId?: unknown;
}

/** Adapt text/image previews to the shared viewer's blob contract. */
export function toFileBlob(res: PreviewResponse): FileBlob {
    if (res.type === 'image-too-large') {
        throw new Error('Image too large to preview (max 2 MB).');
    }
    if (res.type === 'image') {
        if (typeof res.content !== 'string' || typeof res.mimeType !== 'string' || !res.mimeType.startsWith('image/')) {
            throw new Error('Invalid image preview');
        }
        return { content: res.content, encoding: 'base64', mimeType: res.mimeType };
    }
    return {
        content: extractContent(res),
        encoding: 'utf-8',
        mimeType: 'text/plain',
        language: typeof res.language === 'string' ? res.language : '',
    };
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
