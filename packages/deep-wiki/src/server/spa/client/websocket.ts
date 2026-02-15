/**
 * WebSocket live-reload script.
 *
 * Contains: connectWebSocket, handleWsMessage, and reconnection logic.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { markdownCache, currentModuleId } from './core';

let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsReconnectDelay = 1000;

export function connectWebSocket(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + location.host + '/ws';
    const ws = new WebSocket(wsUrl);

    ws.onopen = function () {
        wsReconnectDelay = 1000;
        setInterval(function () {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    };

    ws.onmessage = function (event: MessageEvent) {
        try {
            const msg = JSON.parse(event.data);
            handleWsMessage(msg);
        } catch (_e) { /* ignore */ }
    };

    ws.onclose = function () {
        wsReconnectTimer = setTimeout(function () {
            wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
            connectWebSocket();
        }, wsReconnectDelay);
    };

    ws.onerror = function () { /* ignore */ };
}

function handleWsMessage(msg: any): void {
    const bar = document.getElementById('live-reload-bar');
    if (!bar) return;

    if (msg.type === 'rebuilding') {
        bar.className = 'live-reload-bar visible rebuilding';
        bar.textContent = 'Rebuilding: ' + (msg.modules || []).join(', ') + '...';
    } else if (msg.type === 'reload') {
        bar.className = 'live-reload-bar visible reloaded';
        bar.textContent = 'Updated: ' + (msg.modules || []).join(', ');
        (msg.modules || []).forEach(function (id: string) { delete markdownCache[id]; });
        if (currentModuleId && (msg.modules || []).indexOf(currentModuleId) !== -1) {
            (window as any).loadModule(currentModuleId, true);
        }
        setTimeout(function () { bar.className = 'live-reload-bar'; }, 3000);
    } else if (msg.type === 'error') {
        bar.className = 'live-reload-bar visible error';
        bar.textContent = 'Error: ' + (msg.message || 'Unknown error');
        setTimeout(function () { bar.className = 'live-reload-bar'; }, 5000);
    }
}
