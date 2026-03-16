/**
 * Shared theme detection utility for the SPA dashboard.
 */

/**
 * Returns true when the document root has the `dark` CSS class,
 * which is toggled by ThemeProvider on theme changes.
 * Safe to call in SSR/test environments (returns false if `document` is undefined).
 */
export function detectDarkMode(): boolean {
    if (typeof document !== 'undefined') {
        return document.documentElement.classList.contains('dark');
    }
    return false;
}
