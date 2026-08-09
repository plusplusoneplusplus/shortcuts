/**
 * E2E runner for the modernised screenshot annotation editor — executed inside a
 * REAL Electron main process (spawned by annotate-editor.e2e.test.ts). This is
 * the automated form of the three manual demos in the goal spec: it runs the
 * whole product path — real `desktopCapturer` grab, real crop overlay, a real
 * mouse drag to select, the real frameless editor `BrowserWindow` loading the
 * real `data:` URL page through the real preload bridge — and drives the toolbar
 * with real input events.
 *
 * Emits one `E2E::{json}` line per step; the vitest side parses and asserts.
 *
 * Only two things are stubbed, both at the OS boundary that a headless box
 * cannot answer: `dialog.showSaveDialog` (scripted per round) and the main
 * window's `webContents.send`, recorded so the chat-attach sink is observable.
 *
 * Kept as plain CommonJS: Electron loads it directly as an app main script.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow, dialog, clipboard } = require('electron');

const DIST = path.join(__dirname, '..', '..', 'dist');
const host = require(path.join(DIST, 'screenshot-capture-host.js'));

const emit = (step, data) => console.log('E2E::' + JSON.stringify({ step, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scripted Save-As answers, consumed one per Save click. */
const saveAnswers = [];
const saveCalls = [];
dialog.showSaveDialog = async (options) => {
    saveCalls.push({ title: options.title, defaultPath: options.defaultPath, filters: options.filters });
    return saveAnswers.shift() || { canceled: true, filePath: undefined };
};

/** The editor is the only window whose page carries the annotate toolbar. */
function findEditor() {
    return BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && w.webContents.getURL().includes('annotate-toolbar'),
    );
}

/** The overlay is the other screenshot window — fullscreen, no toolbar. */
function findOverlay(exceptIds) {
    return BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed()
            && !exceptIds.includes(w.id)
            && w.webContents.getURL().startsWith('data:text/html')
            && !w.webContents.getURL().includes('annotate-toolbar'),
    );
}

async function waitFor(fn, ms) {
    const deadline = Date.now() + ms;
    for (;;) {
        const v = fn();
        if (v) { return v; }
        if (Date.now() > deadline) { return null; }
        await sleep(50);
    }
}

function drag(wc, from, to) {
    wc.sendInputEvent({ type: 'mouseDown', x: from[0], y: from[1], button: 'left', clickCount: 1 });
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
        wc.sendInputEvent({
            type: 'mouseMove',
            x: Math.round(from[0] + ((to[0] - from[0]) * i) / steps),
            y: Math.round(from[1] + ((to[1] - from[1]) * i) / steps),
        });
    }
    wc.sendInputEvent({ type: 'mouseUp', x: to[0], y: to[1], button: 'left', clickCount: 1 });
}

/** Click a toolbar control with a REAL mouse event at its on-screen centre. */
async function clickControl(wc, id) {
    const box = await wc.executeJavaScript(
        '(function(){var r=document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect();'
        + 'return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()',
    );
    wc.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(120);
    return box;
}

function key(wc, keyCode, modifiers) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: keyCode, modifiers: modifiers || [] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: keyCode, modifiers: modifiers || [] });
}

const canvasSnapshot = (wc) => wc.executeJavaScript(
    "document.getElementById('annotate-canvas').toDataURL('image/png').length",
);

/** Open a fresh editor by running the whole capture → crop path. */
async function captureAndCrop(mainWin) {
    const before = BrowserWindow.getAllWindows().map((w) => w.id);
    await host.startScreenshotCapture();
    const overlay = await waitFor(() => findOverlay(before), 8000);
    if (!overlay) { throw new Error('overlay never opened'); }
    await sleep(400);
    drag(overlay.webContents, [120, 100], [640, 460]);
    const editor = await waitFor(findEditor, 8000);
    if (!editor) { throw new Error('editor never opened'); }
    await waitFor(() => editor.isVisible(), 5000);
    await sleep(400);
    return editor;
}

