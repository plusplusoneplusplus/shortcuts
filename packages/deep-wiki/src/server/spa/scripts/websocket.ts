/**
 * WebSocket live-reload script.
 *
 * Contains: connectWebSocket, handleWsMessage, and reconnection logic.
 * Uses the browser-native WebSocket API — no external dependencies.
 */
export function getWebSocketScript(): string {
    return `
        // ================================================================
        // WebSocket Live Reload
        // ================================================================

        var wsReconnectTimer = null;
        var wsReconnectDelay = 1000;

        function connectWebSocket() {
            var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            var wsUrl = protocol + '//' + location.host + '/ws';
            var ws = new WebSocket(wsUrl);

            ws.onopen = function() {
                wsReconnectDelay = 1000;
                setInterval(function() {
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
                wsReconnectTimer = setTimeout(function() {
                    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
                    connectWebSocket();
                }, wsReconnectDelay);
            };

            ws.onerror = function() {};
        }

        function handleWsMessage(msg) {
            var bar = document.getElementById('live-reload-bar');
            if (!bar) return;

            if (msg.type === 'rebuilding') {
                bar.className = 'live-reload-bar visible rebuilding';
                bar.textContent = 'Rebuilding: ' + (msg.modules || []).join(', ') + '...';
            } else if (msg.type === 'reload') {
                bar.className = 'live-reload-bar visible reloaded';
                bar.textContent = 'Updated: ' + (msg.modules || []).join(', ');
                (msg.modules || []).forEach(function(id) { delete markdownCache[id]; });
                if (currentModuleId && (msg.modules || []).indexOf(currentModuleId) !== -1) {
                    loadModule(currentModuleId, true);
                }
                setTimeout(function() { bar.className = 'live-reload-bar'; }, 3000);
            } else if (msg.type === 'error') {
                bar.className = 'live-reload-bar visible error';
                bar.textContent = 'Error: ' + (msg.message || 'Unknown error');
                setTimeout(function() { bar.className = 'live-reload-bar'; }, 5000);
            }
        }

        connectWebSocket();`;
}
