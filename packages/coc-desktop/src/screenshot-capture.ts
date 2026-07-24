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

// ─── AC-02: capture + drag-to-crop overlay ──────────────────────────────────
//
// The Electron glue (capturing the display, opening the overlay window, cropping
// the NativeImage) lives in `screenshot-capture-host.ts`. Everything here is
// pure and unit-tested: the IPC channel constants, the crop-rect math, the
// macOS permission gate, and the overlay page (HTML + injected script).

/**
 * IPC channel: main → overlay renderer, carrying the frozen screenshot data URL
 * and the overlay's CSS dimensions so the page can paint the frame to crop.
 */
export const SCREENSHOT_OVERLAY_INIT_CHANNEL = 'coc-desktop:screenshot-overlay-init';
/** IPC channel: overlay renderer → main, "the user selected this crop rectangle". */
export const SCREENSHOT_CROP_CHANNEL = 'coc-desktop:screenshot-crop';
/** IPC channel: overlay renderer → main, "cancel the capture (ESC / right-click)". */
export const SCREENSHOT_CANCEL_CHANNEL = 'coc-desktop:screenshot-cancel';

/** A point in the overlay's CSS pixel space (drag start / current cursor). */
export interface Point {
    x: number;
    y: number;
}

/** A width/height in pixels — the overlay bounds or an image's device size. */
export interface PixelSize {
    width: number;
    height: number;
}

/** An integer crop rectangle (top-left origin) in a single pixel space. */
export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Payload of {@link SCREENSHOT_OVERLAY_INIT_CHANNEL}. */
export interface OverlayInitPayload {
    /** The frozen screenshot of the display under the cursor, as a PNG data URL. */
    imageDataUrl: string;
    /** Overlay CSS width (== the display's DIP width). */
    width: number;
    /** Overlay CSS height (== the display's DIP height). */
    height: number;
}

/**
 * AC-02: normalize a drag (start → end) into an integer crop rectangle, clamped
 * to the overlay bounds. Returns `null` for a zero-area selection (a click, or a
 * drag collapsed to a line) so callers can ignore it rather than crop nothing.
 *
 * Coordinates are in the overlay's CSS pixel space (which equals the captured
 * display's DIP size); the host scales the result to device pixels with
 * {@link scaleCropRect} before cropping the full-resolution image.
 *
 * Kept dependency-free (Math only) so it is both unit-tested here AND embedded
 * verbatim into the overlay page script (via `.toString()`), giving the live
 * selection outline and the final crop identical math.
 */
export function normalizeCropRect(start: Point, end: Point, bounds: PixelSize): CropRect | null {
    const left = Math.max(0, Math.min(Math.min(start.x, end.x), bounds.width));
    const top = Math.max(0, Math.min(Math.min(start.y, end.y), bounds.height));
    const right = Math.max(0, Math.min(Math.max(start.x, end.x), bounds.width));
    const bottom = Math.max(0, Math.min(Math.max(start.y, end.y), bounds.height));
    const width = Math.round(right - left);
    const height = Math.round(bottom - top);
    if (width < 1 || height < 1) {
        return null;
    }
    return { x: Math.round(left), y: Math.round(top), width: width, height: height };
}

/**
 * AC-02: scale a CSS-space crop rectangle to device pixels for cropping the
 * full-resolution capture (whose size is display size × `scaleFactor`). A
 * non-positive scale falls back to 1; width/height never round below 1 px.
 */
export function scaleCropRect(rect: CropRect, scale: number): CropRect {
    const factor = scale > 0 ? scale : 1;
    return {
        x: Math.round(rect.x * factor),
        y: Math.round(rect.y * factor),
        width: Math.max(1, Math.round(rect.width * factor)),
        height: Math.max(1, Math.round(rect.height * factor)),
    };
}

/** Electron's `systemPreferences.getMediaAccessStatus` return values. */
export type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

/** Result of {@link resolveScreenCaptureAccess}: whether to proceed, else why not. */
export interface ScreenCaptureAccess {
    /** True when capture may proceed; false means show `message` and bail. */
    allowed: boolean;
    /** User-facing headline shown when capture is blocked. */
    message?: string;
    /** Supporting detail (how to grant permission). */
    detail?: string;
    /** True when the caller should offer to open the OS privacy settings. */
    openSettings?: boolean;
}

/**
 * AC-02 (macOS permission gate): decide whether screen capture may proceed.
 *
 * Only macOS gates full-resolution screen capture behind a Screen Recording
 * permission Electron can query; without it `desktopCapturer` yields a black
 * frame. So on macOS we require `getMediaAccessStatus('screen') === 'granted'`
 * and otherwise return a clear message + a prompt to open System Settings,
 * rather than silently capturing black. Every other platform is always allowed.
 *
 * Pure (no `electron`, no `process`) so the permission branch is unit-testable.
 */
export function resolveScreenCaptureAccess(
    platform: NodeJS.Platform,
    status?: MediaAccessStatus | string,
): ScreenCaptureAccess {
    if (platform !== 'darwin') {
        return { allowed: true };
    }
    if (status === 'granted') {
        return { allowed: true };
    }
    return {
        allowed: false,
        message: 'CoC needs Screen Recording permission to capture your screen.',
        detail:
            'Grant CoC access under System Settings → Privacy & Security → Screen Recording, ' +
            'then press the capture shortcut again.',
        openSettings: true,
    };
}

