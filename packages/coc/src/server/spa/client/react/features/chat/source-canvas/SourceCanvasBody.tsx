/**
 * SourceCanvasBody — renders loaded source-canvas content (AC-04 + AC-05).
 *
 * A thin adapter over the shared `FileViewer`: read-only, markdown on the
 * Rendered ⇄ Raw toggle, and the referenced line range highlighted + centred.
 *
 * AC-05: when the reference carried a `:line` / `:start-end` suffix, the target
 * line(s) are highlighted and the first is auto-scrolled into view. In the code
 * view that is a Monaco whole-line decoration; rendered markdown reuses the
 * renderer's own `.md-line[data-line]` rows. No line ref → the file opens at the
 * top with no highlight.
 */
import { FileViewer } from '../../../shared/file-viewer/FileViewer';
import { toLines, resolveLineRange } from '../../../shared/file-viewer/lineRange';
import type { FileBlob } from '../../../shared/file-viewer/types';

export interface SourceCanvasBodyProps {
    /** File name (used to detect markdown + derive the editor language). */
    fileName: string;
    content: string;
    encoding?: FileBlob['encoding'];
    mimeType?: string;
    /** Optional server-reported language hint (helps detect markdown). */
    language?: string;
    /** Target (start) line to scroll to + highlight, when the ref carried one. */
    line?: number;
    /** End line of a highlighted range, when the ref carried `:start-end`. */
    endLine?: number;
}

/** Render loaded text or image content through the shared file viewer. */
export function SourceCanvasBody({
    fileName, content, encoding = 'utf-8', mimeType = 'text/plain', language, line, endLine,
}: SourceCanvasBodyProps) {
    const range = encoding === 'utf-8' ? resolveLineRange(line, endLine, toLines(content).length) : null;
    return (
        <FileViewer
            blob={{ content, encoding, mimeType }}
            fileName={fileName}
            language={language}
            readOnly
            markdown="toggle"
            highlightRange={range}
            codeTestId="source-canvas-source"
        />
    );
}
