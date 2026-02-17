/**
 * SPA Dashboard Tests — Global Admin Panel
 *
 * Tests for the global admin overlay: HTML structure, source code patterns,
 * bundle integration, styling, and top-bar gear icon.
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

    it('exports showAdmin function', () => {
        const content = readClientFile('admin.ts');
        expect(content).toContain('export function showAdmin');
    });

    it('exports hideAdmin function', () => {
        const content = readClientFile('admin.ts');
        expect(content).toContain('export function hideAdmin');
    });

    it('exports toggleAdmin function', () => {
        const content = readClientFile('admin.ts');
        expect(content).toContain('export function toggleAdmin');
    });

    it('exports formatBytes function', () => {
        const content = readClientFile('admin.ts');
        expect(content).toContain('export function formatBytes');
    });
});

// ============================================================================
// admin.ts — overlay HTML structure
// ============================================================================

describe('global admin — overlay HTML structure', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('generates overlay with id admin-overlay', () => {
        expect(content).toContain("id = 'admin-overlay'");
    });

    it('generates close button with id admin-close-btn', () => {
        expect(content).toContain('id="admin-close-btn"');
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

    it('exposes showAdmin on window', () => {
        expect(content).toContain('(window as any).showAdmin = showAdmin');
    });

    it('exposes hideAdmin on window', () => {
        expect(content).toContain('(window as any).hideAdmin = hideAdmin');
    });

    it('exposes toggleAdmin on window', () => {
        expect(content).toContain('(window as any).toggleAdmin = toggleAdmin');
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
// admin.ts — no browser history manipulation
// ============================================================================

describe('global admin — no browser history', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('admin.ts'); });

    it('does not push to browser history', () => {
        expect(content).not.toContain('history.pushState');
    });

    it('does not use location.hash for admin navigation', () => {
        expect(content).not.toContain('location.hash');
    });
});

// ============================================================================
// HTML template — admin toggle button in top bar
// ============================================================================

describe('HTML template — global admin toggle', () => {
    const html = generateDashboardHtml();

    it('contains admin toggle button in top-bar-right', () => {
        expect(html).toContain('id="admin-toggle"');
    });

    it('admin toggle has gear icon', () => {
        // &#9881; is the gear symbol (⚙)
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

    it('admin toggle appears between workspace-select and theme-toggle', () => {
        const wsIdx = html.indexOf('id="workspace-select"');
        const adminIdx = html.indexOf('id="admin-toggle"');
        const themeIdx = html.indexOf('id="theme-toggle"');
        expect(adminIdx).toBeGreaterThan(wsIdx);
        expect(adminIdx).toBeLessThan(themeIdx);
    });
});

// ============================================================================
// CSS — global admin overlay styles
// ============================================================================

describe('CSS — global admin overlay styles', () => {
    let css: string;
    beforeAll(() => { css = readClientFile('styles.css'); });

    it('defines .admin-overlay style', () => {
        expect(css).toContain('.admin-overlay');
    });

    it('admin overlay uses fixed positioning', () => {
        expect(css).toContain('position: fixed');
    });

    it('admin overlay has z-index above content', () => {
        const match = css.match(/\.admin-overlay\s*\{[^}]*z-index:\s*(\d+)/);
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBeGreaterThanOrEqual(1000);
    });

    it('defines .admin-overlay.hidden style', () => {
        expect(css).toContain('.admin-overlay.hidden');
    });

    it('defines .admin-overlay-content style', () => {
        expect(css).toContain('.admin-overlay-content');
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

    it('defines .admin-close-btn style', () => {
        expect(css).toContain('.admin-close-btn');
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

    it('defines showAdmin function', () => {
        expect(script).toContain('showAdmin');
    });

    it('defines hideAdmin function', () => {
        expect(script).toContain('hideAdmin');
    });

    it('defines toggleAdmin function', () => {
        expect(script).toContain('toggleAdmin');
    });

    it('defines formatBytes function', () => {
        expect(script).toContain('formatBytes');
    });

    it('includes admin overlay element IDs', () => {
        expect(script).toContain('admin-overlay');
        expect(script).toContain('admin-close-btn');
        expect(script).toContain('admin-stats-grid');
        expect(script).toContain('admin-wipe-btn');
    });

    it('includes admin API endpoint patterns', () => {
        expect(script).toContain('/admin/data/stats');
        expect(script).toContain('/admin/data/wipe-token');
    });

    it('registers click handler on admin-toggle', () => {
        expect(script).toContain('admin-toggle');
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
