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

// ─── AC-03: custom `<canvas>` annotation window ─────────────────────────────
//
// The cropped image opens in a dedicated, resizable Electron window (opened by
// `screenshot-capture-host.ts`) rendering a CUSTOM HTML5 `<canvas>` drawing
// surface — deliberately NOT Excalidraw (see the goal). Everything testable
// lives here: the IPC channel constants, the annotation model, the drawing /
// compositing logic, the flattened-PNG export, and the editor page builders.

/**
 * IPC channel: main → annotation editor, carrying the cropped image (as a PNG
 * data URL) and its device-pixel dimensions so the editor's canvas resolution
 * matches the full-resolution crop.
 */
export const SCREENSHOT_ANNOTATE_INIT_CHANNEL = 'coc-desktop:screenshot-annotate-init';
/** IPC channel: annotation editor → main, "Done" — carries the flattened PNG data URL. */
export const SCREENSHOT_ANNOTATE_DONE_CHANNEL = 'coc-desktop:screenshot-annotate-done';
/** IPC channel: annotation editor → main, "Cancel" — discard the annotation. */
export const SCREENSHOT_ANNOTATE_CANCEL_CHANNEL = 'coc-desktop:screenshot-annotate-cancel';

/** Height (CSS px) reserved for the editor toolbar above the drawing canvas. */
export const ANNOTATION_TOOLBAR_HEIGHT = 48;

/** The drawing tools the editor offers. `pen`/`line`/`rect` are mandatory. */
export type AnnotationTool = 'pen' | 'line' | 'rect' | 'arrow';

/**
 * A single committed annotation drawn over the base image, in the crop's device
 * pixel space. `pen` (freehand) accumulates many points; `line`/`rect`/`arrow`
 * use the first and last point as their two anchors.
 */
export interface AnnotationStroke {
    tool: AnnotationTool;
    color: string;
    width: number;
    points: Point[];
}

/** Payload of {@link SCREENSHOT_ANNOTATE_INIT_CHANNEL}. */
export interface AnnotateInitPayload {
    /** The cropped screenshot, as a PNG data URL. */
    imageDataUrl: string;
    /** Crop width in device pixels (the canvas's internal resolution). */
    width: number;
    /** Crop height in device pixels (the canvas's internal resolution). */
    height: number;
}

/** On-screen size (CSS px) for the annotation window. */
export interface AnnotationWindowSize {
    width: number;
    height: number;
}

/**
 * The subset of `CanvasRenderingContext2D` the annotation drawing uses. Declaring
 * it structurally (rather than importing the DOM type) keeps this module usable
 * from plain Node/vitest and lets the compositing be tested with a recording stub.
 */
export interface Context2DLike {
    save(): void;
    restore(): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
    lineWidth: number;
    strokeStyle: string;
    lineCap: string;
    lineJoin: string;
}

/** The subset of `HTMLCanvasElement` the export uses (see {@link exportAnnotatedPng}). */
export interface CanvasElementLike {
    width: number;
    height: number;
    getContext(type: '2d'): Context2DLike | null;
    toDataURL(type?: string): string;
}

/** The subset of `document` the export uses — just an off-screen canvas factory. */
export interface DocumentLike {
    createElement(tag: 'canvas'): CanvasElementLike;
}

/**
 * AC-03: draw one annotation stroke onto a 2D context, in the crop's pixel space.
 *
 * Freehand connects every point; line/rect/arrow use the first and last point.
 * The rectangle is stroked as an explicit 4-segment path (no `strokeRect`) so the
 * {@link Context2DLike} surface stays tiny and fully recordable in tests. Kept
 * dependency-free (Math only) so it can be embedded verbatim into the editor page
 * script via `.toString()`, giving the live preview and the flattened export
 * identical rendering.
 */
