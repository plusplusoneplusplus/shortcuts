'use strict';

// Only loopback synthetic documents and disposable profiles enter these real hosts.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, Menu, clipboard } = require('electron');
const { withRichClipboard } = require('../../dist/browser-rich-clipboard.js');
const { BrowserControlQueue } = require('../../dist/browser-control-queue.js');
const { registerBrowserEmbedder } = require('../../dist/browser-webview-guard.js');
const { ElectronBrowserHost } = require('../../dist/electron-browser-host.js');
const { WebView2BrowserHost } = require('../../dist/webview2-browser-host.js');

const data = process.env.COC_BROWSER_FRAME_DATA;
const engine = process.env.COC_BROWSER_E2E_ENGINE;
const richClipboardEnabled = process.env.COC_DESKTOP_RICH_CLIPBOARD_E2E === '1';
assert(data && path.basename(data).startsWith('.e2e-browser-frames-'));
app.setPath('userData', data);
app.setPath('sessionData', path.join(data, 'session'));
app.commandLine.appendSwitch('site-per-process');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1');
app.commandLine.appendSwitch('disable-background-networking');
// cleanup() destroys the only window before the server drains; without a listener
// Electron quits with code 0 there, before the report line is written.
app.on('window-all-closed', () => {});
let origin;
let crossOrigin;
let window;
let host;
let view;
let queue;
let unsubscribe;
const events = [];
const contexts = new Map();
const sessions = new Map();
const commands = [];
const ancestryProbes = new Map();
let maxProtocolBytes = 0;
let sessionEvaluations = 0;
let abortMouse;
let evalDispatched;
let savedRich = '<table><tbody><tr><td>Original</td></tr></tbody></table>';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const step = value => console.log('FRAME::' + value);
const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    const url = new URL(request.url, origin || 'http://127.0.0.1');
    const frame = (name, src, width, height, extra = '') =>
        `<iframe name="${name}" src="${src}" style="width:${width}px;height:${height}px;border:7px solid teal;${extra}"></iframe>`;
    const head = '<!doctype html><meta charset="utf-8"><style>body{margin:13px}input{width:170px}button{min-height:28px}</style>';
    if (url.pathname === '/save-rich') {
        let text = '';
        request.on('data', chunk => { text += chunk; });
        request.on('end', () => { savedRich = text; response.end('saved'); });
        return;
    }
    if (url.pathname === '/absolute') {
        const clip = url.searchParams.get('clip');
        const wrappers = {
            'static-hidden': 'overflow:hidden;height:0',
            'static-scroll': 'overflow:auto;height:0',
            'static-clip': 'overflow:clip;height:0',
            'fixed-hidden': 'overflow:hidden;height:0',
            'positioned-hidden': 'position:relative;overflow:hidden;height:0',
            'transformed-hidden': 'transform:translateZ(0);overflow:hidden;height:0',
            'paint-hidden': 'contain:paint;overflow:hidden;height:0',
            'positioned-clip': 'position:relative;overflow:clip;height:0',
            'hidden': 'visibility:hidden;height:0',
            'occluded': 'overflow:hidden;height:0',
        };
        return response.end(`<!doctype html><style>
            html{overflow:${clip === 'root' ? 'hidden' : 'visible'}}
            body{margin:0;height:0;overflow:${clip === 'root' ? 'visible' : 'hidden'}}
            iframe{position:${clip === 'fixed-hidden' ? 'fixed' : 'absolute'};inset:0;border:0;width:100vw;height:100vh}
            </style><div id="wrapper" style="${wrappers[clip] ?? (clip === 'genuine' ? 'position:relative;overflow:hidden;height:0' : '')}">
            <iframe name="rich-child" src="${crossOrigin}/${clip === 'body-nested' ? 'rich-shell' : 'rich'}"></iframe></div>
            ${clip === 'occluded' ? '<div style="position:fixed;inset:0;background:white;z-index:5"></div>' : ''}`);
    }
    if (url.pathname === '/rich-shell') return response.end(head + frame('same-site-rich', crossOrigin + '/rich', 700, 650, 'margin:30px'));
    if (url.pathname === '/rich') {
        response.setHeader('Content-Security-Policy', "require-trusted-types-for 'script'");
        return response.end(head + `<button id="focus">Focus sentinel</button>
            <div contenteditable="true" aria-label="Rich editor" id="editor">${savedRich}</div>
            <script>
            window.richSaved=false;
            document.getElementById('focus').onclick=()=>window.richClicked=true;
            document.getElementById('editor').addEventListener('input',async e=>{
                window.richInputTrusted=e.isTrusted;
                await fetch('/save-rich',{method:'POST',body:e.currentTarget.innerHTML});
                window.richSaved=true;
            });
            </script>`);
    }
    if (url.pathname === '/shell') return response.end(head + '<title>Synthetic embedder</title>');
    if (url.pathname === '/same') {
        return response.end(head + '<h2>Same-origin sentinel</h2>'
            + `<div style="margin-left:17px;overflow:auto;height:560px;width:760px">${frame('cross-site', crossOrigin + '/outer?synthetic-private=query', 690, 490, 'transform:scale(.9);transform-origin:top left')}</div>`);
    }
    if (url.pathname === '/outer') {
        return response.end(head + '<h2>Cross-site sentinel</h2><input aria-label="Outer input" value="outer untouched">'
            + frame('nested-site', origin + '/nested', 550, 330));
    }
    if (url.pathname === '/nested' || url.pathname === '/replacement') {
        const replacement = url.pathname === '/replacement';
        return response.end(head + `<h2>${replacement ? 'Replacement sentinel' : 'Nested sentinel'}</h2>
            <label>${replacement ? 'Replacement input' : 'Nested input'}<input id="field" value="initial"></label>
            <button id="save">Nested save</button><output id="result">Not saved</output>
            <div id="scroller" style="height:80px;overflow:auto;border:3px solid purple">
                <button id="scroll-anchor">Scroll anchor</button><div style="height:1200px">Synthetic scroll content</div>
            </div>
            <script>
                window.syntheticEvents=[];
                for(const type of ['input','change','click','keydown','wheel']) document.addEventListener(type,e=>{
                    syntheticEvents.push({type:e.type,trusted:e.isTrusted,target:e.target.id,key:e.key,x:e.clientX,y:e.clientY});
                },true);
                document.getElementById('save').onclick=()=>document.getElementById('result').textContent=
                    'Saved synthetic: '+document.getElementById('field').value;
            </script>`);
    }
    if (url.pathname === '/caps') {
        return response.end(head + '<h1>Bounded synthetic inventory</h1>'
            + Array.from({ length: 40 }, (_, index) => frame('bounded-' + index + '-' + 'x'.repeat(200), origin + '/tiny?i=' + index, 120, 50)).join(''));
    }
    if (url.pathname === '/tiny') return response.end(head + '<button>Tiny synthetic</button>');
    if (url.pathname === '/depth') {
        const depth = Number(url.searchParams.get('n') || 0);
        return response.end(head + `<p>Depth ${depth}</p>` + (depth < 11
            ? frame('depth-' + depth, `${depth % 2 ? origin : crossOrigin}/depth?n=${depth + 1}`, 600, 500) : ''));
    }
    if (url.pathname === '/large') {
        return response.end(head + `<pre id="text"></pre><button id="label">Large synthetic</button>
            <script>
                document.getElementById('text').textContent='界\\"\\\\synthetic '.repeat(100000);
                document.getElementById('label').setAttribute('aria-label','界\\"\\\\'.repeat(100000));
            </script>`);
    }
    if (url.pathname === '/nodes') {
        return response.end(head + `<h1>Node budget sentinel</h1><main></main><script>
            const fragment=document.createDocumentFragment();
            for(let i=0;i<21000;i++){const node=document.createElement('span');node.textContent='node ';fragment.append(node)}
            document.querySelector('main').append(fragment);
            const tail=document.createElement('button');tail.textContent='Beyond node budget';document.body.append(tail);
        </script>`);
    }
    response.end(head + '<title>Synthetic frame host</title><h1>Host sentinel</h1>'
        + '<input aria-label="Host input" value="host untouched">'
        + frame('same-site', origin + '/same', 820, 670));
});

