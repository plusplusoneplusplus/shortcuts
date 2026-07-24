/**
 * CoC Desktop — screenshot capture + annotate: main-process (Electron) glue.
 *
 * This module owns the parts that touch `electron`: the accelerator wiring, the
 * screen capture, and the overlay / annotation `BrowserWindow`s. Like
 * `find-bar-host.ts` it is exercised by the live Electron harness rather than
 * unit tests, so all pure/testable logic (constants, crop-rect math, the macOS
 * permission gate, page builders, PNG compositing) is pushed into
 * `screenshot-capture.ts`.
 *
 * Behaviour layers in by acceptance criterion — see `screenshot-capture.ts`.
 */

import * as path from 'path';
import {
    BrowserWindow,
    desktopCapturer,
    dialog,
    ipcMain,
    screen,
    shell,
    systemPreferences,
} from 'electron';
import {
    SCREENSHOT_OVERLAY_INIT_CHANNEL,
    SCREENSHOT_CROP_CHANNEL,
    SCREENSHOT_CANCEL_CHANNEL,
    SCREENSHOT_ANNOTATE_INIT_CHANNEL,
    SCREENSHOT_ANNOTATE_DONE_CHANNEL,
    SCREENSHOT_ANNOTATE_CANCEL_CHANNEL,
    ANNOTATION_TOOLBAR_HEIGHT,
    buildOverlayHtml,
    buildAnnotationHtml,
    fitAnnotationWindowSize,
    resolveScreenCaptureAccess,
    scaleCropRect,
    CropRect,
    MediaAccessStatus,
    ScreenCaptureAccess,
} from './screenshot-capture';

/** macOS deep link to the Screen Recording pane of System Settings. */
const MAC_SCREEN_RECORDING_SETTINGS_URL =
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/** A capture in flight: the frozen full-res image plus the overlay showing it. */
interface PendingCapture {
    overlay: BrowserWindow;
    image: Electron.NativeImage;
    /** The captured display's scale factor (device px per CSS px). */
    scaleFactor: number;
}

/** Keyed by the overlay window's webContents id, so IPC routes by sender. */
const pendingByOverlayId = new Map<number, PendingCapture>();
/** Open annotation editor windows, keyed by their webContents id (routes done/cancel). */
const editorByWebContentsId = new Map<number, BrowserWindow>();
let ipcRegistered = false;
/** True while a capture (permission check → overlay) is in progress — the global
 *  accelerator is best-effort single-shot; a second press mid-capture is ignored. */
let capturing = false;

/**
 * AC-01/AC-02: entry point fired by the global capture accelerator. Runs on the
 * main process even when the CoC window is unfocused/backgrounded.
 *
 * AC-02: gate on the macOS Screen Recording permission, capture the display
 * under the cursor at full resolution, and open the fullscreen drag-to-crop
 * overlay. Everything is best-effort — any failure logs and resets rather than
 * crashing the app.
 */
export async function startScreenshotCapture(): Promise<void> {
    if (capturing) {
        return;
    }
    registerScreenshotIpc();

    const status =
        process.platform === 'darwin' ? safeGetScreenAccessStatus() : undefined;
    const access = resolveScreenCaptureAccess(process.platform, status);
    if (!access.allowed) {
        showPermissionMessage(access);
        return;
    }

    capturing = true;
    try {
        const cursor = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursor);
        const scaleFactor = display.scaleFactor || 1;
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: Math.round(display.size.width * scaleFactor),
                height: Math.round(display.size.height * scaleFactor),
            },
        });
        // Pick the source for the display under the cursor; fall back to the first.
        const source =
            sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
        if (!source || source.thumbnail.isEmpty()) {
            capturing = false;
            process.stderr.write('[coc-desktop] screenshot capture produced no image\n');
            return;
        }
        openOverlay(display, source.thumbnail, scaleFactor);
    } catch (err) {
        capturing = false;
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coc-desktop] screenshot capture failed: ${message}\n`);
    }
}

/** Read the macOS Screen Recording status, degrading a throw to undefined. */
function safeGetScreenAccessStatus(): MediaAccessStatus | undefined {
    try {
        return systemPreferences.getMediaAccessStatus('screen') as MediaAccessStatus;
    } catch {
        return undefined;
    }
}

/**
 * AC-02: surface the blocked-capture message (macOS Screen Recording denied) and
 * offer to open the OS privacy settings, instead of capturing a black frame.
 */
function showPermissionMessage(access: ScreenCaptureAccess): void {
    void dialog
        .showMessageBox({
            type: 'warning',
            title: 'Screen Recording permission required',
            message: access.message ?? 'Screen capture is unavailable.',
            detail: access.detail,
            buttons: access.openSettings ? ['Open System Settings', 'Cancel'] : ['OK'],
            defaultId: 0,
            cancelId: access.openSettings ? 1 : 0,
            noLink: true,
        })
        .then((result) => {
            if (access.openSettings && result.response === 0) {
                void shell.openExternal(MAC_SCREEN_RECORDING_SETTINGS_URL);
            }
        })
        .catch(() => {
            /* dialog failures are non-fatal */
        });
}

/**
 * Register the capture IPC handlers exactly once. Requests route by sender id
 * through {@link pendingByOverlayId}, so this stays correct even if a stray
 * message arrives after its overlay closed.
 */
function registerScreenshotIpc(): void {
    if (ipcRegistered) {
        return;
    }
    ipcRegistered = true;
    ipcMain.on(SCREENSHOT_CROP_CHANNEL, (event, rect: CropRect) => {
        const pending = pendingByOverlayId.get(event.sender.id);
        if (!pending) {
            return;
        }
        closeOverlay(pending);
        try {
            // The CSS-space rect is scaled to device pixels to crop the full-res image.
            const cropped = pending.image.crop(scaleCropRect(rect, pending.scaleFactor));
            openAnnotationEditor(cropped, pending.scaleFactor);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[coc-desktop] screenshot crop failed: ${message}\n`);
        }
    });
    ipcMain.on(SCREENSHOT_CANCEL_CHANNEL, (event) => {
        const pending = pendingByOverlayId.get(event.sender.id);
        if (pending) {
            closeOverlay(pending);
        }
    });
    // AC-03/AC-04: the annotation editor reports its result. "Done" carries the
    // flattened PNG data URL (handed to the three sinks); "Cancel" just discards.
    ipcMain.on(SCREENSHOT_ANNOTATE_DONE_CHANNEL, (event, pngDataUrl: string) => {
        const editor = editorByWebContentsId.get(event.sender.id);
        if (editor && !editor.isDestroyed()) {
            editor.close();
        }
        dispatchAnnotationResult(pngDataUrl);
    });
    ipcMain.on(SCREENSHOT_ANNOTATE_CANCEL_CHANNEL, (event) => {
        const editor = editorByWebContentsId.get(event.sender.id);
        if (editor && !editor.isDestroyed()) {
            editor.close();
        }
    });
}

