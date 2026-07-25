/**
 * Paper Annotations — shared type definitions.
 *
 * A paper annotation is a persisted Quick Ask Q&A anchored to a passage inside a
 * PDF rendered in a note (Goal 2). It stores a **dual anchor** following the W3C
 * Web Annotation model:
 *
 *  - a {@link PaperTextQuoteSelector} — the same `{selectedText, contextBefore,
 *    contextAfter}` shape the existing sidenote/comment resolver already knows how
 *    to re-resolve against re-extracted page text (robust to reflow), and
 *  - an optional {@link PaperRectAnchor} — normalized page + bounding boxes for a
 *    pixel-exact highlight on the pdf.js canvas overlay.
 *
 * Resolve by quote first; fall back to page+rects for the visual highlight.
 *
 * Pure types, no runtime dependencies. Safe to import from server and client code.
 */

/** Text-quote half of the dual anchor (unchanged shape from the sidenote loop). */
export interface PaperTextQuoteSelector {
    /** The exact passage that was selected in the paper. */
    selectedText: string;
    /** Surrounding page text before the selection (± context window). */
    contextBefore: string;
    /** Surrounding page text after the selection (± context window). */
    contextAfter: string;
}

/** A single normalized bounding box (fractions 0..1 of the page dimensions). */
export interface PaperRect {
    /** Left edge as a fraction of page width. */
    x: number;
    /** Top edge as a fraction of page height. */
    y: number;
    /** Width as a fraction of page width. */
    width: number;
    /** Height as a fraction of page height. */
    height: number;
}

/** Geometric half of the dual anchor: page + normalized rects for pixel highlight. */
export interface PaperRectAnchor {
    /** 1-based page number the selection lives on. */
    page: number;
    /** One or more normalized bounding boxes (multi-line selections span several). */
    rects: PaperRect[];
}

/** A persisted Q&A anchored to a passage in a paper. */
export interface PaperAnnotation {
    /** UUID v4 identifier. */
    id: string;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** ISO 8601 timestamp of last edit, if edited. */
    updatedAt?: string;
    /** The PDF this annotation belongs to (a note may embed several papers). */
    pdfUrl: string;
    /** Text-quote anchor — the primary, reflow-robust locator. */
    quote: PaperTextQuoteSelector;
    /** Optional geometric anchor for a pixel-accurate overlay highlight. */
    position?: PaperRectAnchor;
    /** The user's question, if they typed a custom one. */
    question?: string;
    /** The AI answer (Markdown). */
    answer: string;
    /** The model that produced the answer, if known. */
    model?: string;
}

/** Sidecar file format — persisted as `<note-path>.paper-annotations.json`. */
export interface PaperAnnotationsSidecar {
    /** Schema version for future migrations. */
    version: 1;
    /** Map of annotation ID → PaperAnnotation. */
    annotations: Record<string, PaperAnnotation>;
}

/** Create an empty sidecar object with no annotations. */
export function createEmptyPaperAnnotationsSidecar(): PaperAnnotationsSidecar {
    return { version: 1, annotations: {} };
}

/**
 * Validate a client-supplied dual anchor draft. Returns an error string if the
 * shape is unusable, or `undefined` if it is safe to persist. The geometric
 * `position` is optional; the text quote is mandatory (it is what keeps the
 * annotation resolvable after re-extraction).
 */
export function validateAnnotationDraft(draft: unknown): string | undefined {
    if (!draft || typeof draft !== 'object') {
        return 'Missing annotation body';
    }
    const d = draft as Record<string, unknown>;
    if (typeof d.pdfUrl !== 'string' || d.pdfUrl.trim().length === 0) {
        return 'Missing required field: pdfUrl';
    }
    if (typeof d.answer !== 'string' || d.answer.trim().length === 0) {
        return 'Missing required field: answer';
    }
    const quote = d.quote as Record<string, unknown> | undefined;
    if (!quote || typeof quote !== 'object') {
        return 'Missing required field: quote';
    }
    if (typeof quote.selectedText !== 'string' || quote.selectedText.trim().length === 0) {
        return 'Missing required field: quote.selectedText';
    }
    if (d.position !== undefined) {
        const pos = d.position as Record<string, unknown>;
        if (typeof pos.page !== 'number' || !Number.isFinite(pos.page) || pos.page < 1) {
            return 'Invalid field: position.page';
        }
        if (!Array.isArray(pos.rects)) {
            return 'Invalid field: position.rects';
        }
    }
    return undefined;
}

/**
 * Coerce a validated draft into a stored {@link PaperAnnotation}, keeping only
 * the known fields (drops anything extra a client sent).
 */
export function normalizeAnnotationDraft(
    draft: Record<string, unknown>,
    id: string,
    createdAt: string,
): PaperAnnotation {
    const quote = draft.quote as Record<string, unknown>;
    const annotation: PaperAnnotation = {
        id,
        createdAt,
        pdfUrl: String(draft.pdfUrl),
        quote: {
            selectedText: String(quote.selectedText),
            contextBefore: typeof quote.contextBefore === 'string' ? quote.contextBefore : '',
            contextAfter: typeof quote.contextAfter === 'string' ? quote.contextAfter : '',
        },
        answer: String(draft.answer),
    };
    if (typeof draft.question === 'string' && draft.question.trim()) {
        annotation.question = draft.question.trim();
    }
    if (typeof draft.model === 'string' && draft.model.trim()) {
        annotation.model = draft.model.trim();
    }
    if (draft.position && typeof draft.position === 'object') {
        const pos = draft.position as Record<string, unknown>;
        const rects = Array.isArray(pos.rects) ? pos.rects : [];
        annotation.position = {
            page: Number(pos.page),
            rects: rects
                .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
                .map(r => ({
                    x: Number(r.x) || 0,
                    y: Number(r.y) || 0,
                    width: Number(r.width) || 0,
                    height: Number(r.height) || 0,
                })),
        };
    }
    return annotation;
}
