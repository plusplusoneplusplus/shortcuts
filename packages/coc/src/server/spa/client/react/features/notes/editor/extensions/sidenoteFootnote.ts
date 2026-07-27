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
 *   Definition block (file bottom): `[^qa-<id>]: {"turns":[{"q":"…","a":"…"},…]}`
 *
 * The definition payload is a single-line JSON object holding the full
 * multi-turn thread as an ordered `turns` array (AC-03), with a fixed key order
 * (`turns` first, then optional `s`/`p`/`x` anchor fields; `q` optional then `a`
 * within each turn) so the construct round-trips byte-for-byte. A legacy
 * single-pair `{"q","a"}` payload (written before follow-ups existed) is still
 * decoded — as a one-turn thread — so old notes keep their answer without a
 * migration pass; it is re-serialized in the turns form on the next save. The
 * `qa-` namespace on every footnote label keeps these markers from colliding
 * with an ordinary `[^1]`-style footnote a user might type (which the pipeline
 * leaves as literal text).
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

/** One ordered turn of a Quick Ask thread: an answer and its optional question. */
export interface QaTurn {
    /** The question the user asked for this turn, if any (a default first ask
     * persists as absent). */
    question?: string;
    /** The frozen answer text for this turn. */
    answer: string;
}

/** The full multi-turn Quick Ask thread for one side-note (AC-03). */
export interface QaFootnoteDef {
    /** The ordered conversation turns. Turn 0 is the original ask. Always at
     * least one turn for a persisted note. */
    turns: QaTurn[];
    /** Exact text selected when the side-note was created. */
    selectedText?: string;
    /** Plain-text context immediately before the selection. */
    contextBefore?: string;
    /** Plain-text context immediately after the selection. */
    contextAfter?: string;
}

// ── payload codec ────────────────────────────────────────────────────────────

/**
 * Serialize one turn to a fixed-key-order object (`q` optional, then `a`), so
 * the same turn always encodes to the same bytes. An empty/absent question is
 * omitted.
 */
function serializeTurn(turn: QaTurn): Record<string, string> {
    const obj: Record<string, string> = {};
    if (turn.question != null && turn.question !== '') obj.q = turn.question;
    obj.a = turn.answer;
    return obj;
}

/**
 * Serialize just the ordered turns array to its single-line JSON form
 * (`[{"a":"…"},{"q":"…","a":"…"}]`). Shared by {@link encodeQaPayload} (the `.md`
 * definition payload) and the `data-qa-turns` marker attribute so the two forms
 * stay byte-identical across a save/reload cycle.
 */
export function encodeQaTurns(turns: QaTurn[]): string {
    return JSON.stringify(turns.map(serializeTurn));
}

/**
 * Parse a `data-qa-turns` attribute value (a JSON turns array) back into turns.
 * Returns `null` for anything that is not a non-empty array of `{a:string}`
 * objects, so a corrupt attribute degrades gracefully. Turns whose answer is not
 * a string are dropped.
 */
export function decodeQaTurns(raw: string): QaTurn[] | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const arr = JSON.parse(trimmed) as unknown;
        return toTurns(arr);
    } catch {
        return null;
    }
}

/** Coerce a parsed JSON value into a non-empty turns array, or `null`. */
function toTurns(arr: unknown): QaTurn[] | null {
    if (!Array.isArray(arr)) return null;
    const turns: QaTurn[] = [];
    for (const entry of arr) {
        if (entry && typeof entry === 'object' && typeof (entry as any).a === 'string') {
            const q = (entry as any).q;
            turns.push({
                answer: (entry as any).a,
                question: typeof q === 'string' && q !== '' ? q : undefined,
            });
        }
    }
    return turns.length ? turns : null;
}

/**
 * Serialize a side-note thread to the single-line JSON stored after `:` in a
 * definition. Key order is fixed (`turns`, then `s`/`p`/`x` for the optional
 * selected text/prefix/suffix), so the same payload always encodes to the same
 * bytes. Anchor fields are emitted only when selected text is present, keeping
 * anchorless payloads compact.
 */
export function encodeQaPayload(def: QaFootnoteDef): string {
    const obj: Record<string, unknown> = {};
    obj.turns = def.turns.map(serializeTurn);
    if (def.selectedText != null && def.selectedText !== '') {
        obj.s = def.selectedText;
        obj.p = def.contextBefore ?? '';
        obj.x = def.contextAfter ?? '';
    }
    return JSON.stringify(obj);
}

/**
 * Parse a definition payload back into a side-note thread. Accepts either the
 * current `{"turns":[…]}` form or a legacy single-pair `{"q","a"}` payload
 * (decoded as a one-turn thread so pre-follow-up notes keep their answer — no
 * migration pass). Returns `null` for anything that is not one of our JSON
 * shapes (e.g. a hand-written definition), so a malformed or foreign definition
 * is ignored rather than crashing the load (AC-05).
 */