/**
 * AC-02: open the fullscreen, frameless, transparent, always-on-top overlay for
 * the display under the cursor, sized to the display bounds and rendering the
 * frozen shot. The captured image + scale factor ride along so the crop IPC can
 * cut the full-resolution pixels once the user finishes the drag.
 */
function openOverlay(
    display: Electron.Display,
    image: Electron.NativeImage,
    scaleFactor: number,
): void {
    const overlay = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        enableLargerThanScreen: true,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    // Float above full-screen apps too (macOS/Windows) so the capture UI is visible.
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const overlayId = overlay.webContents.id;
    const pending: PendingCapture = { overlay, image, scaleFactor };
    pendingByOverlayId.set(overlayId, pending);

    overlay.webContents.once('did-finish-load', () => {
        if (overlay.isDestroyed()) {
            return;
        }
        overlay.webContents.send(SCREENSHOT_OVERLAY_INIT_CHANNEL, {
            imageDataUrl: image.toDataURL(),
            width: display.bounds.width,
            height: display.bounds.height,
        });
        overlay.focus();
    });
    overlay.on('closed', () => {
        pendingByOverlayId.delete(overlayId);
        capturing = false;
    });

    void overlay.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(buildOverlayHtml()),
    );
}

/** Close the overlay for a finished/cancelled capture and release the guard. */
function closeOverlay(pending: PendingCapture): void {
    capturing = false;
    if (!pending.overlay.isDestroyed()) {
        // The 'closed' handler removes the map entry.
        pending.overlay.close();
    }
}

/**
 * AC-03: open the custom annotation editor on the cropped image. A dedicated,
 * resizable `BrowserWindow` loads the self-contained editor page (a custom HTML5
 * `<canvas>` — NOT Excalidraw) and, once loaded, receives the cropped image via
 * {@link SCREENSHOT_ANNOTATE_INIT_CHANNEL}. The canvas resolution equals the
 * crop's device pixels; the window is sized to fit the work area. Draw/undo/Done/
 * Cancel are handled in the page; "Done"/"Cancel" route back through the IPC
 * registered in {@link registerScreenshotIpc}.
 */
function openAnnotationEditor(image: Electron.NativeImage, scaleFactor: number): void {
    const size = image.getSize();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const windowSize = fitAnnotationWindowSize(
        size,
        scaleFactor,
        display.workAreaSize,
        ANNOTATION_TOOLBAR_HEIGHT,
    );

    const editor = new BrowserWindow({
        width: windowSize.width,
        height: windowSize.height,
        minWidth: 320,
        minHeight: 240,
        resizable: true,
        title: 'Annotate Screenshot',
        backgroundColor: '#0d1117',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    const editorId = editor.webContents.id;
    editorByWebContentsId.set(editorId, editor);

    editor.webContents.once('did-finish-load', () => {
        if (editor.isDestroyed()) {
            return;
        }
        editor.webContents.send(SCREENSHOT_ANNOTATE_INIT_CHANNEL, {
            imageDataUrl: image.toDataURL(),
            width: size.width,
            height: size.height,
        });
        editor.show();
        editor.focus();
    });
    editor.on('closed', () => {
        editorByWebContentsId.delete(editorId);
    });

    void editor.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(buildAnnotationHtml()),
    );
}

/**
 * AC-04 stub: fan the finished annotation PNG out to the three sinks — OS
 * clipboard, the active chat draft, and a Save-As file. Replaced when AC-04
 * lands; for now it records that the flattened PNG reached the finish stage so
 * the AC-03 flow is observable end-to-end.
 */
function dispatchAnnotationResult(pngDataUrl: string): void {
    process.stdout.write(
        `[coc-desktop] annotation finished (${pngDataUrl.length} bytes of PNG data URL)\n`,
    );
}
