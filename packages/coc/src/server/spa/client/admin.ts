/**
 * Global Admin Page — storage stats and data wipe.
 *
 * Renders as a dedicated page at #admin, accessible from the top-bar gear icon.
 * Uses the existing admin REST API:
 *   GET  /api/admin/data/stats
 *   GET  /api/admin/data/wipe-token
 *   DELETE /api/admin/data?confirm=<token>&includeWikis=<bool>
 */

import { getApiBase } from './config';
import { fetchApi } from './core';

// ================================================================
// Page initialization
// ================================================================

export function initAdminPage(): void {
    const container = document.getElementById('admin-page-content');
    if (!container) return;
    container.innerHTML = renderAdminPage();
    attachAdminListeners(container);
    loadStats();
    loadConfig();
}

// ================================================================
// Navigation
// ================================================================

export function navigateToAdmin(): void {
    location.hash = '#admin';
}

// ================================================================
// HTML
// ================================================================

function renderAdminPage(): string {
    return `
<div class="admin-page-header">
    <h1>Admin</h1>
    <p class="admin-page-subtitle">Server management and data administration</p>
</div>

<div class="admin-page-sections">
    <section class="admin-section">
        <h3>Storage Stats</h3>
        <div class="admin-stats-grid" id="admin-stats-grid">
            <div class="admin-stat-card">
                <div class="admin-stat-value" id="admin-stat-processes">—</div>
                <div class="admin-stat-label">Processes</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-value" id="admin-stat-wikis">—</div>
                <div class="admin-stat-label">Wikis</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-value" id="admin-stat-disk">—</div>
                <div class="admin-stat-label">Disk Usage</div>
            </div>
        </div>
        <button class="admin-btn admin-refresh-btn" id="admin-refresh-stats">Refresh</button>
    </section>

    <section class="admin-section admin-config-section">
        <h3>Configuration</h3>
        <div id="admin-config-content">
            <div class="admin-config-loading">Loading configuration…</div>
        </div>
    </section>

    <section class="admin-section admin-danger-zone">
        <h3>Danger Zone</h3>
        <p class="admin-danger-desc">Permanently delete all stored data. This cannot be undone.</p>
        <label class="admin-checkbox-label">
            <input type="checkbox" id="admin-include-wikis" />
            Include wikis
        </label>
        <div class="admin-danger-actions">
            <button class="admin-btn admin-preview-btn" id="admin-preview-wipe">Preview</button>
            <button class="admin-btn admin-wipe-btn" id="admin-wipe-btn">Wipe Data</button>
        </div>
        <div class="admin-wipe-preview hidden" id="admin-wipe-preview"></div>
        <div class="admin-wipe-status" id="admin-wipe-status"></div>
    </section>
</div>`;
}

// ================================================================
// Event listeners
// ================================================================

function attachAdminListeners(container: HTMLElement): void {
    // Refresh stats
    container.querySelector('#admin-refresh-stats')?.addEventListener('click', loadStats);

    // Preview wipe
    container.querySelector('#admin-preview-wipe')?.addEventListener('click', previewWipe);

    // Wipe
    container.querySelector('#admin-wipe-btn')?.addEventListener('click', confirmAndWipe);

    // Config save (form may not exist yet; loadConfig re-attaches after render)
    attachConfigFormListener(container);
}

function attachConfigFormListener(container: HTMLElement): void {
    container.querySelector('#admin-config-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveConfig();
    });
}

// ================================================================
// Data fetching
// ================================================================

export async function loadStats(): Promise<void> {
    const procs = document.getElementById('admin-stat-processes');
    const wikis = document.getElementById('admin-stat-wikis');
    const disk = document.getElementById('admin-stat-disk');
    if (procs) procs.textContent = '…';
    if (wikis) wikis.textContent = '…';
    if (disk) disk.textContent = '…';

    const data = await fetchApi('/admin/data/stats?includeWikis=true');
    if (!data) {
        if (procs) procs.textContent = 'Error';
        if (wikis) wikis.textContent = 'Error';
        if (disk) disk.textContent = 'Error';
        return;
    }

    if (procs) procs.textContent = String(data.processCount ?? data.processes ?? '—');
    if (wikis) wikis.textContent = String(data.wikiCount ?? data.wikis ?? '—');
    if (disk) disk.textContent = formatBytes(data.totalBytes ?? data.diskUsage ?? 0);
}

async function previewWipe(): Promise<void> {
    const includeWikis = (document.getElementById('admin-include-wikis') as HTMLInputElement)?.checked ?? false;
    const preview = document.getElementById('admin-wipe-preview');
    if (!preview) return;

    preview.classList.remove('hidden');
    preview.textContent = 'Loading preview…';

    const data = await fetchApi('/admin/data/stats?includeWikis=' + includeWikis);
    if (!data) {
        preview.textContent = 'Failed to load preview.';
        return;
    }

    const lines: string[] = [];
    if (data.processCount != null) lines.push('Processes: ' + data.processCount);
    if (data.wikiCount != null) lines.push('Wikis: ' + data.wikiCount);
    if (data.totalBytes != null) lines.push('Disk: ' + formatBytes(data.totalBytes));
    if (data.files != null) lines.push('Files: ' + data.files);
    preview.textContent = lines.length ? lines.join('\n') : JSON.stringify(data, null, 2);
}

