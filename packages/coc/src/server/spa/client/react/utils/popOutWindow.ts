/**
 * Did a `#popout/*` `window.open` actually open a window?
 *
 * In a browser the answer is simply "the call returned a handle". Inside the
 * Electron desktop shell it is not: the main process intercepts pop-out-shaped
 * opens (`#popout/markdown`, `#popout/activity`, `#popout/git-review`,
 * `#popout/canvas`) and rebuilds them as native windows with their own address
 * bar. That interception is a `{ action: 'deny' }`, so `window.open` returns
 * `null` even though a window really did appear — treating that as failure would
 * fire a "Pop-out blocked" toast on a window that is right there on screen, and
 * would skip the `markPoppedOut` bookkeeping that drives the popped-out rails.
 *
 * See packages/coc-desktop/src/popout-chrome.ts for the URL allow-list the main
 * process intercepts on — it is deliberately narrow, so every other
 * `window.open` call site (print preview, OAuth popups) still gets a real
 * handle and is unaffected by this helper.
 */

import { isDesktopShell } from '../hooks/ui/useDesktopShell';

export function popOutOpened(handle: Window | null): boolean {
    return handle !== null || isDesktopShell();
}
