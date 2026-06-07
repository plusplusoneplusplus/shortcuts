import { useState, useCallback } from 'react';

/** Minimum character count before content is considered a "large paste". Matches server-side PASTE_THRESHOLD. */
export const CLIENT_PASTE_THRESHOLD = 16_384;

export const DEFAULT_PASTE_PREVIEW_LINES = 3;

export function getPastePreviewLines(text: string, maxPreviewLines: number = DEFAULT_PASTE_PREVIEW_LINES): string[] {
    return text.split('\n')
        .slice(0, maxPreviewLines)
        .map(line => line.length > 120 ? line.slice(0, 120) + '…' : line);
}

export interface UseTextPasteResult {
    /** The raw pasted content (only set when it exceeds the threshold) */
    pastedContent: string | null;
    /** Character count of the pasted content */
    charCount: number;
    /** First N lines of the pasted content for preview */
    previewLines: string[];
    /** Paste event handler — attach to textarea's onPaste */
    addFromPaste: (e: React.ClipboardEvent) => void;
    /** Clear the detected paste state */
    clearPaste: () => void;
}

export function useTextPaste(
    threshold: number = CLIENT_PASTE_THRESHOLD,
    maxPreviewLines: number = DEFAULT_PASTE_PREVIEW_LINES,
): UseTextPasteResult {
    const [pastedContent, setPastedContent] = useState<string | null>(null);
    const [charCount, setCharCount] = useState(0);
    const [previewLines, setPreviewLines] = useState<string[]>([]);

    const addFromPaste = useCallback((e: React.ClipboardEvent) => {
        const text = e.clipboardData?.getData('text/plain');
        if (!text || text.length <= threshold) return;

        // Prevent the raw text from flooding the input — the PastePreview chip serves as the visual reference
        e.preventDefault();

        setPastedContent(text);
        setCharCount(text.length);
        setPreviewLines(getPastePreviewLines(text, maxPreviewLines));
    }, [threshold, maxPreviewLines]);

    const clearPaste = useCallback(() => {
        setPastedContent(null);
        setCharCount(0);
        setPreviewLines([]);
    }, []);

    return { pastedContent, charCount, previewLines, addFromPaste, clearPaste };
}
