/**
 * CoC Desktop — screenshot capture + annotate: shared, Electron-free helpers.
 *
 * This module is the single source of truth for the capture feature's constants
 * and pure logic, kept import-free of `electron` (like `find-in-page.ts`) so it
 * runs under plain Node/vitest. The Electron glue — registering the accelerator,
 * capturing the display, and opening the overlay / annotation windows — lives in
 * `screenshot-capture-host.ts`.
 *
 * Behaviour layers in by acceptance criterion:
 *   - AC-01: the global accelerator constant + register/unregister helpers.  ← here
 *   - AC-02: fullscreen drag-to-crop overlay (crop-rect math + overlay page).
 *   - AC-03: the custom `<canvas>` annotation window (editor page + PNG export).
 *   - AC-04: the three-sink finish (clipboard + chat-attach + save-file).
 */

/**
 * AC-01: the default system-wide accelerator that starts the capture flow. A
 * single constant (no rebind UI yet — out of scope). `Shift+2` deliberately
 * avoids the macOS system screenshot shortcuts (Cmd+Shift+3/4/5). If a real
 * conflict is found on a target platform, pick the next free combo and note it
 * in the Ralph progress journal.
 */
export const SCREENSHOT_ACCELERATOR = 'CommandOrControl+Shift+2';

/**
 * The structural slice of Electron's `globalShortcut` module this feature needs.
 * Depending on the shape (not the concrete module) keeps this file Electron-free
 * and lets the register/unregister helpers be unit-tested with a plain mock.
 */
export interface GlobalShortcutLike {
    register(accelerator: string, callback: () => void): boolean;
    unregisterAll(): void;
}

/** Options for {@link registerScreenshotShortcut}. */
export interface RegisterScreenshotShortcutOptions {
    /** The accelerator to bind. Defaults to {@link SCREENSHOT_ACCELERATOR}. */
    accelerator?: string;
    /** Invoked (on the main process) each time the accelerator is pressed. */
    onTrigger: () => void;
    /** Optional sink for a human-readable warning when registration fails. */
    onWarn?: (message: string) => void;
}

/**
 * AC-01: register the capture accelerator via Electron's `globalShortcut`.
 *
 * Registration can fail when the combo is already claimed by the OS or another
 * app; Electron signals that by returning `false` (and can throw on some
 * platforms). Either way this must NEVER crash the app — it logs a warning
 * through `onWarn` and returns `false`, letting the caller carry on. Returns
 * `true` only when the accelerator is now bound to `onTrigger`.
 */
export function registerScreenshotShortcut(
    globalShortcut: GlobalShortcutLike,
    options: RegisterScreenshotShortcutOptions,
): boolean {
    const accelerator = options.accelerator ?? SCREENSHOT_ACCELERATOR;
    try {
        const registered = globalShortcut.register(accelerator, options.onTrigger);
        if (!registered) {
            options.onWarn?.(
                `[coc-desktop] screenshot shortcut ${accelerator} could not be registered ` +
                    `(already in use by the OS or another app); capture disabled`,
            );
        }
        return registered;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        options.onWarn?.(
            `[coc-desktop] screenshot shortcut ${accelerator} registration failed: ${message}`,
        );
        return false;
    }
}

/**
 * AC-01: release the capture accelerator. Called on `will-quit`; because the
 * capture shortcut is the app's only global accelerator, `unregisterAll` is the
 * idiomatic (Electron-recommended) teardown and cannot clobber anything else.
 */
export function unregisterScreenshotShortcut(globalShortcut: GlobalShortcutLike): void {
    globalShortcut.unregisterAll();
}
