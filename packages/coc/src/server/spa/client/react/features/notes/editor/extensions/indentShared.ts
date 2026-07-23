/**
 * indentShared — framework-free indentation primitives shared by IndentExtension
 * (text blocks) and every block-level visual embed node.
 *
 * This module is intentionally dependency-free (no `@tiptap/core` import) so
 * embed nodes can reuse the exact parse / clamp / render logic without pulling
 * in the Extension runtime — and so unit tests that mock `@tiptap/core` don't
 * trip over a top-level `Extension.create` when they import an embed node.
 *
 * Centralizing the node-type lists and the `indent` attribute here is what keeps
 * commands, node attributes, CSS, Markdown serialization, and tests from drifting.
 */

export const MAX_INDENT = 8;

/** Text blocks that carry `indent` as a Tiptap global attribute. */
export const TEXT_INDENT_TYPES = ['paragraph', 'heading'];

/**
 * Block-level visual embeds that carry `indent` as their own node attribute.
 * New block-level visual embed nodes should opt in here (and spread
 * `createIndentAttribute()` into their own `addAttributes`) rather than building
 * a parallel indent system. Inline `mathInline` is intentionally excluded — it
 * is not a block.
 */
export const EMBED_INDENT_TYPES = ['image', 'pdfBlock', 'mapBlock', 'mermaidBlock', 'mathDisplay'];

/** Every node type the indent commands operate on. */
export const INDENT_TYPES = [...TEXT_INDENT_TYPES, ...EMBED_INDENT_TYPES];

/** Clamp any indent value into the supported [0, MAX_INDENT] range. */
export function clampIndent(n: number): number {
    return Math.max(0, Math.min(n, MAX_INDENT));
}

/** Read a clamped indent level from a `data-indent` attribute (absent/invalid → 0). */
export function parseIndentAttr(el: HTMLElement): number {
    const raw = el.getAttribute('data-indent');
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? clampIndent(n) : 0;
}

/** Render the `data-indent` HTML attribute — omitted entirely at level 0. */
export function renderIndentAttr(indent: number | null | undefined): Record<string, string> {
    const n = indent ?? 0;
    if (!n || n <= 0) return {};
    return { 'data-indent': String(n) };
}

/**
 * Shared Tiptap attribute spec for `indent`. Used by the text-block global
 * attribute in IndentExtension AND by each embed node's `addAttributes()`, so
 * the parse / clamp / render behaviour stays identical across every indentable
 * node.
 */
export function createIndentAttribute() {
    return {
        default: 0,
        parseHTML: (el: HTMLElement) => parseIndentAttr(el),
        renderHTML: (attrs: { indent?: number | null }) => renderIndentAttr(attrs.indent),
    };
}
