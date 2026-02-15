/**
 * WebSocket client script: connection with exponential backoff reconnect.
 */

import { getWsPath, getApiBase } from './config';
import { appState, queueState } from './state';
import { fetchApi } from './core';
import { renderProcessList } from './sidebar';
import { renderDetail, clearDetail } from './detail';
import { renderQueuePanel, startQueuePolling, stopQueuePolling } from './queue';

let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsReconnectDelay = 1000;
let wsPingInterval: ReturnType<typeof setInterval> | null = null;

export function connectWebSocket(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + location.host + getWsPath();
    const ws = new WebSocket(wsUrl);

    ws.onopen = function() {
        wsReconnectDelay = 1000;
        wsPingInterval = setInterval(function() {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    };

    ws.onmessage = function(event) {
        try {
            const msg = JSON.parse(event.data);
            handleWsMessage(msg);
        } catch(e) {}
    };

    ws.onclose = function() {
        if (wsPingInterval) { clearInterval(wsPingInterval); wsPingInterval = null; }
        wsReconnectTimer = setTimeout(function() {
            wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
            connectWebSocket();
        }, wsReconnectDelay);
    };

    ws.onerror = function() {};
}

export function handleWsMessage(msg: any): void {
    if (!msg || !msg.type) return;

    if (msg.type === 'process-added' && msg.process) {
        // Add if not already present
        const existing = appState.processes.find(function(p: any) { return p.id === msg.process.id; });
        if (!existing) {
            appState.processes.push(msg.process);
            renderProcessList();
        }
    } else if (msg.type === 'process-updated' && msg.process) {
        let idx = -1;
        for (let i = 0; i < appState.processes.length; i++) {
            if (appState.processes[i].id === msg.process.id) { idx = i; break; }
        }
        if (idx >= 0) {
            // Merge updated fields
            const prev = appState.processes[idx];
            for (const key in msg.process) {
                if (msg.process.hasOwnProperty(key)) {
                    prev[key] = msg.process[key];
                }
            }
            renderProcessList();
            if (appState.selectedId === msg.process.id) {
                renderDetail(msg.process.id);
            }
        }
    } else if (msg.type === 'process-removed' && msg.processId) {
        appState.processes = appState.processes.filter(function(p: any) {
            return p.id !== msg.processId;
        });
        if (appState.selectedId === msg.processId) {
            appState.selectedId = null;
            clearDetail();
        }
        renderProcessList();
    } else if (msg.type === 'processes-cleared') {
        appState.processes = appState.processes.filter(function(p: any) {
            return p.status !== 'completed';
        });
        if (appState.selectedId) {
            const sel = appState.processes.find(function(p: any) { return p.id === appState.selectedId; });
            if (!sel) {
                appState.selectedId = null;
                clearDetail();
            }
        }
        renderProcessList();
    } else if (msg.type === 'queue-updated' && msg.queue) {
        const prevCompleted = queueState.stats ? (queueState.stats.completed || 0) : 0;
        const prevFailed = queueState.stats ? (queueState.stats.failed || 0) : 0;

        queueState.queued = msg.queue.queued || [];
        queueState.running = msg.queue.running || [];
        queueState.stats = msg.queue.stats || queueState.stats;

        // Use history from WebSocket message if available (avoids REST race condition)
        if (msg.queue.history) {
            queueState.history = msg.queue.history;
        }

        // Auto-expand history when new tasks complete or fail
        const newCompleted = queueState.stats.completed || 0;
        const newFailed = queueState.stats.failed || 0;
        if (newCompleted > prevCompleted || newFailed > prevFailed) {
            queueState.showHistory = true;
        }

        // Always render immediately with current state
        renderQueuePanel();

        // Start/stop polling based on active tasks
        const hasActive = (queueState.stats.queued > 0 || queueState.stats.running > 0);
        if (hasActive) {
            startQueuePolling();
        } else {
            stopQueuePolling();
        }

        // If history was not in the WS message, fetch it via REST as fallback
        if (!msg.queue.history) {
            fetchApi('/queue/history').then(function(data: any) {
                if (data && data.history) {
                    queueState.history = data.history;
                }
                renderQueuePanel();
            }).catch(function() {
                // Already rendered above
            });
        }
    } else if (msg.type === 'workspace-registered' && msg.data) {
        const select = document.getElementById('workspace-select') as HTMLSelectElement | null;
        if (select) {
            // Add if not present
            let found = false;
            for (let j = 0; j < select.options.length; j++) {
                if (select.options[j].value === msg.data.id) { found = true; break; }
            }
            if (!found) {
                const opt = document.createElement('option');
                opt.value = msg.data.id;
                opt.textContent = msg.data.name || msg.data.path || msg.data.id;
                select.appendChild(opt);
            }
        }
    }
}

connectWebSocket();
