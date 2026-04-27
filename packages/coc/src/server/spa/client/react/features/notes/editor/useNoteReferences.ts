import { useState, useCallback } from 'react';

export interface NoteTextReference {
    id: string;
    /** Selected text, capped at TEXT_SIZE_LIMIT characters. */
    text: string;
    /** First 80 chars of the text on a single line, for chip display. */
    preview: string;
    noteTitle: string;
    notePath: string;
    /** True when the original selection exceeded TEXT_SIZE_LIMIT and was truncated. */
    truncated?: boolean;
}

export const NOTE_REFERENCE_MAX = 5;
const PREVIEW_LENGTH = 80;
const TEXT_SIZE_LIMIT = 4000;

let nextRefId = 0;

function makePreview(text: string): string {
    const oneLine = text.replace(/\n/g, ' ').trim();
    if (oneLine.length <= PREVIEW_LENGTH) return oneLine;
    return oneLine.slice(0, PREVIEW_LENGTH) + '…';
}

export interface UseNoteReferencesReturn {
    references: NoteTextReference[];
    addReference: (text: string, notePath: string, noteTitle: string) => void;
    removeReference: (id: string) => void;
    clearReferences: () => void;
    isAtMax: boolean;
}

export function useNoteReferences(): UseNoteReferencesReturn {
    const [references, setReferences] = useState<NoteTextReference[]>([]);

    const addReference = useCallback((text: string, notePath: string, noteTitle: string) => {
        setReferences(prev => {
            if (prev.length >= NOTE_REFERENCE_MAX) return prev;
            const truncated = text.length > TEXT_SIZE_LIMIT;
            const stored = truncated ? text.slice(0, TEXT_SIZE_LIMIT) : text;
            const ref: NoteTextReference = {
                id: `note-ref-${++nextRefId}`,
                text: stored,
                preview: makePreview(stored),
                noteTitle,
                notePath,
                truncated: truncated || undefined,
            };
            return [...prev, ref];
        });
    }, []);

    const removeReference = useCallback((id: string) => {
        setReferences(prev => prev.filter(r => r.id !== id));
    }, []);

    const clearReferences = useCallback(() => {
        setReferences([]);
    }, []);

    return {
        references,
        addReference,
        removeReference,
        clearReferences,
        isAtMax: references.length >= NOTE_REFERENCE_MAX,
    };
}

/**
 * Format note references into an XML block to prepend to the user message.
 * Consistent with the <context> block pattern used by formatAttachedContext.
 */
export function formatNoteReferences(refs: NoteTextReference[]): string {
    if (refs.length === 0) return '';
    return refs.map(r =>
        `<note_reference path="${r.notePath}" title="${r.noteTitle}">\n${r.text}\n</note_reference>`
    ).join('\n\n') + '\n\n';
}
