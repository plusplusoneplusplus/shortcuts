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
import { FileViewer, toLines, resolveLineRange } from '../../../shared/file-viewer';

export interface SourceCanvasBodyProps {
    /** File name (used to detect markdown + derive the editor language). */
    fileName: string;
    /** Full file text. */
    content: string;
    /** Optional server-reported language hint (helps detect markdown). */
    language?: string;
    /** Target (start) line to scroll to + highlight, when the ref carried one. */
    line?: number;
    /** End line of a highlighted range, when the ref carried `:start-end`. */
    endLine?: number;
}

/** Render the loaded canvas content: formatted markdown vs the code viewer. */
export function SourceCanvasBody({ fileName, content, language, line, endLine }: SourceCanvasBodyProps) {
    const range = resolveLineRange(line, endLine, toLines(content).length);
    return (
        <FileViewer
            blob={{ content, encoding: 'utf-8', mimeType: 'text/plain' }}
            fileName={fileName}
            language={language}
            readOnly
            markdown="toggle"
            highlightRange={range}
            codeTestId="source-canvas-source"
        />
    );
}