/**
 * AC-02: build the script that drives the overlay page (running in the overlay's
 * own frameless window with the standard preload bridge). Separated from
 * {@link buildOverlayHtml} so tests can drive it against DOM/window stubs.
 *
 * Flow: receive the frozen shot via `cocDesktop.screenshot.onOverlayInit`, paint
 * it, then track a left-button drag into a live selection outline (dimensions
 * label included) using the SAME {@link normalizeCropRect} as the host. Mouse-up
 * on a real region sends the crop; a zero-area drag is ignored (overlay stays
 * open); ESC and right-click cancel with no side effects.
 */
export function buildOverlayPageScript(): string {
    // NOTE: this string runs in the overlay page's context, NOT here. Keep it
    // free of TypeScript syntax and of backticks / ${...} (other than the single
    // normalizeCropRect interpolation below, which embeds compiled JS).
    return `(function () {
  var api = window.cocDesktop && window.cocDesktop.screenshot;
  if (!api) { return; }

  var normalizeCropRect = ${normalizeCropRect.toString()};

  var img = document.getElementById('screenshot-overlay-image');
  var mask = document.getElementById('screenshot-overlay-mask');
  var selection = document.getElementById('screenshot-overlay-selection');
  var dimLabel = document.getElementById('screenshot-overlay-dimensions');
  var hint = document.getElementById('screenshot-overlay-hint');

  var dragStart = null;
  var finished = false;

  function overlayBounds() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function reset() {
    dragStart = null;
    if (mask) { mask.style.display = 'block'; }
    if (hint) { hint.style.display = 'block'; }
    if (selection) { selection.style.display = 'none'; }
    if (dimLabel) { dimLabel.style.display = 'none'; }
  }

  function drawSelection(rect) {
    if (!selection || !dimLabel) { return; }
    selection.style.display = 'block';
    selection.style.left = rect.x + 'px';
    selection.style.top = rect.y + 'px';
    selection.style.width = rect.width + 'px';
    selection.style.height = rect.height + 'px';
    dimLabel.style.display = 'block';
    dimLabel.textContent = rect.width + ' \\u00d7 ' + rect.height;
    var labelTop = rect.y - 24;
    if (labelTop < 4) { labelTop = rect.y + 4; }
    dimLabel.style.left = rect.x + 'px';
    dimLabel.style.top = labelTop + 'px';
  }

  function cancel() {
    if (finished) { return; }
    finished = true;
    api.cancel();
  }

  function finish(rect) {
    if (finished) { return; }
    finished = true;
    api.crop(rect);
  }

  if (api.onOverlayInit) {
    api.onOverlayInit(function (payload) {
      if (payload && payload.imageDataUrl && img) {
        img.src = payload.imageDataUrl;
      }
    });
  }

  window.addEventListener('mousedown', function (e) {
    if (e.button !== 0) { return; }
    dragStart = { x: e.clientX, y: e.clientY };
    if (mask) { mask.style.display = 'none'; }
    if (hint) { hint.style.display = 'none'; }
  });

  window.addEventListener('mousemove', function (e) {
    if (!dragStart) { return; }
    var rect = normalizeCropRect(dragStart, { x: e.clientX, y: e.clientY }, overlayBounds());
    if (rect) { drawSelection(rect); }
  });

  window.addEventListener('mouseup', function (e) {
    if (e.button !== 0 || !dragStart) { return; }
    var start = dragStart;
    var rect = normalizeCropRect(start, { x: e.clientX, y: e.clientY }, overlayBounds());
    if (!rect) { reset(); return; }
    finish(rect);
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  window.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    cancel();
  });
})();`;
}

/**
 * AC-02: the full HTML document for the overlay window, loaded as a data: URL
 * (self-contained inline styles — the window has no access to the SPA's CSS).
 * The frozen screenshot fills the window; a dim mask darkens it until a drag
 * begins, then the selection's giant box-shadow dims everything OUTSIDE the
 * crop so the chosen region reads crisp. Embeds {@link buildOverlayPageScript}.
 */
export function buildOverlayHtml(): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
    background: transparent; cursor: crosshair;
    user-select: none; -webkit-user-select: none;
  }
  #screenshot-overlay-image {
    position: fixed; inset: 0; width: 100vw; height: 100vh;
    object-fit: fill; pointer-events: none; -webkit-user-drag: none;
  }
  #screenshot-overlay-mask {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); pointer-events: none;
  }
  #screenshot-overlay-selection {
    position: fixed; display: none; box-sizing: border-box;
    border: 1px solid #4ea1ff; background: transparent; pointer-events: none;
    box-shadow: 0 0 0 100000px rgba(0, 0, 0, 0.45);
  }
  #screenshot-overlay-dimensions {
    position: fixed; display: none; padding: 2px 6px; border-radius: 4px;
    font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #e6edf3; background: #161b22; border: 1px solid #30363d; pointer-events: none;
  }
  #screenshot-overlay-hint {
    position: fixed; left: 50%; top: 24px; transform: translateX(-50%);
    padding: 6px 12px; border-radius: 6px;
    font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #e6edf3; background: rgba(22, 27, 34, 0.9); border: 1px solid #30363d;
    pointer-events: none;
  }
</style>
</head>
<body>
  <img id="screenshot-overlay-image" alt="">
  <div id="screenshot-overlay-mask"></div>
  <div id="screenshot-overlay-selection"></div>
  <div id="screenshot-overlay-dimensions"></div>
  <div id="screenshot-overlay-hint">Drag to select a region &middot; Esc to cancel</div>
  <script>${buildOverlayPageScript()}</script>
</body>
</html>`;
}
