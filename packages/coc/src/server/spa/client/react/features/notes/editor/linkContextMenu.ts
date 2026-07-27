/**
 * Helpers for the note-editor right-click "link" context menu.
 *
 * Kept pure (no React) so the link-detection logic can be unit-tested against
 * a jsdom DOM without mounting the whole editor.
 */

/**
 * Given the `target` of a right-click event, walk up to the nearest anchor and
 * return its raw `href` attribute (the value as authored in the markdown), or
 * `null` when the click was not on a link.
 *
 * The raw attribute is preferred over the resolved `anchor.href` property so the
 * copied value matches what the user typed (e.g. a relative or `mailto:` link)
 * rather than a browser-resolved absolute URL.
 */
export function getLinkHrefFromEventTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const anchor = target.closest('a[href]');
    if (!anchor) return null;
    const href = anchor.getAttribute('href');
    return href && href.trim() ? href : null;
}
