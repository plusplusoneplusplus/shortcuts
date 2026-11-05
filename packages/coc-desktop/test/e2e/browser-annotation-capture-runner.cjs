'use strict';

const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');
const { captureElectronAnnotation } = require('../../dist/electron-annotation-capture.js');
const { captureWebView2Annotation } = require('../../dist/webview2-annotation-capture.js');

app.setPath('userData', process.env.COC_BROWSER_E2E_USER_DATA);
app.setPath('sessionData', path.join(process.env.COC_BROWSER_E2E_USER_DATA, 'session'));

// Fractional guest bounds, like the SPA's placeholder rect, make the compositor surface
// differ from the rounded innerWidth/innerHeight the page reports.
const embedder = `<!doctype html><body style="margin:0"><webview src="data:text/html,<body style=margin:0>"
    style="position:absolute;left:10.25px;top:20.5px;width:300.5px;height:200.5px;display:flex"></webview>`;
// Seeded per-device-pixel noise makes any one-pixel misalignment change the cropped bytes.
const paint = `new Promise(resolve => {
    let canvas = document.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;left:0;top:0;display:block';
        document.body.append(canvas);
    }
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    canvas.width = Math.ceil(innerWidth * devicePixelRatio);
    canvas.height = Math.ceil(innerHeight * devicePixelRatio);
    const context = canvas.getContext('2d');
    const image = context.createImageData(canvas.width, canvas.height);
    let seed = 0x9e3779b9;
    for (let i = 0; i < image.data.length; i += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        image.data[i] = seed & 255; image.data[i + 1] = (seed >>> 8) & 255; image.data[i + 2] = (seed >>> 16) & 255; image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        width: innerWidth, height: innerHeight, devicePixelRatio,
    })));
})`;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Independent reference: enclosing device pixels, trimmed to the displayed surface. */
function expectedCrop(rect, dpr, size) {
    const round = value => Math.round(value * 1e4) / 1e4;
    const x = Math.floor(round(rect.x * dpr)), y = Math.floor(round(rect.y * dpr));
    return {
        x, y,
        width: Math.min(Math.ceil(round((rect.x + rect.width) * dpr)), size.width) - x,
        height: Math.min(Math.ceil(round((rect.y + rect.height) * dpr)), size.height) - y,
    };
}

(async () => {
    await app.whenReady();
    const win = new BrowserWindow({ width: 420, height: 300, show: true, webPreferences: { webviewTag: true } });
    const attached = new Promise(resolve => win.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await win.loadURL(`data:text/html,${encodeURIComponent(embedder)}`);
    const guest = await attached;
    if (guest.isLoading()) await new Promise(resolve => guest.once('did-finish-load', resolve));
    const base = (await guest.executeJavaScript(paint)).devicePixelRatio;
    const results = [];
    for (const zoom of [1, 0.75, 1.25, 1.1]) {
        guest.setZoomFactor(zoom);
        for (const started = Date.now(); Date.now() - started < 5000; await delay(25)) {
            if (Math.abs(await guest.executeJavaScript('devicePixelRatio') - base * zoom) < 1e-3) break;
        }
        const viewport = await guest.executeJavaScript(paint);
        const full = nativeImage.createFromBuffer((await guest.capturePage()).toPNG());
        const size = full.getSize();
        const { width: w, height: h } = viewport;
        const rects = {
            interior: { x: 13.3, y: 17.7, width: 80.2, height: 31.6 },
            topLeft: { x: 0, y: 0, width: 20.5, height: 10.25 },
            bottom: { x: 50.25, y: h - 21.75, width: 75.5, height: 21.75 },
            right: { x: w - 40.5, y: 30.5, width: 40.5, height: 20 },
            corner: { x: w - 30.75, y: h - 15.5, width: 30.75, height: 15.5 },
            viewport: { x: 0, y: 0, width: w, height: h },
        };
        const engines = {
            electron: rect => captureElectronAnnotation(guest, rect, viewport),
            // Shared geometry with a native full-viewport PNG, not the Windows CapturePreview runtime.
            webview2: rect => captureWebView2Annotation(async () => (await guest.capturePage()).toDataURL(), rect, viewport),
        };
        for (const [name, rect] of Object.entries(rects)) {
            const expected = expectedCrop(rect, viewport.devicePixelRatio, size);
            const reference = full.crop(expected).toBitmap();
            // Proves the comparison detects a one-pixel shift wherever the image leaves room for one.
            const dx = expected.x > 0 ? -1 : 1;
            const shiftedDiffers = expected.x + dx >= 0 && expected.x + dx + expected.width <= size.width
                ? !full.crop({ ...expected, x: expected.x + dx }).toBitmap().equals(reference) : null;
            for (const [engine, capture] of Object.entries(engines)) {
                try {
                    const image = await capture(rect);
                    const pixels = nativeImage.createFromDataURL(image.dataUrl);
                    results.push({ zoom, case: name, engine, viewport, surface: size,
                        width: image.width, height: image.height, pngSize: pixels.getSize(), expected,
                        aligned: pixels.toBitmap().equals(reference), shiftedDiffers });
                } catch (error) {
                    results.push({ zoom, case: name, engine, viewport, surface: size, expected, error: String(error?.message ?? error) });
                }
            }
        }
    }
    console.log('E2E::' + JSON.stringify(results));
    app.quit();
})().catch(error => {
    console.error(error);
    app.exit(1);
});
