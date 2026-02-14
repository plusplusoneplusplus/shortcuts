/**
 * WebSocket client script: connection with exponential backoff reconnect.
 */

import type { ScriptOptions } from '../types';

export function getWebSocketScript(opts: ScriptOptions): string {
    return `
        // ================================================================
        // WebSocket
        // ================================================================

        var wsReconnectTimer = null;
        var wsReconnectDelay = 1000;
        var wsPingInterval = null;

        function connectWebSocket() {
            var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            var wsUrl = protocol + '//' + location.host + '${opts.wsPath}';
            var ws = new WebSocket(wsUrl);

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
                    var msg = JSON.parse(event.data);
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

        function handleWsMessage(msg) {
            if (!msg || !msg.type) return;

            if (msg.type === 'process-added' && msg.process) {
                // Add if not already present
                var existing = appState.processes.find(function(p) { return p.id === msg.process.id; });
                if (!existing) {
                    appState.processes.push(msg.process);
                    renderProcessList();
                }
            } else if (msg.type === 'process-updated' && msg.process) {
                var idx = -1;
                for (var i = 0; i < appState.processes.length; i++) {
                    if (appState.processes[i].id === msg.process.id) { idx = i; break; }
                }
                if (idx >= 0) {
                    // Merge updated fields
                    var prev = appState.processes[idx];
                    for (var key in msg.process) {
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
                appState.processes = appState.processes.filter(function(p) {
                    return p.id !== msg.processId;
                });
                if (appState.selectedId === msg.processId) {
                    appState.selectedId = null;
                    clearDetail();
                }
                renderProcessList();
            } else if (msg.type === 'processes-cleared') {
                appState.processes = appState.processes.filter(function(p) {
                    return p.status !== 'completed';
                });
                if (appState.selectedId) {
                    var sel = appState.processes.find(function(p) { return p.id === appState.selectedId; });
                    if (!sel) {
                        appState.selectedId = null;
                        clearDetail();
                    }
                }
                renderProcessList();
            } else if (msg.type === 'queue-updated' && msg.queue) {
                var prevCompleted = queueState.stats ? (queueState.stats.completed || 0) : 0;
                var prevFailed = queueState.stats ? (queueState.stats.failed || 0) : 0;

                queueState.queued = msg.queue.queued || [];
                queueState.running = msg.queue.running || [];
                queueState.stats = msg.queue.stats || queueState.stats;

                // Use history from WebSocket message if available (avoids REST race condition)
                if (msg.queue.history) {
                    queueState.history = msg.queue.history;
                }

                // Auto-expand history when new tasks complete or fail
                var newCompleted = queueState.stats.completed || 0;
                var newFailed = queueState.stats.failed || 0;
                if (newCompleted > prevCompleted || newFailed > prevFailed) {
                    queueState.showHistory = true;
                }

                // If history was not in the WS message, fetch it via REST as fallback
                if (!msg.queue.history) {
                    fetchApi('/queue/history').then(function(data) {
                        if (data && data.history) {
                            queueState.history = data.history;
                        }
                        renderQueuePanel();
                    }).catch(function() {
                        renderQueuePanel();
                    });
                } else {
                    renderQueuePanel();
                }
            } else if (msg.type === 'workspace-registered' && msg.data) {
                var select = document.getElementById('workspace-select');
                if (select) {
                    // Add if not present
                    var found = false;
                    for (var j = 0; j < select.options.length; j++) {
                        if (select.options[j].value === msg.data.id) { found = true; break; }
                    }
                    if (!found) {
                        var opt = document.createElement('option');
                        opt.value = msg.data.id;
                        opt.textContent = msg.data.name || msg.data.path || msg.data.id;
                        select.appendChild(opt);
                    }
                }
            }
        }

        connectWebSocket();
`;
}
