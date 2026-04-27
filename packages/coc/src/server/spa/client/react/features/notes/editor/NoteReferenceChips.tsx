import { NOTE_REFERENCE_MAX } from './useNoteReferences';
import type { NoteTextReference } from './useNoteReferences';

export interface NoteReferenceChipsProps {
    references: NoteTextReference[];
    onRemove: (id: string) => void;
    className?: string;
}

export function NoteReferenceChips({ references, onRemove, className }: NoteReferenceChipsProps) {
    if (references.length === 0) return null;

    return (
        <div
            className={`flex flex-col gap-1 ${className ?? ''}`}
            data-testid="note-reference-chips"
        >
            {references.map(ref => (
                <div
                    key={ref.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#2d2d2d] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                    data-testid="note-reference-chip"
                >
                    <span className="shrink-0">📎</span>
                    <span
                        className="shrink-0 font-medium text-[10px] uppercase tracking-wide text-[#848484]"
                        title={ref.notePath}
                    >
                        {ref.noteTitle}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[#1e1e1e] dark:text-[#cccccc]">
                        {ref.preview}
                    </span>
                    {ref.truncated && (
                        <span
                            className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400"
                            title="Selection exceeded 4000 characters and was truncated"
                            data-testid="note-reference-chip-truncated"
                        >
                            ⚠ truncated
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => onRemove(ref.id)}
                        title="Remove reference"
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-transparent border-none text-[#848484] hover:text-[#f14c4c] cursor-pointer text-sm"
                        data-testid="note-reference-chip-remove"
                    >
                        ×
                    </button>
                </div>
            ))}
            {references.length >= NOTE_REFERENCE_MAX && (
                <div
                    className="text-[10px] text-[#848484] px-1"
                    data-testid="note-reference-max-notice"
                >
                    Max {NOTE_REFERENCE_MAX} references reached
                </div>
            )}
        </div>
    );
}
