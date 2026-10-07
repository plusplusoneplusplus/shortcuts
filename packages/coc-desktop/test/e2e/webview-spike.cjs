'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = process.env.COC_BROWSER_E2E_USER_DATA;
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'user'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
    const server = http.createServer((_req, res) => res.end('<body style="margin:0;background:blue"><input id="input"></body>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const src = `http://127.0.0.1:${server.address().port}/`;
    const profile = session.fromPath(path.join(root, 'profile'));
    await profile.cookies.set({ url: src, name: 'spike', value: 'exact-session' });
    let hooked = 0;
    profile.webRequest.onBeforeRequest((details, cb) => { hooked++; cb({}); });
    const win = new BrowserWindow({ show: true, width: 600, height: 500, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
    const attached = [];
    win.webContents.on('will-attach-webview', (_event, prefs) => {
        prefs.session = profile;
        prefs.sandbox = true;
        prefs.contextIsolation = true;
        prefs.nodeIntegration = false;
        prefs.webviewTag = false;
        delete prefs.preload;
    });
    win.webContents.on('did-attach-webview', (_event, guest) => attached.push(guest));
    await win.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0"><webview partition="spike-token" style="width:600px;height:400px" src="' + src + '"></webview><div style="position:absolute;left:0;top:0;width:100px;height:100px;background:rgb(255,0,0);z-index:100"></div></body>'));
    for (let i = 0; i < 100 && (!attached[0] || attached[0].isLoading()); i++) await sleep(50);
    const guest = attached[0];
    assert(guest, 'guest attached');
    const cookie = await guest.executeJavaScript('document.cookie');
    assert.equal(guest.session, profile, 'session.fromPath override must be exact');
    assert.equal(cookie, 'spike=exact-session');
    assert(hooked > 0);
    await sleep(300);
    const image = await win.webContents.capturePage();
    const pixel = image.crop({ x: 30, y: 30, width: 1, height: 1 }).toBitmap();
    assert.deepEqual([...pixel], [0, 0, 255, 255]);
    await win.webContents.executeJavaScript('document.querySelector("div").remove(); document.querySelector("webview").focus()');
    win.focus();
    guest.focus();
    await guest.executeJavaScript('document.querySelector("input").focus()');
    await sleep(100);
    if (process.platform === 'linux') {
        // sendInputEvent does not consistently route text through Chromium's guest
        // widget. Exercise real OS input rather than treating that as a product bug.
        require('node:child_process').execFileSync('python3', ['-c', `
import ctypes
x = ctypes.CDLL('libX11.so.6')
t = ctypes.CDLL('libXtst.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x.XFlush.argtypes = [ctypes.c_void_p]
x.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
d = x.XOpenDisplay(None)
x.XSetInputFocus(d, ${win.getNativeWindowHandle().readUInt32LE()}, 1, 0)
k = x.XKeysymToKeycode(d, ord('z'))
t.XTestFakeKeyEvent(d, k, 1, 0)
t.XTestFakeKeyEvent(d, k, 0, 0)
x.XFlush(d)
x.XSync(d, 0)
`]);
        await sleep(200);
        assert.equal(await guest.executeJavaScript('document.querySelector("input").value'), 'z');
    }
    const before = attached.length;
    await win.webContents.executeJavaScript(`new Promise(resolve => {
        const frame = document.createElement('iframe');
        frame.srcdoc = '<webview src="${src}" style="width:100px;height:100px"></webview>';
        frame.onload = resolve; document.body.append(frame);
    })`);
    await sleep(500);
    assert.equal(attached.length, before);
    console.log('SPIKE passed', JSON.stringify({
        exactSession: guest.session === profile, cookie, hooked,
        overlayPixel: [...pixel], nativeInput: process.platform === 'linux' ? 'passed' : 'not-tested',
        subframeAttached: false,
    }));
    win.destroy();
    await profile.cookies.flushStore();
    server.close();
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
