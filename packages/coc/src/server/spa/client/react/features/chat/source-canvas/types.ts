/**
 * Types for the docked, read-only source-file canvas panel.
 *
 * A `SourceCanvasFileRef` is what the chat-link click handler hands to the
 * panel: the *bare* path to resolve/fetch plus the optional `:line`/`:start-end`
 * info that travels separately for scroll + highlight (never folded into the
 * fetched path).
 */
export interface SourceCanvasFileRef {
    /**
     * The bare file path to resolve + fetch — never includes a `:line` suffix.
     * May be absolute (matched against a workspace `rootPath`) or relative
     * (resolved against `sourceFilePath` or the workspace root).
     */
    fullPath: string;
    /** Optional path to show in the header (defaults to `fullPath`). */
    displayPath?: string;
    /** Target (start) line to scroll to + highlight, when the ref carried one. */
    line?: number;
    /** End line of a highlighted range, when the ref carried `:start-end`. */
    endLine?: number;
    /** The file the (possibly relative) reference appeared in — for resolution. */
    sourceFilePath?: string;
    /** Workspace-id hint from the clicked container, if known. */
    wsId?: string;
}
