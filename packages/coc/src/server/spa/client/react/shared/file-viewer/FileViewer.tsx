/**
 * FileViewer — picks one rendering for a loaded blob: rendered markdown (only
 * when the host opts in with `markdown="toggle"`), image, binary placeholder,
 * or Monaco. Every capability is opt-in by prop, so a host renders exactly what
 * it rendered before moving here. Loading/error chrome stays with the host.
 */
import { MarkdownFileView, isMarkdownFile } from './MarkdownFileView';
import { MonacoFileEditor, getMonacoLanguage } from './MonacoFileEditor';
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
        <div className="h-full w-full min-h-0" data-testid={codeTestId}>
            <MonacoFileEditor
                value={blob.content}
                language={getMonacoLanguage(fileName)}
                readOnly={readOnly}
                onChange={onChange}
                onSave={onSave}
                highlightRange={highlightRange ?? null}
                revealLine={revealLine}
            />
        </div>
    );
}
