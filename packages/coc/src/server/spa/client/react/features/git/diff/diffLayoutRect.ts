/**
 * Diff scrolling and virtual rows use unzoomed CSS pixels; client rects include
 * the Git page's zoom. Keep both sides of that arithmetic in layout coordinates.
 * Popover/pointer positioning must keep using the original client coordinates.
 */
export function diffLayoutRect(element: HTMLElement): { top: number; height: number } {
    const rect = element.getBoundingClientRect();
    const zoom = (element as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
    return { top: rect.top / zoom, height: rect.height / zoom };
}