async function until(check, label, timeout = 8000) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        try { const value = await check(); if (value) return value; }
        catch (error) { last = error; }
        await pause(40);
    }
    throw new Error(`Timed out: ${label}${last ? ': ' + last.message : ''}`);
}
const run = operation => queue.run(operation);
const configure = page => page.configureFrames(true, listener => view.onCdpEvent(listener), () => view.waitForCdpEvents?.());
const evaluate = (js, frame) => run(async page => JSON.parse((await page.evaluateForTool(js, frame)).valueJson));
const metadata = () => run(async page => page.frameMetadata());
const snapshot = () => run(page => page.snapshot());
const find = (result, name) => {
    const element = result.elements.find(value => value.name === name);
    assert(element, `Missing ${name}: ${JSON.stringify(result.elements.map(({name,frame})=>({name,frame})))}`);
    return element;
};
async function settledSnapshot(name) {
    return until(async () => {
        const result = await snapshot();
        return result.elements.some(value => value.name === name) ? result : false;
    }, 'snapshot containing ' + name);
}
async function navigate(url, marker) {
    await view.navigate(url);
    await until(async () => {
        const state = view.snapshot();
        if (state.loading || state.url !== url) return false;
        return evaluate(`document.body?.textContent.includes(${JSON.stringify(marker)})`);
    }, 'committed ' + marker);
}
function trace(method, params, session) {
    if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
        assert.equal(typeof params.sessionId, 'string');
        sessions.set(params.sessionId, params.targetInfo.targetId);
        if (ancestryProbes.size < 4) {
            const probe = { session: params.sessionId, target: params.targetInfo.targetId };
            ancestryProbes.set(params.sessionId, {
                probe, pending: Promise.all([
                    view.cdp('Page.getFrameTree', {}, params.sessionId).then(result => {
                        probe.tree = { id: result.frameTree?.frame.id, parent: result.frameTree?.frame.parentId,
                            origin: result.frameTree?.frame.securityOrigin };
                    }, error => { probe.treeError = error.message; }),
                    view.cdp('DOM.getFrameOwner', { frameId: params.targetInfo.targetId }).then(
                        result => { probe.owner = result; }, error => { probe.ownerError = error.message; }),
                ]),
            });
        }
    }
    if (method === 'Runtime.executionContextCreated' && params.context?.auxData?.isDefault) {
        contexts.set(`${session || ''}:${params.context.id}`, { session, frame: params.context.auxData.frameId });
    }
    if (events.length < 512 && ['Target.attachedToTarget', 'Target.detachedFromTarget', 'Page.frameDetached'].includes(method)) {
        events.push({ method, session: params.sessionId || session, reason: params.reason });
    }
}
async function cleanup() {
    unsubscribe?.();
    queue?.cancel(new Error('Synthetic fixture closed'));
    await view?.close();
    await host?.dispose();
    if (window && !window.isDestroyed()) window.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    crossOrigin = `http://localhost:${server.address().port}`;
    await app.whenReady();
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({ width: 1000, height: 920, show: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true } });
    registerBrowserEmbedder(window, origin + '/shell');
    await window.loadURL(origin + '/shell');
    host = engine === 'electron' ? new ElectronBrowserHost(path.join(data, 'profile'))
        : new WebView2BrowserHost(path.join(data, 'profile'));
    const availability = await host.availability();
    assert.equal(availability.available, true, 'Required real engine unavailable: ' + JSON.stringify(availability));
    const sink = { state() {}, newTab() { throw new Error('Fixture unexpectedly opened a tab'); },
        download() { throw new Error('Fixture unexpectedly downloaded a file'); }, closeRequested() {}, openMenuRequested() {} };
    view = await host.create({ ownerId: window.webContents.id, viewId: 'synthetic-frames', sessionKey: 'synthetic-owner', url: origin + '/' }, sink);
    if (view.embed === 'webview') {
        await window.webContents.executeJavaScript(`(() => {
            const guest=document.createElement('webview');guest.id='guest';
            guest.style.cssText='position:absolute;left:0;top:0;width:950px;height:850px';
            guest.setAttribute('partition',${JSON.stringify(view.partition)});
            guest.setAttribute('src',${JSON.stringify(view.src)});document.body.append(guest);
        })()`);
        const id = await until(() => window.webContents.executeJavaScript(`(() => {
            try{return document.getElementById('guest').getWebContentsId()}catch{return 0}
        })()`), 'authorized guest attachment');
        await view.adopt(id);
    }
    await view.setBounds({ x: 0, y: 0, width: 950, height: 850 });
    await until(() => !view.snapshot().loading, 'initial document');
    await view.focus();
    queue = new BrowserControlQueue(async (method, params, session) => {
        commands.push({ method, type: params?.type, session, x: params?.x, y: params?.y });
        if (session && method === 'Runtime.evaluate') {
            sessionEvaluations++;
            assert(contexts.has(`${session}:${params.contextId}`), 'Session evaluation lacks a real context/frame event association');
        }
        if (evalDispatched && method === 'Runtime.evaluate' && params.expression?.includes('synthetic-delayed-eval')) {
            evalDispatched(); evalDispatched = undefined;
        }
        const result = await view.cdp(method, params, session);
        maxProtocolBytes = Math.max(maxProtocolBytes, Buffer.byteLength(JSON.stringify(result) || '', 'utf8'));
        if (abortMouse && method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') {
            abortMouse.abort(new Error('Synthetic input cancelled')); abortMouse = undefined;
        }
        return result;
    });
    step('enable real frame discovery');
    unsubscribe = view.onCdpEvent(trace);
    try {
        await run(configure);
    } catch (error) {
        const tree = await view.cdp('Page.getFrameTree');
        const bounded = node => node && ({ id: node.frame.id, parent: node.frame.parentId,
            origin: node.frame.securityOrigin, children: node.childFrames?.slice(0, 8).map(bounded) });
        await Promise.all([...ancestryProbes.values()].map(value => value.pending));
        console.error('Synthetic ancestry:', JSON.stringify({
            tree: bounded(tree.frameTree), candidates: [...ancestryProbes.values()].map(value => value.probe),
            contexts: [...contexts.values()].slice(0, 16),
        }));
        throw error;
    }
    await until(async () => {
        await run(configure);
        return sessions.size >= 2 && [...contexts.values()].some(context => context.session && sessions.get(context.session) === context.frame);
    }, 'actual nested Target.attachedToTarget iframe sessions and default contexts');
    if (engine === 'webview2') {
        const other = new BrowserWindow({ width: 240, height: 160, show: true,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        try {
            await other.loadURL(origin + '/shell');
            other.focus();
            await until(async () => !await evaluate('document.hasFocus()'), 'background view loses focus');
            await view.focus();
            await until(() => evaluate('document.hasFocus()'), 'native focus returns to the selected view');
        } finally {
            other.destroy();
        }
    }
    // This proof precedes all frame reads and input assertions, not just their final report.
    assert(sessions.size >= 2, 'Distinct origins without real iframe sessions are insufficient');
    step('automatic snapshot and explicit frame reading');
    let current = await settledSnapshot('Nested input');
    const input = find(current, 'Nested input');
    const save = find(current, 'Nested save');
    const anchor = find(current, 'Scroll anchor');
    const outer = find(current, 'Outer input');
    const main = find(current, 'Host input');
    assert.notEqual(input.frame, outer.frame);
    assert.notEqual(input.frame, main.frame);
    assert.equal(current.elements.filter(value => value.name === 'Same-origin sentinel').length, 1);
    assert.equal(new Set(current.elements.map(value => value.ref)).size, current.elements.length);
    const inventory = (await metadata()).frames;
    assert.equal(inventory.length, 4);
    assert(inventory.every(frame => frame.status === 'ready' && frame.name.length <= 160));
    assert.equal(inventory.find(frame => frame.id === outer.frame).origin, crossOrigin);
    assert.equal(inventory.find(frame => frame.id === input.frame).origin, origin);
    assert.equal(inventory.find(frame => frame.id === input.frame).parent, outer.frame);
    assert(!JSON.stringify(inventory).includes('synthetic-private'));
    assert(!inventory.some(frame => ['sessionId', 'contextId', 'targetId', 'rawId'].some(key => key in frame)));
    const read = await run(page => page.readPage());
    for (const frame of inventory) {
        assert(read.text.includes(`[frame ${frame.id} | origin ${frame.origin} | ready]`));
        assert(read.text.includes(`[/frame ${frame.id}]`));
    }
    assert.equal(read.text.split('Same-origin sentinel').length - 1, 1);
    assert((await run(page => page.readPage(undefined, 0, input.frame))).text.includes('Nested sentinel'));
    assert.equal(await evaluate('document.querySelector("h2").textContent', input.frame), 'Nested sentinel');
    assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Host sentinel');
    await run((page, signal) => page.wait('Nested sentinel', signal, input.frame));
    await assert.rejects(run(page => page.readPage(input.ref, 0, outer.frame)), /another frame|conflict/);

    step('trusted scaled, bordered nested input and keyboard focus');
    await view.focus();
    await until(() => evaluate('document.hasFocus()'), 'selected view focused for input');
    await run(page => page.type(input.ref, 'frame value'));
    await run(page => page.press('End'));
    await run(page => page.press('x'));
    assert.equal(await evaluate('document.getElementById("field").value', input.frame), 'frame valuex');
    await run(async page => page.setCursorOverlay(true));
    await run(page => page.click(save.ref));
    assert((await run(page => page.readPage(undefined, 0, input.frame))).text.includes('Saved synthetic: frame valuex'));
    // The AI cursor lives in the top-level document, at the nested OOPIF click translated to top-level viewport space.
    const cursor = await until(() => evaluate(`(() => {
        const point = window.__cocCursorOverlay?.point;
        return point && { ...point, hit: document.elementFromPoint(point.x, point.y)?.tagName, hosts: document.querySelectorAll('coc-ai-cursor').length };
    })()`), 'AI cursor drawn in the top-level document');
    const nestedClick = (await evaluate('window.syntheticEvents', input.frame)).findLast(event => event.type === 'click' && event.target === 'save');
    assert.equal(cursor.hosts, 1);
    assert.equal(cursor.hit, 'IFRAME');
    assert(cursor.x > nestedClick.x && cursor.y > nestedClick.y, `cursor ${JSON.stringify(cursor)} is in top-level space, not frame-local ${JSON.stringify(nestedClick)}`);
    assert.equal(await evaluate('document.querySelectorAll("coc-ai-cursor").length', input.frame), 0);
    await run(async page => page.setCursorOverlay(false));
    await until(async () => await evaluate('document.querySelectorAll("coc-ai-cursor").length') === 0, 'AI cursor removed when the setting turns off');
    const trusted = await evaluate('window.syntheticEvents', input.frame);
    assert(trusted.some(event => event.type === 'input' && event.trusted));
    assert(trusted.some(event => event.type === 'change' && event.trusted));
    assert(trusted.some(event => event.type === 'click' && event.target === 'save' && event.trusted));
    assert(trusted.every(event => event.trusted));
    assert.equal(await evaluate('document.querySelector("input").value'), 'host untouched');
    assert.equal(await evaluate('document.querySelector("input").value', outer.frame), 'outer untouched');
    const geometry = async () => {
        const result = [];
        for (const frame of inventory) {
            result.push({ depth: frame.depth, ...await evaluate(`({
                width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollX,scrollY,
                owner:document.querySelector('iframe')?.getBoundingClientRect().toJSON(),
                input:document.querySelector('input')?.getBoundingClientRect().toJSON(),
                save:document.getElementById('save')?.getBoundingClientRect().toJSON()
            })`, frame.id) });
        }
        return result;
    };
    const zoomBaseline = await geometry();
    const zoomCommands = commands.length;
    await view.setPageZoom(150);
    const zoomBefore = await geometry();
    await run(page => page.type(input.ref, 'zoomed synthetic'));
    await run(page => page.click(save.ref));
    const zoomAfter = await geometry();
    const zoomValue = await evaluate('document.getElementById("result").textContent', input.frame);
    if (zoomValue !== 'Saved synthetic: zoomed synthetic') {
        console.error('Synthetic zoom geometry:', JSON.stringify({
            baseline: zoomBaseline, before: zoomBefore, after: zoomAfter,
            mouse: commands.slice(zoomCommands).filter(command => command.method === 'Input.dispatchMouseEvent'),
            nestedEvents: await evaluate('window.syntheticEvents.slice(-12)', input.frame),
            focused: await evaluate('({value:document.getElementById("field").value,active:document.activeElement.id})', input.frame),
        }));
    }
    assert.equal(await evaluate('document.getElementById("result").textContent', input.frame), 'Saved synthetic: zoomed synthetic');
    assert.equal(await evaluate('document.querySelector("input").value'), 'host untouched');
    await view.setPageZoom(100);
    await assert.rejects(run(page => page.press('x', outer.frame)), /Browser frame focus unavailable/);
    await run(page => page.click(outer.ref));
    await run(page => page.press('Tab', outer.frame));
    assert.equal(await evaluate('document.hasFocus()', outer.frame), true);
    await run(page => page.type(input.ref, 'scroll value'));
    await evaluate('document.getElementById("field").setSelectionRange(0,6); true', input.frame);
    await run(page => page.press('x', input.frame));
    assert.equal(await evaluate('document.getElementById("field").value', input.frame), 'x value');
    assert.equal(await evaluate('document.activeElement.id', input.frame), 'field');
    await run(page => page.scroll('down', anchor.ref));
    await until(() => evaluate('document.getElementById("scroller").scrollTop>0', input.frame), 'trusted nested container scroll');
    assert((await evaluate('window.syntheticEvents', input.frame)).some(event => event.type === 'wheel' && event.trusted));
    await assert.rejects(run(page => page.scroll('down', anchor.ref, outer.frame)), /another frame|conflict/);
    await evaluate(`document.body.insertAdjacentHTML('beforeend','<div id="overlay" style="position:fixed;inset:0;z-index:99999;background:white"></div>')`);
    const clicks = commands.filter(command => command.method === 'Input.dispatchMouseEvent' && command.type === 'mousePressed').length;
    await assert.rejects(run(page => page.click(save.ref)), /occluded|clipped|obscured/);
    assert.equal(commands.filter(command => command.method === 'Input.dispatchMouseEvent' && command.type === 'mousePressed').length, clicks);
    await evaluate('document.getElementById("overlay").remove()');

    step('cancelled trusted input releases without inserting text');
    const beforeCancelled = await evaluate('document.getElementById("field").value', input.frame);
    const insertions = commands.filter(command => command.method === 'Input.insertText').length;
    const releases = commands.filter(command => command.type === 'mouseReleased').length;
    const controller = new AbortController();
    abortMouse = controller;
    await assert.rejects(queue.run(page => page.type(input.ref, 'must not appear'), controller.signal), /Synthetic input cancelled/);
    await run(async () => {});
    assert.equal(commands.filter(command => command.method === 'Input.insertText').length, insertions);
    assert.equal(commands.filter(command => command.type === 'mouseReleased').length, releases + 1);
    assert.equal(await evaluate('document.getElementById("field").value', input.frame), beforeCancelled);

    step('cancelled real child evaluation retains the view queue barrier');
    const delayed = new AbortController();
    let dispatched;
    const started = new Promise(resolve => { dispatched = resolve; });
    evalDispatched = dispatched;
    const pending = queue.run(page => page.evaluateForTool(`new Promise(resolve=>setTimeout(()=>resolve('synthetic-delayed-eval'),350))`, input.frame), delayed.signal);
    await started;
    delayed.abort(new Error('Synthetic evaluation cancelled'));
    await assert.rejects(pending, /Synthetic evaluation cancelled/);
    let nextEntered = false;
    const after = run(async () => { nextEntered = true; });
    await pause(60);
    assert.equal(nextEntered, false, 'Cancellation released an outstanding session command');
    await after;
    assert.equal(nextEntered, true);

    step('process swap, detach and same-name replacement retire capabilities');
    const oldDocument = inventory.find(frame => frame.id === input.frame).document;
    await evaluate(`document.querySelector('iframe').src=${JSON.stringify(crossOrigin + '/replacement')}`, outer.frame);
    current = await settledSnapshot('Replacement input');
    const replacement = find(current, 'Replacement input');
    assert.notEqual(replacement.ref, input.ref);
    const replacedFrame = (await metadata()).frames.find(frame => frame.id === replacement.frame);
    assert(replacedFrame.id !== input.frame || replacedFrame.document !== oldDocument);
    assert.equal(replacedFrame.origin, crossOrigin);
    await assert.rejects(run(page => page.click(input.ref)), /stale/);
    await evaluate("document.querySelector('iframe').remove()", outer.frame);
    await until(async () => !(await metadata()).frames.some(frame => frame.id === replacement.frame), 'detached frame retirement');
    await assert.rejects(run(page => page.readPage(undefined, 0, replacement.frame)), /stale|unavailable/);
    await evaluate(`document.body.insertAdjacentHTML('beforeend',${JSON.stringify(`<iframe name="nested-site" src="${origin}/nested" style="width:550px;height:330px;border:7px solid teal"></iframe>`)})`, outer.frame);
    current = await settledSnapshot('Nested input');
    const recreated = find(current, 'Nested input');
    assert.notEqual(recreated.frame, replacement.frame);
    assert.notEqual(recreated.ref, input.ref);
    await assert.rejects(run(page => page.click(input.ref)), /stale/);
    await evaluate('setTimeout(()=>location.reload(),50); true', recreated.frame);
    await until(async () => {
        const fresh = await snapshot();
        return fresh.elements.some(element => element.name === 'Nested input' && element.frame !== recreated.frame);
    }, 'same-URL reload retires the document handle');
    await assert.rejects(run(page => page.readPage(undefined, 0, recreated.frame)), /stale/);

    step('fixed frame, depth, Unicode and transport budgets');
    for (const clip of ['static-hidden', 'static-scroll', 'static-clip', 'fixed-hidden', 'body', 'root', 'body-nested']) {
        await navigate(origin + '/absolute?clip=' + clip, '');
        if (clip === 'static-hidden') {
            assert(await evaluate(`(() => {
                const frame=document.querySelector('iframe'), parent=frame.parentElement;
                return frame.getBoundingClientRect().height > 700 && parent.getBoundingClientRect().height === 0
                    && getComputedStyle(parent).overflowY === 'hidden'
                    && getComputedStyle(parent).position === 'static'
                    && document.elementFromPoint(64,27) === frame;
            })()`), 'Zero-height static overflow wrapper must not actually clip its out-of-flow iframe');
        }
        current = await settledSnapshot('Focus sentinel');
        await view.focus();
        await until(() => evaluate('document.hasFocus()'), 'absolute-frame view focused');
        await run(page => page.click(find(current, 'Focus sentinel').ref));
        const editor = find(current, 'Rich editor');
        await until(() => evaluate('window.richClicked===true', editor.frame), 'visible absolute-frame click');
        await run(page => page.press('Escape', editor.frame));
        assert.equal(await evaluate('document.hasFocus()', editor.frame), true);
        await evaluate(`(() => {
            const editor=document.getElementById('editor');editor.focus();
            getSelection().selectAllChildren(editor);return true;
        })()`, editor.frame);
        const selectionBefore = await evaluate(`({active:document.activeElement.id,
            text:getSelection().toString(),anchor:getSelection().anchorOffset,focus:getSelection().focusOffset})`, editor.frame);
        await view.focus();
        await run(page => page.press('Escape', editor.frame));
        assert.deepEqual(await evaluate(`({active:document.activeElement.id,
            text:getSelection().toString(),anchor:getSelection().anchorOffset,focus:getSelection().focusOffset})`, editor.frame), selectionBefore);
        if (clip === 'static-hidden') {
            await evaluate('document.getElementById("wrapper").style.position="relative";true');
            const clipped = await snapshot();
            assert(!clipped.elements.some(e => e.name === 'Focus sentinel'));
            const inputCount = commands.filter(c => c.method.startsWith('Input.')).length;
            await assert.rejects(run(page => page.click(editor.ref)), /visible bounds|clipped/);
            await assert.rejects(run(page => page.press('Escape', editor.frame)), /focus unavailable/);
            assert.equal(commands.filter(c => c.method.startsWith('Input.')).length, inputCount);
            await evaluate('document.getElementById("wrapper").style.position="static";true');
            await settledSnapshot('Focus sentinel');
        }
        if (!richClipboardEnabled) continue;
        await evaluate(`(() => {
            const editor=document.getElementById('editor');editor.focus();
            const selection=getSelection();selection.selectAllChildren(editor);
            return true;
        })()`, editor.frame);
        const html = '<table><tbody><tr><td><b>Rich synthetic</b></td><td>Unicode \u03a9</td></tr></tbody></table>';
        const text = 'Rich synthetic\tUnicode \u03a9';
        await run((page, signal) => withRichClipboard(clipboard, html, text, true, signal, async write => {
            await view.focus();
            await page.pasteHtml(editor.ref, write, signal);
        }));
        await until(() => evaluate('window.richSaved===true', editor.frame), 'rich input persisted');
        assert.equal(await evaluate('window.richInputTrusted', editor.frame), true);
        assert.equal(await evaluate('document.querySelectorAll("#editor td").length', editor.frame), 2);
        assert.equal(await evaluate('document.querySelector("#editor b").textContent', editor.frame), 'Rich synthetic');
        await evaluate('setTimeout(()=>location.reload(),10);true', editor.frame);
        current = await until(async () => {
            const next = await snapshot();
            return next.elements.some(e => e.name === 'Rich editor' && e.frame !== editor.frame) && next;
        }, 'rich editor reload');
        const reloaded = find(current, 'Rich editor');
        assert.equal(await evaluate('document.querySelectorAll("#editor td").length', reloaded.frame), 2);
    }
    for (const clip of ['genuine', 'positioned-hidden', 'transformed-hidden', 'paint-hidden', 'positioned-clip', 'hidden']) {
        await navigate(origin + '/absolute?clip=' + clip, '');
        await until(async () => {
            await run(configure);
            const frames = (await metadata()).frames;
            return frames.some(f => f.name === 'rich-child' && f.status === 'ready');
        }, 'loaded genuinely clipped frame');
        assert.equal(await evaluate('document.elementFromPoint(64,27)?.localName === "iframe"'), false,
            clip + ' fixture must actually clip its iframe');
        current = await snapshot();
        assert(!current.elements.some(e => e.name === 'Focus sentinel'), clip + ': clipped child must not be visible');
    }
    await navigate(origin + '/absolute?clip=occluded', '');
    current = await settledSnapshot('Focus sentinel');
    const occluded = find(current, 'Focus sentinel');
    const beforeOccluded = commands.filter(c => c.method === 'Input.dispatchMouseEvent').length;
    await assert.rejects(run(page => page.click(occluded.ref)), /occluded|obscured/);
    assert.equal(commands.filter(c => c.method === 'Input.dispatchMouseEvent').length, beforeOccluded);
    await navigate(origin + '/caps', 'Bounded synthetic inventory');
    await run(configure);
    const capped = await metadata();
    assert.equal(capped.frames.length, 32);
    assert(capped.frames.every(frame => frame.name.length <= 160));
    assert(capped.frames.some(frame => frame.name.length === 160));
    assert.match(capped.truncated, /frame/);
    await navigate(origin + '/depth', 'Depth 0');
    await until(async () => {
        await run(configure);
        const value = await metadata();
        return value.frames.some(frame => frame.depth === 8) && value;
    }, 'depth-eight inventory');
    const depth = await metadata();
    assert.equal(Math.max(...depth.frames.map(frame => frame.depth)), 8);
    assert.match(depth.truncated, /frame|depth/);
    await navigate(origin + '/large', 'synthetic');
    const large = await run(page => page.readPage());
    assert.equal(large.text.length, 8000);
    assert(large.textTotal <= 1000000 + 1024, 'Read staged more than the aggregate character budget');
    assert.match((await metadata()).truncated, /char|work/);
    const next = await run(page => page.readPage(undefined, 8000));
    assert(next.text.length > 0 && next.text.length <= 8000, 'Bounded read pagination did not advance');
    const hugeEval = await run(page => page.evaluateForTool('"界".repeat(5000)'));
    assert.equal(hugeEval.valueJson.length, 4000);
    assert.equal(hugeEval.valueTruncated, true);
    const unicodeSnapshot = await snapshot();
    assert(unicodeSnapshot.elements.every(element => element.name.length <= 160));
    await navigate(origin + '/nodes', 'Node budget sentinel');
    const nodes = await snapshot();
    assert(!nodes.elements.some(element => element.name === 'Beyond node budget'));
    assert.match((await metadata()).truncated, /node|work/);
    assert(maxProtocolBytes <= 900000, 'Native result transport cap exceeded');

    step('feature-off rejects handles without installing new frame tracking');
    unsubscribe(); unsubscribe = undefined;
    await run(page => page.configureFrames(false));
    const beforeDisabled = commands.length;
    await run(page => page.readPage());
    await assert.rejects(run(page => page.readPage(undefined, 0, recreated.frame)), /disabled/);
    assert.equal((await metadata()).frames, undefined);
    assert(!commands.slice(beforeDisabled).some(command => ['Page.enable', 'Runtime.enable', 'Target.setAutoAttach'].includes(command.method)));
    const result = {
        engine, oopif: true, contextAssociation: true, iframeSessions: sessions.size, sessionEvaluations, maxProtocolBytes,
        automaticSnapshot: true, explicitReadEval: true, uniqueSameOrigin: true, boundaries: true,
        trustedNestedInput: true, nestedScroll: true, keyboardFocus: true, scaledBorderGeometry: true, pageZoom: true,
        occlusionRejected: true, conflictRejected: true, processSwapStale: true, detachStale: true,
        replacementStale: true, cancelledInputReleased: true, cancelledEvalSerialized: true,
        frameCap: 32, readCap: 8000, evalCap: 4000, depthCap: 8, nodeCap: 20000, charCap: 1000000,
        disabled: true, temporaryProfilesOnly: true, richPaste: richClipboardEnabled, absoluteClipping: true,
        containingBlockClipping: true, clippedKeysRejected: true, focusedSelectionPreserved: true,
    };
    await cleanup();
    // Piped stdout is asynchronous on Windows; exit only after the report flushes.
    process.stdout.write('E2E::' + JSON.stringify(result) + '\n', () => app.exit(0));
})().catch(async error => {
    console.error(error);
    try { await cleanup(); } catch (cleanupError) { console.error(cleanupError); }
    app.exit(1);
});
