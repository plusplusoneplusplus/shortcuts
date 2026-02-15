/**
 * Admin Portal: tab switching, seeds/config editing, save/reset,
 * phase-based generation SSE, and Phase 4 module list.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { moduleGraph, currentModuleId, setCurrentModuleId, escapeHtml } from './core';
import { showAdminContent } from './sidebar';

let adminSeedsOriginal = '';
let adminConfigOriginal = '';
let adminInitialized = false;
let generateRunning = false;

export function showAdmin(skipHistory?: boolean): void {
    setCurrentModuleId(null);
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

/**
 * Set up admin toggle/back button listeners. Called once from index.ts.
 */
export function setupAdminListeners(): void {
    const adminToggle = document.getElementById('admin-toggle');
    if (adminToggle) {
        adminToggle.addEventListener('click', function () {
            showAdmin(false);
        });
    }

    const adminBack = document.getElementById('admin-back');
    if (adminBack) {
        adminBack.addEventListener('click', function () {
            (window as any).showHome(false);
        });
    }
}

function initAdminEvents(): void {
    // Tab switching
    document.querySelectorAll('.admin-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            const target = (tab as HTMLElement).getAttribute('data-tab');
            document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
            document.querySelectorAll('.admin-tab-content').forEach(function (c) { c.classList.remove('active'); });
            tab.classList.add('active');
            const contentEl = document.getElementById('admin-content-' + target);
            if (contentEl) contentEl.classList.add('active');
        });
    });

    // Save seeds
    const seedsSave = document.getElementById('seeds-save');
    if (seedsSave) {
        seedsSave.addEventListener('click', async function () {
            clearAdminStatus('seeds');
            const editor = document.getElementById('seeds-editor') as HTMLTextAreaElement | null;
            if (!editor) return;
            const text = editor.value;
            let content: any;
            try {
                content = JSON.parse(text);
            } catch (e: any) {
                setAdminStatus('seeds', 'Invalid JSON: ' + e.message, true);
                return;
            }
            try {
                const res = await fetch('/api/admin/seeds', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: content })
                });
                const data = await res.json();
                if (data.success) {
                    setAdminStatus('seeds', 'Saved', false);
                    adminSeedsOriginal = text;
                } else {
                    setAdminStatus('seeds', data.error || 'Save failed', true);
                }
            } catch (err: any) {
                setAdminStatus('seeds', 'Error: ' + err.message, true);
            }
        });
    }

    // Reset seeds
    const seedsReset = document.getElementById('seeds-reset');
    if (seedsReset) {
        seedsReset.addEventListener('click', function () {
            const editor = document.getElementById('seeds-editor') as HTMLTextAreaElement | null;
            if (editor) editor.value = adminSeedsOriginal;
            clearAdminStatus('seeds');
        });
    }

    // Save config
    const configSave = document.getElementById('config-save');
    if (configSave) {
        configSave.addEventListener('click', async function () {
            clearAdminStatus('config');
            const editor = document.getElementById('config-editor') as HTMLTextAreaElement | null;
            if (!editor) return;
            const text = editor.value;
            try {
                const res = await fetch('/api/admin/config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: text })
                });
                const data = await res.json();
                if (data.success) {
                    setAdminStatus('config', 'Saved', false);
                    adminConfigOriginal = text;
                } else {
                    setAdminStatus('config', data.error || 'Save failed', true);
                }
            } catch (err: any) {
                setAdminStatus('config', 'Error: ' + err.message, true);
            }
        });
    }

    // Reset config
    const configReset = document.getElementById('config-reset');
    if (configReset) {
        configReset.addEventListener('click', function () {
            const editor = document.getElementById('config-editor') as HTMLTextAreaElement | null;
            if (editor) editor.value = adminConfigOriginal;
            clearAdminStatus('config');
        });
    }
}

