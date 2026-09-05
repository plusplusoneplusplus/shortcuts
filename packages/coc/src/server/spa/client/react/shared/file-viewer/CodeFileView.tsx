/**
 * CodeFileView — full-bleed Monaco for one file's text.
 *
 * A thin layout wrapper so every host renders Monaco inside the same box.
 * Read-only hosts simply omit `onChange`/`onSave` and pass `readOnly`.
 */
import { MonacoFileEditor } from './MonacoFileEditor';
import type { LineRange } from './types';

export interface CodeFileViewProps {
    content: string;
    /** Monaco language ID, e.g. `getMonacoLanguage(fileName)`. */
    language: string | null;
    readOnly?: boolean;
    onChange?: (value: string) => void;
    onSave?: () => void;
    /** Line range to highlight + centre (from a `:line` / `:start-end` ref). */
    highlightRange?: LineRange | null;
    /** One-based line to scroll into view only (from a content-search hit). */
    revealLine?: number;
    testId?: string;
}

export function CodeFileView({
    content, language, readOnly, onChange, onSave, highlightRange, revealLine, testId,
}: CodeFileViewProps) {
    return (
        <div className="h-full w-full min-h-0" data-testid={testId}>
            <MonacoFileEditor
                value={content}
                language={language}
                readOnly={readOnly}
                onChange={onChange}
                onSave={onSave}
                highlightRange={highlightRange ?? null}
                revealLine={revealLine}
            />
        </div>
    );
}
