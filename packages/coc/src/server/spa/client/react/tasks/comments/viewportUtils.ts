/**
 * Shared viewport utilities for floating popup positioning.
 */

export const VIEWPORT_MARGIN = 8;

/**
 * Clamp a popup rect so it stays fully inside the viewport.
 * Returns adjusted { top, left } values.
 */
export function clampToViewport(
    position: { top: number; left: number },
    popupWidth: number,
    popupHeight: number,
    viewportWidth: number = window.innerWidth,
    viewportHeight: number = window.innerHeight,
    margin: number = VIEWPORT_MARGIN,
): { top: number; left: number } {
    let { top, left } = position;

    if (left + popupWidth + margin > viewportWidth) {
        left = viewportWidth - popupWidth - margin;
    }
    if (left < margin) {
        left = margin;
    }

    if (top + popupHeight + margin > viewportHeight) {
        top = viewportHeight - popupHeight - margin;
    }
    if (top < margin) {
        top = margin;
    }

    return { top, left };
}
