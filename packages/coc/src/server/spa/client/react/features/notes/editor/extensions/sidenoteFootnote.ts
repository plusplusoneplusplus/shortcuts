/**
 * sidenoteFootnote — the payload-persisting half of Quick Ask side-notes in the
 * WYSIWYG note editor (Goal: notes-quick-ask, AC-03).
 *
 * A note side-note is stored **inside the note `.md` file** in footnote form:
 * an inline reference marker at the anchor phrase plus an answer definition
 * block collected at the bottom of the file. The pipeline has no native
 * footnote support, so this module hand-rolls the persistence triple — a
 * `marked` inline tokenizer, helpers to split/rejoin the definition block, and
 * (paired in {@link ../noteMarkdown}) a `turndown` rule — modelled on the
 * payload-persisting `noteLink` atom (never the payload-stripping `comment`
 * mark, whose data is discarded on save).
 *
 * ## Markdown form
 *   Inline marker (at the phrase):  `[^qa-<id>]`
 *   Definition block (file bottom): `[^qa-<id>]: {"q":"…","a":"…"}`
 *
 * The definition payload is a single-line JSON object with a fixed key order
 * (`q` optional, then `a`) so the construct round-trips byte-for-byte. The `qa-`
 * namespace on every footnote label keeps these markers from colliding with an
 * ordinary `[^1]`-style footnote a user might type (which the pipeline leaves as
 * literal text).
 *
 * ## Why the definition never enters the Tiptap document
 * On load the definition lines are stripped out of the body and folded into the
 * matching marker as data attributes ({@link extractQaFootnoteDefs} +
 * {@link injectQaAnswers}); on save the definition block is rebuilt from the
 * marker nodes still present in the HTML ({@link appendQaFootnoteDefs}). Keeping
 * the answer text out of the editable document guarantees marker and definition
 * can never drift, and makes an orphaned definition (no matching marker) simply
 * fall away rather than corrupt the document (AC-05 tolerance).
 */

import type { MarkedExtension, Tokens } from 'marked';

/** HTML class carried by the inline reference marker span (marked + Tiptap). */
export const QA_SIDENOTE_REF_CLASS = 'qa-sidenote-ref';

/**
 * Leaf glyph rendered inside the marker span. Non-empty content is load-bearing:
 * turndown drops content-less inline nodes as "blank" before any custom rule
 * runs, so both the marked renderer and the Tiptap node must emit a glyph or the
 * marker (and its answer) would silently vanish on save.
 */
export const QA_MARKER_GLYPH = '✨';

/** Namespace prefix on every Quick Ask footnote label (`[^qa-<id>]`). */
const QA_LABEL_PREFIX = 'qa-';

/** Matches an inline reference marker at the start of an inline source slice. */
const QA_REF_MARKER_RE = /^\[\^qa-([A-Za-z0-9_-]+)\]/;

/** Matches a full definition line: `[^qa-<id>]: <payload>` (whole physical line). */
const QA_DEF_LINE_RE = /^\[\^qa-([A-Za-z0-9_-]+)\]:[ \t]*(.*)$/;

/** The exact span the marked renderer emits (marker only, no answer yet). */
const QA_BARE_REF_SPAN_RE =
    /<span class="qa-sidenote-ref" data-qa-id="([A-Za-z0-9_-]+)">✨<\/span>/g;

/** Answer + optional question for one side-note. */
export interface QaFootnoteDef {
    /** The question the user asked, if any (a default ask persists as absent). */
    question?: string;
    /** The frozen one-shot answer text. */
    answer: string;
}

// ── payload codec ────────────────────────────────────────────────────────────

/**
 * Serialize a side-note payload to the single-line JSON stored after `:` in a
 * definition. Key order is fixed (`q` then `a`) and an empty/absent question is
 * omitted, so the same payload always encodes to the same bytes.
 */
export function encodeQaPayload(def: QaFootnoteDef): string {
    const obj =
        def.question != null && def.question !== ''
            ? { q: def.question, a: def.answer }
            : { a: def.answer };
    return JSON.stringify(obj);
}

/**
 * Parse a definition payload back into a side-note. Returns `null` for anything
 * that is not our JSON shape (e.g. a hand-written definition), so a malformed or
 * foreign definition is ignored rather than crashing the load (AC-05).
 */
export function decodeQaPayload(raw: string): QaFootnoteDef | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const obj = JSON.parse(trimmed) as unknown;
        if (obj && typeof obj === 'object' && typeof (obj as any).a === 'string') {
            const question = (obj as any).q;
            return {
                answer: (obj as any).a,
                question: typeof question === 'string' && question !== '' ? question : undefined,
            };
        }
    } catch {
        /* not our payload — ignore */
    }
    return null;
}

// ── html attribute helpers ───────────────────────────────────────────────────

function escapeHtmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── marked inline tokenizer ──────────────────────────────────────────────────

interface QaRefToken {
    type: 'qaSidenoteRef';
    raw: string;
    refId: string;
}

/**
 * marked inline extension recognising `[^qa-<id>]` reference markers and
 * emitting the bare marker span. The answer/question attributes are folded in
 * afterwards by {@link injectQaAnswers} (the tokenizer is a module-level
 * singleton and cannot see per-call definitions).
 */
