/**
 * Admin Portal Script Module
 *
 * Contains the admin portal functionality: tab switching, seeds/config editing,
 * save/reset operations, and status management.
 */

export function getAdminScript(): string {
    return `
        // ================================================================
        // Admin Portal (full page via SPA routing)
        // ================================================================

        var adminSeedsOriginal = '';
        var adminConfigOriginal = '';
        var adminInitialized = false;
        var generateRunning = false;
        var generateAbortController = null;

        function showAdmin(skipHistory) {
            currentModuleId = null;
            showAdminContent();
            if (!skipHistory) {
                history.pushState({ type: 'admin' }, '', location.pathname + '#admin');
            }
            if (!adminInitialized) {
                initAdminEvents();
                initGenerateEvents();
                initPhase4ModuleList();
                adminInitialized = true;
            }
            loadAdminSeeds();
            loadAdminConfig();
            loadGenerateStatus();
        }

        document.getElementById('admin-toggle').addEventListener('click', function() {
            showAdmin(false);
        });

        document.getElementById('admin-back').addEventListener('click', function() {
            showHome(false);
        });

        function initAdminEvents() {
            // Tab switching
            document.querySelectorAll('.admin-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    var target = this.getAttribute('data-tab');
                    document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
                    document.querySelectorAll('.admin-tab-content').forEach(function(c) { c.classList.remove('active'); });
                    this.classList.add('active');
                    document.getElementById('admin-content-' + target).classList.add('active');
                });
            });

            // Save seeds
            document.getElementById('seeds-save').addEventListener('click', async function() {
                clearAdminStatus('seeds');
                var text = document.getElementById('seeds-editor').value;
                var content;
                try {
                    content = JSON.parse(text);
                } catch (e) {
                    setAdminStatus('seeds', 'Invalid JSON: ' + e.message, true);
                    return;
                }
                try {
                    var res = await fetch('/api/admin/seeds', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: content })
                    });
                    var data = await res.json();
                    if (data.success) {
                        setAdminStatus('seeds', 'Saved', false);
                        adminSeedsOriginal = text;
                    } else {
                        setAdminStatus('seeds', data.error || 'Save failed', true);
                    }
                } catch (err) {
                    setAdminStatus('seeds', 'Error: ' + err.message, true);
                }
            });

            // Reset seeds
            document.getElementById('seeds-reset').addEventListener('click', function() {
                document.getElementById('seeds-editor').value = adminSeedsOriginal;
                clearAdminStatus('seeds');
            });

            // Save config
            document.getElementById('config-save').addEventListener('click', async function() {
                clearAdminStatus('config');
                var text = document.getElementById('config-editor').value;
                try {
                    var res = await fetch('/api/admin/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: text })
                    });
                    var data = await res.json();
                    if (data.success) {
                        setAdminStatus('config', 'Saved', false);
                        adminConfigOriginal = text;
                    } else {
                        setAdminStatus('config', data.error || 'Save failed', true);
                    }
                } catch (err) {
                    setAdminStatus('config', 'Error: ' + err.message, true);
                }
            });

            // Reset config
            document.getElementById('config-reset').addEventListener('click', function() {
                document.getElementById('config-editor').value = adminConfigOriginal;
                clearAdminStatus('config');
            });
        }

        function setAdminStatus(which, msg, isError) {
            var el = document.getElementById(which + '-status');
            el.textContent = msg;
            el.className = 'admin-file-status ' + (isError ? 'error' : 'success');
        }

        function clearAdminStatus(which) {
            var el = document.getElementById(which + '-status');
            el.textContent = '';
            el.className = 'admin-file-status';
        }

        async function loadAdminSeeds() {
            try {
                var res = await fetch('/api/admin/seeds');
                var data = await res.json();
                document.getElementById('seeds-path').textContent = data.path || 'seeds.json';
                if (data.exists && data.content) {
                    var text = JSON.stringify(data.content, null, 2);
                    document.getElementById('seeds-editor').value = text;
                    adminSeedsOriginal = text;
                } else if (data.exists && data.raw) {
                    document.getElementById('seeds-editor').value = data.raw;
                    adminSeedsOriginal = data.raw;
                } else {
                    document.getElementById('seeds-editor').value = '';
                    adminSeedsOriginal = '';
                }
            } catch (err) {
                setAdminStatus('seeds', 'Failed to load: ' + err.message, true);
            }
        }

        async function loadAdminConfig() {
            try {
                var res = await fetch('/api/admin/config');
                var data = await res.json();
                document.getElementById('config-path').textContent = data.path || 'deep-wiki.config.yaml';
                if (data.exists && data.content) {
                    document.getElementById('config-editor').value = data.content;
                    adminConfigOriginal = data.content;
                } else {
                    document.getElementById('config-editor').value = '';
                    adminConfigOriginal = '';
                }
            } catch (err) {
                setAdminStatus('config', 'Failed to load: ' + err.message, true);
            }
        }

        // ================================================================
        // Generate Tab
        // ================================================================

        function initGenerateEvents() {
            // Individual phase run buttons
            for (var i = 1; i <= 5; i++) {
                (function(phase) {
                    var btn = document.getElementById('phase-run-' + phase);
                    if (btn) {
                        btn.addEventListener('click', function() {
                            runPhaseGeneration(phase, phase);
                        });
                    }
                })(i);
            }

            // Run range button
            var rangeBtn = document.getElementById('generate-run-range');
            if (rangeBtn) {
                rangeBtn.addEventListener('click', function() {
                    var startPhase = parseInt(document.getElementById('generate-start-phase').value);
                    var endPhase = parseInt(document.getElementById('generate-end-phase').value);
                    if (endPhase < startPhase) {
                        alert('End phase must be >= start phase');
                        return;
                    }
                    runPhaseGeneration(startPhase, endPhase);
                });
            }
        }

        async function loadGenerateStatus() {
            try {
                var res = await fetch('/api/admin/generate/status');
                var data = await res.json();

                var unavailableEl = document.getElementById('generate-unavailable');
                var controlsEl = document.getElementById('generate-controls');

                if (!data.available) {
                    unavailableEl.classList.remove('hidden');
                    controlsEl.style.display = 'none';
                    return;
                }

                unavailableEl.classList.add('hidden');
                controlsEl.style.display = '';

                // Update cache badges
                for (var phase = 1; phase <= 5; phase++) {
                    var badge = document.getElementById('phase-cache-' + phase);
                    if (!badge) continue;
                    var phaseData = data.phases[String(phase)];
                    if (phaseData && phaseData.cached) {
                        badge.textContent = 'Cached';
                        badge.className = 'phase-cache-badge cached';
                    } else {
                        badge.textContent = 'None';
                        badge.className = 'phase-cache-badge missing';
                    }
                }

                // Update running state
                if (data.running) {
                    generateRunning = true;
                    setAllPhaseButtonsDisabled(true);
                    var statusBar = document.getElementById('generate-status-bar');
                    statusBar.textContent = 'Phase ' + (data.currentPhase || '?') + ' is running...';
                    statusBar.classList.remove('hidden');
                } else {
                    generateRunning = false;
                }

                // Populate Phase 4 module list if available
                var phase4Data = data.phases['4'];
                if (phase4Data && phase4Data.modules) {
                    renderPhase4ModuleList(phase4Data.modules);
                }
            } catch (err) {
                // Silently fail on status load
            }
        }

        function setAllPhaseButtonsDisabled(disabled) {
            for (var i = 1; i <= 5; i++) {
                var btn = document.getElementById('phase-run-' + i);
                if (btn) btn.disabled = disabled;
            }
            var rangeBtn = document.getElementById('generate-run-range');
            if (rangeBtn) rangeBtn.disabled = disabled;
        }

        function setPhaseCardState(phase, state, message) {
            var card = document.getElementById('phase-card-' + phase);
            if (!card) return;

            // Remove all state classes
            card.classList.remove('phase-running', 'phase-success', 'phase-error');

            var btn = document.getElementById('phase-run-' + phase);
            var logEl = document.getElementById('phase-log-' + phase);

            switch (state) {
                case 'running':
                    card.classList.add('phase-running');
                    if (btn) {
                        btn.textContent = 'Cancel';
                        btn.disabled = false;
                        btn.onclick = function() { cancelGeneration(); };
                    }
                    if (logEl) {
                        logEl.classList.remove('hidden');
                        logEl.textContent = message || 'Running...';
                    }
                    break;
                case 'success':
                    card.classList.add('phase-success');
                    if (btn) {
                        btn.textContent = 'Run';
                        btn.disabled = false;
                        btn.onclick = null;
                        btn.addEventListener('click', (function(p) {
                            return function() { runPhaseGeneration(p, p); };
                        })(phase));
                    }
                    if (logEl && message) {
                        logEl.textContent = message;
                    }
                    break;
                case 'error':
                    card.classList.add('phase-error');
                    if (btn) {
                        btn.textContent = 'Run';
                        btn.disabled = false;
                        btn.onclick = null;
                        btn.addEventListener('click', (function(p) {
                            return function() { runPhaseGeneration(p, p); };
                        })(phase));
                    }
                    if (logEl && message) {
                        logEl.classList.remove('hidden');
                        logEl.textContent = message;
                    }
                    break;
                case 'idle':
                    if (btn) {
                        btn.textContent = 'Run';
                        btn.disabled = false;
                        btn.onclick = null;
                        btn.addEventListener('click', (function(p) {
                            return function() { runPhaseGeneration(p, p); };
                        })(phase));
                    }
                    break;
            }
        }

        function appendPhaseLog(phase, message) {
            var logEl = document.getElementById('phase-log-' + phase);
            if (!logEl) return;
            logEl.classList.remove('hidden');
            logEl.textContent += '\\n' + message;
            logEl.scrollTop = logEl.scrollHeight;
        }

        async function runPhaseGeneration(startPhase, endPhase) {
            if (generateRunning) return;
            generateRunning = true;

            var force = document.getElementById('generate-force').checked;

            // Show confirmation for early phases that invalidate later caches
            if (startPhase <= 1 && endPhase < 5) {
                var phaseNames = { 1: 'Discovery', 2: 'Consolidation', 3: 'Analysis', 4: 'Writing', 5: 'Website' };
                var downstream = [];
                for (var p = endPhase + 1; p <= 5; p++) downstream.push(phaseNames[p]);
                if (downstream.length > 0 && !force) {
                    // Just a note, not blocking
                }
            }

            // Disable all buttons
            setAllPhaseButtonsDisabled(true);

            // Clear logs for phases in range
            for (var i = startPhase; i <= endPhase; i++) {
                var logEl = document.getElementById('phase-log-' + i);
                if (logEl) {
                    logEl.textContent = '';
                    logEl.classList.add('hidden');
                }
                setPhaseCardState(i, 'idle', '');
            }

            // Show status bar
            var statusBar = document.getElementById('generate-status-bar');
            statusBar.textContent = 'Starting generation (phases ' + startPhase + '-' + endPhase + ')...';
            statusBar.className = 'generate-status-bar';
            statusBar.classList.remove('hidden');

            try {
                var response = await fetch('/api/admin/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ startPhase: startPhase, endPhase: endPhase, force: force })
                });

                if (response.status === 409) {
                    statusBar.textContent = 'Generation already in progress';
                    statusBar.className = 'generate-status-bar error';
                    generateRunning = false;
                    setAllPhaseButtonsDisabled(false);
                    return;
                }

                if (!response.ok) {
                    var errData = await response.json();
                    statusBar.textContent = 'Error: ' + (errData.error || 'Unknown error');
                    statusBar.className = 'generate-status-bar error';
                    generateRunning = false;
                    setAllPhaseButtonsDisabled(false);
                    return;
                }

                // Parse SSE stream
                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';

                while (true) {
                    var result = await reader.read();
                    if (result.done) break;

                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\\n');
                    buffer = lines.pop() || '';

                    for (var li = 0; li < lines.length; li++) {
                        var line = lines[li];
                        if (!line.startsWith('data: ')) continue;
                        try {
                            var event = JSON.parse(line.substring(6));
                            handleGenerateEvent(event, statusBar);
                        } catch (e) {
                            // Ignore parse errors
                        }
                    }
                }
            } catch (err) {
                statusBar.textContent = 'Connection error: ' + err.message;
                statusBar.className = 'generate-status-bar error';
            } finally {
                generateRunning = false;
                setAllPhaseButtonsDisabled(false);
                loadGenerateStatus();
            }
        }

        function handleGenerateEvent(event, statusBar) {
            switch (event.type) {
                case 'status':
                    setPhaseCardState(event.phase, 'running', event.message);
                    statusBar.textContent = 'Phase ' + event.phase + ': ' + event.message;
                    break;
                case 'log':
                    if (event.phase) {
                        appendPhaseLog(event.phase, event.message);
                    }
                    break;
                case 'progress':
                    if (event.phase) {
                        appendPhaseLog(event.phase, 'Progress: ' + event.current + '/' + event.total);
                    }
                    break;
                case 'phase-complete':
                    if (event.success) {
                        var dur = event.duration ? ' (' + formatDuration(event.duration) + ')' : '';
                        setPhaseCardState(event.phase, 'success', event.message + dur);
                        appendPhaseLog(event.phase, 'Completed' + dur + ': ' + event.message);
                    } else {
                        setPhaseCardState(event.phase, 'error', event.message);
                    }
                    break;
                case 'error':
                    if (event.phase) {
                        setPhaseCardState(event.phase, 'error', event.message);
                        appendPhaseLog(event.phase, 'Error: ' + event.message);
                    }
                    statusBar.textContent = 'Error: ' + event.message;
                    statusBar.className = 'generate-status-bar error';
                    break;
                case 'done':
                    if (event.success) {
                        var totalDur = event.duration ? ' in ' + formatDuration(event.duration) : '';
                        statusBar.textContent = 'Generation completed' + totalDur;
                        statusBar.className = 'generate-status-bar success';
                    } else {
                        statusBar.textContent = 'Generation failed: ' + (event.error || 'Unknown error');
                        statusBar.className = 'generate-status-bar error';
                    }
                    break;
            }
        }

        function formatDuration(ms) {
            if (ms < 1000) return ms + 'ms';
            var seconds = Math.round(ms / 1000);
            if (seconds < 60) return seconds + 's';
            var minutes = Math.floor(seconds / 60);
            var remainingSeconds = seconds % 60;
            return minutes + 'm ' + remainingSeconds + 's';
        }

        async function cancelGeneration() {
            try {
                await fetch('/api/admin/generate/cancel', { method: 'POST' });
            } catch (e) {
                // Ignore cancel errors
            }
        }

        // ================================================================
        // Phase 4 Module List
        // ================================================================

        function initPhase4ModuleList() {
            var toggle = document.getElementById('phase4-module-toggle');
            if (!toggle) return;
            toggle.addEventListener('click', function() {
                var list = document.getElementById('phase4-module-list');
                var expanded = toggle.classList.toggle('expanded');
                if (list) {
                    list.classList.toggle('expanded', expanded);
                }
            });
        }

        function renderPhase4ModuleList(modules) {
            var toggle = document.getElementById('phase4-module-toggle');
            var list = document.getElementById('phase4-module-list');
            var countEl = document.getElementById('phase4-module-count');
            if (!toggle || !list || !modules) return;

            var keys = Object.keys(modules);
            if (keys.length === 0) {
                toggle.style.display = 'none';
                return;
            }

            toggle.style.display = '';
            countEl.textContent = keys.length;

            var html = '';
            keys.forEach(function(moduleId) {
                var info = modules[moduleId];
                var mod = moduleGraph ? moduleGraph.modules.find(function(m) { return m.id === moduleId; }) : null;
                var name = mod ? mod.name : moduleId;
                var badgeClass = info.cached ? 'cached' : 'missing';
                var badgeText = info.cached ? '\\u2713' : '\\u2717';

                html += '<div class="phase-module-row" id="phase4-mod-row-' + moduleId.replace(/[^a-z0-9-]/g, '_') + '">' +
                    '<span class="phase-module-badge ' + badgeClass + '">' + badgeText + '</span>' +
                    '<span class="phase-module-id">' + escapeHtml(moduleId) + '</span>' +
                    '<span class="phase-module-name">' + escapeHtml(name) + '</span>' +
                    '<button class="phase-module-run-btn" onclick="runModuleRegenFromAdmin(\\'' +
                    moduleId.replace(/'/g, "\\\\'") + '\\')" title="Regenerate article for ' + escapeHtml(name) + '">Run</button>' +
                    '</div>' +
                    '<div class="phase-module-log" id="phase4-mod-log-' + moduleId.replace(/[^a-z0-9-]/g, '_') + '"></div>';
            });

            list.innerHTML = html;
        }

        async function runModuleRegenFromAdmin(moduleId) {
            if (generateRunning) return;
            generateRunning = true;

            var safeId = moduleId.replace(/[^a-z0-9-]/g, '_');
            var row = document.getElementById('phase4-mod-row-' + safeId);
            var logEl = document.getElementById('phase4-mod-log-' + safeId);
            var btn = row ? row.querySelector('.phase-module-run-btn') : null;

            if (btn) { btn.disabled = true; btn.textContent = '...'; }
            if (logEl) { logEl.textContent = 'Regenerating...'; logEl.classList.add('visible'); }

            setAllPhaseButtonsDisabled(true);

            try {
                var response = await fetch('/api/admin/generate/module/' + encodeURIComponent(moduleId), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ force: document.getElementById('generate-force').checked })
                });

                if (response.status === 409) {
                    if (logEl) logEl.textContent = 'Error: Generation already in progress';
                    return;
                }

                if (!response.ok && response.headers.get('content-type')?.indexOf('text/event-stream') === -1) {
                    var errData = await response.json();
                    if (logEl) logEl.textContent = 'Error: ' + (errData.error || 'Unknown error');
                    return;
                }

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';

                while (true) {
                    var result = await reader.read();
                    if (result.done) break;
                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\\n');
                    buffer = lines.pop() || '';
                    for (var li = 0; li < lines.length; li++) {
                        var line = lines[li];
                        if (!line.startsWith('data: ')) continue;
                        try {
                            var event = JSON.parse(line.substring(6));
                            if (logEl) {
                                if (event.type === 'log' || event.type === 'status') {
                                    logEl.textContent += '\\n' + event.message;
                                    logEl.scrollTop = logEl.scrollHeight;
                                }
                                if (event.type === 'done') {
                                    var dur = event.duration ? ' (' + formatDuration(event.duration) + ')' : '';
                                    logEl.textContent += '\\n' + (event.success ? 'Done' + dur : 'Failed: ' + (event.error || 'Unknown'));
                                }
                                if (event.type === 'error') {
                                    logEl.textContent += '\\nError: ' + event.message;
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            } catch (err) {
                if (logEl) logEl.textContent += '\\nConnection error: ' + err.message;
            } finally {
                generateRunning = false;
                setAllPhaseButtonsDisabled(false);
                if (btn) { btn.disabled = false; btn.textContent = 'Run'; }
                loadGenerateStatus();
            }
        }`;

}
