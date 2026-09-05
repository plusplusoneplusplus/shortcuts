/**
 * FileViewer — presentational core shared by every file-viewing panel.
 *
 * Picks one of four renderings for a loaded blob: rendered markdown (only when
 * the host opts in with `markdown="toggle"`), an image, a binary placeholder,
 * or Monaco. Loading and error chrome stay with the host, because the two
 * panels frame them differently.
 *
 * Every capability is opt-in by prop, so a host renders exactly what it
 * rendered before it moved onto this component.
 */
import { CodeFileView } from './CodeFileView';
import { MarkdownFileView, isMarkdownFile } from './MarkdownFileView';
import { getMonacoLanguage } from './MonacoFileEditor';
import type { FileBlob, LineRange } from './types';

export interface FileViewerProps {
    /** The bytes to show. `content` is already truncated/edited by the host. */
    blob: FileBlob;
    /** Used to derive the Monaco language and to detect markdown. */
    fileName: string;
    /** Optional server-reported language hint (helps detect markdown). */
    language?: string;
    readOnly?: boolean;
    onChange?: (value: string) => void;
    onSave?: () => void;
    /** Line range to highlight + centre (from a `:line` / `:start-end` ref). */
    highlightRange?: LineRange | null;
    /** One-based line to scroll into view only (from a content-search hit). */
    revealLine?: number;
    /**
     * `'off'` (the default) renders markdown as source in Monaco, like any
     * other file. `'toggle'` renders it formatted with a Rendered ⇄ Raw switch.
     */
    markdown?: 'off' | 'toggle';
    /** Test id for the Monaco container, which differs per host. */
    codeTestId?: string;
}

/** Human-readable byte count for the binary placeholder. */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewer({
    blob, fileName, language, readOnly, onChange, onSave,
    highlightRange, revealLine, markdown = 'off', codeTestId,
}: FileViewerProps) {
    if (blob.encoding === 'base64') {
        // The `preview-*` test ids are historical — the Explorer preview pane is
        // still the only host that fetches non-text blobs.
        return blob.mimeType.startsWith('image/') ? (
            <div className="flex items-center justify-center p-4 h-full" data-testid="preview-image">
                <img
                    src={`data:${blob.mimeType};base64,${blob.content}`}
                    alt={fileName}
                    className="max-w-full max-h-[80vh] object-contain"
                />
            </div>
        ) : (
            <div className="flex flex-col items-center justify-center gap-2 h-full text-sm text-[#848484]" data-testid="preview-binary">
                <span className="text-2xl">📄</span>
                <span>Binary file — {formatFileSize(blob.content.length)} bytes</span>
            </div>
        );
    }

    if (markdown === 'toggle' && isMarkdownFile(fileName, language)) {
        return (
            <MarkdownFileView
                content={blob.content}
                range={highlightRange}
                codeTestId={codeTestId}
            />
        );
    }

    return (
        <CodeFileView
            content={blob.content}
            language={getMonacoLanguage(fileName)}
            readOnly={readOnly}
            onChange={onChange}
            onSave={onSave}
            highlightRange={highlightRange}
            revealLine={revealLine}
            testId={codeTestId}
        />
    );
}
