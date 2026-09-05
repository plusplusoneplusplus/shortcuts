/**
 * Shared file-viewer types.
 *
 * Neutral ground between the Explorer preview pane and the chat source canvas:
 * both view the same thing (one file's bytes) but fetch it over different
 * transports, so the shape they agree on is the blob, not the request.
 */

/** One file's bytes as returned by whichever transport the host injected. */
export interface FileBlob {
    /** Text when `encoding` is 'utf-8', base64 payload when 'base64'. */
    content: string;
    encoding: 'utf-8' | 'base64';
    mimeType: string;
}

/** What a viewer buffer is doing: fetching, failed, or showing content. */
export type FileViewerStatus = 'loading' | 'error' | 'ready';

/** One-based inclusive line range (`end === start` for a single line). */
export interface LineRange {
    start: number;
    end: number;
}