export function drawAnnotationStroke(ctx: Context2DLike, stroke: AnnotationStroke): void {
    const points = stroke.points;
    if (!points || points.length === 0) {
        return;
    }
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const a = points[0];
    const b = points[points.length - 1];
    if (stroke.tool === 'rect') {
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y);
        ctx.stroke();
    } else if (stroke.tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    } else if (stroke.tool === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.max(8, stroke.width * 3);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        if (points.length === 1) {
            ctx.lineTo(a.x, a.y);
        }
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * AC-03: paint the whole annotation scene — the base image, then every stroke on
 * top — onto a 2D context. The base image is drawn (never mutated) and the
 * strokes composite above it, so undo/redo can always re-derive the picture from
 * the model. Shared by the editor's live repaint and the flattened export.
 */
export function renderAnnotationScene(
    ctx: Context2DLike,
    baseImage: unknown,
    strokes: AnnotationStroke[],
    size: PixelSize,
): void {
    ctx.clearRect(0, 0, size.width, size.height);
    if (baseImage) {
        ctx.drawImage(baseImage, 0, 0, size.width, size.height);
    }
    for (let i = 0; i < strokes.length; i++) {
        drawAnnotationStroke(ctx, strokes[i]);
    }
}

/**
 * AC-03 (DoD #2): flatten the base image + annotation strokes into a PNG data URL.
 *
 * Creates an off-screen canvas sized to the crop's device dimensions, paints the
 * scene with {@link renderAnnotationScene}, and returns `toDataURL('image/png')`.
 * `doc` is injected so the compositing/export can be tested against a stubbed
 * canvas (jsdom / Node have no real 2D canvas).
 */
export function exportAnnotatedPng(
    doc: DocumentLike,
    baseImage: unknown,
    strokes: AnnotationStroke[],
    size: PixelSize,
): string {
    const canvas = doc.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        renderAnnotationScene(ctx, baseImage, strokes, size);
    }
    return canvas.toDataURL('image/png');
}

/**
 * AC-03: choose a sensible on-screen size for the annotation window. The canvas's
 * internal resolution stays at the crop's device pixels (full quality); this only
 * sizes the WINDOW so a large / HiDPI crop still fits the work area. Converts the
 * device crop to CSS px (÷ scaleFactor), scales it down to fit `workArea` minus
 * the toolbar, and adds the toolbar height back for the window height.
 */
export function fitAnnotationWindowSize(
    imageDeviceSize: PixelSize,
    scaleFactor: number,
    workArea: PixelSize,
    toolbarHeight: number,
): AnnotationWindowSize {
    const factor = scaleFactor > 0 ? scaleFactor : 1;
    const cssW = imageDeviceSize.width / factor;
    const cssH = imageDeviceSize.height / factor;
    const maxW = Math.max(1, workArea.width);
    const maxH = Math.max(1, workArea.height - toolbarHeight);
    const fit = Math.min(1, maxW / cssW, maxH / cssH);
    return {
        width: Math.max(1, Math.round(cssW * fit)),
        height: Math.max(1, Math.round(cssH * fit)) + toolbarHeight,
    };
}

/**
 * AC-03: build the script that drives the annotation editor page (running in the
 * editor window with the standard preload bridge). Separated from
 * {@link buildAnnotationHtml} so tests can drive it against DOM/window stubs.
 *
 * Flow: receive the cropped image via `cocDesktop.screenshot.onAnnotateInit`,
 * paint it onto the canvas, then let the user pick a tool (pen/line/rect/arrow),
 * colour and stroke width and draw strokes on top. Undo pops the last stroke.
 * "Done" flattens image+strokes and calls `done(pngDataUrl)`; "Cancel"/ESC calls
 * `cancelAnnotate()`. Shares the exact drawing/export code with the host via the
 * `.toString()` interpolations below.
 */
