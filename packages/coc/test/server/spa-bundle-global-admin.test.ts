/**
 * SPA Dashboard Tests — Global Admin Page
 *
 * Tests for the global admin dedicated page (#admin): HTML structure, source code
 * patterns, bundle integration, styling, routing, and top-bar gear icon.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, getClientCssBundle, generateDashboardHtml } from './spa-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// admin.ts source file exists
// ============================================================================

describe('global admin client source file', () => {
    it('should have client/admin.ts', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'admin.ts'))).toBe(true);
    });

    it('exports initAdminPage function', () => {
        const content = readClientFile('admin.ts');
        expect(content).toContain('export function initAdminPage');
    });

    it('exports navigateToAdmin function', () => {
        const content = readClientFile('admin.ts');
        expect(content).toContain('export function navigateToAdmin');
    });

    it('exports loadStats function', () => {
        const content = readClientFile('admin.ts');
        expect(content).toContain('export async function loadStats');
    });

    it('exports formatBytes function', () => {
        const content = readClientFile('admin.ts');
        expect(content).toContain('export function formatBytes');
    });
});

// ============================================================================
// admin.ts — page HTML structure
// ============================================================================

describe('global admin — page HTML structure', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('renders page header with h1', () => {
        expect(content).toContain('<h1>Admin</h1>');
    });

    it('renders page subtitle', () => {
        expect(content).toContain('admin-page-subtitle');
    });

    it('renders page sections container', () => {
        expect(content).toContain('admin-page-sections');
    });

    it('generates stats grid with id admin-stats-grid', () => {
        expect(content).toContain('id="admin-stats-grid"');
    });

    it('generates process count stat card', () => {
        expect(content).toContain('id="admin-stat-processes"');
    });

    it('generates wiki count stat card', () => {
        expect(content).toContain('id="admin-stat-wikis"');
    });

    it('generates disk usage stat card', () => {
        expect(content).toContain('id="admin-stat-disk"');
    });

    it('generates refresh stats button', () => {
        expect(content).toContain('id="admin-refresh-stats"');
    });

    it('generates danger zone section', () => {
        expect(content).toContain('admin-danger-zone');
    });

    it('generates include-wikis checkbox', () => {
        expect(content).toContain('id="admin-include-wikis"');
    });

    it('generates preview button', () => {
        expect(content).toContain('id="admin-preview-wipe"');
    });

    it('generates wipe button', () => {
        expect(content).toContain('id="admin-wipe-btn"');
    });

    it('generates wipe preview container', () => {
        expect(content).toContain('id="admin-wipe-preview"');
    });

    it('generates wipe status container', () => {
        expect(content).toContain('id="admin-wipe-status"');
    });
});

// ============================================================================
// admin.ts — API endpoints
// ============================================================================

describe('global admin — API endpoints', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('calls stats endpoint', () => {
        expect(content).toContain("'/admin/data/stats");
    });

    it('calls wipe-token endpoint', () => {
        expect(content).toContain("'/admin/data/wipe-token'");
    });

    it('calls DELETE /admin/data with confirmation token', () => {
        expect(content).toContain("'/admin/data?confirm='");
    });

    it('uses DELETE method for wipe', () => {
        expect(content).toContain("method: 'DELETE'");
    });
});

// ============================================================================
// admin.ts — uses CoC patterns
// ============================================================================

describe('global admin — uses CoC patterns', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('imports fetchApi from core', () => {
        expect(content).toContain("import { fetchApi } from './core'");
    });

    it('imports getApiBase from config', () => {
        expect(content).toContain("import { getApiBase } from './config'");
    });

    it('exposes navigateToAdmin on window', () => {
        expect(content).toContain('(window as any).navigateToAdmin = navigateToAdmin');
    });

    it('exposes initAdminPage on window', () => {
        expect(content).toContain('(window as any).initAdminPage = initAdminPage');
    });

    it('exposes loadAdminStats on window', () => {
        expect(content).toContain('(window as any).loadAdminStats = loadStats');
    });
});

// ============================================================================
// admin.ts — two-step wipe confirmation
// ============================================================================

describe('global admin — two-step wipe confirmation', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('fetches wipe token before wiping', () => {
        expect(content).toContain("fetchApi('/admin/data/wipe-token')");
    });

    it('uses browser confirm dialog', () => {
        expect(content).toContain('confirm(');
    });

    it('passes token via confirm query parameter', () => {
        expect(content).toContain('confirm=');
        expect(content).toContain('encodeURIComponent(tokenData.token)');
    });

    it('passes includeWikis parameter', () => {
        expect(content).toContain('includeWikis=');
    });
});

// ============================================================================
// admin.ts — hash-based navigation (page, not overlay)
// ============================================================================

describe('global admin — hash-based navigation', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('navigateToAdmin sets location.hash to #admin', () => {
        expect(content).toContain("location.hash = '#admin'");
    });

    it('does not use overlay show/hide pattern', () => {
        expect(content).not.toContain('showAdmin');
        expect(content).not.toContain('hideAdmin');
        expect(content).not.toContain('toggleAdmin');
    });

    it('does not create overlay dynamically', () => {
        expect(content).not.toContain('admin-overlay');
    });

    it('uses admin-page-content container from HTML template', () => {
        expect(content).toContain("getElementById('admin-page-content')");
    });
});

// ============================================================================
// core.ts — hash router includes #admin
// ============================================================================

describe('core.ts — hash router includes #admin', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('core.ts'); });

    it('handles #admin hash route', () => {
        expect(content).toContain("hash === 'admin'");
    });

    it('switches to admin tab on #admin', () => {
        expect(content).toContain("switchTab?.('admin')");
    });

    it('includes view-admin in dashboardEls', () => {
        expect(content).toContain('view-admin');
    });
});

// ============================================================================
// state.ts — DashboardTab includes admin
// ============================================================================

describe('state.ts — DashboardTab includes admin', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('state.ts'); });

    it('DashboardTab type includes admin', () => {
        expect(content).toContain("'admin'");
        const match = content.match(/DashboardTab\s*=\s*([^;]+)/);
        expect(match).not.toBeNull();
        expect(match![1]).toContain('admin');
    });
});

// ============================================================================
// repos.ts — switchTab includes view-admin
// ============================================================================

describe('repos.ts — switchTab includes view-admin', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('repos.ts'); });

    it('view-admin is in the viewIds list', () => {
        expect(content).toContain("'view-admin'");
    });

    it('calls initAdminPage when switching to admin', () => {
        expect(content).toContain('initAdminPage');
    });

    it('highlights admin toggle when admin tab is active', () => {
        expect(content).toContain("admin-toggle");
        expect(content).toContain("tab === 'admin'");
    });
});

// ============================================================================
// HTML template — admin page view
// ============================================================================

describe('HTML template — admin page view', () => {
    const html = generateDashboardHtml();

    it('contains view-admin div', () => {
        expect(html).toContain('id="view-admin"');
    });

    it('view-admin has hidden class by default', () => {
        const idx = html.indexOf('id="view-admin"');
        const surrounding = html.substring(idx - 100, idx + 50);
        expect(surrounding).toContain('hidden');
    });

    it('contains admin-page container', () => {
        expect(html).toContain('class="admin-page"');
    });

    it('contains admin-page-content container', () => {
        expect(html).toContain('id="admin-page-content"');
    });

    it('view-admin uses app-view class', () => {
        const idx = html.indexOf('id="view-admin"');
        const surrounding = html.substring(idx - 50, idx + 50);
        expect(surrounding).toContain('app-view');
    });
});

// ============================================================================
// HTML template — admin toggle as link
// ============================================================================

describe('HTML template — admin toggle link', () => {
    const html = generateDashboardHtml();

    it('contains admin toggle element in top-bar-right', () => {
        expect(html).toContain('id="admin-toggle"');
    });

    it('admin toggle is an anchor tag with href="#admin"', () => {
        const idx = html.indexOf('id="admin-toggle"');
        const surrounding = html.substring(idx - 150, idx + 200);
        expect(surrounding).toContain('href="#admin"');
        expect(surrounding).toContain('<a ');
    });

    it('admin toggle has gear icon', () => {
        const idx = html.indexOf('id="admin-toggle"');
        const surrounding = html.substring(idx - 100, idx + 200);
        expect(surrounding).toContain('&#9881;');
    });

    it('admin toggle has title attribute', () => {
        expect(html).toContain('title="Admin"');
    });

    it('admin toggle has aria-label', () => {
        expect(html).toContain('aria-label="Admin"');
    });

    it('admin toggle uses top-bar-btn class', () => {
        const idx = html.indexOf('id="admin-toggle"');
        const surrounding = html.substring(idx - 100, idx + 100);
        expect(surrounding).toContain('top-bar-btn');
    });

    it('admin toggle appears before theme-toggle', () => {
        const adminIdx = html.indexOf('id="admin-toggle"');
        const themeIdx = html.indexOf('id="theme-toggle"');
        expect(adminIdx).toBeLessThan(themeIdx);
    });
});

// ============================================================================
// CSS — admin page styles
// ============================================================================

describe('CSS — admin page styles', () => {
    let css: string;
    beforeAll(() => { css = getClientCssBundle(); });

    it('defines .admin-page style', () => {
        expect(css).toContain('.admin-page');
    });

    it('defines .admin-page-header style', () => {
        expect(css).toContain('.admin-page-header');
    });

    it('defines .admin-page-subtitle style', () => {
        expect(css).toContain('.admin-page-subtitle');
    });

    it('defines .admin-page-sections style', () => {
        expect(css).toContain('.admin-page-sections');
    });

    it('global admin page uses max-width scoped to #view-admin', () => {
        const match = css.match(/#view-admin\s+\.admin-page\s*\{[^}]*max-width/);
        expect(match).not.toBeNull();
    });

    it('global admin page uses auto margin for centering scoped to #view-admin', () => {
        const match = css.match(/#view-admin\s+\.admin-page\s*\{[^}]*margin:\s*0\s+auto/);
        expect(match).not.toBeNull();
    });

    it('does not have overlay styles', () => {
        expect(css).not.toContain('.admin-overlay');
    });

    it('defines .admin-stat-card style', () => {
        expect(css).toContain('.admin-stat-card');
    });

    it('defines .admin-stats-grid style', () => {
        expect(css).toContain('.admin-stats-grid');
    });

    it('defines .admin-stat-value style', () => {
        expect(css).toContain('.admin-stat-value');
    });

    it('defines .admin-stat-label style', () => {
        expect(css).toContain('.admin-stat-label');
    });

    it('defines .admin-danger-zone style', () => {
        expect(css).toContain('.admin-danger-zone');
    });

    it('danger zone uses red border', () => {
        const dangerSection = css.substring(css.indexOf('.admin-danger-zone'));
        expect(dangerSection).toContain('--status-failed');
    });

    it('defines .admin-wipe-btn style', () => {
        expect(css).toContain('.admin-wipe-btn');
    });

    it('defines .admin-wipe-preview style', () => {
        expect(css).toContain('.admin-wipe-preview');
    });

    it('defines .admin-wipe-status style', () => {
        expect(css).toContain('.admin-wipe-status');
    });

    it('defines .admin-btn style', () => {
        expect(css).toContain('.admin-btn');
    });

    it('defines .admin-checkbox-label style', () => {
        expect(css).toContain('.admin-checkbox-label');
    });

    it('defines a.top-bar-btn style for anchor buttons', () => {
        expect(css).toContain('a.top-bar-btn');
    });

    it('defines .top-bar-btn.active style', () => {
        expect(css).toContain('.top-bar-btn.active');
    });
});

// ============================================================================
// index.ts — admin import
// ============================================================================

describe('index.ts — global admin import', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('index.ts'); });

    it('imports admin module', () => {
        expect(content).toContain("import './admin'");
    });

    it('admin import is after wiki modules', () => {
        const wikiAdminIdx = content.indexOf("import './wiki-admin'");
        const adminIdx = content.indexOf("import './admin'");
        expect(adminIdx).toBeGreaterThan(wikiAdminIdx);
    });

    it('admin import is before websocket module', () => {
        const adminIdx = content.indexOf("import './admin'");
        const wsIdx = content.indexOf("import './websocket'");
        expect(adminIdx).toBeLessThan(wsIdx);
    });
});

// ============================================================================
// Client bundle — admin module
// ============================================================================

describe('client bundle — global admin module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines initAdminPage function', () => {
        expect(script).toContain('initAdminPage');
    });

    it('defines navigateToAdmin function', () => {
        expect(script).toContain('navigateToAdmin');
    });

    it('defines formatBytes function', () => {
        expect(script).toContain('formatBytes');
    });

    it('includes admin page element IDs', () => {
        expect(script).toContain('admin-page-content');
        expect(script).toContain('admin-stats-grid');
        expect(script).toContain('admin-wipe-btn');
    });

    it('includes admin API endpoint patterns', () => {
        expect(script).toContain('/admin/data/stats');
        expect(script).toContain('/admin/data/wipe-token');
    });
});

// ============================================================================
// admin.ts — Configuration section (read-only viewer)
// ============================================================================

describe('global admin — config section HTML', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('renders admin-config-section between stats and danger zone', () => {
        const statsIdx = content.indexOf('admin-stats-grid');
        const configIdx = content.indexOf('admin-config-section');
        const dangerIdx = content.indexOf('admin-danger-zone');
        expect(configIdx).toBeGreaterThan(statsIdx);
        expect(configIdx).toBeLessThan(dangerIdx);
    });

    it('has admin-config-content container', () => {
        expect(content).toContain('id="admin-config-content"');
    });

    it('calls loadConfig in initAdminPage', () => {
        expect(content).toContain('loadConfig()');
    });

    it('exports loadConfig function', () => {
        expect(content).toContain('export async function loadConfig');
    });

    it('fetches /admin/config API endpoint', () => {
        expect(content).toContain("fetchApi('/admin/config')");
    });

    it('renders config file path', () => {
        expect(content).toContain('admin-config-path');
        expect(content).toContain('admin-config-path-value');
    });

    it('renders config table with key-value rows', () => {
        expect(content).toContain('admin-config-table');
        expect(content).toContain('admin-config-key');
        expect(content).toContain('admin-config-value');
    });

    it('renders source badges for default and file', () => {
        expect(content).toContain('admin-config-source-badge');
        expect(content).toContain('admin-config-source-${src}');
    });

    it('displays all expected config fields', () => {
        // Editable fields are rendered as form inputs
        for (const field of ['model', 'parallel', 'timeout', 'output']) {
            expect(content).toContain(`name="${field}"`);
        }
        // Read-only fields still use key pattern
        for (const field of ['approvePermissions', 'mcpConfig', 'persist']) {
            expect(content).toContain(`key: '${field}'`);
        }
    });

    it('displays serve sub-fields', () => {
        for (const field of ['serve.port', 'serve.host', 'serve.dataDir', 'serve.theme']) {
            expect(content).toContain(`key: '${field}'`);
        }
    });

    it('shows error message on fetch failure', () => {
        expect(content).toContain('Failed to load configuration');
        expect(content).toContain('admin-config-error');
    });

    it('exposes loadAdminConfig on window', () => {
        expect(content).toContain('(window as any).loadAdminConfig = loadConfig');
    });
});

// ============================================================================
// CSS — admin config styles
// ============================================================================

describe('CSS — admin config styles', () => {
    let css: string;
    beforeAll(() => { css = getClientCssBundle(); });

    it('defines .admin-config-section style', () => {
        expect(css).toContain('.admin-config-section');
    });

    it('defines .admin-config-path style', () => {
        expect(css).toContain('.admin-config-path');
    });

    it('defines .admin-config-path-value style', () => {
        expect(css).toContain('.admin-config-path-value');
    });

    it('defines .admin-config-table style', () => {
        expect(css).toContain('.admin-config-table');
    });

    it('defines .admin-config-key style', () => {
        expect(css).toContain('.admin-config-key');
    });

    it('defines .admin-config-value style', () => {
        expect(css).toContain('.admin-config-value');
    });

    it('defines .admin-config-source-badge style', () => {
        expect(css).toContain('.admin-config-source-badge');
    });

    it('defines .admin-config-source-default style', () => {
        expect(css).toContain('.admin-config-source-default');
    });

    it('defines .admin-config-source-file style', () => {
        expect(css).toContain('.admin-config-source-file');
    });

    it('defines .admin-config-error style', () => {
        expect(css).toContain('.admin-config-error');
    });

    it('defines .admin-config-loading style', () => {
        expect(css).toContain('.admin-config-loading');
    });
});

// ============================================================================
// Client bundle — admin config
// ============================================================================

describe('client bundle — admin config module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('includes admin-config-content element ID', () => {
        expect(script).toContain('admin-config-content');
    });

    it('includes loadConfig function', () => {
        expect(script).toContain('loadConfig');
    });

    it('includes /admin/config API path', () => {
        expect(script).toContain('/admin/config');
    });

    it('includes admin-config-table class', () => {
        expect(script).toContain('admin-config-table');
    });

    it('includes admin-config-source-badge class', () => {
        expect(script).toContain('admin-config-source-badge');
    });
});

// ============================================================================
// Global admin does not interfere with wiki admin
// ============================================================================

describe('global admin — independent of wiki admin', () => {
    it('admin.ts does not import from wiki-admin', () => {
        const content = readClientFile('admin.ts');
        expect(content).not.toContain("from './wiki-admin'");
    });

    it('wiki-admin.ts does not import from admin', () => {
        const content = readClientFile('wiki-admin.ts');
        expect(content).not.toContain("from './admin'");
    });

    it('admin toggle has different id than wiki admin gear', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="admin-toggle"');
        expect(html).not.toContain('id="wiki-admin-toggle"');
    });
});

// ============================================================================
// admin.ts — Config editor form (editable fields)
// ============================================================================

describe('global admin — config editor form', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('renders a form element with id admin-config-form', () => {
        expect(content).toContain('id="admin-config-form"');
    });

    it('renders model text input with id admin-cfg-model', () => {
        expect(content).toContain('id="admin-cfg-model"');
        expect(content).toContain('type="text"');
        expect(content).toContain('name="model"');
    });

    it('renders parallel number input with id admin-cfg-parallel', () => {
        expect(content).toContain('id="admin-cfg-parallel"');
        expect(content).toContain('name="parallel"');
        expect(content).toMatch(/type="number".*name="parallel"/s);
    });

    it('renders timeout number input with id admin-cfg-timeout', () => {
        expect(content).toContain('id="admin-cfg-timeout"');
        expect(content).toContain('name="timeout"');
    });

    it('renders output select with id admin-cfg-output', () => {
        expect(content).toContain('id="admin-cfg-output"');
        expect(content).toContain('<select');
        expect(content).toContain('name="output"');
    });

    it('includes all valid output options (table, json, csv, markdown)', () => {
        expect(content).toContain("'table'");
        expect(content).toContain("'json'");
        expect(content).toContain("'csv'");
        expect(content).toContain("'markdown'");
    });

    it('renders Save button with id admin-config-save', () => {
        expect(content).toContain('id="admin-config-save"');
        expect(content).toContain('>Save<');
    });

    it('renders config status element', () => {
        expect(content).toContain('id="admin-config-status"');
        expect(content).toContain('admin-config-status');
    });

    it('all editable inputs have admin-config-input class', () => {
        expect(content).toContain('class="admin-config-input"');
    });

    it('number inputs have min="1"', () => {
        // Both parallel and timeout should have min=1
        const matches = content.match(/min="1"/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it('form has admin-config-form class', () => {
        expect(content).toContain('class="admin-config-form"');
    });

    it('renders admin-config-actions container', () => {
        expect(content).toContain('admin-config-actions');
    });
});

// ============================================================================
// admin.ts — Config save/validation logic
// ============================================================================

describe('global admin — config save logic', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('defines saveConfig function', () => {
        expect(content).toContain('async function saveConfig');
    });

    it('defines validateConfigForm function', () => {
        expect(content).toContain('function validateConfigForm');
    });

    it('validates model is non-empty', () => {
        expect(content).toContain('Model must be a non-empty string');
    });

    it('validates parallel is at least 1', () => {
        expect(content).toContain('Parallelism must be at least 1');
    });

    it('validates timeout is at least 1', () => {
        expect(content).toContain('Timeout must be at least 1');
    });

    it('validates output against allowed values', () => {
        expect(content).toContain('VALID_OUTPUT_OPTIONS');
        expect(content).toContain('Output must be one of');
    });

    it('sends PUT request to /admin/config', () => {
        expect(content).toContain("method: 'PUT'");
        expect(content).toContain("'/admin/config'");
    });

    it('sends JSON content type header', () => {
        expect(content).toContain("'Content-Type': 'application/json'");
    });

    it('sends JSON body with config values', () => {
        expect(content).toContain('JSON.stringify(values)');
    });

    it('shows success status on save', () => {
        expect(content).toContain('admin-config-status-success');
        expect(content).toContain("'Saved'");
    });

    it('shows error status on validation failure', () => {
        expect(content).toContain('admin-config-status-error');
    });

    it('shows server error on 400 response', () => {
        expect(content).toContain("body?.error || 'Save failed'");
    });

    it('handles network error', () => {
        expect(content).toContain("err.message || 'Network error'");
    });

    it('re-fetches config after successful save', () => {
        // After PUT succeeds, loadConfig is called to re-render
        expect(content).toContain('await loadConfig()');
    });

    it('exposes saveAdminConfig on window', () => {
        expect(content).toContain('(window as any).saveAdminConfig = saveConfig');
    });
});

// ============================================================================
// admin.ts — Form event handling
// ============================================================================

describe('global admin — form event handling', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('defines attachConfigFormListener function', () => {
        expect(content).toContain('function attachConfigFormListener');
    });

    it('attaches submit handler to config form', () => {
        expect(content).toContain("'#admin-config-form'");
        expect(content).toContain("'submit'");
    });

    it('prevents default form submission', () => {
        expect(content).toContain('e.preventDefault()');
    });

    it('calls saveConfig on form submit', () => {
        expect(content).toContain('saveConfig()');
    });

    it('loadConfig re-attaches form listener after render', () => {
        // loadConfig calls attachConfigFormListener after setting innerHTML
        const loadConfigFn = content.substring(
            content.indexOf('export async function loadConfig'),
            content.indexOf('const VALID_OUTPUT_OPTIONS')
        );
        expect(loadConfigFn).toContain('attachConfigFormListener');
    });
});

// ============================================================================
// CSS — config editor form styles
// ============================================================================

describe('CSS — admin config editor styles', () => {
    let css: string;
    beforeAll(() => { css = getClientCssBundle(); });

    it('defines .admin-config-form style', () => {
        expect(css).toContain('.admin-config-form');
    });

    it('defines .admin-config-input style', () => {
        expect(css).toContain('.admin-config-input');
    });

    it('defines .admin-config-input:focus style', () => {
        expect(css).toContain('.admin-config-input:focus');
    });

    it('defines .admin-config-actions style', () => {
        expect(css).toContain('.admin-config-actions');
    });

    it('defines .admin-save-btn style', () => {
        expect(css).toContain('.admin-save-btn');
    });

    it('defines .admin-config-status style', () => {
        expect(css).toContain('.admin-config-status');
    });

    it('defines .admin-config-status-success style', () => {
        expect(css).toContain('.admin-config-status-success');
    });

    it('defines .admin-config-status-error style', () => {
        expect(css).toContain('.admin-config-status-error');
    });

    it('input uses monospace font', () => {
        const inputSection = css.substring(css.indexOf('.admin-config-input'));
        expect(inputSection).toContain('monospace');
    });

    it('save button uses status-running color', () => {
        const btnSection = css.substring(css.indexOf('.admin-save-btn'));
        expect(btnSection).toContain('--status-running');
    });
});

// ============================================================================
// Client bundle — config editor module
// ============================================================================

describe('client bundle — admin config editor', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('includes config form element IDs', () => {
        expect(script).toContain('admin-config-form');
        expect(script).toContain('admin-cfg-model');
        expect(script).toContain('admin-cfg-parallel');
        expect(script).toContain('admin-cfg-timeout');
        expect(script).toContain('admin-cfg-output');
    });

    it('includes save button ID', () => {
        expect(script).toContain('admin-config-save');
    });

    it('includes PUT method for config save', () => {
        expect(script).toContain('PUT');
    });

    it('includes validation messages', () => {
        expect(script).toContain('must be');
    });

    it('includes config status classes', () => {
        expect(script).toContain('admin-config-status-success');
        expect(script).toContain('admin-config-status-error');
    });

    it('includes saveAdminConfig window global', () => {
        expect(script).toContain('saveAdminConfig');
    });
});
