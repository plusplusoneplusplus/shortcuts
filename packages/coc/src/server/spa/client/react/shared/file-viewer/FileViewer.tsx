/**
 * FileViewer — picks one rendering for a loaded blob: rendered markdown (only
 * when the host opts in with `markdown="toggle"`), image, binary placeholder,
 * or Monaco. Every capability is opt-in by prop, so a host renders exactly what
 * it rendered before moving here. Loading/error chrome stays with the host.
 */
import type { editor as monacoEditor } from 'monaco-editor';
import { MarkdownFileView, isMarkdownFile } from './MarkdownFileView';
import { MonacoFileEditor, getMonacoLanguage, type EditorModelMountContext } from './MonacoFileEditor';
import type { FileBlob, LineRange } from './types';

export interface FileViewerProps {
    /** The bytes to show. `content` is already truncated/edited by the host. */
    blob: FileBlob;
    /** Used to derive the Monaco language and to detect markdown. */
    fileName: string;
    /** Optional server-reported language hint (helps detect markdown). */
    language?: string;
    readOnly?: boolean;
    /** `changes` is Monaco's own change list; hosts that mirror text ignore it. */
    onChange?: (value: string, changes: readonly monacoEditor.IModelContentChange[]) => void;
    onSave?: () => void;
    /**
     * Diagnostics for the Monaco branch, forwarded verbatim. Only a host that
     * has decided this blob is a live repo document passes them; the markdown,
     * image and binary branches have no editor to publish into.
     */
    markers?: readonly monacoEditor.IMarkerData[];
    /**
     * Handed the live `monaco` namespace and text model for the Monaco branch,
     * so a host that has decided this blob is a live repo document can register
     * language providers against exactly that model. The other branches have no
     * editor, so they never call it.
     */
    onModelMount?: (context: EditorModelMountContext) => (() => void) | void;
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
    highlightRange, revealLine, markdown = 'off', codeTestId, markers, onModelMount,
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
                markers={markers}
                onModelMount={onModelMount}
            />
        </div>
    );
}
