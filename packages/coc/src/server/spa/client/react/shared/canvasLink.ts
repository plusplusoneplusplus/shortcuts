/** Fired from a clicked `canvas://<id>` markdown link; `detail` is `{ canvasId }`. */
export const OPEN_CANVAS_REFERENCE_EVENT = 'coc-open-canvas-reference';

/**
 * Parse a `canvas://<canvasId>` reference marker.
 *
 * Side-effect free on purpose: click handlers in widely imported modules
 * (`file-path-preview`, the Notes editor) use it without pulling in the chat
 * markdown renderer. Returns null if the marker doesn't match a valid canvas id.
 */
export function parseCanvasLink(href: string): { canvasId: string } | null {
    const match = href.match(/^canvas:\/\/([a-z0-9][a-z0-9-]{0,127})$/i);
    if (!match) {
        return null;
    }
    return { canvasId: match[1] };
}
