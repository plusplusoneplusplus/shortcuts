'use strict';

// Real WKWebView helper in a real Electron window: annotation crops through the production
// host (`captureAnnotation` -> helper `capture-annotation` -> shared crop) at fractional zoom.
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, Menu, nativeImage } = require('electron');
const { WkWebViewBrowserHost } = require('../../dist/wkwebview-browser-host.js');

const userData = process.env.COC_BROWSER_E2E_USER_DATA;
app.setPath('userData', userData);

// Seeded noise per device pixel; the runner regenerates it, so the reference never comes from a capture.
const SEED = 0x9e3779b9;
const page = `<!doctype html><body style="margin:0;overflow:hidden"><script>
window.paint = () => new Promise(resolve => {
    let canvas = document.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;left:0;top:0;display:block';
        document.body.append(canvas);
    }
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    canvas.width = Math.round(innerWidth * devicePixelRatio);
    canvas.height = Math.round(innerHeight * devicePixelRatio);
    const context = canvas.getContext('2d');
    const image = context.createImageData(canvas.width, canvas.height);
    let seed = ${SEED};
    for (let i = 0; i < image.data.length; i += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        image.data[i] = seed & 255; image.data[i + 1] = (seed >>> 8) & 255; image.data[i + 2] = (seed >>> 16) & 255; image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        width: innerWidth, height: innerHeight, devicePixelRatio, canvas: [canvas.width, canvas.height],
    })));
});
</script>`;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function noise(width, height) {
    const pixels = new Uint8Array(width * height * 3);
    let seed = SEED;
    for (let i = 0; i < pixels.length; i += 3) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        pixels[i] = seed & 255; pixels[i + 1] = (seed >>> 8) & 255; pixels[i + 2] = (seed >>> 16) & 255;
    }
    return pixels;
}

/** Independent reference: enclosing device pixels of the CSS rect. */
function expectedCrop(rect, dpr) {
    const round = value => Math.round(value * 1e4) / 1e4;
    const x = Math.floor(round(rect.x * dpr)), y = Math.floor(round(rect.y * dpr));
    return { x, y, width: Math.ceil(round((rect.x + rect.width) * dpr)) - x, height: Math.ceil(round((rect.y + rect.height) * dpr)) - y };
}

/** Mean absolute channel difference between a BGRA crop and the noise at `origin`. */
function difference(bitmap, crop, origin, reference, referenceWidth, referenceHeight) {
    let total = 0, count = 0;
    for (let y = 0; y < crop.height; y++) {
        for (let x = 0; x < crop.width; x++) {
            const rx = origin.x + x, ry = origin.y + y;
            if (rx < 0 || ry < 0 || rx >= referenceWidth || ry >= referenceHeight) continue;
            const b = (y * crop.width + x) * 4, r = (ry * referenceWidth + rx) * 3;
            total += Math.abs(bitmap[b + 2] - reference[r]) + Math.abs(bitmap[b + 1] - reference[r + 1]) + Math.abs(bitmap[b] - reference[r + 2]);
            count += 3;
        }
    }
    return count ? total / count : Infinity;
}

(async () => {
    const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(page); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await app.whenReady();
    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({ width: 700, height: 500, show: true });
    await window.loadURL('data:text/html,<body style="margin:0;background:%23888">');
    const host = new WkWebViewBrowserHost(path.join(userData, 'coc', 'browser', 'wkwebview'));
    const availability = await host.availability();
    if (!availability.available) throw new Error('WKWebView unavailable: ' + JSON.stringify(availability));
    const sink = { state() {}, newTab() {}, download() {}, closeRequested() {}, openMenuRequested() {} };
    const url = `http://127.0.0.1:${server.address().port}/`;
    const view = await host.create({ ownerId: window.webContents.id, viewId: 'annotation', sessionKey: 'e2e', url }, sink);
    // 600x400 DIPs keeps innerWidth * devicePixelRatio whole at every zoom below, so the canvas is 1:1 with device pixels.
    await view.setBounds({ x: 0, y: 0, width: 600, height: 400 });
    await view.waitForControlReady(new AbortController().signal);
    const evaluate = async expression => {
        const result = await view.control.evaluate(expression, { awaitPromise: true });
        if (result.exception) throw new Error(result.exception);
        return result.value;
    };
    const results = [];
    const base = (await evaluate('paint()')).devicePixelRatio;
    for (const zoom of [100, 75, 125, 150]) {
        await view.setPageZoom(zoom);
        for (const started = Date.now(); Date.now() - started < 5000; await delay(25)) {
            if (Math.abs(await evaluate('devicePixelRatio') - base * zoom / 100) < 1e-3) break;
        }
        const painted = await evaluate('paint()');
        const viewport = { width: painted.width, height: painted.height, devicePixelRatio: painted.devicePixelRatio };
        const [referenceWidth, referenceHeight] = painted.canvas;
        const reference = noise(referenceWidth, referenceHeight);
        const { width: w, height: h } = viewport;
        const rects = {
            interior: { x: 13.3, y: 17.7, width: 80.2, height: 31.6 },
            topLeft: { x: 0, y: 0, width: 20.5, height: 10.25 },
            bottom: { x: 50.25, y: h - 21.75, width: 75.5, height: 21.75 },
            right: { x: w - 40.5, y: 30.5, width: 40.5, height: 20 },
            corner: { x: w - 30.75, y: h - 15.5, width: 30.75, height: 15.5 },
            viewport: { x: 0, y: 0, width: w, height: h },
        };
        for (const [name, rect] of Object.entries(rects)) {
            const expected = expectedCrop(rect, viewport.devicePixelRatio);
            try {
                const image = await view.captureAnnotation(rect, viewport);
                const pixels = nativeImage.createFromDataURL(image.dataUrl);
                const bitmap = pixels.toBitmap();
                const size = pixels.getSize();
                const crop = { width: size.width, height: size.height };
                const diff = difference(bitmap, crop, expected, reference, referenceWidth, referenceHeight);
                // One device pixel off must look like unrelated noise.
                const shifted = difference(bitmap, crop, { x: expected.x + (expected.x > 0 ? -1 : 1), y: expected.y }, reference, referenceWidth, referenceHeight);
                results.push({ zoom, case: name, viewport, expected, width: image.width, height: image.height, pngSize: size, diff, shifted });
            } catch (error) {
                results.push({ zoom, case: name, viewport, expected, error: String(error?.message ?? error) });
            }
        }
    }
    // A late capture is rejected when the document changes underneath it.
    const late = view.captureAnnotation({ x: 0, y: 0, width: 10, height: 10 }, {
        width: results.at(-1).viewport.width, height: results.at(-1).viewport.height, devicePixelRatio: results.at(-1).viewport.devicePixelRatio,
    });
    await view.navigate(url + '?next');
    const lateError = await late.then(() => null, error => String(error?.message ?? error));
    console.log('E2E::' + JSON.stringify({ results, lateError }));
    await view.close();
    await host.dispose();
    server.close();
    app.quit();
})().catch(error => {
    console.error(error);
    app.exit(1);
});
