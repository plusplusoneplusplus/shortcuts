/**
 * SPA Dashboard Tests — CSS Modularization
 *
 * Validates the CSS module structure after splitting styles.css into
 * feature-based modules under styles/. Ensures:
 * - All module files exist on disk
 * - Main entry point (styles.css) imports all modules in correct order
 * - Each module contains expected selectors
 * - Bundle output contains all selectors from all modules
 * - No duplicate :root declarations across modules
 * - Build produces identical output regardless of module structure
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientCssBundle } from './spa-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');
const STYLES_DIR = path.join(CLIENT_DIR, 'styles');

const EXPECTED_MODULES = [
    '_variables.css',
    '_base.css',
    'layout.css',
    'process-history.css',
    'detail-panel.css',
    'queue.css',
    'chat.css',
    'repos.css',
    'tasks.css',
    'admin.css',
    'components.css',
    'mermaid.css',
];

// ============================================================================
// Module file existence
// ============================================================================

describe('CSS module files', () => {
    it('styles/ directory exists', () => {
        expect(fs.existsSync(STYLES_DIR)).toBe(true);
        expect(fs.statSync(STYLES_DIR).isDirectory()).toBe(true);
    });

    for (const mod of EXPECTED_MODULES) {
        it(`styles/${mod} exists and is non-empty`, () => {
            const filePath = path.join(STYLES_DIR, mod);
            expect(fs.existsSync(filePath)).toBe(true);
            const stat = fs.statSync(filePath);
            expect(stat.size).toBeGreaterThan(50);
        });
    }
});

// ============================================================================
// Main entry point (styles.css) — import structure
// ============================================================================

describe('styles.css entry point', () => {
    let entryContent: string;

    beforeAll(() => {
        entryContent = fs.readFileSync(path.join(CLIENT_DIR, 'styles.css'), 'utf8');
    });

    it('contains only @import statements and comments', () => {
        const lines = entryContent.split('\n').filter(l => l.trim() && !l.trim().startsWith('/*') && !l.trim().startsWith('*'));
        for (const line of lines) {
            expect(line.trim()).toMatch(/^@import\s+/);
        }
    });

    it('imports external dependencies first', () => {
        const imports = entryContent.match(/@import\s+'[^']+'/g) || [];
        expect(imports.length).toBeGreaterThanOrEqual(2);
        expect(imports[0]).toContain('wiki-ask.css');
        expect(imports[1]).toContain('wiki-styles.css');
    });

    it('imports foundation modules before feature modules', () => {
        const variablesIdx = entryContent.indexOf('_variables.css');
        const baseIdx = entryContent.indexOf('_base.css');
        const layoutIdx = entryContent.indexOf('layout.css');
        const processHistoryIdx = entryContent.indexOf('process-history.css');

        expect(variablesIdx).toBeLessThan(baseIdx);
        expect(baseIdx).toBeLessThan(layoutIdx);
        expect(layoutIdx).toBeLessThan(processHistoryIdx);
    });

    for (const mod of EXPECTED_MODULES) {
        it(`imports styles/${mod}`, () => {
            expect(entryContent).toContain(mod);
        });
    }
});

// ============================================================================
// _variables.css — theme tokens
// ============================================================================

describe('_variables.css module', () => {
    let content: string;

    beforeAll(() => {
        content = fs.readFileSync(path.join(STYLES_DIR, '_variables.css'), 'utf8');
    });

    it('defines :root with light theme variables', () => {
        expect(content).toContain(':root');
        expect(content).toContain('--bg-primary:');
        expect(content).toContain('--text-primary:');
        expect(content).toContain('--accent:');
        expect(content).toContain('--status-running:');
        expect(content).toContain('--topbar-bg:');
    });

    it('defines dark theme overrides', () => {
        expect(content).toContain('html[data-theme="dark"]');
        expect(content).toContain('--bg-primary: #1e1e1e');
    });

    it('defines wiki content variables', () => {
        expect(content).toContain('--code-bg:');
        expect(content).toContain('--toc-active:');
        expect(content).toContain('--card-bg:');
    });

    it('defines wiki sidebar tokens', () => {
        expect(content).toContain('--sidebar-header-bg:');
        expect(content).toContain('--sidebar-active-text:');
    });
});

// ============================================================================
// _base.css — reset and utilities
// ============================================================================

describe('_base.css module', () => {
    let content: string;

    beforeAll(() => {
        content = fs.readFileSync(path.join(STYLES_DIR, '_base.css'), 'utf8');
    });

    it('has universal box-sizing reset', () => {
        expect(content).toContain('box-sizing: border-box');
    });

    it('has body styles', () => {
        expect(content).toContain('body');
        expect(content).toContain('font-family:');
    });

    it('has .hidden utility class', () => {
        expect(content).toContain('.hidden');
        expect(content).toContain('display: none !important');
    });

    it('has scrollbar styles', () => {
        expect(content).toContain('::-webkit-scrollbar');
    });

    it('has spin keyframe animation', () => {
        expect(content).toContain('@keyframes spin');
    });
});

// ============================================================================
// layout.css — app structure
// ============================================================================

describe('layout.css module', () => {
    let content: string;

    beforeAll(() => {
        content = fs.readFileSync(path.join(STYLES_DIR, 'layout.css'), 'utf8');
    });

    it('has top bar styles', () => {
        expect(content).toContain('.top-bar');
        expect(content).toContain('.top-bar-left');
        expect(content).toContain('.top-bar-btn');
    });

    it('has app layout grid', () => {
        expect(content).toContain('.app-layout');
        expect(content).toContain('grid-template-columns');
    });

    it('has sidebar styles', () => {
        expect(content).toContain('.sidebar');
        expect(content).toContain('.filter-bar');
    });

    it('has empty state styles', () => {
        expect(content).toContain('.empty-state');
    });

    it('has responsive media query', () => {
        expect(content).toContain('@media (max-width: 768px)');
    });

    it('has top bar tabs', () => {
        expect(content).toContain('.top-bar-tabs');
        expect(content).toContain('.top-bar-tab');
    });
});

// ============================================================================
// Feature module selectors — spot checks
// ============================================================================

describe('process-history.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'process-history.css'), 'utf8'); });

    it('has process list and item styles', () => {
        expect(content).toContain('.process-list');
        expect(content).toContain('.process-item');
        expect(content).toContain('.status-dot');
    });

    it('has status group headers', () => {
        expect(content).toContain('.status-group-header');
    });

    it('has history items', () => {
        expect(content).toContain('.history-item');
        expect(content).toContain('.history-loading-spinner');
    });
});

describe('detail-panel.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'detail-panel.css'), 'utf8'); });

    it('has detail panel and chat layout', () => {
        expect(content).toContain('.detail-panel');
        expect(content).toContain('.detail-panel.chat-layout');
    });

    it('has metadata grid', () => {
        expect(content).toContain('.meta-grid');
    });

    it('has result section and markdown rendering', () => {
        expect(content).toContain('.result-section');
        expect(content).toContain('.result-body');
        expect(content).toContain('.result-body h1');
    });

    it('has error alert', () => {
        expect(content).toContain('.error-alert');
    });

    it('has code block enhancements', () => {
        expect(content).toContain('.code-block-container');
        expect(content).toContain('.code-block-header');
        expect(content).toContain('.code-line');
    });

    it('has markdown span-based rendering styles', () => {
        expect(content).toContain('.md-h1');
        expect(content).toContain('.md-blockquote');
        expect(content).toContain('.md-inline-code');
    });
});

describe('queue.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'queue.css'), 'utf8'); });

    it('has queue panel styles', () => {
        expect(content).toContain('.queue-panel');
        expect(content).toContain('.queue-header');
        expect(content).toContain('.queue-task');
    });

    it('has enqueue dialog', () => {
        expect(content).toContain('.enqueue-overlay');
        expect(content).toContain('.enqueue-dialog');
    });

    it('has queue drain banner', () => {
        expect(content).toContain('.queue-drain-banner');
    });
});

describe('chat.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'chat.css'), 'utf8'); });

    it('has chat message bubbles', () => {
        expect(content).toContain('.chat-message');
        expect(content).toContain('.chat-message.user');
        expect(content).toContain('.chat-message.assistant');
    });

    it('has chat input bar', () => {
        expect(content).toContain('.chat-input-bar');
        expect(content).toContain('.send-btn');
    });

    it('has streaming state', () => {
        expect(content).toContain('.chat-message.streaming');
        expect(content).toContain('.typing-cursor');
    });

    it('has scroll to bottom button', () => {
        expect(content).toContain('.scroll-to-bottom');
    });
});

describe('repos.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'repos.css'), 'utf8'); });

    it('has repos sidebar', () => {
        expect(content).toContain('.repos-sidebar');
        expect(content).toContain('.repo-item');
    });

    it('has path browser', () => {
        expect(content).toContain('.path-browser');
        expect(content).toContain('.breadcrumb-segment');
    });

    it('has repo groups', () => {
        expect(content).toContain('.repo-group');
        expect(content).toContain('.repo-group-header');
    });

    it('has repo validation styles', () => {
        expect(content).toContain('.repo-validation');
    });
});

describe('tasks.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'tasks.css'), 'utf8'); });

    it('has task tree styles', () => {
        expect(content).toContain('.tasks-tree');
        expect(content).toContain('.task-tree-row');
    });

    it('has miller columns', () => {
        expect(content).toContain('.miller-columns');
        expect(content).toContain('.miller-column');
    });

    it('has task context menu', () => {
        expect(content).toContain('.task-context-menu');
    });

    it('has AI action dropdown', () => {
        expect(content).toContain('.ai-action-dropdown');
    });

    it('has drag and drop styles', () => {
        expect(content).toContain('.miller-row-drop-target');
    });
});

describe('admin.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'admin.css'), 'utf8'); });

    it('has admin page layout', () => {
        expect(content).toContain('.admin-page');
        expect(content).toContain('.admin-page-header');
    });

    it('has admin stats grid', () => {
        expect(content).toContain('.admin-stats-grid');
        expect(content).toContain('.admin-stat-card');
    });

    it('has danger zone', () => {
        expect(content).toContain('.admin-danger-zone');
    });

    it('has config section', () => {
        expect(content).toContain('.admin-config-table');
        expect(content).toContain('.admin-config-input');
    });

    it('has export/import sections', () => {
        expect(content).toContain('.admin-export-btn');
        expect(content).toContain('.admin-import-btn');
    });
});

describe('components.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'components.css'), 'utf8'); });

    it('has toast notifications', () => {
        expect(content).toContain('.toast');
        expect(content).toContain('.toast-success');
        expect(content).toContain('.toast-error');
    });

    it('has tool call cards', () => {
        expect(content).toContain('.tool-call-card');
        expect(content).toContain('.tool-call-header');
        expect(content).toContain('.tool-call-body');
    });

    it('has tool call status badges', () => {
        expect(content).toContain('.tool-call-status.running');
        expect(content).toContain('.tool-call-status.completed');
        expect(content).toContain('.tool-call-status.failed');
    });

    it('has grouped tool calls', () => {
        expect(content).toContain('.tool-call-group');
        expect(content).toContain('.tool-call-group-item');
    });

    it('has writeback toast', () => {
        expect(content).toContain('.writeback-toast');
    });
});

describe('mermaid.css module', () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(path.join(STYLES_DIR, 'mermaid.css'), 'utf8'); });

    it('has mermaid container', () => {
        expect(content).toContain('.mermaid-container');
    });

    it('has mermaid toolbar', () => {
        expect(content).toContain('.task-mermaid-toolbar');
        expect(content).toContain('.task-mermaid-btn');
    });

    it('has mermaid viewport for zoom/pan', () => {
        expect(content).toContain('.task-mermaid-viewport');
        expect(content).toContain('cursor: grab');
    });

    it('has source view', () => {
        expect(content).toContain('.task-mermaid-source-view');
    });

    it('has dark theme overrides', () => {
        expect(content).toContain('[data-theme="dark"]');
    });
});

// ============================================================================
// Bundle integrity — all modules present in output
// ============================================================================

describe('bundle.css integrity', () => {
    let bundle: string;

    beforeAll(() => {
        bundle = getClientCssBundle();
    });

    it('bundle is non-empty', () => {
        expect(bundle.length).toBeGreaterThan(10000);
    });

    it('contains :root variables from _variables.css', () => {
        expect(bundle).toContain(':root');
        expect(bundle).toContain('--bg-primary:');
        expect(bundle).toContain('--accent:');
    });

    it('contains base reset from _base.css', () => {
        expect(bundle).toContain('box-sizing: border-box');
    });

    it('contains layout from layout.css', () => {
        expect(bundle).toContain('.top-bar');
        expect(bundle).toContain('.app-layout');
    });

    it('contains process-history from process-history.css', () => {
        expect(bundle).toContain('.process-item');
        expect(bundle).toContain('.status-dot');
    });

    it('contains detail-panel from detail-panel.css', () => {
        expect(bundle).toContain('.detail-panel');
        expect(bundle).toContain('.meta-grid');
    });

    it('contains queue from queue.css', () => {
        expect(bundle).toContain('.queue-panel');
        expect(bundle).toContain('.enqueue-dialog');
    });

    it('contains chat from chat.css', () => {
        expect(bundle).toContain('.chat-message');
        expect(bundle).toContain('.chat-input-bar');
    });

    it('contains repos from repos.css', () => {
        expect(bundle).toContain('.repos-sidebar');
        expect(bundle).toContain('.path-browser');
    });

    it('contains tasks from tasks.css', () => {
        expect(bundle).toContain('.tasks-tree');
        expect(bundle).toContain('.miller-columns');
    });

    it('contains admin from admin.css', () => {
        expect(bundle).toContain('.admin-page');
        expect(bundle).toContain('.admin-danger-zone');
    });

    it('contains components from components.css', () => {
        expect(bundle).toContain('.tool-call-card');
        expect(bundle).toContain('.toast');
    });

    it('contains mermaid from mermaid.css', () => {
        expect(bundle).toContain('.mermaid-container');
        expect(bundle).toContain('.task-mermaid-viewport');
    });

    it('contains wiki-ask.css styles', () => {
        expect(bundle).toContain('.wiki-ask');
    });

    it('contains wiki-styles.css styles', () => {
        expect(bundle).toContain('.wiki-article');
    });

    it('task-comments-styles.css removed (migrated to Tailwind)', () => {
        // task-comments-styles.css was replaced by Tailwind classes in React components
        expect(bundle).not.toContain('.task-comment-count-badge');
    });
});

// ============================================================================
// No duplicate :root declarations (only _variables.css should define :root)
// ============================================================================

describe('CSS module isolation', () => {
    it('only _variables.css defines :root', () => {
        for (const mod of EXPECTED_MODULES) {
            if (mod === '_variables.css') continue;
            const content = fs.readFileSync(path.join(STYLES_DIR, mod), 'utf8');
            expect(content).not.toMatch(/^:root\s*\{/m);
        }
    });

    it('only _variables.css defines html[data-theme] variable overrides', () => {
        for (const mod of EXPECTED_MODULES) {
            if (mod === '_variables.css') continue;
            const content = fs.readFileSync(path.join(STYLES_DIR, mod), 'utf8');
            const hasThemeVarOverride = /html\[data-theme[^\]]*\]\s*\{[^}]*--[a-z]/.test(content);
            expect(hasThemeVarOverride).toBe(false);
        }
    });

    it('no module imports other modules (imports only in styles.css)', () => {
        for (const mod of EXPECTED_MODULES) {
            const content = fs.readFileSync(path.join(STYLES_DIR, mod), 'utf8');
            expect(content).not.toContain('@import');
        }
    });
});
