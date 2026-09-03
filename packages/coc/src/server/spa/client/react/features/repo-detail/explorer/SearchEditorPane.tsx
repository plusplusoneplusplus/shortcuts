/**
 * SearchEditorPane — the read-only buffer "Open in Editor" puts in the preview
 * pane (§2.7).
 *
 * Deliberately a `<pre>`, not Monaco: the buffer is a result listing, not a
 * source file, so there is nothing to syntax-highlight, nothing to edit and no
 * reason to pull the editor into this path. It keeps the pane cheap to render
 * and cheap to test.
 */

export interface SearchEditorPaneProps {
    /** The query the buffer reports, shown in the title bar. */
    query: string;
    /** The buffer text, already built by `buildSearchEditorText`. */
    text: string;
    /** Close the buffer and go back to whatever the preview pane was showing. */
    onClose: () => void;
}

export function SearchEditorPane({ query, text, onClose }: SearchEditorPaneProps) {
    return (
        <div className="flex flex-col w-full h-full" data-testid="search-editor-pane">
            <div className="flex items-center gap-2 h-9 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] flex-shrink-0">
                <span className="text-xs text-[#616161] dark:text-[#cccccc] truncate flex-1">
                    Search: {query}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    title="Close"
                    aria-label="Close search editor"
                    className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] bg-transparent border-none cursor-pointer"
                    data-testid="search-editor-close"
                >
                    ✕
                </button>
            </div>
            <pre
                className="flex-1 min-h-0 overflow-auto m-0 px-3 py-2 text-xs font-mono whitespace-pre text-[#1e1e1e] dark:text-[#cccccc]"
                data-testid="search-editor-text"
            >
                {text}
            </pre>
        </div>
    );
}
