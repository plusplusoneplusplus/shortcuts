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

/**
 * Region anchor: a drag-a-box over a figure/equation (Goal 4 AC-01).
 *
 * Unlike the text-quote + rects dual anchor, a region has **no selectable text** —
 * it is a single box on a single page whose cropped image is sent to a vision
 * model at ask time. Only the box is persisted here (so it can be re-highlighted
 * on reload); the crop image itself is not stored in the sidecar.
 */
export interface PaperRegionAnchor {
    /** 1-based page number the box lives on. */
    page: number;
    /** The single normalized bounding box (fractions 0..1 of the page dimensions). */
    rect: PaperRect;
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
    /**
     * Text-quote anchor — the primary, reflow-robust locator. Optional because a
     * {@link region} (figure/equation) annotation has no selectable text; every
     * annotation carries at least one of `quote` or `region`.
     */
    quote?: PaperTextQuoteSelector;
    /** Optional geometric anchor for a pixel-accurate overlay highlight. */
    position?: PaperRectAnchor;
    /**
     * Region anchor for a figure/equation drag-a-box (Goal 4 AC-01). Present
     * instead of (or alongside) `quote` when the annotation targets a
     * non-text region whose crop was sent to a vision model.
     */
    region?: PaperRegionAnchor;
    /** The user's question, if they typed a custom one. */
    question?: string;
    /** The AI answer (Markdown). */
    answer: string;
    /** The model that produced the answer, if known. */
    model?: string;
    /**
     * Whether the user has marked this annotation resolved (Goal 4 AC-02).
     * Mirrors the notes-comments thread `status: 'resolved'` — resolved
     * annotations are filtered out of the default view but never deleted.
     */
    resolved?: boolean;
    /** ISO 8601 timestamp when resolved, if resolved. */
    resolvedAt?: string;
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

/** True when a draft's `quote` carries a non-blank `selectedText`. */
function isNonEmptyQuote(quote: unknown): boolean {
    return !!quote
        && typeof quote === 'object'
        && typeof (quote as Record<string, unknown>).selectedText === 'string'
        && ((quote as Record<string, unknown>).selectedText as string).trim().length > 0;
}

/**
 * Validate a region anchor draft (Goal 4 AC-01). Returns an error string, or
 * `undefined` when the box is a usable single normalized rect on a real page.
 */
function validateRegionAnchor(region: unknown): string | undefined {
    if (!region || typeof region !== 'object') {
        return 'Invalid field: region';
    }
    const r = region as Record<string, unknown>;
    if (typeof r.page !== 'number' || !Number.isFinite(r.page) || r.page < 1) {
        return 'Invalid field: region.page';
    }
    const rect = r.rect as Record<string, unknown> | undefined;
    if (!rect || typeof rect !== 'object') {
        return 'Invalid field: region.rect';
    }
    for (const key of ['x', 'y', 'width', 'height'] as const) {
        const v = rect[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            return `Invalid field: region.rect.${key}`;
        }
    }
    if ((rect.width as number) <= 0 || (rect.height as number) <= 0) {
        return 'Invalid field: region.rect (zero-size box)';
    }
    return undefined;
}

/**
 * Validate a client-supplied anchor draft. Returns an error string if the shape
 * is unusable, or `undefined` if it is safe to persist. The geometric `position`
 * is optional. Every annotation must carry at least one usable anchor — either a
 * non-empty text `quote` (the primary, reflow-robust locator) OR a `region` box
 * (a figure/equation whose crop went to a vision model, Goal 4 AC-01).
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

    // Region anchor (figure/equation) — validate its shape whenever present.
    let hasRegion = false;
    if (d.region !== undefined && d.region !== null) {
        const regionError = validateRegionAnchor(d.region);
        if (regionError) {
            return regionError;
        }
        hasRegion = true;
    }

    // At least one usable anchor is required. Preserve the historical error
    // messages so a blank/absent text quote still points at the right field.
    if (!isNonEmptyQuote(d.quote) && !hasRegion) {
        if (d.quote && typeof d.quote === 'object') {
            return 'Missing required field: quote.selectedText';
        }
        return 'Missing required field: quote (a text quote or region anchor is required)';
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
    const annotation: PaperAnnotation = {
        id,
        createdAt,
        pdfUrl: String(draft.pdfUrl),
        answer: String(draft.answer),
    };
    // Text quote is optional (a region annotation has none); keep it only when
    // it carries a real selection.
    if (isNonEmptyQuote(draft.quote)) {
        const quote = draft.quote as Record<string, unknown>;
        annotation.quote = {
            selectedText: String(quote.selectedText),
            contextBefore: typeof quote.contextBefore === 'string' ? quote.contextBefore : '',
            contextAfter: typeof quote.contextAfter === 'string' ? quote.contextAfter : '',
        };
    }
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
    if (draft.region && typeof draft.region === 'object') {
        const reg = draft.region as Record<string, unknown>;
        const rect = (reg.rect && typeof reg.rect === 'object'
            ? reg.rect
            : {}) as Record<string, unknown>;
        annotation.region = {
            page: Number(reg.page),
            rect: {
                x: Number(rect.x) || 0,
                y: Number(rect.y) || 0,
                width: Number(rect.width) || 0,
                height: Number(rect.height) || 0,
            },
        };
    }
    return annotation;
}
