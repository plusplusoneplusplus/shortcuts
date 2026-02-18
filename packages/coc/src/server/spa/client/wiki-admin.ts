/**
 * Wiki Admin Panel: tab switching, seeds/config editing, save/reset,
 * phase-based generation SSE, and Phase 4 component list.
 *
 * Ported from deep-wiki client/admin.ts.
 * Adapted for CoC: wiki-scoped API endpoints, inline panel within wiki view,
 * no browser history manipulation, state resets on wiki switch.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getApiBase } from './config';
import { fetchApi } from './core';
import { escapeHtmlClient } from './utils';
import { wikiState } from './wiki-content';

// ================================================================
// Module state — reset when switching wikis
// ================================================================

let adminSeedsOriginal = '';
let adminConfigOriginal = '';
let adminInitialized = false;
let generateRunning = false;
let currentAdminWikiId: string | null = null;

export type WikiAdminTab = 'seeds' | 'config' | 'generate';

export function resetAdminState(): void {
    adminSeedsOriginal = '';
    adminConfigOriginal = '';
    adminInitialized = false;
    generateRunning = false;
    currentAdminWikiId = null;
}

// ================================================================
// Admin panel HTML generation
// ================================================================

const PHASE_NAMES: Record<number, { name: string; desc: string }> = {
    1: { name: 'Discovery', desc: 'Discover module graph structure' },
    2: { name: 'Consolidation', desc: 'Merge and consolidate discovery output' },
    3: { name: 'Analysis', desc: 'Deep analysis per module' },
    4: { name: 'Writing', desc: 'Generate articles and synthesis' },
    5: { name: 'Website', desc: 'Build static site output' },
};

export function renderAdminPanel(): string {
    let phasesHtml = '';
    for (let i = 1; i <= 5; i++) {
        const p = PHASE_NAMES[i];
        phasesHtml += `<div class="generate-phase-card" id="phase-card-${i}">
            <div class="phase-card-header">
                <span class="phase-number">${i}</span>
                <div class="phase-info">
                    <span class="phase-name">${p.name}</span>
                    <span class="phase-desc">${p.desc}</span>
                </div>
                <span class="phase-cache-badge missing" id="phase-cache-${i}">None</span>
                <button class="admin-btn phase-run-btn" id="phase-run-${i}">Run</button>
            </div>
            <div class="phase-log hidden" id="phase-log-${i}"></div>` +
            (i === 4 ? `<button class="phase-component-list-toggle" id="phase4-component-toggle" style="display:none">
                <span class="toggle-arrow">&#9654;</span> Components (<span id="phase4-component-count">0</span>)
            </button>
            <div class="phase-component-list" id="phase4-component-list"></div>` : '') +
            `</div>`;
    }

    let phaseOptions = '';
    for (let i = 1; i <= 5; i++) {
        phaseOptions += `<option value="${i}">Phase ${i}: ${PHASE_NAMES[i].name}</option>`;
    }

    return `<div class="admin-page hidden" id="wiki-admin-panel">
    <div class="admin-page-header">
        <div class="admin-page-title-row">
            <h2 class="admin-page-title">Wiki Admin</h2>
        </div>
        <p class="admin-page-desc">Manage seeds, configuration, and wiki generation.</p>
    </div>
    <div class="admin-tabs">
        <button class="admin-tab active" data-tab="seeds">Seeds</button>
        <button class="admin-tab" data-tab="config">Config</button>
        <button class="admin-tab" data-tab="generate">Generate</button>
    </div>
    <div class="admin-body">
        <div class="admin-tab-content active" id="admin-content-seeds">
            <div class="admin-section">
                <div class="admin-file-info">
                    <span class="admin-file-path" id="seeds-path">seeds.json</span>
                    <span class="admin-file-status" id="seeds-status"></span>
                </div>
                <textarea class="admin-editor" id="seeds-editor" spellcheck="false"></textarea>
                <div class="admin-actions">
                    <button class="admin-btn admin-btn-reset" id="seeds-reset">Reset</button>
                    <button class="admin-btn admin-btn-save" id="seeds-save">Save</button>
                </div>
            </div>
        </div>
        <div class="admin-tab-content" id="admin-content-config">
            <div class="admin-section">
                <div class="admin-file-info">
                    <span class="admin-file-path" id="config-path">deep-wiki.config.yaml</span>
                    <span class="admin-file-status" id="config-status"></span>
                </div>
                <textarea class="admin-editor" id="config-editor" spellcheck="false"></textarea>
                <div class="admin-actions">
                    <button class="admin-btn admin-btn-reset" id="config-reset">Reset</button>
                    <button class="admin-btn admin-btn-save" id="config-save">Save</button>
                </div>
            </div>
        </div>
        <div class="admin-tab-content" id="admin-content-generate">
            <div class="admin-section">
                <div class="generate-unavailable hidden" id="generate-unavailable">
                    &#9888; Generation requires a repository path to be configured for this wiki.
                </div>
                <div id="generate-controls">
                    <div class="generate-options">
                        <label class="generate-force-label">
                            <input type="checkbox" id="generate-force" />
                            Force (ignore cache)
                        </label>
                    </div>
                    <div class="generate-phases">${phasesHtml}</div>
                    <div class="generate-range-controls">
                        <div class="generate-range-row">
                            <label>Run range:</label>
                            <select id="generate-start-phase">${phaseOptions}</select>
                            <span>to</span>
                            <select id="generate-end-phase">${phaseOptions.replace('value="1"', 'value="1"').replace(/<option value="5"/, '<option value="5" selected')}</select>
                            <button class="admin-btn admin-btn-save" id="generate-run-range">Run Range</button>
                        </div>
                    </div>
                    <div class="generate-status-bar hidden" id="generate-status-bar"></div>
                </div>
            </div>
        </div>
    </div>
</div>`;
}

// ================================================================
// Show / Hide admin panel
// ================================================================

export function showWikiAdmin(wikiId: string): void {
    if (currentAdminWikiId !== wikiId) {
        // Recreate the panel to avoid stale event handlers capturing old wiki IDs.
        const existingPanel = document.getElementById('wiki-admin-panel');
        if (existingPanel) existingPanel.remove();
    }

    if (currentAdminWikiId !== wikiId) {
        resetAdminState();
        currentAdminWikiId = wikiId;
    }

    // Inject admin panel into the in-page admin shell so the wiki sidebar stays visible.
    const adminHost = document.getElementById('wiki-admin-shell')
        || document.getElementById('wiki-content')
        || document.getElementById('view-wiki');
    if (!adminHost) return;

    let panel = document.getElementById('wiki-admin-panel');
    const panelWasVisible = !!panel && !panel.classList.contains('hidden');
    if (!panel) {
        adminHost.insertAdjacentHTML('beforeend', renderAdminPanel());
        panel = document.getElementById('wiki-admin-panel');
    } else if (panel.parentElement !== adminHost) {
        adminHost.appendChild(panel);
    }

    if (panel) {
        panel.classList.add('wiki-admin-embedded');
        panel.classList.remove('hidden');
    }

    setActiveAdminTab('seeds');

    if (!adminInitialized) {
        initAdminEvents(wikiId);
        initGenerateEvents(wikiId);
        initPhase4ComponentList();
        adminInitialized = true;
    }

    if (!panelWasVisible) {
        loadAdminSeeds(wikiId);
        loadAdminConfig(wikiId);
        loadGenerateStatus(wikiId);
    }
}

export function showWikiAdminTab(wikiId: string, tab: WikiAdminTab): void {
    showWikiAdmin(wikiId);
    setActiveAdminTab(tab);
}

export function hideWikiAdmin(): void {
    const panel = document.getElementById('wiki-admin-panel');
    if (panel) panel.classList.add('hidden');
}

// ================================================================
// Admin events (tabs, save, reset)
// ================================================================

function initAdminEvents(wikiId: string): void {
    // Tab switching
    document.querySelectorAll('#wiki-admin-panel .admin-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            const target = (tab as HTMLElement).getAttribute('data-tab');
            if (target === 'seeds' || target === 'config' || target === 'generate') {
                setActiveAdminTab(target);
            }
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
                const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/seeds', {
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
                const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/config', {
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

// ================================================================
// Status helpers
// ================================================================

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

function setActiveAdminTab(tab: WikiAdminTab): void {
    document.querySelectorAll('#wiki-admin-panel .admin-tab').forEach(function (t) {
        t.classList.toggle('active', (t as HTMLElement).getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('#wiki-admin-panel .admin-tab-content').forEach(function (c) {
        c.classList.remove('active');
    });
    const contentEl = document.getElementById('admin-content-' + tab);
    if (contentEl) contentEl.classList.add('active');
}

// ================================================================
// Load data
// ================================================================

async function loadAdminSeeds(wikiId: string): Promise<void> {
    try {
        const data = await fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/admin/seeds');
        if (!data) return;
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

async function loadAdminConfig(wikiId: string): Promise<void> {
    try {
        const data = await fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/admin/config');
        if (!data) return;
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

function initGenerateEvents(wikiId: string): void {
    for (let i = 1; i <= 5; i++) {
        (function (phase: number) {
            const btn = document.getElementById('phase-run-' + phase);
            if (btn) {
                btn.addEventListener('click', function () {
                    runPhaseGeneration(wikiId, phase, phase);
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
            runPhaseGeneration(wikiId, startPhase, endPhase);
        });
    }
}

async function loadGenerateStatus(wikiId: string): Promise<void> {
    try {
        const data = await fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/admin/generate/status');
        if (!data) return;

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
        if (phase4Data && phase4Data.components) {
            renderPhase4ComponentList(phase4Data.components, wikiId);
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

function setPhaseCardState(phase: number, state: string, message: string, wikiId?: string): void {
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
                btn.onclick = function () { if (wikiId) cancelGeneration(wikiId); };
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
                    return function () { if (wikiId) runPhaseGeneration(wikiId, p, p); };
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
                    return function () { if (wikiId) runPhaseGeneration(wikiId, p, p); };
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
                    return function () { if (wikiId) runPhaseGeneration(wikiId, p, p); };
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

async function runPhaseGeneration(wikiId: string, startPhase: number, endPhase: number): Promise<void> {
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
        setPhaseCardState(i, 'idle', '', wikiId);
    }

    const statusBar = document.getElementById('generate-status-bar');
    if (statusBar) {
        statusBar.textContent = 'Starting generation (phases ' + startPhase + '-' + endPhase + ')...';
        statusBar.className = 'generate-status-bar';
        statusBar.classList.remove('hidden');
    }

    try {
        const response = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/generate', {
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
                    handleGenerateEvent(event, statusBar, wikiId);
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
        loadGenerateStatus(wikiId);
    }
}

function handleGenerateEvent(event: any, statusBar: HTMLElement | null, wikiId?: string): void {
    switch (event.type) {
        case 'status':
            setPhaseCardState(event.phase, 'running', event.message, wikiId);
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
                setPhaseCardState(event.phase, 'success', event.message + dur, wikiId);
                appendPhaseLog(event.phase, 'Completed' + dur + ': ' + event.message);
            } else {
                setPhaseCardState(event.phase, 'error', event.message, wikiId);
            }
            break;
        case 'error':
            if (event.phase) {
                setPhaseCardState(event.phase, 'error', event.message, wikiId);
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

async function cancelGeneration(wikiId: string): Promise<void> {
    try {
        await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/generate/cancel', { method: 'POST' });
    } catch (_e) {
        // Ignore cancel errors
    }
}

// ================================================================
// Phase 4 Component List
// ================================================================

function initPhase4ComponentList(): void {
    const toggle = document.getElementById('phase4-component-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
        const list = document.getElementById('phase4-component-list');
        const expanded = toggle.classList.toggle('expanded');
        if (list) {
            list.classList.toggle('expanded', expanded);
        }
    });
}

function renderPhase4ComponentList(components: Record<string, any>, wikiId: string): void {
    const toggle = document.getElementById('phase4-component-toggle');
    const list = document.getElementById('phase4-component-list');
    const countEl = document.getElementById('phase4-component-count');
    if (!toggle || !list || !components) return;

    const keys = Object.keys(components);
    if (keys.length === 0) {
        (toggle as HTMLElement).style.display = 'none';
        return;
    }

    (toggle as HTMLElement).style.display = '';
    if (countEl) countEl.textContent = String(keys.length);

    // Use wikiState.graph for component name resolution (CoC equivalent of deep-wiki's componentGraph)
    const graph = wikiState.graph;

    let html = '';
    keys.forEach(function (componentId) {
        const info = components[componentId];
        const mod = graph ? graph.components.find(function (m: any) { return m.id === componentId; }) : null;
        const name = mod ? mod.name : componentId;
        const badgeClass = info.cached ? 'cached' : 'missing';
        const badgeText = info.cached ? '\u2713' : '\u2717';
        const safeId = componentId.replace(/[^a-z0-9-]/g, '_');

        html += '<div class="phase-component-row" id="phase4-comp-row-' + safeId + '">' +
            '<span class="phase-component-badge ' + badgeClass + '">' + badgeText + '</span>' +
            '<span class="phase-component-id">' + escapeHtmlClient(componentId) + '</span>' +
            '<span class="phase-component-name">' + escapeHtmlClient(name) + '</span>' +
            '<button class="phase-component-run-btn" data-component-id="' + escapeHtmlClient(componentId) + '" title="Regenerate article for ' + escapeHtmlClient(name) + '">Run</button>' +
            '</div>' +
            '<div class="phase-component-log" id="phase4-comp-log-' + safeId + '"></div>';
    });

    list.innerHTML = html;

    // Attach click handlers for component run buttons
    list.querySelectorAll('.phase-component-run-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const cid = (btn as HTMLElement).getAttribute('data-component-id');
            if (cid) runComponentRegenFromAdmin(wikiId, cid);
        });
    });
}

export async function runComponentRegenFromAdmin(wikiId: string, componentId: string): Promise<void> {
    if (generateRunning) return;
    generateRunning = true;

    const safeId = componentId.replace(/[^a-z0-9-]/g, '_');
    const row = document.getElementById('phase4-comp-row-' + safeId);
    const logEl = document.getElementById('phase4-comp-log-' + safeId);
    const btn = row ? row.querySelector('.phase-component-run-btn') as HTMLButtonElement | null : null;

    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    if (logEl) { logEl.textContent = 'Regenerating...'; logEl.classList.add('visible'); }

    setAllPhaseButtonsDisabled(true);

    const forceEl = document.getElementById('generate-force') as HTMLInputElement | null;

    try {
        const response = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/generate/component/' + encodeURIComponent(componentId), {
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
        loadGenerateStatus(wikiId);
    }
}

// Expose for global access
(window as any).showWikiAdmin = showWikiAdmin;
(window as any).showWikiAdminTab = showWikiAdminTab;
(window as any).hideWikiAdmin = hideWikiAdmin;
(window as any).runComponentRegenFromAdmin = runComponentRegenFromAdmin;