async function confirmAndWipe(): Promise<void> {
    const statusEl = document.getElementById('admin-wipe-status');
    const includeWikis = (document.getElementById('admin-include-wikis') as HTMLInputElement)?.checked ?? false;

    // Step 1: Get token
    if (statusEl) statusEl.textContent = 'Requesting confirmation token…';
    const tokenData = await fetchApi('/admin/data/wipe-token');
    if (!tokenData || !tokenData.token) {
        if (statusEl) statusEl.textContent = 'Failed to get wipe token.';
        return;
    }

    // Step 2: Confirm
    const confirmed = confirm('Are you sure you want to wipe all data? This cannot be undone.');
    if (!confirmed) {
        if (statusEl) statusEl.textContent = 'Cancelled.';
        return;
    }

    // Step 3: Execute wipe
    if (statusEl) statusEl.textContent = 'Wiping data…';
    try {
        const res = await fetch(
            getApiBase() + '/admin/data?confirm=' + encodeURIComponent(tokenData.token) +
            '&includeWikis=' + includeWikis,
            { method: 'DELETE' }
        );
        if (res.ok) {
            if (statusEl) statusEl.textContent = 'Data wiped successfully.';
            loadStats();
        } else {
            const body = await res.json().catch(() => null);
            if (statusEl) statusEl.textContent = 'Wipe failed: ' + (body?.error || res.statusText);
        }
    } catch (err: any) {
        if (statusEl) statusEl.textContent = 'Wipe failed: ' + (err.message || 'Network error');
    }
}

// ================================================================
// Config loading
// ================================================================

export async function loadConfig(): Promise<void> {
    const container = document.getElementById('admin-config-content');
    if (!container) return;

    const data = await fetchApi('/admin/config');
    if (!data) {
        container.innerHTML = '<div class="admin-config-error">Failed to load configuration</div>';
        return;
    }

    container.innerHTML = renderConfigSection(data);
    attachConfigFormListener(container);
}

const VALID_OUTPUT_OPTIONS = ['table', 'json', 'csv', 'markdown'] as const;

function renderConfigSection(data: any): string {
    const resolved = data.resolved ?? {};
    const sources: Record<string, string> = data.sources ?? {};
    const configFilePath: string = data.configFilePath ?? 'Unknown';

    // Editable fields rendered as form inputs
    const modelValue = resolved.model ?? '';
    const parallelValue = resolved.parallel ?? 1;
    const timeoutValue = resolved.timeout ?? 30;
    const outputValue = resolved.output ?? 'table';

    const outputOptions = VALID_OUTPUT_OPTIONS.map(o =>
        `<option value="${o}"${o === outputValue ? ' selected' : ''}>${o}</option>`
    ).join('');

    // Read-only fields
    const readOnlyFields: Array<{ key: string; label: string; value: string }> = [
        { key: 'approvePermissions', label: 'Approve Permissions', value: String(resolved.approvePermissions ?? '—') },
        { key: 'mcpConfig', label: 'MCP Config', value: String(resolved.mcpConfig ?? '—') },
        { key: 'persist', label: 'Persist', value: String(resolved.persist ?? '—') },
        { key: 'serve.port', label: 'Serve Port', value: String(resolved.serve?.port ?? '—') },
        { key: 'serve.host', label: 'Serve Host', value: String(resolved.serve?.host ?? '—') },
        { key: 'serve.dataDir', label: 'Serve Data Dir', value: String(resolved.serve?.dataDir ?? '—') },
        { key: 'serve.theme', label: 'Serve Theme', value: String(resolved.serve?.theme ?? '—') },
    ];

    const readOnlyRows = readOnlyFields.map(f => {
        const src = sources[f.key] ?? 'default';
        const badge = `<span class="admin-config-source-badge admin-config-source-${src}">${src}</span>`;
        return `<tr><td class="admin-config-key">${f.label}</td><td class="admin-config-value">${f.value} ${badge}</td></tr>`;
    }).join('\n');

    const srcBadge = (key: string) => {
        const src = sources[key] ?? 'default';
        return `<span class="admin-config-source-badge admin-config-source-${src}">${src}</span>`;
    };

    return `
<div class="admin-config-path">
    <span class="admin-config-path-label">Config file:</span>
    <code class="admin-config-path-value">${configFilePath}</code>
</div>
<form id="admin-config-form" class="admin-config-form">
    <table class="admin-config-table">
        <thead><tr><th>Setting</th><th>Value</th></tr></thead>
        <tbody>
            <tr>
                <td class="admin-config-key"><label for="admin-cfg-model">Model</label></td>
                <td class="admin-config-value">
                    <input type="text" id="admin-cfg-model" name="model" class="admin-config-input" value="${modelValue}" />
                    ${srcBadge('model')}
                </td>
            </tr>
            <tr>
                <td class="admin-config-key"><label for="admin-cfg-parallel">Parallelism</label></td>
                <td class="admin-config-value">
                    <input type="number" id="admin-cfg-parallel" name="parallel" class="admin-config-input" value="${parallelValue}" min="1" />
                    ${srcBadge('parallel')}
                </td>
            </tr>
            <tr>
                <td class="admin-config-key"><label for="admin-cfg-timeout">Timeout</label></td>
                <td class="admin-config-value">
                    <input type="number" id="admin-cfg-timeout" name="timeout" class="admin-config-input" value="${timeoutValue}" min="1" />
                    ${srcBadge('timeout')}
                </td>
            </tr>
            <tr>
                <td class="admin-config-key"><label for="admin-cfg-output">Output Format</label></td>
                <td class="admin-config-value">
                    <select id="admin-cfg-output" name="output" class="admin-config-input">${outputOptions}</select>
                    ${srcBadge('output')}
                </td>
            </tr>
            ${readOnlyRows}
        </tbody>
    </table>
    <div class="admin-config-actions">
        <button type="submit" class="admin-btn admin-save-btn" id="admin-config-save">Save</button>
        <span class="admin-config-status" id="admin-config-status"></span>
    </div>
</form>`;
}