export function buildAnnotationPageScript(): string {
    // NOTE: this string runs in the editor page's context, NOT here. Keep it free
    // of TypeScript syntax and of backticks / ${...} (other than the three
    // interpolations below, which embed compiled drawing JS).
    return `(function () {
  var api = window.cocDesktop && window.cocDesktop.screenshot;
  if (!api) { return; }

  var drawAnnotationStroke = ${drawAnnotationStroke.toString()};
  var renderAnnotationScene = ${renderAnnotationScene.toString()};
  var exportAnnotatedPng = ${exportAnnotatedPng.toString()};

  var canvas = document.getElementById('annotate-canvas');
  var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  var toolbar = document.getElementById('annotate-toolbar');

  var baseImage = null;
  var size = { width: 0, height: 0 };
  var strokes = [];
  var current = null;
  var drawing = false;
  var tool = 'pen';
  var color = '#ff3b30';
  var strokeWidth = 4;
  var finished = false;
  var TOOLS = ['pen', 'line', 'rect', 'arrow'];

  function repaint() {
    if (!ctx) { return; }
    var all = current ? strokes.concat([current]) : strokes;
    renderAnnotationScene(ctx, baseImage, all, size);
  }

  function fitCanvasDisplay() {
    if (!canvas || !canvas.style || !size.width || !size.height) { return; }
    var toolbarH = (toolbar && toolbar.offsetHeight) || ${String(ANNOTATION_TOOLBAR_HEIGHT)};
    var availW = window.innerWidth || size.width;
    var availH = (window.innerHeight || size.height) - toolbarH;
    var fit = Math.min(1, availW / size.width, availH / size.height);
    canvas.style.width = Math.max(1, Math.round(size.width * fit)) + 'px';
    canvas.style.height = Math.max(1, Math.round(size.height * fit)) + 'px';
  }

  function setTool(t) {
    tool = t;
    for (var i = 0; i < TOOLS.length; i++) {
      var btn = document.getElementById('annotate-tool-' + TOOLS[i]);
      if (btn) { btn.className = TOOLS[i] === t ? 'tool active' : 'tool'; }
    }
  }

  function toCanvasPoint(e) {
    if (!canvas || !canvas.getBoundingClientRect) { return { x: e.clientX, y: e.clientY }; }
    var rect = canvas.getBoundingClientRect();
    var sx = rect.width ? canvas.width / rect.width : 1;
    var sy = rect.height ? canvas.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function extendCurrent(p) {
    if (current.tool === 'pen') { current.points.push(p); }
    else { current.points = [current.points[0], p]; }
  }

  if (api.onAnnotateInit) {
    api.onAnnotateInit(function (payload) {
      if (!payload) { return; }
      size = { width: payload.width, height: payload.height };
      if (canvas) { canvas.width = payload.width; canvas.height = payload.height; }
      var image = document.createElement('img');
      image.onload = function () { baseImage = image; fitCanvasDisplay(); repaint(); };
      image.src = payload.imageDataUrl;
      fitCanvasDisplay();
      repaint();
    });
  }

  if (canvas && canvas.addEventListener) {
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) { return; }
      current = { tool: tool, color: color, width: strokeWidth, points: [toCanvasPoint(e)] };
      drawing = true;
    });
    canvas.addEventListener('mousemove', function (e) {
      if (!drawing || !current) { return; }
      extendCurrent(toCanvasPoint(e));
      repaint();
    });
  }

  window.addEventListener('mouseup', function (e) {
    if (!drawing || !current) { return; }
    drawing = false;
    extendCurrent(toCanvasPoint(e));
    strokes.push(current);
    current = null;
    repaint();
  });

  for (var t = 0; t < TOOLS.length; t++) {
    (function (name) {
      var btn = document.getElementById('annotate-tool-' + name);
      if (btn) { btn.addEventListener('click', function () { setTool(name); }); }
    })(TOOLS[t]);
  }

  var colorInput = document.getElementById('annotate-color');
  if (colorInput) {
    colorInput.value = color;
    colorInput.addEventListener('input', function (e) {
      if (e.target && e.target.value) { color = e.target.value; }
    });
  }

  var widthInput = document.getElementById('annotate-width');
  if (widthInput) {
    widthInput.value = String(strokeWidth);
    widthInput.addEventListener('input', function (e) {
      var v = e.target ? Number(e.target.value) : NaN;
      if (v > 0) { strokeWidth = v; }
    });
  }

  function undo() {
    if (strokes.length) { strokes.pop(); repaint(); }
  }

  var undoBtn = document.getElementById('annotate-undo');
  if (undoBtn) { undoBtn.addEventListener('click', undo); }

  function finishDone() {
    if (finished) { return; }
    finished = true;
    api.done(exportAnnotatedPng(document, baseImage, strokes, size));
  }

  function finishCancel() {
    if (finished) { return; }
    finished = true;
    api.cancelAnnotate();
  }

  var doneBtn = document.getElementById('annotate-done');
  if (doneBtn) { doneBtn.addEventListener('click', finishDone); }
  var cancelBtn = document.getElementById('annotate-cancel');
  if (cancelBtn) { cancelBtn.addEventListener('click', finishCancel); }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); finishCancel(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); }
  });

  window.addEventListener('resize', fitCanvasDisplay);

  setTool('pen');
})();`;
}

