'use strict';

// Only the provider and process persistence are deterministic stand-ins. Every browser
// command crosses the production WebSocket relay, SPA handler, preload, main and CDP.
const { app, BrowserWindow, Menu, nativeImage } = require('electron');
const { buildSync } = require('esbuild');
const { createServer } = require('node:http');
const childProcess = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

process.on('uncaughtException', error => {
    console.error(error);
    app.exit(1);
});

const data = process.env.COC_BROWSER_WORKFLOW_DATA;
const engine = process.env.COC_BROWSER_E2E_ENGINE;
const frameWorkflow = process.env.COC_BROWSER_E2E_FRAMES === '1';
const nativeBinary = engine === 'webview2' ? require('@plusplusoneplusplus/coc-native').loadWebView2Binary() : undefined;
let nativeHelperPid;
const spawn = childProcess.spawn;
childProcess.spawn = function (binary, ...args) {
    const child = spawn.call(this, binary, ...args);
    if (nativeBinary && binary === nativeBinary) nativeHelperPid = child.pid;
    return child;
};
app.setPath('userData', data);
if (frameWorkflow) {
    app.commandLine.appendSwitch('site-per-process');
    app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1');
}
const { registerBrowserViewIpc, registerBrowserEmbedder, disposeBrowserViews } = require('../../dist/browser-view-host');
const { ProcessWebSocketServer } = require('../../../coc/dist/server/streaming/websocket');
const { buildChatTurnContext } = require('../../../coc/dist/server/executors/chat-turn-context-builder');
const { BrowserToolStateStore } = require('../../../coc/dist/server/llm-tools/browser-tools');
const { CocToolRuntime } = require('@plusplusoneplusplus/coc-agent-sdk');
const fixtureConfig = { browserControl: { enabled: true, framesEnabled: frameWorkflow } };
const renderer = buildSync({
    entryPoints: [path.join(__dirname, 'browser-control-workflow-renderer.tsx')],
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;
const page = `<!doctype html><title>Workflow fixture</title>
    <label>Message<input aria-label="Message"></label><button>Publish</button><p id="result">Waiting</p>
    <button id="popup">Open popup</button><button id="sibling">Open sibling</button>
    <script>
        window.events = [];
        document.querySelector('input').addEventListener('input', e => events.push({type:e.type,trusted:e.isTrusted}));
        document.querySelector('button').addEventListener('click', e => {
            events.push({type:e.type,trusted:e.isTrusted});
            document.getElementById('result').textContent = 'Published: ' + document.querySelector('input').value;
        });
        for (const id of ['popup', 'sibling']) {
            document.getElementById(id).addEventListener('click', () => {
                window.open('/page?native=' + id, id, 'width=480,height=560');
            });
        }
    </script>`;
const largePage = `<!doctype html><title>Large bounded fixture</title><h1>Large content</h1>
    <pre></pre><button id="large-name">Large name</button><button>After large name</button>
    <script>
        document.querySelector('pre').textContent = '0123456789'.repeat(110000) + 'TAIL_MARKER';
        document.getElementById('large-name').setAttribute('aria-label', 'quoted"slash\\\\'.repeat(110000));
    </script>`;
const cancellations = [];
const turnControllers = new Map();
const server = createServer((req, res) => {
    if (req.url.includes('/llm-tools-config')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ tools: fixtureConfig.browserControl.enabled ? [{ name: 'browser' }] : [], disabledLlmTools: [] }));
        return;
    }
    if (req.method === 'POST' && req.url.startsWith('/api/processes/') && req.url.includes('/cancel')) {
        const url = new URL(req.url, 'http://127.0.0.1');
        const processId = decodeURIComponent(url.pathname.split('/')[3]);
        const workspaceId = url.searchParams.get('workspace');
        cancellations.push({ processId, workspaceId });
        turnControllers.get(processId)?.abort(new Error('Fixture conversation turn cancelled'));
        ws.browserControl.finishProcess(workspaceId, processId);
        ws.broadcastProcessEvent({ type: 'process-updated', process: { id: processId, workspaceId, status: 'cancelled' } });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ process: { id: processId, workspaceId, status: 'cancelled' } }));
        return;
    }
    if (req.url.startsWith('/large')) res.setHeader('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; require-trusted-types-for 'script'");
    res.setHeader('content-type', req.url === '/renderer.js' ? 'application/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/renderer.js' ? renderer : req.url === '/style.css'
        ? readFileSync(path.join(__dirname, '../../../coc/src/server/spa/client/dist/bundle.css'))
        : frameWorkflow && req.url.startsWith('/route-frame')
            ? '<!doctype html><title>Synthetic route frame</title><p>Route frame sentinel</p><input aria-label="Route frame input"><button onclick="document.querySelector(\'p\').textContent=document.querySelector(\'input\').value">Route frame save</button>'
        : req.url.startsWith('/large') ? largePage : req.url.startsWith('/page') ? page
            : `<!doctype html><link rel="stylesheet" href="/style.css"><script>window.__DASHBOARD_CONFIG__={features:{browserControlEnabled:true,browserFrameControlEnabled:${frameWorkflow}},apiBasePath:"/api"}</script><div id="root"></div><script src="/renderer.js"></script>`);
});
const ws = new ProcessWebSocketServer();
ws.browserControl.setEnabledGetter(() => fixtureConfig.browserControl.enabled);
if (frameWorkflow) ws.browserControl.setFramesEnabledGetter(() => fixtureConfig.browserControl.framesEnabled);
ws.attach(server);
const browserState = new BrowserToolStateStore(path.join(data, 'coc-data'));
let lastBrowserResult;
const executeBrowser = ws.browserControl.execute.bind(ws.browserControl);
ws.browserControl.execute = async (...args) => {
    const result = await executeBrowser(...args);
    if (args[1] === 'conversation-large') lastBrowserResult = result;
    return result;
};
const processes = new Map();
const store = {
    getProcess(id, workspaceId) {
        const value = processes.get(id);
        return value?.workspaceId === workspaceId ? value : undefined;
    },
    updateProcess(id, patch) {
        const current = processes.get(id);
        if (!current) throw new Error('Missing fixture process');
        Object.assign(current, patch);
        return current;
    },
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
    for (let i = 0; i < 200; i++) {
        const value = await check();
        if (value) return value;
        await pause(25);
    }
    throw new Error(`Timed out: ${label}`);
}
async function turn(workspaceId, processId, query, browserActivation) {
    if (!processes.has(processId)) processes.set(processId, { id: processId, workspaceId, metadata: { type: 'chat' } });
    const controller = new AbortController();
    turnControllers.set(processId, controller);
    return buildChatTurnContext({
        store, workspaceId, processId, query, browserActivation, browserOnly: true, includeMemoryV2: false,
        browserRuntime: ws.browserControl, browserState, browserSignal: controller.signal,
    });
}
function driver(context) {
    const tool = context.tools.find(tool => tool.name === 'browser');
    assert(tool, 'Real turn bundle did not register browser');
    return async command => {
        const result = await tool.handler(command);
        assert(result.resultType === 'success', `${command.action}: ${result.textResultForLlm}`);
        return result.textResultForLlm;
    };
}

