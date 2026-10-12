'use strict';

// Only the provider and process persistence are deterministic stand-ins. Every browser
// command crosses the production WebSocket relay, SPA handler, preload, main and CDP.
const { app, BrowserWindow, Menu, nativeImage } = require('electron');
const { buildSync } = require('esbuild');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const data = process.env.COC_BROWSER_WORKFLOW_DATA;
const engine = process.env.COC_BROWSER_E2E_ENGINE;
app.setPath('userData', data);
const { registerBrowserViewIpc, registerBrowserEmbedder, disposeBrowserViews } = require('../../dist/browser-view-host');
const { ProcessWebSocketServer } = require('../../../coc/dist/server/streaming/websocket');
const { buildChatTurnContext } = require('../../../coc/dist/server/executors/chat-turn-context-builder');
const { BrowserToolStateStore } = require('../../../coc/dist/server/llm-tools/browser-tools');
const { CocToolRuntime } = require('@plusplusoneplusplus/coc-agent-sdk');
const fixtureConfig = { browserControl: { enabled: true } };
const renderer = buildSync({
    entryPoints: [path.join(__dirname, 'browser-control-workflow-renderer.tsx')],
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;
const page = `<!doctype html><title>Workflow fixture</title>
    <label>Message<input aria-label="Message"></label><button>Publish</button><p id="result">Waiting</p>
    <script>
        window.events = [];
        document.querySelector('input').addEventListener('input', e => events.push({type:e.type,trusted:e.isTrusted}));
        document.querySelector('button').addEventListener('click', e => {
            events.push({type:e.type,trusted:e.isTrusted});
            document.getElementById('result').textContent = 'Published: ' + document.querySelector('input').value;
        });
    </script>`;
const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/renderer.js' ? 'application/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/renderer.js' ? renderer : req.url === '/style.css'
        ? readFileSync(path.join(__dirname, '../../../coc/src/server/spa/client/dist/bundle.css'))
        : req.url.startsWith('/page') ? page
            : '<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/renderer.js"></script>');
});
const ws = new ProcessWebSocketServer();
ws.browserControl.setEnabledGetter(() => fixtureConfig.browserControl.enabled);
ws.attach(server);
const browserState = new BrowserToolStateStore();
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
    return buildChatTurnContext({
        store, workspaceId, processId, query, browserActivation, browserOnly: true, includeMemoryV2: false,
        browserRuntime: ws.browserControl, browserState,
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
    const call = driver(context);
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
    const report = JSON.parse(await call({ action: 'eval', js: '({events:window.events, bridge:typeof window.cocDesktop, require:typeof require})' }));
    assert(read.includes('Published: isolated relay works'), `Live page read failed: ${read}; ${JSON.stringify(report)}`);
    assert(report.events.length >= 2 && report.events.every(event => event.trusted), 'Input was not trusted CDP input');
    assert(report.bridge === 'undefined' && report.require === 'undefined', 'Guest exposed privileged bridge');
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
    const nativeScreenshot = await browserTool.handler({ action: 'screenshot' });
    const nativeBinary = nativeScreenshot.binaryResultsForLlm?.[0];
    assert(nativeScreenshot.resultType === 'success' && nativeBinary?.mimeType === 'image/jpeg', 'Native tool screenshot failed');
    const mcpRuntime = new CocToolRuntime(context.tools, { workspaceId: 'workspace-a', processId: 'conversation-a' });
    const mcpScreenshot = await mcpRuntime.callTool('browser', { action: 'screenshot' });
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
    const rejected = await context.tools.find(tool => tool.name === 'browser').handler({ action: 'select', tab: foreignId });
    assert(rejected.resultType === 'failure' && rejected.textResultForLlm.includes('not found in this workspace'), 'Foreign tab selection succeeded');
    const wrongScope = await owner.js(`window.cocDesktop.browser.control.execute({
        id:'wrong-workspace', workspaceId:'workspace-b', processId:'conversation-a', command:{action:'tabs'}
    }).then(() => '', error => error.message)`);
    assert(wrongScope.includes('workspace scope changed'), 'Main IPC accepted a request outside its bound owner scope');

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
        exactSourceGuard: true, liveDisabled: true,
        actions: await owner.js('window.workflow.messages'),
    }));
    for (const ctx of [context, followUp, independent, foreignContext, disabled]) ctx.dispose();
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