export function decodeQaPayload(raw: string): QaFootnoteDef | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const obj = JSON.parse(trimmed) as unknown;
        if (!obj || typeof obj !== 'object') return null;

        let turns: QaTurn[] | null = null;
        if (Array.isArray((obj as any).turns)) {
            // Current multi-turn form.
            turns = toTurns((obj as any).turns);
        } else if (typeof (obj as any).a === 'string') {
            // Legacy single-pair `{q,a}` — read as a one-turn thread (no migration).
            const q = (obj as any).q;
            turns = [{
                answer: (obj as any).a,
                question: typeof q === 'string' && q !== '' ? q : undefined,
            }];
        }
        if (!turns) return null;

        const def: QaFootnoteDef = { turns };
        const selectedText = (obj as any).s;
        const contextBefore = (obj as any).p;
        const contextAfter = (obj as any).x;
        if (
            typeof selectedText === 'string' &&
            selectedText !== '' &&
            typeof contextBefore === 'string' &&
            typeof contextAfter === 'string'
        ) {
            def.selectedText = selectedText;
            def.contextBefore = contextBefore;
            def.contextAfter = contextAfter;
        }
        return def;
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
 * Fold each definition's thread into its matching marker span produced by the
 * marked tokenizer. A marker with no matching definition (anchorless) is left
 * bare so it still renders without crashing (AC-05).
 *
 * The full thread is folded in as a `data-qa-turns` JSON attribute (the
 * save-path source of truth); turn 0's `data-qa-question`/`data-qa-answer` are
 * also emitted as a display/back-compat mirror.
 */
export function injectQaAnswers(html: string, defs: Map<string, QaFootnoteDef>): string {
    if (defs.size === 0) return html;
    return html.replace(QA_BARE_REF_SPAN_RE, (whole, id: string) => {
        const def = defs.get(id);
        if (!def || def.turns.length === 0) return whole;
        const first = def.turns[0];
        const turns = ` data-qa-turns="${escapeHtmlAttr(encodeQaTurns(def.turns))}"`;
        const q =
            first.question != null && first.question !== ''
                ? ` data-qa-question="${escapeHtmlAttr(first.question)}"`
                : '';
        const a = ` data-qa-answer="${escapeHtmlAttr(first.answer)}"`;
        const anchor =
            def.selectedText != null && def.selectedText !== ''
                ? ` data-qa-selected-text="${escapeHtmlAttr(def.selectedText)}"` +
                  ` data-qa-context-before="${escapeHtmlAttr(def.contextBefore ?? '')}"` +
                  ` data-qa-context-after="${escapeHtmlAttr(def.contextAfter ?? '')}"`
                : '';
        return `<span class="${QA_SIDENOTE_REF_CLASS}" data-qa-id="${id}"${turns}${q}${a}${anchor}>${QA_MARKER_GLYPH}</span>`;
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

        // Prefer the full thread carried in `data-qa-turns`. A freshly-inserted
        // marker (turn-0-only persistence) carries no turns attribute, so fall
        // back to the turn-0 `data-qa-answer`/`data-qa-question` mirror.
        const turnsAttr = span.getAttribute('data-qa-turns');
        let turns = turnsAttr ? decodeQaTurns(turnsAttr) : null;
        if (!turns) {
            const answer = span.getAttribute('data-qa-answer') ?? '';
            if (answer !== '') {
                const question = span.getAttribute('data-qa-question') || undefined;
                turns = [{ question, answer }];
            }
        }
        // Keep only turns with a real answer, dropping any degraded blank turns.
        turns = turns ? turns.filter(t => t.answer !== '') : null;
        // An answerless marker is a degraded, manually-edited state: the user
        // hand-deleted the definition line in source view, leaving `[^qa-<id>]`
        // with nothing to fold back in. Emit no definition rather than
        // resurrecting a meaningless `{"turns":[{"a":""}]}` line — the marker
        // stays byte-stable and still renders as a bare chip (AC-05 manual-md
        // tolerance). A real answered note is never empty (the layer rejects an
        // empty answer before inserting the marker).
        if (!turns || turns.length === 0) return;
        seen.add(id);
        const selectedText = span.getAttribute('data-qa-selected-text') || undefined;
        const contextBefore = selectedText
            ? span.getAttribute('data-qa-context-before') ?? ''
            : undefined;
        const contextAfter = selectedText
            ? span.getAttribute('data-qa-context-after') ?? ''
            : undefined;
        defLines.push(
            `[^${QA_LABEL_PREFIX}${id}]: ${encodeQaPayload({
                turns,
                selectedText,
                contextBefore,
                contextAfter,
            })}`,
        );
    });
    if (defLines.length === 0) return md;

    const body = md.replace(/\n+$/, '');
    return `${body}\n\n${defLines.join('\n')}\n`;
}