app.whenReady().then(async () => {
    try {
        const mainWin = new BrowserWindow({ show: false, width: 500, height: 380 });
        await mainWin.loadURL('data:text/html,<html><body>coc</body></html>');
        const sent = [];
        const realSend = mainWin.webContents.send.bind(mainWin.webContents);
        mainWin.webContents.send = (channel, ...rest) => {
            sent.push({ channel, payload: String(rest[0] || '').slice(0, 24) });
            return realSend(channel, ...rest);
        };
        host.setScreenshotMainWindowProvider(() => mainWin);

        // A framed control window, so "frameless" is a real discriminator and not
        // just an artefact of this window manager.
        emit('framed-control', {
            bounds: mainWin.getBounds(),
            content: mainWin.getContentBounds(),
        });

        // ── Round 1: the full AC-01/02/03 demo ────────────────────────────────
        const editor = await captureAndCrop(mainWin);
        const wc = editor.webContents;

        const b = editor.getBounds();
        const cb = editor.getContentBounds();
        emit('editor-open', {
            title: editor.getTitle(),
            frameless: b.width === cb.width && b.height === cb.height && b.y === cb.y,
            bounds: b,
            content: cb,
            visible: editor.isVisible(),
            resizable: editor.isResizable(),
            urlHasToolbar: wc.getURL().includes('annotate-toolbar'),
            canvas: await wc.executeJavaScript(
                "(function(){var c=document.getElementById('annotate-canvas');"
                + 'return {w:c.width,h:c.height,cssW:Math.round(c.getBoundingClientRect().width)};})()',
            ),
        });

        // AC-01: the pill floats over a full-height stage and is the drag region.
        emit('chrome', await wc.executeJavaScript(`(function () {
          var bar = document.getElementById('annotate-toolbar');
          var stage = document.getElementById('annotate-stage');
          var t = bar.getBoundingClientRect();
          var cs = getComputedStyle(bar);
          var controls = [].slice.call(bar.querySelectorAll('button, input, label'));
          return {
            position: cs.position,
            radius: parseFloat(cs.borderRadius),
            hasShadow: cs.boxShadow !== 'none' && cs.boxShadow !== '',
            hasBlur: (cs.backdropFilter || cs.webkitBackdropFilter || 'none') !== 'none',
            translucent: /rgba\\(/.test(cs.backgroundColor),
            centered: Math.abs((t.left + t.width / 2) - window.innerWidth / 2) <= 2,
            pillBottom: Math.round(t.top + t.height),
            stageFullHeight: Math.round(stage.getBoundingClientRect().height) === window.innerHeight,
            stagePadTop: parseFloat(getComputedStyle(stage).paddingTop),
            barRegion: cs.webkitAppRegion,
            controlRegions: controls.map(function (c) { return (c.id || c.tagName) + '=' + getComputedStyle(c).webkitAppRegion; }),
            fullWidthBar: Math.round(t.width) >= window.innerWidth,
            bottomBorder: parseFloat(cs.borderBottomWidth) > 1
          };
        })()`));

        // AC-02: real inline SVG, real tooltips, no network.
        emit('icons', await wc.executeJavaScript(`(function () {
          var ids = ['annotate-tool-pen','annotate-tool-line','annotate-tool-rect','annotate-tool-arrow','annotate-undo','annotate-save'];
          var out = {};
          ids.forEach(function (id) {
            var el = document.getElementById(id);
            var svg = el.querySelector('svg');
            var r = svg ? svg.getBoundingClientRect() : null;
            out[id] = {
              svgNs: svg ? svg.namespaceURI : null,
              shapes: svg ? svg.children.length : 0,
              w: r ? Math.round(r.width) : 0,
              h: r ? Math.round(r.height) : 0,
              title: el.getAttribute('title'),
              aria: el.getAttribute('aria-label'),
              text: el.textContent.trim()
            };
          });
          out.cancelText = document.getElementById('annotate-cancel').textContent.trim();
          out.doneText = document.getElementById('annotate-done').textContent.trim();
          out.resourceUrls = performance.getEntriesByType('resource').map(function (e) { return e.name; });
          return out;
        })()`));

        // AC-02: hover / active / focus-visible affordances, and Tab reach.
        emit('affordances', await wc.executeJavaScript(`(function () {
          function bg(id) { return getComputedStyle(document.getElementById(id)).backgroundColor; }
          var order = [];
          var els = [].slice.call(document.querySelectorAll('#annotate-toolbar button, #annotate-toolbar input'));
          els.forEach(function (el) {
            el.focus();
            var cs = getComputedStyle(el);
            order.push({ id: el.id, ring: cs.outlineWidth + ' ' + cs.outlineStyle, tabIndex: el.tabIndex });
          });
          document.activeElement.blur();
          return {
            inactiveBg: bg('annotate-tool-line'),
            activeBg: bg('annotate-tool-pen'),
            activeClass: document.getElementById('annotate-tool-pen').className,
            focusRuleCount: [].slice.call(document.styleSheets[0].cssRules).filter(function (r) {
              return r.selectorText && r.selectorText.indexOf(':focus-visible') >= 0;
            }).length,
            hoverRuleCount: [].slice.call(document.styleSheets[0].cssRules).filter(function (r) {
              return r.selectorText && r.selectorText.indexOf(':hover') >= 0;
            }).length,
            focusables: order
          };
        })()`));

        // Draw with a real mouse drag on the canvas, one stroke per tool.
        const blank = await canvasSnapshot(wc);
        const stage = await wc.executeJavaScript(
            "(function(){var r=document.getElementById('annotate-canvas').getBoundingClientRect();"
            + 'return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};})()',
        );
        const tools = ['pen', 'rect', 'arrow', 'line'];
        const activeAfterClick = {};
        for (let i = 0; i < tools.length; i++) {
            await clickControl(wc, 'annotate-tool-' + tools[i]);
            // Read ALL four, so "exactly one is active" is what gets asserted.
            activeAfterClick[tools[i]] = await wc.executeJavaScript(
                "['pen','line','rect','arrow'].filter(function(t){"
                + "return document.getElementById('annotate-tool-'+t).className==='tool active';})",
            );
            const y = stage.y + 40 + i * 30;
            drag(wc, [stage.x + 30, y], [stage.x + 30 + 120, y + 22]);
            await sleep(80);
        }
        const drawn = await canvasSnapshot(wc);
        emit('draw', { blank, drawn, changed: drawn !== blank, activeAfterClick, stage });

        // The image must sit fully INSIDE the padded stage — no clipping, no
        // scrollbars. (Regression: the fit math once measured the raw window.)
        emit('canvas-fits', await wc.executeJavaScript(`(function () {
          var stage = document.getElementById('annotate-stage');
          var c = document.getElementById('annotate-canvas');
          var s = stage.getBoundingClientRect();
          var r = c.getBoundingClientRect();
          var cs = getComputedStyle(stage);
          var padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
          var padT = parseFloat(cs.paddingTop), padB = parseFloat(cs.paddingBottom);
          return {
            overflowsLeft: r.left < s.left + padL - 1,
            overflowsRight: r.right > s.right - padR + 1,
            overflowsTop: r.top < s.top + padT - 1,
            overflowsBottom: r.bottom > s.bottom - padB + 1,
            scrolls: stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1,
            aspectPreserved: Math.abs((r.width / r.height) - (c.width / c.height)) < 0.02,
            canvasRect: { w: Math.round(r.width), h: Math.round(r.height) },
            stagePad: { l: padL, r: padR, t: padT, b: padB }
          };
        })()`));

        // ── AC-03: Save is explicit, repeatable, and never closes the editor ──
        const outFile = path.join(os.tmpdir(), 'coc-annotate-e2e-' + process.pid + '.png');
        saveAnswers.push({ canceled: false, filePath: outFile });
        await clickControl(wc, 'annotate-save');
        await sleep(400);
        emit('save-once', {
            dialogCalls: saveCalls.length,
            dialogTitle: saveCalls[0] && saveCalls[0].title,
            defaultPath: saveCalls[0] && saveCalls[0].defaultPath,
            editorAlive: !editor.isDestroyed() && editor.isVisible(),
            fileWritten: fs.existsSync(outFile),
            fileBytes: fs.existsSync(outFile) ? fs.statSync(outFile).size : 0,
            isPng: fs.existsSync(outFile)
                ? fs.readFileSync(outFile).slice(0, 4).toString('hex') === '89504e47'
                : false,
            attachedSoFar: sent.filter((s) => s.channel.includes('attach')).length,
        });

        // A cancelled dialog writes nothing.
        const cancelProbe = path.join(os.tmpdir(), 'coc-annotate-e2e-cancel-' + process.pid + '.png');
        saveAnswers.push({ canceled: true, filePath: cancelProbe });
        await clickControl(wc, 'annotate-save');
        await sleep(400);
        emit('save-cancelled', {
            dialogCalls: saveCalls.length,
            cancelFileWritten: fs.existsSync(cancelProbe),
            editorAlive: !editor.isDestroyed() && editor.isVisible(),
        });

        // Undo still works after saving.
        const beforeUndo = await canvasSnapshot(wc);
        key(wc, 'z', ['control']);
        await sleep(250);
        const afterUndo = await canvasSnapshot(wc);
        emit('undo', { beforeUndo, afterUndo, changed: beforeUndo !== afterUndo });

        // ── Done: clipboard + chat draft, no file dialog ──────────────────────
        clipboard.clear();
        const dialogsBeforeDone = saveCalls.length;
        await clickControl(wc, 'annotate-done');
        await sleep(700);
        emit('done', {
            dialogsBeforeDone,
            dialogsAfterDone: saveCalls.length,
            editorClosed: editor.isDestroyed(),
            clipboardHasImage: !clipboard.readImage().isEmpty(),
            clipboardSize: clipboard.readImage().isEmpty() ? null : clipboard.readImage().getSize(),
            channels: sent.map((s) => s.channel),
            attachPayloadPrefix: (sent.find((s) => s.channel.includes('attach')) || {}).payload,
        });

        // ── Round 2: with no title bar, Esc must still be a close path ────────
        const editor2 = await captureAndCrop(mainWin);
        const dialogsBeforeEsc = saveCalls.length;
        const channelsBeforeEsc = sent.length;
        key(editor2.webContents, 'Escape');
        await sleep(700);
        emit('esc', {
            editorClosed: editor2.isDestroyed(),
            newDialogs: saveCalls.length - dialogsBeforeEsc,
            newChannels: sent.length - channelsBeforeEsc,
        });

        try { fs.unlinkSync(outFile); } catch { /* best effort */ }
        emit('finished', { ok: true });
        app.exit(0);
    } catch (e) {
        emit('error', { message: String((e && e.stack) || e) });
        app.exit(1);
    }
});
