/** Shared file-viewer vocabulary: the hosts agree on the blob, not the request. */

/** One file's bytes as returned by whichever transport the host injected. */
export interface FileBlob {
    /** Text when `encoding` is 'utf-8', base64 payload when 'base64'. */
    content: string;
    encoding: 'utf-8' | 'base64';
    mimeType: string;
    /**
     * Optional language hint from the transport, when it reports one. Purely
     * additive — hosts whose transport says nothing about language leave it
     * unset and derive the language from the file name instead.
     */
    language?: string;
}

/** What a viewer buffer is doing: fetching, failed, or showing content. */
export type FileViewerStatus = 'loading' | 'error' | 'ready';

/** One-based inclusive line range (`end === start` for a single line). */
export interface LineRange {
    start: number;
    end: number;
}
