/**
 * Paper Annotations — Markdown export (Goal 4 AC-03).
 *
 * Turns the persisted dual-anchor Q&A sidecar into a portable Markdown document:
 * every annotation's anchored quote (the passage it was pinned to) followed by the
 * question and the AI answer, grouped by the paper it belongs to. This is the
 * "export all paper annotations (Q&A + anchored quotes) to Markdown" deliverable.
 *
 * Pure — no Node.js / DOM dependencies (only the shared annotation types). Safe to
 * import from both the server export route and future client-side export code, the
 * same way {@link ./paper-annotations-types} is shared.
 */

import type { PaperAnnotation, PaperAnnotationsSidecar } from './paper-annotations-types';

export interface PaperAnnotationsMarkdownOptions {
    /** Document H1 title. Defaults to "Paper annotations". */
    title?: string;
    /** Optional line rendered under the title (e.g. the source note path). */
    subtitle?: string;
}

/** Accepted shapes: a list, an id→annotation map, or the raw sidecar. */
export type PaperAnnotationsExportInput =
    | PaperAnnotation[]
    | Record<string, PaperAnnotation>
    | PaperAnnotationsSidecar;

/** Normalize any accepted input into a flat annotation list. */
function toAnnotationList(input: PaperAnnotationsExportInput): PaperAnnotation[] {
    if (Array.isArray(input)) return input.filter(Boolean);
    if (input && typeof input === 'object') {
        const maybeSidecar = input as PaperAnnotationsSidecar;
        const map =
            maybeSidecar.annotations && typeof maybeSidecar.annotations === 'object'
                ? maybeSidecar.annotations
                : (input as Record<string, PaperAnnotation>);
        return Object.values(map).filter(Boolean);
    }
    return [];
}

/**
 * A short, human label for a PDF URL: the file's basename without query/hash, or
 * the raw string if it does not parse. Keeps section headings readable when a note
 * embeds several papers (each annotation carries its own `pdfUrl`).
 */
export function paperDisplayLabel(pdfUrl: string): string {
    const trimmed = (pdfUrl || '').trim();
    if (!trimmed) return 'Paper';
    // Drop query + hash, then take the last path segment.
    const withoutQuery = trimmed.split(/[?#]/)[0];
    const segments = withoutQuery.split('/').filter(Boolean);
    const last = segments.length ? segments[segments.length - 1] : withoutQuery;
    return last || trimmed;
}

/** Render text as a Markdown blockquote, one `>` per line (blank lines kept). */
function blockquote(text: string): string {
    return text
        .split('\n')
        .map(line => (line.length ? `> ${line}` : '>'))
        .join('\n');
}

/** Deterministic short date (`YYYY-MM-DD`) from an ISO timestamp, else the raw value. */
function shortDate(iso: string | undefined): string | undefined {
    if (!iso) return undefined;
    return /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso.slice(0, 10) : iso;
}

/** Order within a paper: by page (rects first, page-ordered), then creation time. */
function compareForReading(a: PaperAnnotation, b: PaperAnnotation): number {
    const pa = a.position?.page ?? Number.POSITIVE_INFINITY;
    const pb = b.position?.page ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
}

/**
 * Format all paper annotations as a single Markdown document. Annotations are
 * grouped by paper (`pdfUrl`) and, within a paper, ordered by page then time so the
 * export reads top-to-bottom like the paper itself.
 */
export function formatPaperAnnotationsMarkdown(
    input: PaperAnnotationsExportInput,
    opts: PaperAnnotationsMarkdownOptions = {},
): string {
    const title = opts.title?.trim() || 'Paper annotations';
    const annotations = toAnnotationList(input);

    const lines: string[] = [`# ${title}`, ''];
    if (opts.subtitle?.trim()) {
        lines.push(`_${opts.subtitle.trim()}_`, '');
    }

    if (annotations.length === 0) {
        lines.push('_No annotations yet._', '');
        return lines.join('\n');
    }

    lines.push(`_${annotations.length} annotation${annotations.length === 1 ? '' : 's'}_`, '');

    // Group by paper, preserving first-seen order of papers.
    const groups = new Map<string, PaperAnnotation[]>();
    for (const a of annotations) {
        const key = a.pdfUrl || '';
        const bucket = groups.get(key);
        if (bucket) bucket.push(a);
        else groups.set(key, [a]);
    }

    for (const [pdfUrl, group] of groups) {
        lines.push(`## ${paperDisplayLabel(pdfUrl)}`, '');
        const ordered = [...group].sort(compareForReading);
        ordered.forEach((a, index) => {
            const heading = a.question?.trim()
                || (a.region && !a.quote ? `Figure region ${index + 1}` : `Highlight ${index + 1}`);
            lines.push(`### ${heading}`, '');

            if (a.quote?.selectedText?.trim()) {
                lines.push(blockquote(a.quote.selectedText.trim()), '');
            }

            if (a.answer?.trim()) {
                lines.push(a.answer.trim(), '');
            }

            const meta: string[] = [];
            const page = a.position?.page ?? a.region?.page;
            if (page) meta.push(`Page ${page}`);
            if (a.model?.trim()) meta.push(a.model.trim());
            const date = shortDate(a.createdAt);
            if (date) meta.push(date);
            if (meta.length) lines.push(`_${meta.join(' · ')}_`, '');

            lines.push('---', '');
        });
    }

    // Trim the trailing separator/blank so the document ends cleanly.
    while (lines.length && (lines[lines.length - 1] === '' || lines[lines.length - 1] === '---')) {
        lines.pop();
    }
    lines.push('');
    return lines.join('\n');
}
