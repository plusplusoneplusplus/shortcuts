/**
 * SPA Dashboard Tests — Wiki Admin Panel
 *
 * Tests for the wiki admin panel: HTML structure, source code patterns,
 * bundle integration, styling, and URL routing.
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
// Wiki admin source file exists
// ============================================================================

describe('wiki-admin client source file', () => {
    it('should have client/wiki-admin.ts', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'wiki-admin.ts'))).toBe(true);
    });

    it('exports showWikiAdmin function', () => {
        const content = readClientFile('wiki-admin.ts');
        expect(content).toContain('export function showWikiAdmin');
    });

    it('exports hideWikiAdmin function', () => {
        const content = readClientFile('wiki-admin.ts');
        expect(content).toContain('export function hideWikiAdmin');
    });

    it('exports resetAdminState function', () => {
        const content = readClientFile('wiki-admin.ts');
        expect(content).toContain('export function resetAdminState');
    });

    it('exports renderAdminPanel function', () => {
        const content = readClientFile('wiki-admin.ts');
        expect(content).toContain('export function renderAdminPanel');
    });

    it('exports formatDuration function', () => {
        const content = readClientFile('wiki-admin.ts');
        expect(content).toContain('export function formatDuration');
    });

    it('exports runComponentRegenFromAdmin function', () => {
        const content = readClientFile('wiki-admin.ts');
        expect(content).toContain('export async function runComponentRegenFromAdmin');
    });
});

// ============================================================================
// Admin panel renders within wiki view
// ============================================================================

describe('wiki-admin — renderAdminPanel HTML structure', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('generates admin panel container with id wiki-admin-panel', () => {
        expect(content).toContain('id="wiki-admin-panel"');
    });

    it('generates seeds tab content', () => {
        expect(content).toContain('id="admin-content-seeds"');
    });

    it('generates config tab content', () => {
        expect(content).toContain('id="admin-content-config"');
    });

    it('generates generate tab content', () => {
        expect(content).toContain('id="admin-content-generate"');
    });

    it('generates seeds editor textarea', () => {
        expect(content).toContain('id="seeds-editor"');
    });

    it('generates config editor textarea', () => {
        expect(content).toContain('id="config-editor"');
    });

    it('generates seeds save and reset buttons', () => {
        expect(content).toContain('id="seeds-save"');
        expect(content).toContain('id="seeds-reset"');
    });

    it('generates config save and reset buttons', () => {
        expect(content).toContain('id="config-save"');
        expect(content).toContain('id="config-reset"');
    });

    it('generates back button', () => {
        expect(content).toContain('id="wiki-admin-back"');
    });

    it('generates 5 phase cards', () => {
        expect(content).toContain('id="phase-card-${i}"');
    });

    it('generates 5 phase run buttons', () => {
        expect(content).toContain('id="phase-run-${i}"');
    });

    it('generates 5 phase cache badges', () => {
        expect(content).toContain('id="phase-cache-${i}"');
    });

    it('generates 5 phase logs', () => {
        expect(content).toContain('id="phase-log-${i}"');
    });

    it('generates force checkbox', () => {
        expect(content).toContain('id="generate-force"');
    });

    it('generates range controls', () => {
        expect(content).toContain('id="generate-start-phase"');
        expect(content).toContain('id="generate-end-phase"');
        expect(content).toContain('id="generate-run-range"');
    });

    it('generates status bar', () => {
        expect(content).toContain('id="generate-status-bar"');
    });

    it('generates unavailable warning', () => {
        expect(content).toContain('id="generate-unavailable"');
    });

    it('generates phase 4 component list toggle', () => {
        expect(content).toContain('id="phase4-component-toggle"');
    });

    it('generates phase 4 component list container', () => {
        expect(content).toContain('id="phase4-component-list"');
    });
});

// ============================================================================
// Seeds validation — JSON parse before save
// ============================================================================

describe('wiki-admin — seeds save validates JSON', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('calls JSON.parse on seeds editor text', () => {
        expect(content).toContain('JSON.parse(text)');
    });

    it('shows Invalid JSON error on parse failure', () => {
        expect(content).toContain('Invalid JSON');
    });
});

// ============================================================================
// Config save sends raw YAML string
// ============================================================================

describe('wiki-admin — config save sends raw text', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('saves config as raw text content', () => {
        // Config save sends { content: text } (raw YAML, no parsing)
        expect(content).toContain("JSON.stringify({ content: text })");
    });
});

// ============================================================================
// URL routing includes wikiId in all API calls
// ============================================================================

describe('wiki-admin — wikiId-scoped API URLs', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('seeds load uses /wikis/ wikiId-scoped path', () => {
        expect(content).toContain("'/wikis/' + encodeURIComponent(wikiId) + '/admin/seeds'");
    });

    it('seeds save uses /wikis/ wikiId-scoped path', () => {
        expect(content).toContain("'/wikis/' + encodeURIComponent(wikiId) + '/admin/seeds'");
    });

    it('config load uses /wikis/ wikiId-scoped path', () => {
        expect(content).toContain("'/wikis/' + encodeURIComponent(wikiId) + '/admin/config'");
    });

    it('config save uses /wikis/ wikiId-scoped path', () => {
        expect(content).toContain("'/wikis/' + encodeURIComponent(wikiId) + '/admin/config'");
    });

    it('generate status uses /wikis/ wikiId-scoped path', () => {
        expect(content).toContain("'/wikis/' + encodeURIComponent(wikiId) + '/admin/generate/status'");
    });

    it('generate POST uses /wikis/ wikiId-scoped path', () => {
        expect(content).toContain("'/wikis/' + encodeURIComponent(wikiId) + '/admin/generate'");
    });

    it('cancel uses /wikis/ wikiId-scoped path', () => {
        expect(content).toContain("'/wikis/' + encodeURIComponent(wikiId) + '/admin/generate/cancel'");
    });

    it('component regen uses /wikis/ wikiId-scoped path', () => {
        expect(content).toContain("'/wikis/' + encodeURIComponent(wikiId) + '/admin/generate/component/'");
    });
});

// ============================================================================
// Admin state resets when switching wiki
// ============================================================================

describe('wiki-admin — state reset on wiki switch', () => {
    let adminContent: string;
    let wikiContent: string;
    beforeAll(() => {
        adminContent = readClientFile('wiki-admin.ts');
        wikiContent = readClientFile('wiki.ts');
    });

    it('resetAdminState clears seeds original', () => {
        expect(adminContent).toContain("adminSeedsOriginal = ''");
    });

    it('resetAdminState clears config original', () => {
        expect(adminContent).toContain("adminConfigOriginal = ''");
    });

    it('resetAdminState clears initialized flag', () => {
        expect(adminContent).toContain('adminInitialized = false');
    });

    it('resetAdminState clears running flag', () => {
        expect(adminContent).toContain('generateRunning = false');
    });

    it('resetAdminState clears currentAdminWikiId', () => {
        expect(adminContent).toContain('currentAdminWikiId = null');
    });

    it('wiki.ts imports resetAdminState', () => {
        expect(wikiContent).toContain('resetAdminState');
    });

    it('wiki.ts calls resetAdminState on wiki selection', () => {
        expect(wikiContent).toContain('resetAdminState()');
    });

    it('wiki.ts calls hideWikiAdmin on wiki selection', () => {
        expect(wikiContent).toContain('hideWikiAdmin()');
    });
});

// ============================================================================
// Admin panel only accessible when wiki is selected
// ============================================================================

describe('wiki-admin — toggle visibility', () => {
    let wikiContent: string;
    beforeAll(() => { wikiContent = readClientFile('wiki.ts'); });

    it('gear icon on cards calls showWikiAdmin', () => {
        expect(wikiContent).toContain('wiki-card-gear');
        expect(wikiContent).toContain('showWikiAdmin(wikiId)');
    });

    it('detail view has gear icon for admin access', () => {
        expect(wikiContent).toContain('wiki-detail-gear');
    });

    it('admin toggle click calls showWikiAdmin with selected wikiId', () => {
        expect(wikiContent).toContain('showWikiAdmin(appState.selectedWikiId)');
    });
});

// ============================================================================
// Generate tab — range validation
// ============================================================================

describe('wiki-admin — range validation (end >= start)', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('validates end phase >= start phase', () => {
        expect(content).toContain('endPhase < startPhase');
    });

    it('shows alert on invalid range', () => {
        expect(content).toContain('End phase must be >= start phase');
    });
});

// ============================================================================
// formatDuration utility
// ============================================================================

describe('wiki-admin — formatDuration', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('handles milliseconds', () => {
        expect(content).toContain("ms + 'ms'");
    });

    it('handles seconds', () => {
        expect(content).toContain("seconds + 's'");
    });

    it('handles minutes and seconds', () => {
        expect(content).toContain("minutes + 'm '");
    });
});

// ============================================================================
// SSE event handling
// ============================================================================

describe('wiki-admin — SSE event types', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('handles status events', () => {
        expect(content).toContain("case 'status':");
    });

    it('handles log events', () => {
        expect(content).toContain("case 'log':");
    });

    it('handles progress events', () => {
        expect(content).toContain("case 'progress':");
    });

    it('handles phase-complete events', () => {
        expect(content).toContain("case 'phase-complete':");
    });

    it('handles error events', () => {
        expect(content).toContain("case 'error':");
    });

    it('handles done events', () => {
        expect(content).toContain("case 'done':");
    });

    it('parses SSE data lines', () => {
        expect(content).toContain("line.startsWith('data: ')");
    });

    it('uses getReader for SSE streaming', () => {
        expect(content).toContain('response.body!.getReader()');
    });

    it('handles 409 conflict response', () => {
        expect(content).toContain('response.status === 409');
        expect(content).toContain('Generation already in progress');
    });
});

// ============================================================================
// Client bundle — wiki-admin module
// ============================================================================

describe('client bundle — wiki-admin module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines showWikiAdmin function', () => {
        expect(script).toContain('showWikiAdmin');
    });

    it('defines hideWikiAdmin function', () => {
        expect(script).toContain('hideWikiAdmin');
    });

    it('defines resetAdminState function', () => {
        expect(script).toContain('resetAdminState');
    });

    it('defines renderAdminPanel function', () => {
        expect(script).toContain('renderAdminPanel');
    });

    it('defines formatDuration function', () => {
        expect(script).toContain('formatDuration');
    });

    it('defines runComponentRegenFromAdmin function', () => {
        expect(script).toContain('runComponentRegenFromAdmin');
    });

    it('includes admin panel element IDs', () => {
        expect(script).toContain('wiki-admin-panel');
        expect(script).toContain('seeds-editor');
        expect(script).toContain('config-editor');
        expect(script).toContain('generate-force');
    });

    it('includes admin API endpoint patterns', () => {
        expect(script).toContain('/admin/seeds');
        expect(script).toContain('/admin/config');
        expect(script).toContain('/admin/generate');
    });

    it('exposes showWikiAdmin on window', () => {
        expect(script).toContain('showWikiAdmin');
    });

    it('exposes hideWikiAdmin on window', () => {
        expect(script).toContain('hideWikiAdmin');
    });
});

// ============================================================================
// HTML template — admin toggle button
// ============================================================================

describe('HTML template — wiki admin access', () => {
    const html = generateDashboardHtml();

    it('wiki sidebar header contains add button', () => {
        expect(html).toContain('wiki-sidebar-add-btn');
    });

    it('wiki sidebar has card list container for gear icons', () => {
        expect(html).toContain('wiki-card-list');
    });

    it('contains gear icon entity in bundle', () => {
        expect(html).toContain('&#9881;');
    });

    it('wiki admin toggle button CSS is still defined', () => {
        expect(html).toContain('.wiki-admin-toggle-btn');
    });
});

// ============================================================================
// CSS — wiki admin styles
// ============================================================================

describe('CSS — wiki admin styles', () => {
    const css = readClientFile('styles.css') + readClientFile('wiki-styles.css');

    it('defines wiki-admin-toggle-btn style', () => {
        expect(css).toContain('.wiki-admin-toggle-btn');
    });

    it('defines admin-page style', () => {
        expect(css).toContain('.admin-page');
    });

    it('defines admin-page hidden style', () => {
        expect(css).toContain('.admin-page.hidden');
    });

    it('defines admin-tabs style', () => {
        expect(css).toContain('.admin-tabs');
    });

    it('defines admin-tab active style', () => {
        expect(css).toContain('.admin-tab.active');
    });

    it('defines admin-editor style', () => {
        expect(css).toContain('.admin-editor');
    });

    it('defines admin-btn-save style', () => {
        expect(css).toContain('.admin-btn-save');
    });

    it('defines admin-btn-reset style', () => {
        expect(css).toContain('.admin-btn-reset');
    });

    it('defines admin-file-status success and error', () => {
        expect(css).toContain('.admin-file-status.success');
        expect(css).toContain('.admin-file-status.error');
    });

    it('defines generate-phase-card style', () => {
        expect(css).toContain('.generate-phase-card');
    });

    it('defines phase-running animation', () => {
        expect(css).toContain('.phase-running');
        expect(css).toContain('@keyframes phase-pulse');
    });

    it('defines phase-success style', () => {
        expect(css).toContain('.phase-success');
    });

    it('defines phase-error style', () => {
        expect(css).toContain('.phase-error');
    });

    it('defines phase-cache-badge variants', () => {
        expect(css).toContain('.phase-cache-badge.cached');
        expect(css).toContain('.phase-cache-badge.missing');
    });

    it('defines phase-log style', () => {
        expect(css).toContain('.phase-log');
    });

    it('defines generate-status-bar variants', () => {
        expect(css).toContain('.generate-status-bar');
        expect(css).toContain('.generate-status-bar.success');
        expect(css).toContain('.generate-status-bar.error');
    });

    it('defines generate-range-controls style', () => {
        expect(css).toContain('.generate-range-controls');
    });

    it('defines generate-unavailable style', () => {
        expect(css).toContain('.generate-unavailable');
    });

    it('defines phase-component-list styles', () => {
        expect(css).toContain('.phase-component-list');
        expect(css).toContain('.phase-component-row');
        expect(css).toContain('.phase-component-run-btn');
        expect(css).toContain('.phase-component-log');
    });

    it('defines phase-component-list-toggle style', () => {
        expect(css).toContain('.phase-component-list-toggle');
    });

    it('includes responsive admin styles', () => {
        expect(css).toContain('.admin-page-header { padding: 20px 16px 0; }');
    });
});

// ============================================================================
// index.ts — wiki-admin import
// ============================================================================

describe('index.ts — wiki-admin import', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('index.ts'); });

    it('imports wiki-admin module', () => {
        expect(content).toContain("import './wiki-admin'");
    });

    it('wiki-admin import is in wiki section', () => {
        const wikiIdx = content.indexOf("import './wiki'");
        const adminIdx = content.indexOf("import './wiki-admin'");
        const wsIdx = content.indexOf("import './websocket'");
        expect(adminIdx).toBeGreaterThan(wikiIdx);
        expect(adminIdx).toBeLessThan(wsIdx);
    });
});

// ============================================================================
// wiki.ts — admin integration
// ============================================================================

describe('wiki.ts — admin imports and integration', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('imports showWikiAdmin from wiki-admin', () => {
        expect(content).toContain("import { showWikiAdmin, hideWikiAdmin, resetAdminState } from './wiki-admin'");
    });

    it('has admin gear event listener in detail view', () => {
        expect(content).toContain("document.getElementById('wiki-detail-gear')");
    });

    it('resets admin state on wiki deselection', () => {
        // When wikiId is empty, should reset and hide admin
        expect(content).toContain('hideWikiAdmin()');
        expect(content).toContain('resetAdminState()');
    });
});

// ============================================================================
// Component regen from admin — uses data attributes (not inline onclick)
// ============================================================================

describe('wiki-admin — component regen uses data attributes', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('uses data-component-id attribute for component buttons', () => {
        expect(content).toContain('data-component-id');
    });

    it('attaches click handlers via addEventListener', () => {
        // Should use addEventListener, not inline onclick for component buttons
        expect(content).toContain("btn.addEventListener('click'");
    });
});

// ============================================================================
// No browser history manipulation
// ============================================================================

describe('wiki-admin — no browser history', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('does not push to browser history', () => {
        expect(content).not.toContain('history.pushState');
    });

    it('does not use location.hash for admin navigation', () => {
        expect(content).not.toContain('#admin');
    });
});

// ============================================================================
// wiki-admin uses CoC patterns
// ============================================================================

describe('wiki-admin — uses CoC patterns', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('imports fetchApi from core', () => {
        expect(content).toContain("import { fetchApi } from './core'");
    });

    it('imports getApiBase from config', () => {
        expect(content).toContain("import { getApiBase } from './config'");
    });

    it('imports escapeHtmlClient from utils', () => {
        expect(content).toContain("import { escapeHtmlClient } from './utils'");
    });

    it('imports wikiState from wiki-content', () => {
        expect(content).toContain("import { wikiState } from './wiki-content'");
    });

    it('uses wikiState.graph for component name resolution', () => {
        expect(content).toContain('wikiState.graph');
    });
});

// ============================================================================
// wiki-admin — full-width layout (injected into #view-wiki, not #wiki-content)
// ============================================================================

describe('wiki-admin — full-width admin layout', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-admin.ts'); });

    it('injects admin panel into #view-wiki (top-level container)', () => {
        expect(content).toContain("document.getElementById('view-wiki')");
    });

    it('does not inject admin panel into #wiki-content', () => {
        // showWikiAdmin should not reference wiki-content for injection
        const showFn = content.substring(
            content.indexOf('export function showWikiAdmin'),
            content.indexOf('export function hideWikiAdmin')
        );
        expect(showFn).not.toContain("getElementById('wiki-content')");
    });

    it('hides .wiki-layout when showing admin', () => {
        expect(content).toContain("#view-wiki .wiki-layout");
        expect(content).toContain("wikiLayout.classList.add('hidden')");
    });

    it('hides wiki-ask-widget when showing admin', () => {
        expect(content).toContain("getElementById('wiki-ask-widget')");
        expect(content).toContain("askWidget.classList.add('hidden')");
    });

    it('restores .wiki-layout when hiding admin', () => {
        expect(content).toContain("wikiLayout.classList.remove('hidden')");
    });

    it('restores wiki-ask-widget when hiding admin', () => {
        expect(content).toContain("askWidget.classList.remove('hidden')");
    });
});

// ============================================================================
// CSS — full-width admin layout styles
// ============================================================================

describe('CSS — wiki admin full-width layout', () => {
    const css = readClientFile('wiki-styles.css');

    it('defines .wiki-layout.hidden to hide the grid', () => {
        expect(css).toContain('.wiki-layout.hidden');
    });

    it('admin-section uses full width (no max-width: 900px)', () => {
        // Ensure admin-section is not constrained to 900px
        const sectionRule = css.match(/\.admin-section\s*\{[^}]*\}/);
        expect(sectionRule).toBeTruthy();
        expect(sectionRule![0]).not.toContain('900px');
        expect(sectionRule![0]).toContain('max-width: 100%');
    });

    it('admin-page uses full viewport height', () => {
        const pageRule = css.match(/\.admin-page\s*\{[^}]*\}/);
        expect(pageRule).toBeTruthy();
        expect(pageRule![0]).toContain('calc(100vh');
    });
});
