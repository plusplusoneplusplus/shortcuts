/**
 * sidenoteInlineChips — DOM primitives for AC-03: inject a small clickable
 * "💡" chip marker inline in the rendered assistant turn, immediately after a
 * resolved side-note source phrase, so the chip lives at its anchored text
 * instead of only in the detached footer row.
 *
 * The marker element holds NO text node — its glyph is a CSS `::after`
 * pseudo-element (see sidenoteHighlight.css) — so `container.textContent` is
 * unchanged by injection. This is load-bearing: both `resolveSidenoteAnchor`
 * (anchor resolution) and `getQuickAskSelection` (selection capture) read
 * `container.textContent`, and neither must ever see injected characters.
 * Inserting a zero-text element only splits a text node (text-neutral) and adds
 * an element sibling the SHOW_TEXT walkers skip, so both stay accurate.
 *
 * Pure DOM logic with no React dependency, so the primitives are unit-testable
 * (jsdom provides `cloneRange`/`collapse`/`insertNode`/`normalize`).
 */

/** Marker attribute stamped on every injected inline chip (used to find + remove). */
export const SIDENOTE_INLINE_ATTR = 'data-quick-ask-inline-chip';
/** Base visual class for the inline chip (see sidenoteHighlight.css). */
export const SIDENOTE_INLINE_CLASS = 'quick-ask-sidenote-inline-chip';
/** Extra class for a chip whose side-note is in the error state. */
export const SIDENOTE_INLINE_ERROR_CLASS = 'quick-ask-sidenote-inline-chip-error';
/**
 * Test id shared with the footer chips. It matches the `quick-ask-chip` prefix
 * so the outside-click highlight guard (which spares `[data-testid^="quick-ask-chip"]`)
 * treats an inline chip click the same as a footer chip click.
 */
export const SIDENOTE_INLINE_TESTID = 'quick-ask-chip-inline';

/**
 * Remove every injected inline chip marker inside `container`, then `normalize()`
 * so the text-node halves an earlier insertion split are merged back. Idempotent;
 * a no-op when there are no markers (so it never disturbs the DOM needlessly).
 */
export function clearInlineChips(container: HTMLElement | null): void {
    if (!container) {return;}
    const chips = container.querySelectorAll(`[${SIDENOTE_INLINE_ATTR}]`);
    if (chips.length === 0) {return;}
    chips.forEach(chip => chip.parentNode?.removeChild(chip));
    container.normalize();
}

/** Options describing an inline chip to inject for a resolved side-note. */
export interface InlineChipOptions {
    /** Side-note id (stamped on the marker; passed back to `onActivate`). */
    id: string;
    /** Human label used for the tooltip / accessible name. */
    label: string;
    /** Render the error variant when the note is in the error state. */
    isError?: boolean;
    /** Invoked (with the chip element) on click — mirrors a footer chip click. */
    onActivate: (chip: HTMLElement) => void;
}

/**
 * Inject an inline chip marker immediately after the end boundary of `range`
 * (the resolved source phrase) inside `container`. The marker is a `<button>`
 * so it is keyboard/click focusable and carries no text child. `range` is left
 * intact (a collapsed clone is used for the insertion). Returns the created
 * element, or null when the container has no owner document.
 */
export function injectInlineChip(
    container: HTMLElement,
    range: Range,
    opts: InlineChipOptions,
): HTMLElement | null {
    const doc = container.ownerDocument;
    if (!doc) {return null;}
    const chip = doc.createElement('button');
    chip.setAttribute('type', 'button');
    chip.setAttribute(SIDENOTE_INLINE_ATTR, '');
    chip.setAttribute('data-testid', SIDENOTE_INLINE_TESTID);
    chip.setAttribute('data-sidenote-id', opts.id);
    chip.setAttribute('aria-label', `Side note: ${opts.label}`);
    chip.setAttribute('title', opts.label);
    chip.className = opts.isError
        ? `${SIDENOTE_INLINE_CLASS} ${SIDENOTE_INLINE_ERROR_CLASS}`
        : SIDENOTE_INLINE_CLASS;
    chip.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        opts.onActivate(chip);
    });
    // Insert at the phrase's end boundary. A collapsed clone leaves the caller's
    // range usable (e.g. for highlighting the same phrase on click).
    const at = range.cloneRange();
    at.collapse(false);
    at.insertNode(chip);
    return chip;
}