/**
 * AC-03: the full HTML document for the annotation editor window, loaded as a
 * data: URL (self-contained inline styles — independent of the SPA). A top
 * toolbar exposes the tools (pen/line/rect mandatory; arrow + colour + width +
 * undo are the trimmable extras) plus Cancel/Done; below it a custom `<canvas>`
 * holds the cropped image and the drawing layer. Embeds
 * {@link buildAnnotationPageScript}. Deliberately contains NO Excalidraw.
 */
export function buildAnnotationHtml(): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
    background: #0d1117; color: #e6edf3;
    font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    user-select: none; -webkit-user-select: none;
  }
  #annotate-toolbar {
    display: flex; align-items: center; gap: 6px; box-sizing: border-box;
    height: ${String(ANNOTATION_TOOLBAR_HEIGHT)}px; padding: 0 10px;
    background: #161b22; border-bottom: 1px solid #30363d;
  }
  #annotate-toolbar .tool, #annotate-toolbar button {
    height: 30px; padding: 0 10px; border-radius: 6px; cursor: pointer;
    color: #e6edf3; background: #21262d; border: 1px solid #30363d;
  }
  #annotate-toolbar .tool.active { background: #1f6feb; border-color: #1f6feb; }
  #annotate-toolbar .spacer { flex: 1 1 auto; }
  #annotate-toolbar input[type="color"] {
    width: 30px; height: 30px; padding: 0; border: 1px solid #30363d;
    border-radius: 6px; background: #21262d; cursor: pointer;
  }
  #annotate-done { background: #238636 !important; border-color: #238636 !important; }
  #annotate-stage {
    position: absolute; top: ${String(ANNOTATION_TOOLBAR_HEIGHT)}px; left: 0; right: 0; bottom: 0;
    display: flex; align-items: center; justify-content: center; overflow: auto;
    background: #010409;
  }
  #annotate-canvas { background: #ffffff; cursor: crosshair; box-shadow: 0 0 0 1px #30363d; }
</style>
</head>
<body>
  <div id="annotate-toolbar">
    <button id="annotate-tool-pen" class="tool active">Pen</button>
    <button id="annotate-tool-line" class="tool">Line</button>
    <button id="annotate-tool-rect" class="tool">Rect</button>
    <button id="annotate-tool-arrow" class="tool">Arrow</button>
    <input id="annotate-color" type="color" value="#ff3b30" title="Colour">
    <input id="annotate-width" type="range" min="1" max="24" value="4" title="Stroke width">
    <button id="annotate-undo" title="Undo (Ctrl/Cmd+Z)">Undo</button>
    <span class="spacer"></span>
    <button id="annotate-cancel">Cancel</button>
    <button id="annotate-done">Done</button>
  </div>
  <div id="annotate-stage">
    <canvas id="annotate-canvas" width="1" height="1"></canvas>
  </div>
  <script>${buildAnnotationPageScript()}</script>
</body>
</html>`;
}
