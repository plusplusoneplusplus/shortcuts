/**
 * CoC Desktop — screenshot capture + annotate: main-process (Electron) glue.
 *
 * This module owns the parts that touch `electron`: the accelerator wiring, the
 * screen capture, and the overlay / annotation `BrowserWindow`s. Like
 * `find-bar-host.ts` it is exercised by the live Electron harness rather than
 * unit tests, so all pure/testable logic (constants, crop-rect math, page
 * builders, PNG compositing) is pushed into `screenshot-capture.ts`.
 *
 * Behaviour layers in by acceptance criterion — see `screenshot-capture.ts`.
 */

/**
 * AC-01: the entry point fired by the global capture accelerator. Runs on the
 * main process even when the CoC window is unfocused/backgrounded.
 *
 * Today it records that the capture flow was requested; the fullscreen
 * drag-to-crop overlay (AC-02) and the custom annotation window (AC-03) hang off
 * this same entry point. Kept as a named function so `main.ts` can wire the
 * accelerator to it and so later criteria grow the body in one place.
 */
export function startScreenshotCapture(): void {
    process.stdout.write('[coc-desktop] screenshot capture requested\n');
}
