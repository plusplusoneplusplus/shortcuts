/**
 * CoC Desktop — Edit ▸ Copy delegation to a focused terminal.
 *
 * The SPA's embedded terminal is xterm.js, which paints its own selection layer
 * instead of using a DOM selection. So the Edit menu's stock `role: 'copy'`
 * (which is `webContents.copy()`, i.e. "copy the native DOM selection") copies
 * nothing at all when the user has selected terminal output and pressed Cmd+C —
 * and on macOS that accelerator is owned by the menu, so it never even reaches
 * the renderer's key handler.
 *
 * The fix: the Edit menu's Copy item asks the focused renderer first. The
 * renderer answers on {@link MENU_COPY_HANDLED_CHANNEL} when a focused terminal
 * with a live selection took the request; if no answer arrives within
 * {@link MENU_COPY_FALLBACK_DELAY_MS}, the main process falls back to
 * `webContents.copy()` so ordinary text fields keep working.
 *
 * Like `app-menu.ts` and `find-in-page.ts`, this module imports NOTHING from
 * `electron`, so the channels and the delegation logic are unit-testable under
 * plain Node.
 */

/** IPC channel: main → renderer, "Edit ▸ Copy was invoked; take it if you can". */
export const MENU_COPY_CHANNEL = 'coc-desktop:menu-copy';
/** IPC channel: renderer → main, "a focused terminal handled that copy". */
export const MENU_COPY_HANDLED_CHANNEL = 'coc-desktop:menu-copy-handled';

/**
 * How long the main process waits for the renderer to claim a copy before
 * falling back to `webContents.copy()`. Long enough for one IPC round trip on a
 * busy renderer, short enough that a plain text-field copy still feels instant.
 */
export const MENU_COPY_FALLBACK_DELAY_MS = 60;

/** The slice of `WebContents` this module needs. */
export interface MenuCopyTarget {
    /** Identity used to match a renderer's reply against the pending request. */
    id: number;
    send(channel: string): void;
    copy(): void;
}

export interface MenuCopyDelegate {
    /** Wired to the Edit ▸ Copy menu item's `click`. */
    requestCopy(): void;
    /** Wired to the {@link MENU_COPY_HANDLED_CHANNEL} listener. */
    markHandled(senderId: number): void;
}

export interface MenuCopyDelegateOptions {
    /** The focused webContents, or null when there is nothing to ask. */
    getTarget: () => MenuCopyTarget | null;
    /** Overridable for tests. */
    delayMs?: number;
}

/**
 * Build the Copy delegate. One pending request at a time — a second Copy
 * before the first resolves cancels the first (its fallback would be stale).
 */
export function createMenuCopyDelegate({
    getTarget,
    delayMs = MENU_COPY_FALLBACK_DELAY_MS,
}: MenuCopyDelegateOptions): MenuCopyDelegate {
    let pending: { senderId: number; target: MenuCopyTarget; timer: ReturnType<typeof setTimeout> } | null = null;

    const clearPending = (): void => {
        if (!pending) return;
        clearTimeout(pending.timer);
        pending = null;
    };

    return {
        requestCopy(): void {
            const target = getTarget();
            clearPending();
            if (!target) return;
            target.send(MENU_COPY_CHANNEL);
            const timer = setTimeout(() => {
                pending = null;
                // Nobody claimed it — this was an ordinary DOM selection.
                target.copy();
            }, delayMs);
            // Never hold the event loop open just for a clipboard fallback.
            (timer as { unref?: () => void }).unref?.();
            pending = { senderId: target.id, target, timer };
        },
        markHandled(senderId: number): void {
            if (pending && pending.senderId === senderId) {
                clearPending();
            }
        },
    };
}
