/**
 * pdfLabel — keep the Notes PDF block's visible title equal to the original
 * filename across Markdown round-trips.
 *
 * The on-disk canonical `![label](x.pdf)` Markdown may legitimately escape
 * Markdown punctuation in the label (Turndown emits `_` as `\_`, `*` as `\*`,
 * etc.). Older raw `data-pdf-label` placeholders written before this fix leaked
 * those escapes into the stored label. Both cases need exactly one layer of
 * Markdown backslash escaping removed so the block renders
 * `OSDI_2026_Paper_Survey.pdf`, never `OSDI\_2026\_Paper\_Survey.pdf`.
 *
 * These helpers are intentionally pure and PDF-scoped. `plainLinkLabel` in
 * noteMarkdown is left untouched because map-link rendering relies on its exact
 * behavior; decoding backslash escapes globally would broaden the fix.
 */

// CommonMark: a backslash before any ASCII-punctuation character is an escape for
// that character; a backslash before anything else is a literal backslash. The
// ranges cover the full punctuation set `! " # $ % & ' ( ) * + , - . / : ; < = >
// ? @ [ \ ] ^ _ ` { | } ~` (the `[-\`` range includes the backslash itself).
const MARKDOWN_ESCAPE_RE = /\\([!-/:-@[-`{-~])/g;

/**
 * Remove exactly one layer of Markdown backslash escaping.
 *
 * Idempotent on already-literal text (no backslash-escape sequences left to
 * decode), and a literal backslash that is not immediately before ASCII
 * punctuation is preserved (`a\b.pdf` stays `a\b.pdf`).
 */
function decodeMarkdownEscapes(value: string): string {
    return value.replace(MARKDOWN_ESCAPE_RE, '$1');
}

/**
 * Convert a Markdown-source PDF image label (as delivered by the custom marked
 * image renderer for `![label](x.pdf)`) into literal display text.
 *
 * `OSDI\_2026\_Paper\_Survey.pdf` → `OSDI_2026_Paper_Survey.pdf`.
 *
 * marked can inject a stray line break around escaped bracket sequences in the
 * alt text (e.g. `a\[c\]` reloads as `a\n[c]`). A filename is always single-line,
 * so line breaks are flattened before decoding to reconstruct the original name.
 */
export function pdfLabelFromMarkdown(markdownLabel: string): string {
    return decodeMarkdownEscapes(markdownLabel.replace(/\s*\r?\n\s*/g, ''));
}

/**
 * Normalize a stored `data-pdf-label` that may carry the legacy leaked escapes
 * back to literal text. New `File.name`-derived labels are already literal, so
 * this is a no-op for them; only pre-fix raw placeholders are repaired.
 */
export function normalizeStoredPdfLabel(label: string): string {
    return decodeMarkdownEscapes(label);
}