// ================================================================
// Config save logic
// ================================================================

interface ConfigValidationError {
    field: string;
    message: string;
}

function validateConfigForm(): { valid: boolean; errors: ConfigValidationError[]; values: Record<string, unknown> } {
    const errors: ConfigValidationError[] = [];

    const modelEl = document.getElementById('admin-cfg-model') as HTMLInputElement | null;
    const parallelEl = document.getElementById('admin-cfg-parallel') as HTMLInputElement | null;
    const timeoutEl = document.getElementById('admin-cfg-timeout') as HTMLInputElement | null;
    const outputEl = document.getElementById('admin-cfg-output') as HTMLSelectElement | null;

    const model = modelEl?.value.trim() ?? '';
    const parallel = Number(parallelEl?.value);
    const timeout = Number(timeoutEl?.value);
    const output = outputEl?.value ?? '';

    if (!model) {
        errors.push({ field: 'model', message: 'Model must be a non-empty string' });
    }
    if (isNaN(parallel) || parallel < 1) {
        errors.push({ field: 'parallel', message: 'Parallelism must be at least 1' });
    }
    if (isNaN(timeout) || timeout < 1) {
        errors.push({ field: 'timeout', message: 'Timeout must be at least 1' });
    }
    if (!(VALID_OUTPUT_OPTIONS as readonly string[]).includes(output)) {
        errors.push({ field: 'output', message: `Output must be one of: ${VALID_OUTPUT_OPTIONS.join(', ')}` });
    }

    return {
        valid: errors.length === 0,
        errors,
        values: { model, parallel, timeout, output },
    };
}

async function saveConfig(): Promise<void> {
    const statusEl = document.getElementById('admin-config-status');

    const { valid, errors, values } = validateConfigForm();
    if (!valid) {
        if (statusEl) {
            statusEl.textContent = errors.map(e => e.message).join('; ');
            statusEl.className = 'admin-config-status admin-config-status-error';
        }
        return;
    }

    if (statusEl) {
        statusEl.textContent = 'Saving…';
        statusEl.className = 'admin-config-status';
    }

    try {
        const res = await fetch(getApiBase() + '/admin/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
        });
        if (res.ok) {
            if (statusEl) {
                statusEl.textContent = 'Saved';
                statusEl.className = 'admin-config-status admin-config-status-success';
            }
            // Re-fetch and re-render to reflect updated sources
            await loadConfig();
        } else {
            const body = await res.json().catch(() => null);
            if (statusEl) {
                statusEl.textContent = body?.error || 'Save failed';
                statusEl.className = 'admin-config-status admin-config-status-error';
            }
        }
    } catch (err: any) {
        if (statusEl) {
            statusEl.textContent = err.message || 'Network error';
            statusEl.className = 'admin-config-status admin-config-status-error';
        }
    }
}

// ================================================================
// Utilities
// ================================================================

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

// ================================================================
// Expose for window globals
// ================================================================

(window as any).navigateToAdmin = navigateToAdmin;
(window as any).initAdminPage = initAdminPage;
(window as any).loadAdminStats = loadStats;
(window as any).loadAdminConfig = loadConfig;
(window as any).saveAdminConfig = saveConfig;