export const qaFootnoteMarkedExtension: MarkedExtension = {
    extensions: [
        {
            name: 'qaSidenoteRef',
            level: 'inline' as const,
            start(src: string) {
                return src.indexOf('[^qa-');
            },
            tokenizer(src: string): (QaRefToken & Tokens.Generic) | undefined {
                const match = QA_REF_MARKER_RE.exec(src);
                if (!match) return undefined;
                return { type: 'qaSidenoteRef', raw: match[0], refId: match[1] };
            },
            renderer(token: Tokens.Generic) {
                const refId = (token as unknown as QaRefToken).refId;
                return `<span class="${QA_SIDENOTE_REF_CLASS}" data-qa-id="${refId}">${QA_MARKER_GLYPH}</span>`;
            },
        },
    ],
};

// ── load: strip definitions, fold answers into markers ───────────────────────

/**
 * Split the footnote definition block out of a markdown body.
 *
 * Every `[^qa-<id>]: <payload>` line is removed and collected into a map keyed
 * by id. Returns the definition-free body (trailing blank lines trimmed) plus
 * the map. When the body carries no Quick Ask footnotes it is returned
 * unchanged so ordinary notes are byte-for-byte untouched.
 */
export function extractQaFootnoteDefs(md: string): {
    body: string;
    defs: Map<string, QaFootnoteDef>;
} {
    const defs = new Map<string, QaFootnoteDef>();
    if (!md.includes('[^qa-')) return { body: md, defs };

    const kept: string[] = [];
    let removed = false;
    for (const line of md.split('\n')) {
        const m = QA_DEF_LINE_RE.exec(line);
        if (m) {
            removed = true;
            const payload = decodeQaPayload(m[2]);
            if (payload) defs.set(m[1], payload);
            continue;
        }
        kept.push(line);
    }
    if (!removed) return { body: md, defs };
    return { body: kept.join('\n').replace(/\n+$/, ''), defs };
}

/**
 * Fold each definition's answer/question into its matching marker span produced
 * by the marked tokenizer. A marker with no matching definition (anchorless) is
 * left bare so it still renders without crashing (AC-05).
 */
export function injectQaAnswers(html: string, defs: Map<string, QaFootnoteDef>): string {
    if (defs.size === 0) return html;
    return html.replace(QA_BARE_REF_SPAN_RE, (whole, id: string) => {
        const def = defs.get(id);
        if (!def) return whole;
        const q =
            def.question != null && def.question !== ''
                ? ` data-qa-question="${escapeHtmlAttr(def.question)}"`
                : '';
        const a = ` data-qa-answer="${escapeHtmlAttr(def.answer)}"`;
        return `<span class="${QA_SIDENOTE_REF_CLASS}" data-qa-id="${id}"${q}${a}>${QA_MARKER_GLYPH}</span>`;
    });
}

// ── save: rebuild the definition block from the marker nodes ──────────────────

/**
 * Append the footnote definition block to a serialized markdown body.
 *
 * The block is derived purely from the reference-marker spans still present in
 * `html` (editor output), in first-appearance order and de-duplicated by id, so
 * the definitions can never drift from their markers. When no markers remain the
 * body is returned unchanged.
 *
 * A marker with an empty/absent answer (a definition the user hand-deleted from
 * the source, leaving the inline marker behind) emits no definition line, so the
 * body stays byte-stable instead of resurrecting an empty `{"a":""}` definition
 * (AC-05 manual-md tolerance).
 *
 * The spans are read through the DOM (via `getAttribute`) rather than by regex:
 * ProseMirror's serializer leaves `<`/`>` unescaped inside attribute values, so
 * a string scan would mis-bound the tag on an answer containing an angle
 * bracket. `htmlToMarkdown` already runs where turndown has a DOM, so parsing
 * here is safe; without one the body is returned unchanged.
 */
export function appendQaFootnoteDefs(md: string, html: string): string {
    if (!html.includes(QA_SIDENOTE_REF_CLASS)) return md;
    if (typeof document === 'undefined') return md;

    const container = document.createElement('div');
    container.innerHTML = html;
    const spans = container.querySelectorAll(`span.${QA_SIDENOTE_REF_CLASS}[data-qa-id]`);

    const seen = new Set<string>();
    const defLines: string[] = [];
    spans.forEach((span) => {
        const id = span.getAttribute('data-qa-id');
        if (!id || seen.has(id)) return;
        const answer = span.getAttribute('data-qa-answer') ?? '';
        // An answerless marker is a degraded, manually-edited state: the user
        // hand-deleted the definition line in source view, leaving `[^qa-<id>]`
        // with nothing to fold back in. Emit no definition rather than
        // resurrecting a meaningless `{"a":""}` line — the marker stays byte-stable
        // and still renders as a bare chip (AC-05 manual-md tolerance). A real
        // answered note is never empty (the layer rejects an empty answer before
        // inserting the marker).
        if (answer === '') return;
        seen.add(id);
        const question = span.getAttribute('data-qa-question') ?? undefined;
        defLines.push(`[^${QA_LABEL_PREFIX}${id}]: ${encodeQaPayload({ question, answer })}`);
    });
    if (defLines.length === 0) return md;

    const body = md.replace(/\n+$/, '');
    return `${body}\n\n${defLines.join('\n')}\n`;
}
