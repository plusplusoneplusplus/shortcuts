/**
 * Admin Portal: tab switching, seeds/config editing, save/reset,
 * phase-based generation SSE, and Phase 4 component list.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { componentGraph, currentComponentId, setCurrentComponentId, escapeHtml } from './core';
import { showAdminContent, showWikiContent } from './sidebar';
import { readSSEStream } from './sse-utils';

interface ThemeSeedClient {
    theme: string;
    description: string;
    hints: string[];
}

let adminSeedsOriginal = '';
let adminConfigOriginal = '';
let adminInitialized = false;
let generateRunning = false;
let wizardInitialized = false;
let wizardSeeds: ThemeSeedClient[] = [];

const wizardState = {
    configYaml: '',
    yamlEditorOpen: false,
    wizardGenerating: false
};

export function showAdmin(skipHistory?: boolean): void {
    setCurrentComponentId(null);
    showAdminContent();
    if (!skipHistory) {
        history.pushState({ type: 'admin' }, '', location.pathname + '#admin');
    }
    if (!adminInitialized) {
        initAdminEvents();
        initGenerateEvents();
        initPhase4ComponentList();
        adminInitialized = true;
    }
    loadAdminSeeds();
    loadAdminConfig();
    loadGenerateStatus();
    checkAndShowWizard();
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

        const wizardEl = document.getElementById('bootstrap-wizard');
        const controlsEl = document.getElementById('generate-controls');

        if (!data.available) {
            if (wizardEl) wizardEl.classList.remove('hidden');
            if (controlsEl) (controlsEl as HTMLElement).style.display = 'none';
            return;
        }

        if (wizardEl) wizardEl.classList.add('hidden');
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
            renderPhase4ComponentList(phase4Data.components);
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
        await readSSEStream(reader, function (event) {
            handleGenerateEvent(event, statusBar);
        });
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

function renderPhase4ComponentList(components: Record<string, any>): void {
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

    let html = '';
    keys.forEach(function (componentId) {
        const info = components[componentId];
        const mod = componentGraph ? componentGraph.components.find(function (m: any) { return m.id === componentId; }) : null;
        const name = mod ? mod.name : componentId;
        const badgeClass = info.cached ? 'cached' : 'missing';
        const badgeText = info.cached ? '\u2713' : '\u2717';

        html += '<div class="phase-component-row" id="phase4-comp-row-' + componentId.replace(/[^a-z0-9-]/g, '_') + '">' +
            '<span class="phase-component-badge ' + badgeClass + '">' + badgeText + '</span>' +
            '<span class="phase-component-id">' + escapeHtml(componentId) + '</span>' +
            '<span class="phase-component-name">' + escapeHtml(name) + '</span>' +
            '<button class="phase-component-run-btn" onclick="runComponentRegenFromAdmin(\'' +
            componentId.replace(/'/g, "\\'") + '\')" title="Regenerate article for ' + escapeHtml(name) + '">Run</button>' +
            '</div>' +
            '<div class="phase-component-log" id="phase4-comp-log-' + componentId.replace(/[^a-z0-9-]/g, '_') + '"></div>';
    });

    list.innerHTML = html;
}

export async function runComponentRegenFromAdmin(componentId: string): Promise<void> {
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
        const response = await fetch('/api/admin/generate/component/' + encodeURIComponent(componentId), {
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
        await readSSEStream(reader, function (event) {
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
        });
    } catch (err: any) {
        if (logEl) logEl.textContent += '\nConnection error: ' + err.message;
    } finally {
        generateRunning = false;
        setAllPhaseButtonsDisabled(false);
        if (btn) { btn.disabled = false; btn.textContent = 'Run'; }
        loadGenerateStatus();
    }
}

// ================================================================
// SSE Stream Helper (re-exported from sse-utils.ts)
// ================================================================

export { readSSEStream } from './sse-utils';

// ================================================================
// Bootstrap Wizard
// ================================================================

async function checkAndShowWizard(): Promise<void> {
    try {
        const wikiId = (window as any).__WIKI_CONFIG__?.wikiId;
        if (!wikiId) return;
        const res = await fetch('/api/wikis/' + encodeURIComponent(wikiId));
        const data = await res.json();
        if (data.wiki?.loaded === false) {
            showWizard();
        }
    } catch (_e) {
        // Silently fail — wizard stays hidden
    }
}

function showWizard(): void {
    const wizard = document.getElementById('bootstrap-wizard');
    if (wizard) wizard.classList.remove('hidden');

    const stepSeeds = document.getElementById('wizard-step-seeds');
    if (stepSeeds) stepSeeds.classList.remove('hidden');

    const stepConfig = document.getElementById('wizard-step-config');
    if (stepConfig) stepConfig.classList.add('hidden');

    const indicators = document.querySelectorAll('#wizard-stepper .wizard-step-indicator');
    indicators.forEach(function (el, i) {
        if (i === 0) el.classList.add('active');
        else el.classList.remove('active');
    });

    if (!wizardInitialized) {
        initWizardEvents();
        wizardInitialized = true;
    }

    startWizardSeedsGenerate();
}

function initWizardEvents(): void {
    const generateBtn = document.getElementById('wizard-seeds-generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', function () {
            startWizardSeedsGenerate();
        });
    }

    const saveBtn = document.getElementById('wizard-seeds-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            saveWizardSeedsAndAdvance();
        });
    }

    const skipBtn = document.getElementById('wizard-seeds-skip-btn');
    if (skipBtn) {
        skipBtn.addEventListener('click', function () {
            advanceWizardToStep2();
        });
    }

    // Step 2: Config — Continue button
    const configSaveBtn = document.getElementById('wizard-config-continue-btn');
    if (configSaveBtn) {
        configSaveBtn.addEventListener('click', async function () {
            clearWizardConfigStatus();
            let yamlToSave: string;

            const advancedDetails = document.getElementById('wizard-config-advanced') as HTMLDetailsElement | null;
            const yamlEditorOpen = advancedDetails ? advancedDetails.open : false;

            if (yamlEditorOpen) {
                const ta = document.getElementById('wizard-config-yaml') as HTMLTextAreaElement | null;
                yamlToSave = ta ? ta.value : wizardState.configYaml;
            } else {
                const modelEl = document.getElementById('wizard-config-model') as HTMLSelectElement | null;
                const depthEl = document.querySelector<HTMLInputElement>('input[name="wizard-depth"]:checked');
                const focusEl = document.getElementById('wizard-config-focus') as HTMLInputElement | null;
                const model = modelEl ? modelEl.value : '';
                const depth = depthEl ? depthEl.value : 'standard';
                const focus = focusEl ? focusEl.value.trim() : '';

                yamlToSave = buildConfigYaml(wizardState.configYaml, { model, depth, focus });
            }

            try {
                const res = await fetch('/api/admin/config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: yamlToSave })
                });
                const result = await res.json();
                if (!result.success) {
                    setWizardConfigStatus('Save failed: ' + (result.error || 'Unknown error'), true);
                    return;
                }
                wizardState.configYaml = yamlToSave;
                advanceWizard(3);
            } catch (err: any) {
                setWizardConfigStatus('Error: ' + err.message, true);
            }
        });
    }

    // Step 2: Config — Back button
    const configBackBtn = document.getElementById('wizard-config-back-btn');
    if (configBackBtn) {
        configBackBtn.addEventListener('click', function () {
            advanceWizard(1);
        });
    }

    // Step 3: Generate — Generate Wiki button
    const wizardGenerateBtn = document.getElementById('wizard-generate-btn') as HTMLButtonElement | null;
    if (wizardGenerateBtn) {
        wizardGenerateBtn.addEventListener('click', async function () {
            if (wizardState.wizardGenerating) return;
            wizardState.wizardGenerating = true;
            wizardGenerateBtn.disabled = true;
            wizardGenerateBtn.textContent = 'Generating\u2026';

            const logEl = document.getElementById('wizard-generate-log');
            if (logEl) { logEl.textContent = ''; logEl.classList.remove('hidden'); }

            const forceEl = document.getElementById('generate-force') as HTMLInputElement | null;
            const force = forceEl ? forceEl.checked : false;

            function appendWizardLog(msg: string): void {
                if (!logEl) return;
                logEl.textContent += (logEl.textContent ? '\n' : '') + msg;
                logEl.scrollTop = logEl.scrollHeight;
            }

            try {
                const response = await fetch('/api/admin/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ startPhase: 1, endPhase: 5, force: force })
                });

                if (response.status === 409) {
                    appendWizardLog('Generation already in progress \u2014 please wait and try again.');
                    return;
                }
                if (!response.ok) {
                    const errData = await response.json().catch(function () { return {}; });
                    appendWizardLog('Error: ' + ((errData as any).error || 'Unknown error'));
                    return;
                }

                let generationSucceeded = false;

                const reader = response.body!.getReader();
                await readSSEStream(reader, function (event) {
                    switch (event.type) {
                        case 'status':
                            appendWizardLog('[Phase ' + event.phase + '] ' + event.message);
                            break;
                        case 'log':
                            if (event.message) appendWizardLog(event.message);
                            break;
                        case 'progress':
                            appendWizardLog('Phase ' + event.phase + ': ' + event.current + '/' + event.total);
                            break;
                        case 'phase-complete':
                            appendWizardLog(
                                event.success
                                    ? '\u2713 Phase ' + event.phase + ' complete' +
                                      (event.duration ? ' (' + formatDuration(event.duration) + ')' : '')
                                    : '\u2717 Phase ' + event.phase + ' failed: ' + event.message
                            );
                            break;
                        case 'error':
                            appendWizardLog('Error: ' + event.message);
                            break;
                        case 'done':
                            if (event.success) {
                                generationSucceeded = true;
                                appendWizardLog(
                                    '\u2713 Wiki generation complete' +
                                    (event.duration ? ' in ' + formatDuration(event.duration) : '')
                                );
                            } else {
                                appendWizardLog('Generation failed: ' + (event.error || 'Unknown error'));
                            }
                            break;
                    }
                });

                if (generationSucceeded) {
                    await new Promise(function (resolve) { setTimeout(resolve, 800); });
                    dismissWizard();
                }
            } catch (err: any) {
                appendWizardLog('Connection error: ' + err.message);
            } finally {
                wizardState.wizardGenerating = false;
                wizardGenerateBtn.disabled = false;
                wizardGenerateBtn.textContent = 'Generate Wiki';
            }
        });
    }

    // Step 3: Generate — Back button
    const generateBackBtn = document.getElementById('wizard-generate-back-btn');
    if (generateBackBtn) {
        generateBackBtn.addEventListener('click', function () {
            if (wizardState.wizardGenerating) return;
            advanceWizard(2);
        });
    }
}

async function startWizardSeedsGenerate(): Promise<void> {
    const btn = document.getElementById('wizard-seeds-generate-btn') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Generating\u2026'; }

    const logEl = document.getElementById('wizard-seeds-log');
    if (logEl) { logEl.textContent = ''; logEl.classList.remove('hidden'); }

    const reviewEl = document.getElementById('wizard-seeds-review');
    if (reviewEl) { reviewEl.innerHTML = ''; reviewEl.classList.add('hidden'); }

    try {
        const response = await fetch('/api/admin/seeds/generate', { method: 'POST' });
        if (!response.ok) {
            if (logEl) logEl.textContent = 'Error: HTTP ' + response.status;
            if (btn) { btn.disabled = false; btn.textContent = 'Re-generate'; }
            return;
        }

        const reader = response.body!.getReader();
        await readSSEStream(reader, function (event) {
            if (event.type === 'status' || event.type === 'log') {
                if (logEl) {
                    logEl.textContent += (logEl.textContent ? '\n' : '') + event.message;
                    logEl.scrollTop = logEl.scrollHeight;
                }
            }
            if (event.type === 'done') {
                if (event.success && event.seeds) {
                    wizardSeeds = event.seeds as ThemeSeedClient[];
                    renderWizardSeedChips(wizardSeeds);
                    populateWizardSeedsEditor(wizardSeeds);
                    if (reviewEl) reviewEl.classList.remove('hidden');
                } else {
                    if (logEl) {
                        logEl.textContent += '\nError: ' + (event.error || 'Unknown error');
                    }
                }
            }
        });
    } catch (err: any) {
        if (logEl) logEl.textContent += '\nConnection error: ' + err.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Re-generate'; }
    }
}

function renderWizardSeedChips(seeds: ThemeSeedClient[]): void {
    const container = document.getElementById('wizard-seeds-review');
    if (!container) return;
    container.innerHTML = '';
    seeds.forEach(function (seed) {
        const chip = document.createElement('div');
        chip.className = 'wizard-seed-chip';
        chip.textContent = seed.theme;
        chip.title = seed.description;
        container.appendChild(chip);
    });
}

function populateWizardSeedsEditor(seeds: ThemeSeedClient[]): void {
    const editor = document.getElementById('wizard-seeds-editor') as HTMLTextAreaElement | null;
    if (!editor) return;
    const yaml = (window as any).jsyaml.dump({ themes: seeds });
    editor.value = yaml;
}

async function saveWizardSeedsAndAdvance(): Promise<void> {
    const editor = document.getElementById('wizard-seeds-editor') as HTMLTextAreaElement | null;
    if (!editor) return;
    const text = editor.value;

    let parsed: any;
    try {
        parsed = (window as any).jsyaml.load(text);
    } catch (_e) {
        const btn = document.getElementById('wizard-seeds-save-btn');
        if (btn) {
            const original = btn.textContent;
            btn.textContent = 'Invalid YAML';
            setTimeout(function () { btn.textContent = original; }, 2000);
        }
        return;
    }

    const logEl = document.getElementById('wizard-seeds-log');
    try {
        const res = await fetch('/api/admin/seeds', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parsed })
        });
        const data = await res.json();
        if (data.success) {
            advanceWizardToStep2();
        } else {
            if (logEl) logEl.textContent += '\n' + (data.error || 'Save failed');
        }
    } catch (err: any) {
        if (logEl) logEl.textContent += '\nError: ' + err.message;
    }
}

function advanceWizardToStep2(): void {
    advanceWizard(2);
}

function advanceWizard(step: number): void {
    const stepIds = ['wizard-step-seeds', 'wizard-step-config', 'wizard-step-generate'];
    const indicatorIds = ['wizard-step-indicator-seeds', 'wizard-step-indicator-config', 'wizard-step-indicator-generate'];

    stepIds.forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const activePanel = document.getElementById(stepIds[step - 1]);
    if (activePanel) activePanel.classList.remove('hidden');

    indicatorIds.forEach(function (id, i) {
        const el = document.getElementById(id);
        if (el) {
            if (i === step - 1) el.classList.add('active');
            else el.classList.remove('active');
        }
    });

    if (step === 2) enterWizardStep2();
    if (step === 3) enterWizardStep3();
}

async function enterWizardStep2(): Promise<void> {
    const res = await fetch('/api/admin/config');
    const data = await res.json();
    const yaml: string = (data.exists && data.content) ? data.content : '';
    wizardState.configYaml = yaml;

    const modelVal  = extractYamlScalar(yaml, 'model')  ?? '';
    const depthVal  = extractYamlScalar(yaml, 'depth')  ?? 'standard';
    const focusVal  = extractYamlScalar(yaml, 'focus')  ?? '';

    const modelEl = document.getElementById('wizard-config-model') as HTMLSelectElement | null;
    if (modelEl && modelVal) modelEl.value = modelVal;

    const depthRadios = document.querySelectorAll<HTMLInputElement>('input[name="wizard-depth"]');
    depthRadios.forEach(function (r) { r.checked = (r.value === depthVal); });

    const focusEl = document.getElementById('wizard-config-focus') as HTMLInputElement | null;
    if (focusEl) focusEl.value = focusVal;

    const yamlTextarea = document.getElementById('wizard-config-yaml') as HTMLTextAreaElement | null;
    if (yamlTextarea) yamlTextarea.value = yaml;

    clearWizardConfigStatus();
}

async function enterWizardStep3(): Promise<void> {
    try {
        const res = await fetch('/api/admin/generate/status');
        const data = await res.json();
        if (!data.available) return;

        for (let phase = 1; phase <= 5; phase++) {
            const badge = document.getElementById('wizard-phase-badge-' + phase);
            if (!badge) continue;
            const phaseData = data.phases[String(phase)];
            if (phaseData && phaseData.cached) {
                badge.textContent = 'Cached';
                badge.className = 'wizard-phase-badge cached';
            } else {
                badge.textContent = 'None';
                badge.className = 'wizard-phase-badge missing';
            }
        }
    } catch (_e) {
        // Silently ignore — badges stay in default state
    }
}

function dismissWizard(): void {
    const wizard = document.getElementById('bootstrap-wizard');
    if (wizard) wizard.classList.add('hidden');

    showWikiContent();

    if (typeof (window as any).reinitWiki === 'function') {
        (window as any).reinitWiki();
    } else {
        window.location.reload();
    }
}

function setWizardConfigStatus(msg: string, isError: boolean): void {
    const el = document.getElementById('wizard-config-status');
    if (!el) { if (isError) console.error(msg); return; }
    el.textContent = msg;
    el.className = 'wizard-status ' + (isError ? 'error' : 'success');
}

function clearWizardConfigStatus(): void {
    const el = document.getElementById('wizard-config-status');
    if (el) { el.textContent = ''; el.className = 'wizard-status'; }
}

export function extractYamlScalar(yaml: string, key: string): string | null {
    const re = new RegExp('^' + key + ':\\s*[\'"]?([^\'"\\n#]+)[\'"]?', 'm');
    const m = yaml.match(re);
    return m ? m[1].trim() : null;
}

export function buildConfigYaml(
    existing: string,
    fields: { model: string; depth: string; focus: string }
): string {
    let yaml = existing;

    function upsertKey(src: string, key: string, val: string): string {
        if (!val) return src;
        const re = new RegExp('^' + key + ':.*$', 'm');
        const line = key + ': ' + val;
        return re.test(src) ? src.replace(re, line) : src + (src.endsWith('\n') ? '' : '\n') + line + '\n';
    }

    if (!yaml.trim()) {
        const lines: string[] = [];
        if (fields.model) lines.push('model: ' + fields.model);
        if (fields.depth) lines.push('depth: ' + fields.depth);
        if (fields.focus) lines.push('focus: ' + fields.focus);
        return lines.join('\n') + '\n';
    }

    yaml = upsertKey(yaml, 'model', fields.model);
    yaml = upsertKey(yaml, 'depth', fields.depth);
    yaml = upsertKey(yaml, 'focus', fields.focus);
    return yaml;
}
