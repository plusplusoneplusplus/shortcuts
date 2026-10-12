import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserWebviewLayer } from '../../../coc/src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserWebviewLayer';
import { UnifiedBrowserTab } from '../../../coc/src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
import { UnifiedHtmlPageTab } from '../../../coc/src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedHtmlPageTab';
import { readUnifiedPanelState, useUnifiedPanelState } from '../../../coc/src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { useDockOpen, workspaceDockOpenStorageKey } from '../../../coc/src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';
import { createBrowserSocketRelay } from '../../../coc/src/server/spa/client/react/shared/file-path/browser-control-relay';
import { desktopBrowserBridge, type BrowserViewState } from '../../../coc/src/server/spa/client/react/shared/file-path/browser-bridge';
import { getActiveMetaCommands, parseSlashCommands } from '../../../coc/src/server/spa/client/react/features/chat/slash-command-parser';
import { getBrowserControlActivity } from '../../../coc/src/server/spa/client/react/shared/file-path/browser-control-activity';
import { applyRuntimeConfigPatch } from '../../../coc/src/server/spa/client/react/utils/config';

const workspaceId = new URLSearchParams(location.search).get('workspace')!;
const socket = new WebSocket(location.origin.replace('http:', 'ws:') + '/ws');
const relay = createBrowserSocketRelay({ send(message) { socket.send(JSON.stringify(message)); } });
const messages: string[] = [];
const reveals: unknown[] = [];
const states: BrowserViewState[] = [];
desktopBrowserBridge()!.control!.onReveal(event => reveals.push(event));
desktopBrowserBridge()!.onState(event => states.push(event));
let ready = false;
socket.onopen = async () => {
    await relay.update(workspaceId);
    relay.onOpen();
    // A ping/pong round trip orders capability registration before the driver starts.
    socket.send(JSON.stringify({ type: 'ping' }));
};
socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'pong') ready = true;
    if (message.type === 'browser-command') messages.push(message.request.command.action);
    relay.onMessage(message);
};
socket.onclose = () => relay.onClose();

const noop = () => {};
function Fixture() {
    const [state] = useUnifiedPanelState(workspaceId);
    const [open, toggle] = useDockOpen(workspaceDockOpenStorageKey(workspaceId));
    const [file, setFile] = React.useState('');
    const [size, setSize] = React.useState({ width: 640, height: 520 });
    (window as any).workflow = {
        get ready() { return ready; },
        get messages() { return messages; },
        get reveals() { return reveals; },
        get states() { return states; },
        get activity() {
            return readUnifiedPanelState(workspaceId).workspaceTabs.map(tab => getBrowserControlActivity(workspaceId, tab.id)).find(Boolean) ?? null;
        },
        setBrowserEnabled(enabled: boolean) { applyRuntimeConfigPatch({ browserControlEnabled: enabled }); },
        async exerciseInactiveCloneRelay() {
            const inactive = createBrowserSocketRelay({ send: () => true }, location.origin);
            inactive.onOpen();
            await inactive.update(workspaceId);
            inactive.onMessage({ type: 'config-changed' });
            inactive.dispose();
        },
        get panelOpen() { return open; },
        get tabs() { return readUnifiedPanelState(workspaceId).workspaceTabs; },
        collapse() { if (open) toggle(); },
        setFile,
        resizePanel(width: number, height: number) { setSize({ width, height }); },
        parse(text: string, enabled: boolean) {
            return parseSlashCommands(text, [], getActiveMetaCommands({
                cronEnabled: false, canvasEnabled: false, browserEnabled: enabled,
            }));
        },
    };
    return <>
        <div id="panel" data-open={open} style={{ position: 'fixed', left: 80, top: 40, ...size, display: 'flex' }}>
            {open && state.workspaceTabs.filter(tab => tab.kind === 'browser').map((tab, index, tabs) =>
                <UnifiedBrowserTab key={tab.id} tabId={tab.id} viewId={tab.resourceId}
                    workspaceId={tab.ownerWorkspaceId} routingRef={tab.ownerRoutingRef}
                    sessionKey={tab.ownerRoutingRef || tab.ownerWorkspaceId} url={tab.browserUrl}
                    active={index === tabs.length - 1} visible onNavigate={noop} onPageState={noop} />)}
            {file && <UnifiedHtmlPageTab tabId="file-tab" pageId="excluded-file" wsId={workspaceId}
                filePath={file} active visible onErrorChange={noop} />}
        </div>
        <BrowserWebviewLayer />
    </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
