/**
 * Detect whether the SPA is running inside the Electron desktop shell.
 *
 * The desktop preload exposes a `window.cocDesktop = { isDesktop: true, ... }`
 * bridge (see packages/coc-desktop/src/preload.ts). This is the single source
 * of truth for "am I in the Electron app" — do NOT confuse it with
 * `useBreakpoint().isDesktop`, which only means "wide viewport."
 *
 * A plain function (not a hook) is enough: the bridge value is fixed for the
 * window's lifetime, so no reactivity is needed.
 */
export function isDesktopShell(): boolean {
    return (
        typeof window !== 'undefined' &&
        (window as { cocDesktop?: { isDesktop?: boolean } }).cocDesktop?.isDesktop === true
    );
}