function setAdminStatus(which: string, msg: string, isError: boolean): void {
    const el = document.getElementById(which + '-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'admin-file-status ' + (isError ? 'error' : 'success');
}

function clearAdminStatus(which: string): void {
    const el = document.getElementById(which + '-status');
    if (!el) return;
    el.textContent = '';
    el.className = 'admin-file-status';
}

async function loadAdminSeeds(): Promise<void> {
    try {
        const res = await fetch('/api/admin/seeds');
        const data = await res.json();
        const pathEl = document.getElementById('seeds-path');
        if (pathEl) pathEl.textContent = data.path || 'seeds.json';
        const editor = document.getElementById('seeds-editor') as HTMLTextAreaElement | null;
        if (!editor) return;
        if (data.exists && data.content) {
            const text = JSON.stringify(data.content, null, 2);
            editor.value = text;
            adminSeedsOriginal = text;
        } else if (data.exists && data.raw) {
            editor.value = data.raw;
            adminSeedsOriginal = data.raw;
        } else {
            editor.value = '';
            adminSeedsOriginal = '';
        }
    } catch (err: any) {
        setAdminStatus('seeds', 'Failed to load: ' + err.message, true);
    }
}

async function loadAdminConfig(): Promise<void> {
    try {
        const res = await fetch('/api/admin/config');
        const data = await res.json();
        const pathEl = document.getElementById('config-path');
        if (pathEl) pathEl.textContent = data.path || 'deep-wiki.config.yaml';
        const editor = document.getElementById('config-editor') as HTMLTextAreaElement | null;
        if (!editor) return;
        if (data.exists && data.content) {
            editor.value = data.content;
            adminConfigOriginal = data.content;
        } else {
            editor.value = '';
            adminConfigOriginal = '';
        }
    } catch (err: any) {
        setAdminStatus('config', 'Failed to load: ' + err.message, true);
    }
}

// ================================================================
// Generate Tab
// ================================================================

function initGenerateEvents(): void {
    for (let i = 1; i <= 5; i++) {
        (function (phase: number) {
            const btn = document.getElementById('phase-run-' + phase);
            if (btn) {
                btn.addEventListener('click', function () {
                    runPhaseGeneration(phase, phase);
                });
            }
        })(i);
    }

    const rangeBtn = document.getElementById('generate-run-range');
    if (rangeBtn) {
        rangeBtn.addEventListener('click', function () {
            const startEl = document.getElementById('generate-start-phase') as HTMLSelectElement | null;
            const endEl = document.getElementById('generate-end-phase') as HTMLSelectElement | null;
            if (!startEl || !endEl) return;
            const startPhase = parseInt(startEl.value);
            const endPhase = parseInt(endEl.value);
            if (endPhase < startPhase) {
                alert('End phase must be >= start phase');
                return;
            }
            runPhaseGeneration(startPhase, endPhase);
        });
    }
}

async function loadGenerateStatus(): Promise<void> {
    try {
        const res = await fetch('/api/admin/generate/status');
        const data = await res.json();

        const unavailableEl = document.getElementById('generate-unavailable');
        const controlsEl = document.getElementById('generate-controls');

        if (!data.available) {
            if (unavailableEl) unavailableEl.classList.remove('hidden');
            if (controlsEl) (controlsEl as HTMLElement).style.display = 'none';
            return;
        }

        if (unavailableEl) unavailableEl.classList.add('hidden');
        if (controlsEl) (controlsEl as HTMLElement).style.display = '';

        // Update cache badges
        for (let phase = 1; phase <= 5; phase++) {
            const badge = document.getElementById('phase-cache-' + phase);
            if (!badge) continue;
            const phaseData = data.phases[String(phase)];
            if (phaseData && phaseData.cached) {
                badge.textContent = 'Cached';
                badge.className = 'phase-cache-badge cached';
            } else {
                badge.textContent = 'None';
                badge.className = 'phase-cache-badge missing';
            }
        }

        if (data.running) {
            generateRunning = true;
            setAllPhaseButtonsDisabled(true);
            const statusBar = document.getElementById('generate-status-bar');
            if (statusBar) {
                statusBar.textContent = 'Phase ' + (data.currentPhase || '?') + ' is running...';
                statusBar.classList.remove('hidden');
            }
        } else {
            generateRunning = false;
        }

        const phase4Data = data.phases['4'];
        if (phase4Data && phase4Data.modules) {
            renderPhase4ModuleList(phase4Data.modules);
        }
    } catch (_err) {
        // Silently fail on status load
    }
}

function setAllPhaseButtonsDisabled(disabled: boolean): void {
    for (let i = 1; i <= 5; i++) {
        const btn = document.getElementById('phase-run-' + i) as HTMLButtonElement | null;
        if (btn) btn.disabled = disabled;
    }
    const rangeBtn = document.getElementById('generate-run-range') as HTMLButtonElement | null;
    if (rangeBtn) rangeBtn.disabled = disabled;
}

function setPhaseCardState(phase: number, state: string, message: string): void {
    const card = document.getElementById('phase-card-' + phase);
    if (!card) return;

    card.classList.remove('phase-running', 'phase-success', 'phase-error');

    const btn = document.getElementById('phase-run-' + phase) as HTMLButtonElement | null;
    const logEl = document.getElementById('phase-log-' + phase);

    switch (state) {
        case 'running':
            card.classList.add('phase-running');
            if (btn) {
                btn.textContent = 'Cancel';
                btn.disabled = false;
                btn.onclick = function () { cancelGeneration(); };
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
                btn.addEventListener('click', (function (p: number) {
                    return function () { runPhaseGeneration(p, p); };
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
                btn.addEventListener('click', (function (p: number) {
                    return function () { runPhaseGeneration(p, p); };
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
                btn.addEventListener('click', (function (p: number) {
                    return function () { runPhaseGeneration(p, p); };
                })(phase));
            }
            break;
    }
}

function appendPhaseLog(phase: number, message: string): void {
    const logEl = document.getElementById('phase-log-' + phase);
    if (!logEl) return;
    logEl.classList.remove('hidden');
    logEl.textContent += '\n' + message;
    logEl.scrollTop = logEl.scrollHeight;
}

async function runPhaseGeneration(startPhase: number, endPhase: number): Promise<void> {
    if (generateRunning) return;
    generateRunning = true;

    const forceEl = document.getElementById('generate-force') as HTMLInputElement | null;
    const force = forceEl ? forceEl.checked : false;

    setAllPhaseButtonsDisabled(true);

    for (let i = startPhase; i <= endPhase; i++) {
        const logEl = document.getElementById('phase-log-' + i);
        if (logEl) {
            logEl.textContent = '';
            logEl.classList.add('hidden');
        }
        setPhaseCardState(i, 'idle', '');
    }

    const statusBar = document.getElementById('generate-status-bar');
    if (statusBar) {
        statusBar.textContent = 'Starting generation (phases ' + startPhase + '-' + endPhase + ')...';
        statusBar.className = 'generate-status-bar';
        statusBar.classList.remove('hidden');
    }

    try {
        const response = await fetch('/api/admin/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startPhase: startPhase, endPhase: endPhase, force: force })
        });

        if (response.status === 409) {
            if (statusBar) {
                statusBar.textContent = 'Generation already in progress';
                statusBar.className = 'generate-status-bar error';
            }
            generateRunning = false;
            setAllPhaseButtonsDisabled(false);
            return;
        }

        if (!response.ok) {
            const errData = await response.json();
            if (statusBar) {
                statusBar.textContent = 'Error: ' + (errData.error || 'Unknown error');
                statusBar.className = 'generate-status-bar error';
            }
            generateRunning = false;
            setAllPhaseButtonsDisabled(false);
            return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const result = await reader.read();
            if (result.done) break;

            buffer += decoder.decode(result.value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (let li = 0; li < lines.length; li++) {
                const line = lines[li];
                if (!line.startsWith('data: ')) continue;
                try {
                    const event = JSON.parse(line.substring(6));
                    handleGenerateEvent(event, statusBar);
                } catch (_e) {
                    // Ignore parse errors
                }
            }
        }
    } catch (err: any) {
        if (statusBar) {
            statusBar.textContent = 'Connection error: ' + err.message;
            statusBar.className = 'generate-status-bar error';
        }
    } finally {
        generateRunning = false;
        setAllPhaseButtonsDisabled(false);
        loadGenerateStatus();
    }
}

function handleGenerateEvent(event: any, statusBar: HTMLElement | null): void {
    switch (event.type) {
        case 'status':
            setPhaseCardState(event.phase, 'running', event.message);
            if (statusBar) statusBar.textContent = 'Phase ' + event.phase + ': ' + event.message;
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
                const dur = event.duration ? ' (' + formatDuration(event.duration) + ')' : '';
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
            if (statusBar) {
                statusBar.textContent = 'Error: ' + event.message;
                statusBar.className = 'generate-status-bar error';
            }
            break;
        case 'done':
            if (event.success) {
                const totalDur = event.duration ? ' in ' + formatDuration(event.duration) : '';
                if (statusBar) {
                    statusBar.textContent = 'Generation completed' + totalDur;
                    statusBar.className = 'generate-status-bar success';
                }
            } else {
                if (statusBar) {
                    statusBar.textContent = 'Generation failed: ' + (event.error || 'Unknown error');
                    statusBar.className = 'generate-status-bar error';
                }
            }
            break;
    }
}

export function formatDuration(ms: number): string {
    if (ms < 1000) return ms + 'ms';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return seconds + 's';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes + 'm ' + remainingSeconds + 's';
}

async function cancelGeneration(): Promise<void> {
    try {
        await fetch('/api/admin/generate/cancel', { method: 'POST' });
    } catch (_e) {
        // Ignore cancel errors
    }
}

// ================================================================
// Phase 4 Module List
// ================================================================

function initPhase4ModuleList(): void {
    const toggle = document.getElementById('phase4-module-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
        const list = document.getElementById('phase4-module-list');
        const expanded = toggle.classList.toggle('expanded');
        if (list) {
            list.classList.toggle('expanded', expanded);
        }
    });
}

function renderPhase4ModuleList(modules: Record<string, any>): void {
    const toggle = document.getElementById('phase4-module-toggle');
    const list = document.getElementById('phase4-module-list');
    const countEl = document.getElementById('phase4-module-count');
    if (!toggle || !list || !modules) return;

    const keys = Object.keys(modules);
    if (keys.length === 0) {
        (toggle as HTMLElement).style.display = 'none';
        return;
    }

    (toggle as HTMLElement).style.display = '';
    if (countEl) countEl.textContent = String(keys.length);

    let html = '';
    keys.forEach(function (moduleId) {
        const info = modules[moduleId];
        const mod = moduleGraph ? moduleGraph.modules.find(function (m: any) { return m.id === moduleId; }) : null;
        const name = mod ? mod.name : moduleId;
        const badgeClass = info.cached ? 'cached' : 'missing';
        const badgeText = info.cached ? '\u2713' : '\u2717';

        html += '<div class="phase-module-row" id="phase4-mod-row-' + moduleId.replace(/[^a-z0-9-]/g, '_') + '">' +
            '<span class="phase-module-badge ' + badgeClass + '">' + badgeText + '</span>' +
            '<span class="phase-module-id">' + escapeHtml(moduleId) + '</span>' +
            '<span class="phase-module-name">' + escapeHtml(name) + '</span>' +
            '<button class="phase-module-run-btn" onclick="runModuleRegenFromAdmin(\'' +
            moduleId.replace(/'/g, "\\'") + '\')" title="Regenerate article for ' + escapeHtml(name) + '">Run</button>' +
            '</div>' +
            '<div class="phase-module-log" id="phase4-mod-log-' + moduleId.replace(/[^a-z0-9-]/g, '_') + '"></div>';
    });

    list.innerHTML = html;
}

export async function runModuleRegenFromAdmin(moduleId: string): Promise<void> {
    if (generateRunning) return;
    generateRunning = true;

    const safeId = moduleId.replace(/[^a-z0-9-]/g, '_');
    const row = document.getElementById('phase4-mod-row-' + safeId);
    const logEl = document.getElementById('phase4-mod-log-' + safeId);
    const btn = row ? row.querySelector('.phase-module-run-btn') as HTMLButtonElement | null : null;

    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    if (logEl) { logEl.textContent = 'Regenerating...'; logEl.classList.add('visible'); }

    setAllPhaseButtonsDisabled(true);

    const forceEl = document.getElementById('generate-force') as HTMLInputElement | null;

    try {
        const response = await fetch('/api/admin/generate/module/' + encodeURIComponent(moduleId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: forceEl ? forceEl.checked : false })
        });

        if (response.status === 409) {
            if (logEl) logEl.textContent = 'Error: Generation already in progress';
            return;
        }

        if (!response.ok && response.headers.get('content-type')?.indexOf('text/event-stream') === -1) {
            const errData = await response.json();
            if (logEl) logEl.textContent = 'Error: ' + (errData.error || 'Unknown error');
            return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const result = await reader.read();
            if (result.done) break;
            buffer += decoder.decode(result.value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (let li = 0; li < lines.length; li++) {
                const line = lines[li];
                if (!line.startsWith('data: ')) continue;
                try {
                    const event = JSON.parse(line.substring(6));
                    if (logEl) {
                        if (event.type === 'log' || event.type === 'status') {
                            logEl.textContent += '\n' + event.message;
                            logEl.scrollTop = logEl.scrollHeight;
                        }
                        if (event.type === 'done') {
                            const dur = event.duration ? ' (' + formatDuration(event.duration) + ')' : '';
                            logEl.textContent += '\n' + (event.success ? 'Done' + dur : 'Failed: ' + (event.error || 'Unknown'));
                        }
                        if (event.type === 'error') {
                            logEl.textContent += '\nError: ' + event.message;
                        }
                    }
                } catch (_e) { /* ignore */ }
            }
        }
    } catch (err: any) {
        if (logEl) logEl.textContent += '\nConnection error: ' + err.message;
    } finally {
        generateRunning = false;
        setAllPhaseButtonsDisabled(false);
        if (btn) { btn.disabled = false; btn.textContent = 'Run'; }
        loadGenerateStatus();
    }
}
