/**
 * SPA Dashboard Tests — Global Admin Page
 *
 * Tests for the global admin dedicated page (#admin): HTML structure, source code
 * patterns, bundle integration, styling, routing, and top-bar gear icon.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';
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
    beforeAll(() => { css = readClientFile('styles.css'); });

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

    it('admin page uses max-width for content', () => {
        const match = css.match(/\.admin-page\s*\{[^}]*max-width/);
        expect(match).not.toBeNull();
    });

    it('admin page uses auto margin for centering', () => {
        const match = css.match(/\.admin-page\s*\{[^}]*margin:\s*0\s+auto/);
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

    it('admin toggle has different id than wiki-admin-toggle', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="admin-toggle"');
        expect(html).toContain('id="wiki-admin-toggle"');
    });
});