app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    registerBrowserViewIpc(path.join(data, 'desktop'));
    const windows = [];
    async function windowFor(workspaceId) {
        const win = new BrowserWindow({
            width: 900, height: 700, show: true,
            webPreferences: { preload: path.resolve(__dirname, '../../dist/preload.js'),
                contextIsolation: true, sandbox: true, webviewTag: true },
        });
        windows.push(win);
        const url = `${origin}/?workspace=${workspaceId}`;
        registerBrowserEmbedder(win, url);
        win.webContents.on('console-message', event => console.error('Renderer:', event.message));
        await win.loadURL(url);
        const js = code => win.webContents.executeJavaScript(code);
        await until(() => js('window.workflow?.ready'), `${workspaceId} capability handshake`);
        const selected = await js(`window.cocDesktop.browser.setDefaultEngine(${JSON.stringify(engine)})`);
        assert(selected.ok, `Engine ${engine} is unavailable: ${JSON.stringify(selected)}`);
        return { win, js };
    }

    const owner = await windowFor('workspace-a');
    assert(!await owner.js('window.workflow.panelOpen'), 'Fixture panel must begin collapsed');
    const parsed = await owner.js(`window.workflow.parse('/browser publish the fixture message', true)`);
    assert(parsed.metaCommands.includes('browser') && parsed.prompt === 'publish the fixture message', 'Actual slash parser failed');
    const context = await turn('workspace-a', 'conversation-a', parsed.prompt, parsed.metaCommands.includes('browser'));
    assert(context.tools.length === 1 && context.tools[0].name === 'browser', 'Fixture received unrelated provider tools');
    assert(context.browserPrompt.includes('Browser mode is active'), 'Actual turn activation prompt missing');
    assert(processes.get('conversation-a').metadata.browserMode === true, 'Sticky mode not persisted');
    let call = driver(context);
    const opened = await call({ action: 'open', url: origin + '/page?owner=a' });
    assert(opened.includes('Workflow fixture'), 'Open did not wait for actual fixture document');
    await until(() => owner.js('window.workflow.panelOpen && window.workflow.tabs.length === 1'), 'closed panel reveal');
    const tab = (await owner.js('window.workflow.tabs'))[0];
    assert(tab.ownerWorkspaceId === 'workspace-a' && tab.ownerRoutingRef === 'workspace-a'
        && (await owner.js('window.workflow.reveals')).every(event => event.processId === 'conversation-a'
            && event.workspaceId === 'workspace-a' && event.viewId === tab.resourceId), 'Reveal lost workspace/conversation ownership');
    const snapshot = await call({ action: 'snapshot' });
    const input = snapshot.match(/^(e\d+) textbox "Message"/m)?.[1];
    const button = snapshot.match(/^(e\d+) button "Publish"/m)?.[1];
    assert(input && button, `No input/button refs in live snapshot: ${snapshot}`);
    await call({ action: 'type', ref: input, text: 'isolated relay works' });
    await call({ action: 'click', ref: button });
    const read = await call({ action: 'read' });
    const parseEvaluation = text => JSON.parse(frameWorkflow ? text.slice(text.indexOf('\n') + 1) : text);
    const report = parseEvaluation(await call({ action: 'eval', js: '({events:window.events, bridge:typeof window.cocDesktop, require:typeof require})' }));
    assert(read.includes('Published: isolated relay works'), `Live page read failed: ${read}; ${JSON.stringify(report)}`);
    assert(report.events.length >= 2 && report.events.every(event => event.trusted), 'Input was not trusted CDP input');
    assert(report.bridge === 'undefined' && report.require === 'undefined', 'Guest exposed privileged bridge');
    if (frameWorkflow) {
        await call({ action: 'eval', js: `document.body.insertAdjacentHTML('beforeend',${JSON.stringify(
            `<iframe src="${origin.replace('127.0.0.1', 'localhost')}/route-frame" name="route-child" style="width:500px;height:200px;border:5px solid teal"></iframe>`)})` });
        const frameSnapshot = await until(async () => {
            const value = await call({ action: 'snapshot' });
            return value.includes('Route frame input') && value;
        }, 'frame-enabled cross-site relay snapshot');
        const frameInput = frameSnapshot.match(/^\s*(e\d+) textbox "Route frame input"/m)?.[1];
        const frameSave = frameSnapshot.match(/^\s*(e\d+) button "Route frame save"/m)?.[1];
        const frames = await call({ action: 'frames' });
        const frame = frames.match(/\[frame ([^\s|]+) \| name "route-child" \|/)?.[1];
        assert(frame && frameInput && frameSave, `Frame metadata/refs lost in relay: ${frameSnapshot}\n${frames}`);
        await call({ action: 'type', ref: frameInput, text: 'frame relay value' });
        await call({ action: 'click', ref: frameSave });
        const frameRead = await call({ action: 'read', frame });
        assert(frameRead.includes('frame relay value') && frameRead.includes('[frame '), 'Frame read lost scoped output');
        assert(parseEvaluation(await call({ action: 'eval', frame, js: 'document.querySelector("p").textContent' })) === 'frame relay value',
            'Explicit frame eval did not cross the production route');
        assert(parseEvaluation(await call({ action: 'eval', js: 'document.title' })) === 'Workflow fixture', 'Explicit frame eval changed the default context');
        const foreign = await windowFor('workspace-b');
        const foreignContext = await turn('workspace-b', 'frame-foreign', '/browser synthetic isolation', true);
        const foreignCall = driver(foreignContext);
        await foreignCall({ action: 'open', url: origin + '/page?owner=foreign-frame' });
        const foreignTool = foreignContext.tools.find(tool => tool.name === 'browser');
        const foreignHandle = await foreignTool.handler({ action: 'read', frame });
        assert(foreignHandle.resultType === 'failure' && /stale frame/.test(foreignHandle.textResultForLlm),
            'Foreign workspace reused a frame handle');
        const foreignRef = await foreignTool.handler({ action: 'click', ref: frameInput });
        assert(foreignRef.resultType === 'failure' && /stale ref/.test(foreignRef.textResultForLlm),
            'Another view reused a returned frame ref');
        const ownerTabId = `t${owner.win.webContents.id}:${tab.resourceId}`;
        await foreign.js(`window.cocDesktop.browser.control.bindScope('workspace-a','remote:synthetic:workspace-a')`);
        const cloneIsolation = await foreign.js(`window.cocDesktop.browser.control.execute({
            id:'frame-clone-isolation',workspaceId:'workspace-a',processId:'frame-foreign',framesEnabled:true,
            selectedTab:${JSON.stringify(ownerTabId)},command:{action:'read',frame:${JSON.stringify(frame)}}
        }).then(() => '',error => error.message)`);
        assert(cloneIsolation.includes('not found in this workspace'), 'Clone with the same raw workspace controlled the local frame');
        const wrongScope = await owner.js(`window.cocDesktop.browser.control.execute({
            id:'frame-workspace-isolation',workspaceId:'workspace-b',processId:'conversation-a',framesEnabled:true,
            selectedTab:${JSON.stringify(ownerTabId)},command:{action:'read',frame:${JSON.stringify(frame)}}
        }).then(() => '',error => error.message)`);
        assert(wrongScope.includes('workspace scope changed'), 'Frame command crossed the bound workspace');
        const file = path.join(data, 'frame-excluded.html');
        writeFileSync(file, '<!doctype html><title>Frame excluded preview</title><p>Synthetic preview</p>');
        await owner.js(`window.workflow.setFile(${JSON.stringify(file)})`);
        await until(() => owner.js(`window.workflow.states.some(state=>state.title==='Frame excluded preview'&&!state.loading)`), 'frame-mode excluded file preview');
        assert(!(await call({ action: 'tabs' })).includes('Frame excluded preview'), 'Frame mode exposed a file preview');
        const fileRejected = await context.tools.find(tool => tool.name === 'browser').handler({
            action: 'select', tab: `t${owner.win.webContents.id}:html-page:excluded-file`,
        });
        assert(fileRejected.resultType === 'failure', 'Frame mode selected a file preview');
        foreignContext.dispose();
        await owner.js(`window.cocDesktop.browser.control.releaseFrames('workspace-a')`);
        const releasedFrame = await context.tools.find(tool => tool.name === 'browser').handler({ action: 'read', frame });
        assert(releasedFrame.resultType === 'failure' && releasedFrame.textResultForLlm.includes('stale frame'),
            'Idle frame release retained a usable context handle');
        fixtureConfig.browserControl.framesEnabled = false;
        const disabledFrame = await context.tools.find(tool => tool.name === 'browser').handler({ action: 'read', frame });
        assert(disabledFrame.resultType === 'failure' && disabledFrame.textResultForLlm.includes('disabled'), 'Live frame policy disable did not reject the old handle');
        const disabledRead = await call({ action: 'read' });
        assert(disabledRead.includes('Published: isolated relay works') && !disabledRead.includes('[frame '), 'Frame disable did not preserve legacy root reading');
        console.log('E2E::' + JSON.stringify({ engine, frameRoute: true, automaticSnapshot: true,
            frameReadEval: true, frameOwnedInput: true, defaultContext: true, liveFrameDisabled: true,
            frameOwnerIsolation: true, frameCloneIsolation: true, frameFileExcluded: true }));
        context.dispose();
        await disposeBrowserViews();
        for (const win of windows) win.destroy();
        ws.closeAll();
        server.close();
        app.exit(0);
        return;
    }
    owner.win.setSize(1800, 1000);
    await owner.js('window.workflow.resizePanel(1600, 800)');
    await until(() => owner.js(`document.getElementById('panel').getBoundingClientRect().width === 1600`), 'expanded browser panel');
    const zoomed = await owner.js('window.cocDesktop.browser.setPageZoom(200)');
    assert(zoomed.ok, 'Actual page-zoom IPC failed');
    const highDpiViewport = await until(async () => {
        const viewport = JSON.parse(await call({ action: 'eval',
            js: '({width:innerWidth, pixelRatio:devicePixelRatio, physicalWidth:innerWidth * devicePixelRatio})' }));
        return viewport.pixelRatio >= 2 && viewport.physicalWidth > 1280 ? viewport : false;
    }, 'high-DPI viewport exceeding the unscaled screenshot budget');
    const browserTool = context.tools.find(tool => tool.name === 'browser');
    // Screenshots always save to a workspace-scoped file; pixels attach only on request.
    const nativeScreenshot = await browserTool.handler({ action: 'screenshot', view: true });
    const nativeBinary = nativeScreenshot.binaryResultsForLlm?.[0];
    assert(nativeScreenshot.resultType === 'success' && nativeBinary?.mimeType === 'image/jpeg',
        `Native tool screenshot failed: ${nativeScreenshot.textResultForLlm}`);
    const savedScreenshot = nativeScreenshot.textResultForLlm.match(/saved: !\[screenshot\]\(<([^>]+)>\)/)?.[1];
    assert(savedScreenshot && existsSync(savedScreenshot)
        && readFileSync(savedScreenshot).equals(Buffer.from(nativeBinary.data, 'base64')), 'Native screenshot file was not saved');
    const mcpRuntime = new CocToolRuntime(context.tools, { workspaceId: 'workspace-a', processId: 'conversation-a' });
    const mcpScreenshot = await mcpRuntime.callTool('browser', { action: 'screenshot', view: true });
    const mcpBinary = mcpScreenshot.content.find(block => block.type === 'image');
    assert(!mcpScreenshot.isError && mcpBinary?.mimeType === nativeBinary.mimeType
        && mcpScreenshot.content[0].type === 'text', 'Provider-neutral runtime discarded the live screenshot');
    const screenshot = nativeImage.createFromBuffer(Buffer.from(mcpBinary.data, 'base64')).getSize();
    const nativeSize = nativeImage.createFromBuffer(Buffer.from(nativeBinary.data, 'base64')).getSize();
    assert(screenshot.width > 0 && screenshot.width <= 1280
        && screenshot.width === nativeSize.width && screenshot.height === nativeSize.height, 'Native/MCP screenshot dimensions differ');
    mcpRuntime.dispose();
    const resetZoom = await owner.js('window.cocDesktop.browser.setPageZoom(100)');
    assert(resetZoom.ok, 'Page zoom reset failed');
    await owner.js('window.workflow.resizePanel(640, 520)');
    owner.win.setSize(900, 700);
    const ownerTabs = await call({ action: 'tabs' });
    assert(ownerTabs.includes(`t${owner.win.webContents.id}:`) && ownerTabs.includes(engine), 'Tab did not belong to actual owner/engine');

    const followUp = await turn('workspace-a', 'conversation-a', 'read the result again');
    assert(followUp.browserPrompt.includes('Browser mode is active'), 'Follow-up lost sticky activation');
    assert((await driver(followUp)({ action: 'read' })).includes('Published: isolated relay works'), 'Follow-up lost selected live tab');
    call = driver(followUp);
    const independent = await turn('workspace-a', 'conversation-independent', 'inspect browser');
    const unselected = await independent.tools.find(tool => tool.name === 'browser').handler({ action: 'read' });
    assert(independent.browserPrompt === '' && unselected.resultType === 'failure'
        && unselected.textResultForLlm.includes('No browser tab selected'), 'Selected tab leaked across conversations');

    const foreign = await windowFor('workspace-b');
    const foreignContext = await turn('workspace-b', 'conversation-b', '/browser other workspace');
    const foreignCall = driver(foreignContext);
    await foreignCall({ action: 'open', url: origin + '/page?owner=b' });
    const foreignTabs = await foreignCall({ action: 'tabs' });
    const foreignId = foreignTabs.split(' ')[0];
    assert(!(await call({ action: 'tabs' })).includes('owner=b'), 'Another workspace URL leaked into tabs');
    const rejected = await followUp.tools.find(tool => tool.name === 'browser').handler({ action: 'select', tab: foreignId });
    assert(rejected.resultType === 'failure' && rejected.textResultForLlm.includes('not found in this workspace'), 'Foreign tab selection succeeded');
    const wrongScope = await owner.js(`window.cocDesktop.browser.control.execute({
        id:'wrong-workspace', workspaceId:'workspace-b', processId:'conversation-a', command:{action:'tabs'}
    }).then(() => '', error => error.message)`);
    assert(wrongScope.includes('workspace scope changed'), 'Main IPC accepted a request outside its bound owner scope');

    const largeContext = await turn('workspace-a', 'conversation-large', '/browser large results', true);
    const largeCall = driver(largeContext);
    await largeCall({ action: 'open', url: origin + '/large', newTab: true });
    const largeTab = lastBrowserResult.tab;
    const largeRead = await largeCall({ action: 'read' });
    const firstPage = lastBrowserResult;
    assert(largeRead.length <= 8000 && firstPage.text.length === 8000 && firstPage.textTotal > 1100000, 'Large read was not paged before transport');
    const nextOffset = Number(largeRead.match(/offset=(\d+)/)?.[1]);
    assert(nextOffset === largeRead.split('\ntruncated')[0].length, 'Read continuation skips characters');
    await largeCall({ action: 'read', offset: nextOffset });
    assert(lastBrowserResult.text.startsWith(firstPage.text.slice(nextOffset)), 'Large read applied its offset twice');
    const largeTail = await largeCall({ action: 'read', offset: firstPage.textTotal - 80 });
    assert(largeTail.includes('TAIL_MARKER'), 'Large read tail is inaccessible');
    const largeSnapshot = await largeCall({ action: 'snapshot', all: true });
    assert(largeSnapshot.length <= 6000 && largeSnapshot.includes('truncated'), 'Large snapshot exceeded its display budget');
    assert(lastBrowserResult.interactiveElements.some(element => element.name === 'After large name')
        && lastBrowserResult.interactiveElements.some(element => element.name.length > 1100000), 'Snapshot paging lost complete interactive baselines');
    const quietDelta = await largeCall({ action: 'press', key: 'Escape' });
    assert(!quietDelta.includes('\n'), 'Paged snapshot lost the delta baseline');
    const largeEval = await largeCall({ action: 'eval', js: "'x'.repeat(1100000)" });
    assert(largeEval.length === 4000 && largeEval.endsWith('truncated - return a smaller result'), 'Large eval was not bounded before transport');
    await largeCall({ action: 'eval', js: "document.title = 'x'.repeat(1100000); true" });
    await largeCall({ action: 'wait', ms: 50 });
    await largeCall({ action: 'eval', js: 'document.title = "Large bounded fixture"; true' });
    const largeViewId = /^t\d+:(.+)$/.exec(largeTab)[1];
    await owner.js(`window.cocDesktop.browser.close(${JSON.stringify(largeViewId)})`);
    assert((await call({ action: 'read' })).includes('Published: isolated relay works'), 'Large results disrupted another shared view');

    // Exercise the same native popup lifecycle through both engines, including Windows CI.
    const rootId = ownerTabs.split('\n').find(line => line.includes('owner=a')).split(' ')[0];
    await call({ action: 'select', tab: rootId });
    const openerSnapshot = await call({ action: 'snapshot' });
    const popupButton = openerSnapshot.match(/^(e\d+) button "Open popup"/m)?.[1];
    const siblingButton = openerSnapshot.match(/^(e\d+) button "Open sibling"/m)?.[1];
    assert(popupButton && siblingButton, 'Missing native-popup opener refs');
    await call({ action: 'click', ref: popupButton });
    await call({ action: 'click', ref: siblingButton });
    const popupTabs = await until(async () => {
        const tabs = await call({ action: 'tabs' });
        return tabs.includes('native=popup') && tabs.includes('native=sibling') ? tabs : false;
    }, 'owner-scoped native popup discovery');
    const popupId = popupTabs.split('\n').find(line => line.includes('native=popup')).split(' ')[0];
    const siblingId = popupTabs.split('\n').find(line => line.includes('native=sibling')).split(' ')[0];
    assert(popupId.startsWith(`t${owner.win.webContents.id}:browser-popout-`)
        && siblingId.startsWith(`t${owner.win.webContents.id}:browser-popout-`), 'Popup lost opener ownership');
    assert(!(await foreignCall({ action: 'tabs' })).includes('native='), 'Native popup leaked to another workspace');
    const foreignPopup = await foreignContext.tools.find(tool => tool.name === 'browser').handler({ action: 'select', tab: popupId });
    assert(foreignPopup.resultType === 'failure' && foreignPopup.textResultForLlm.includes('not found'), 'Foreign workspace controlled native popup');
    await call({ action: 'select', tab: popupId });
    const popupSnapshot = await call({ action: 'snapshot' });
    const popupInput = popupSnapshot.match(/^(e\d+) textbox "Message"/m)?.[1];
    const popupPublish = popupSnapshot.match(/^(e\d+) button "Publish"/m)?.[1];
    assert(popupInput && popupPublish, 'Popup did not expose its own page refs');
    await call({ action: 'type', ref: popupInput, text: 'popup relay works' });
    await call({ action: 'click', ref: popupPublish });
    assert((await call({ action: 'read' })).includes('Published: popup relay works'), 'Native popup trusted input/read failed');
    const popupReport = JSON.parse(await call({ action: 'eval',
        js: '({events:window.events, bridge:typeof window.cocDesktop, require:typeof require})' }));
    assert(popupReport.events.length >= 2 && popupReport.events.every(event => event.trusted)
        && popupReport.bridge === 'undefined' && popupReport.require === 'undefined', 'Native popup input or attachment policy failed');
    await call({ action: 'eval', js: 'setTimeout(() => window.close(), 250); true' });
    await until(async () => !(await call({ action: 'tabs' })).includes(popupId), 'page-requested native popup close');
    const stalePopup = await followUp.tools.find(tool => tool.name === 'browser').handler({ action: 'read' });
    assert(stalePopup.resultType === 'failure' && stalePopup.textResultForLlm.includes('not found'), 'Closed popup retained a usable selection');
    await call({ action: 'select', tab: siblingId });
    assert((await call({ action: 'read' })).includes('Waiting'), 'Closing one popup destroyed its sibling');
    await call({ action: 'select', tab: rootId });
    assert((await call({ action: 'read' })).includes('Published: isolated relay works'), 'Popup state overwrote the root page');
    await owner.js(`window.cocDesktop.browser.close(${JSON.stringify(tab.resourceId)})`);
    await until(async () => !(await call({ action: 'tabs' })).includes(siblingId), 'opener close removes native popup descendants');

    const file = path.join(data, 'preview.html');
    writeFileSync(file, '<!doctype html><title>Excluded file preview</title><p>Local preview</p>');
    await owner.js(`window.workflow.setFile(${JSON.stringify(file)})`);
    await until(() => owner.js(`window.workflow.states.some(state =>
        state.viewId === 'html-page:excluded-file' && state.title === 'Excluded file preview' && !state.loading)`), 'local preview load');
    assert(!(await call({ action: 'tabs' })).includes('Excluded file preview'), 'File preview leaked into URL tabs');

    const unregistered = new BrowserWindow({
        show: false, webPreferences: { preload: path.resolve(__dirname, '../../dist/preload.js'),
            contextIsolation: true, sandbox: true },
    });
    windows.push(unregistered);
    await unregistered.loadURL(origin + '/page?unregistered');
    const unauthorized = await unregistered.webContents.executeJavaScript(`window.cocDesktop.browser.control
        .bindScope('workspace-a', 'workspace-a').then(() => '', error => error.message)`);
    assert(unauthorized.includes('registered SPA main frame'), 'Unregistered window could bind browser control');

    // A follow-up routed through another SPA still drives, reveals and badges the original owner.
    owner.win.focus();
    await pause(150);
    const visibleContext = await turn('workspace-a', 'conversation-visible', '/browser visibility', true);
    const visibleCall = driver(visibleContext);
    await visibleCall({ action: 'open', url: origin + '/page?visibility' });
    await until(() => owner.js('document.querySelector("[data-testid=browser-control-badge]")'), 'owner controlling badge');
    const routing = await windowFor('workspace-a');
    routing.win.focus();
    await pause(150);
    const visibleFollowUp = await turn('workspace-a', 'conversation-visible', 'read the remembered tab');
    const followCall = driver(visibleFollowUp);
    await owner.js('window.workflow.collapse()');
    await followCall({ action: 'read' });
    assert((await routing.js('window.workflow.messages')).includes('read'), 'Follow-up did not route through the other SPA');
    await until(() => owner.js('window.workflow.panelOpen && document.querySelector("[data-testid=browser-control-badge]")'), 'cross-window remembered-tab reveal/badge');
    assert(await owner.js('window.workflow.activity?.processId === "conversation-visible"'), 'Follow-up badge lost conversation');
    const activeTurn = await owner.js('window.workflow.activity.turnId');
    ws.browserControl.finishProcess('workspace-a', 'conversation-a');
    await pause(50);
    assert(await owner.js(`window.workflow.activity?.turnId === ${JSON.stringify(activeTurn)}`), 'Previous conversation clear erased new badge');
    await owner.js('document.querySelector("[aria-label=\\"Stop AI browser control\\"]").click()');
    await until(() => cancellations.some(value => value.processId === 'conversation-visible' && value.workspaceId === 'workspace-a'), 'owner SPA Stop cancellation');
    await until(() => owner.js('!document.querySelector("[data-testid=browser-control-badge]")'), 'owner Stop clears badge');

    const nativeContext = await turn('workspace-a', 'conversation-visible', 'control a popup');
    const nativeCall = driver(nativeContext);
    const visibleSnapshot = await nativeCall({ action: 'snapshot' });
    const visiblePopup = visibleSnapshot.match(/^(e\d+) button "Open popup"/m)?.[1];
    await nativeCall({ action: 'click', ref: visiblePopup });
    const chromePopupId = await until(async () => {
        const tabs = await nativeCall({ action: 'tabs' });
        return tabs.split('\n').find(line => line.includes('native=popup'))?.split(' ')[0];
    }, 'trusted-chrome native popup discovery');
    await nativeCall({ action: 'select', tab: chromePopupId });
    let stoppedWait;
    const beginNativeWait = async () => {
        stoppedWait = nativeContext.tools.find(tool => tool.name === 'browser').handler({ action: 'wait', ms: 30000 });
        await until(() => ws.browserControl.pending.size > 0, 'pending native control wait');
    };
    if (engine === 'electron') {
        const popup = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().includes('native=popup'));
        const chrome = await until(() => popup.contentView.children.find(view => view.webContents?.getURL().startsWith('data:text/html')), 'trusted popup toolbar');
        assert(await chrome.webContents.executeJavaScript('document.body.textContent.includes("AI controlling")'), 'Popup badge is missing');
        assert(await popup.webContents.executeJavaScript('typeof window.cocDesktop === "undefined"'), 'Popup page obtained privileged IPC');
        assert(popup.contentView.children[0] !== chrome && popup.contentView.children[0].getBounds().y === 40, 'Popup page covers trusted chrome');
        await owner.js('window.workflow.setBrowserEnabled(false)');
        await routing.js('window.workflow.setBrowserEnabled(false)');
        await until(() => !chrome.getVisible(), 'live-disable hides popup chrome');
        await owner.js('window.workflow.setBrowserEnabled(true)');
        await routing.js('window.workflow.setBrowserEnabled(true)');
        await until(() => chrome.getVisible(), 'live-enable restores current popup chrome');
        await routing.js('window.workflow.exerciseInactiveCloneRelay()');
        assert(chrome.getVisible(), 'Inactive clone relay hid another source popup chrome');
        assert(popup.contentView.children[0].getBounds().y === 40, 'Inactive clone relay cleared another source activity');
        const stopBounds = await chrome.webContents.executeJavaScript('(() => { const r=document.querySelector("button").getBoundingClientRect(); return { x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2) }; })()');
        await beginNativeWait();
        chrome.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...stopBounds });
        chrome.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...stopBounds });
        await until(() => cancellations.filter(value => value.processId === 'conversation-visible').length === 2, 'native trusted Stop cancellation');
        await until(() => !chrome.getVisible() && popup.contentView.children[0].getBounds().y === 0, 'native terminal chrome cleanup');
    } else {
        const { inspectNativeChrome } = require('./browser-control-native-chrome.cjs');
        await until(async () => {
            const chrome = await inspectNativeChrome(nativeHelperPid);
            return chrome.badge && chrome.stop;
        }, 'Windows native controlling badge and Stop button');
        await owner.js('window.workflow.setBrowserEnabled(false)');
        await routing.js('window.workflow.setBrowserEnabled(false)');
        await until(async () => !(await inspectNativeChrome(nativeHelperPid)).stop, 'Windows live-disable hides native chrome');
        await owner.js('window.workflow.setBrowserEnabled(true)');
        await routing.js('window.workflow.setBrowserEnabled(true)');
        await until(async () => (await inspectNativeChrome(nativeHelperPid)).stop, 'Windows live-enable restores native chrome');
        await beginNativeWait();
        assert((await inspectNativeChrome(nativeHelperPid, true)).clicked, 'Windows native Stop did not receive a click');
        await until(() => cancellations.filter(value => value.processId === 'conversation-visible').length === 2, 'Windows native Stop cancellation');
        await until(async () => !(await inspectNativeChrome(nativeHelperPid)).stop, 'Windows terminal clears native chrome');
    }
    const cancelledWait = await stoppedWait;
    assert(cancelledWait.resultType === 'failure' && cancelledWait.textResultForLlm.includes('cancelled'), 'Native Stop did not abort the controlling turn command');

    fixtureConfig.browserControl.enabled = false;
    const disabled = await turn('workspace-a', 'conversation-a', '/browser disabled');
    assert(!disabled.tools.some(tool => tool.name === 'browser') && disabled.browserPrompt === '', 'Live fixture disable did not affect next turn');
    const disabledCall = await context.tools.find(tool => tool.name === 'browser').handler({ action: 'tabs' });
    assert(disabledCall.resultType === 'failure' && disabledCall.textResultForLlm.includes('disabled'), 'Relay ignored disabled fixture config');
    const disabledParsed = await owner.js(`window.workflow.parse('/browser literal', false)`);
    assert(!disabledParsed.metaCommands.includes('browser') && disabledParsed.prompt === '/browser literal', 'Disabled slash parser consumed browser');

    console.log('E2E::' + JSON.stringify({
        engine, read, report, screenshot, highDpiViewport, screenshotParity: true,
        activation: parsed.metaCommands, sticky: true, panelRevealed: true,
        ownerScoped: true, workspaceScoped: true, conversationScoped: true, fileExcluded: true,
        exactSourceGuard: true, liveDisabled: true, nativePopups: true, popupReport,
        crossOwnerFollowUp: true, ownerBadgeStop: true, nativeChromeStop: true, nativeStopCancelledWait: true, largePayloadsBounded: true,
        actions: await owner.js('window.workflow.messages'),
    }));
    for (const ctx of [context, followUp, independent, foreignContext, disabled, visibleContext, visibleFollowUp, nativeContext, largeContext]) ctx.dispose();
    await disposeBrowserViews();
    for (const win of windows) win.destroy();
    ws.closeAll();
    server.close();
    app.exit(0);
}).catch(error => {
    console.error(error);
    ws.closeAll();
    server.close();
    app.exit(1);
});
