/**
 * SPA Dashboard Tests — CSS styles (via generateDashboardHtml)
 */

import { describe, it, expect } from 'vitest';
import { generateDashboardHtml } from './spa-test-helpers';

describe('Bundled CSS — via generateDashboardHtml', () => {
    const html = generateDashboardHtml();

    it('defines CSS custom properties for light theme', () => {
        expect(html).toContain('--bg-primary:');
        expect(html).toContain('--text-primary:');
        expect(html).toContain('--accent:');
    });

    it('defines dark theme overrides', () => {
        expect(html).toContain('data-theme');
        expect(html).toContain('dark');
    });

    it('defines status colors', () => {
        expect(html).toContain('--status-running');
        expect(html).toContain('--status-completed');
        expect(html).toContain('--status-failed');
    });

    it('defines responsive breakpoint', () => {
        expect(html).toContain('@media');
    });

    it('defines status badge styles', () => {
        expect(html).toContain('.status-badge');
    });

    it('defines process item styles', () => {
        expect(html).toContain('.process-item');
    });

    it('defines queue panel styles', () => {
        expect(html).toContain('.queue-panel');
        expect(html).toContain('.queue-header');
        expect(html).toContain('.queue-task');
    });

    it('defines enqueue dialog styles', () => {
        expect(html).toContain('.enqueue-overlay');
        expect(html).toContain('.enqueue-dialog');
    });

    it('defines conversation section styles', () => {
        expect(html).toContain('.conversation-section');
        expect(html).toContain('.streaming-indicator');
    });

    it('defines markdown result styles', () => {
        expect(html).toContain('.result-body');
    });

    it('does not define prompt-section styles (prompt shown in conversation bubbles)', () => {
        expect(html).not.toContain('.prompt-section');
    });

    it('detail-content uses full width without max-width constraint', () => {
        const detailStart = html.indexOf('.detail-content {');
        expect(detailStart).toBeGreaterThan(-1);
        const detailEnd = html.indexOf('}', detailStart);
        const detailRule = html.substring(detailStart, detailEnd + 1);
        expect(detailRule).not.toContain('max-width: 800px');
        expect(detailRule).toContain('max-width: none');
    });
});

describe('Unified design tokens — wiki variables', () => {
    const html = generateDashboardHtml();

    it('defines wiki sidebar detail tokens in light theme', () => {
        expect(html).toContain('--sidebar-header-bg:');
        expect(html).toContain('--sidebar-border:');
        expect(html).toContain('--sidebar-text:');
        expect(html).toContain('--sidebar-muted:');
        expect(html).toContain('--sidebar-active-bg:');
        expect(html).toContain('--sidebar-active-text:');
        expect(html).toContain('--sidebar-active-border:');
    });

    it('defines wiki header and search tokens', () => {
        expect(html).toContain('--header-bg:');
        expect(html).toContain('--header-shadow:');
        expect(html).toContain('--search-bg:');
        expect(html).toContain('--search-text:');
        expect(html).toContain('--search-placeholder:');
    });

    it('defines ask bar and topbar muted tokens', () => {
        expect(html).toContain('--ask-bar-bg:');
        expect(html).toContain('--ask-bar-border:');
        expect(html).toContain('--topbar-muted:');
    });

    it('defines content-bg-rgb for rgba() usage', () => {
        expect(html).toContain('--content-bg-rgb:');
    });

    it('defines alias variables for wiki component compatibility', () => {
        expect(html).toContain('--content-bg: var(--bg-primary)');
        expect(html).toContain('--content-text: var(--text-primary)');
        expect(html).toContain('--sidebar-bg: var(--bg-sidebar)');
        expect(html).toContain('--sidebar-hover: var(--hover-bg)');
    });

    it('preserves all existing CoC base tokens', () => {
        expect(html).toContain('--bg-primary:');
        expect(html).toContain('--bg-secondary:');
        expect(html).toContain('--bg-sidebar:');
        expect(html).toContain('--text-primary:');
        expect(html).toContain('--text-secondary:');
        expect(html).toContain('--border-color:');
        expect(html).toContain('--accent:');
        expect(html).toContain('--hover-bg:');
        expect(html).toContain('--active-bg:');
    });
});

describe('Chat bubble CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines chat message bubble styles', () => {
        expect(html).toContain('.chat-message');
        expect(html).toContain('.chat-message.user');
        expect(html).toContain('.chat-message.assistant');
    });

    it('defines user bubble with accent background and right alignment', () => {
        expect(html).toContain('align-self: flex-end');
        expect(html).toContain('var(--active-bg)');
    });

    it('defines assistant bubble with primary background and left alignment', () => {
        expect(html).toContain('align-self: flex-start');
    });

    it('defines chat message header with role icon and timestamp', () => {
        expect(html).toContain('.chat-message-header');
        expect(html).toContain('.chat-message-header .role-icon');
        expect(html).toContain('.chat-message-header .timestamp');
    });

    it('defines chat message content styles', () => {
        expect(html).toContain('.chat-message-content');
    });

    it('defines chat input bar styles', () => {
        expect(html).toContain('.chat-input-bar');
        expect(html).toContain('.chat-input-bar textarea');
        expect(html).toContain('.chat-input-bar .send-btn');
    });

    it('defines input bar disabled state', () => {
        expect(html).toContain('.chat-input-bar.disabled textarea');
        expect(html).toContain('.chat-input-bar.disabled .send-btn');
    });

    it('defines streaming state per-bubble', () => {
        expect(html).toContain('.chat-message.streaming');
        expect(html).toContain('var(--status-running)');
    });

    it('defines typing cursor with blink animation', () => {
        expect(html).toContain('.typing-cursor');
        expect(html).toContain('@keyframes blink');
    });

    it('defines collapsible metadata styles', () => {
        expect(html).toContain('.meta-collapse');
        expect(html).toContain('.meta-collapse.expanded');
        expect(html).toContain('.meta-collapse .meta-grid');
        expect(html).toContain('.meta-collapse.expanded .meta-grid');
    });

    it('defines scroll-to-bottom button styles', () => {
        expect(html).toContain('.scroll-to-bottom');
        expect(html).toContain('.scroll-to-bottom.visible');
    });

    it('converts conversation-body to flex column layout', () => {
        expect(html).toContain('flex-direction: column');
        expect(html).toContain('gap: 12px');
    });

    it('removes white-space: pre-wrap from conversation-body', () => {
        // Extract the .conversation-body rule and verify no white-space: pre-wrap
        const bodyStart = html.indexOf('.conversation-body {');
        const bodyEnd = html.indexOf('}', bodyStart);
        const bodyRule = html.substring(bodyStart, bodyEnd + 1);
        expect(bodyRule).not.toContain('white-space: pre-wrap');
    });

    it('defines responsive chat styles at 768px breakpoint', () => {
        expect(html).toContain('.chat-message {');
        expect(html).toContain('max-width: 95%');
        expect(html).toContain('.chat-input-bar .send-btn {');
    });
});

describe('Repos sidebar CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines repos sidebar styles', () => {
        expect(html).toContain('.repos-sidebar');
        expect(html).toContain('.repos-sidebar-header');
    });

    it('defines repos list styles', () => {
        expect(html).toContain('.repos-list');
    });

    it('defines repo item styles', () => {
        expect(html).toContain('.repo-item');
        expect(html).toContain('.repo-item-row');
        expect(html).toContain('.repo-item-name');
    });

    it('defines repo item active state', () => {
        expect(html).toContain('.repo-item.active');
    });

    it('defines repo item stats styles', () => {
        expect(html).toContain('.repo-item-stats');
    });

    it('defines repos sidebar footer styles', () => {
        expect(html).toContain('.repos-sidebar-footer');
    });

    it('defines repo detail header styles', () => {
        expect(html).toContain('.repo-detail-header');
    });
});

// ============================================================================
// History view styles
// ============================================================================

describe('SPA styles — history view', () => {
    let html: string;
    beforeAll(() => { html = generateDashboardHtml(); });

    it('defines queue history section styles', () => {
        expect(html).toContain('.queue-history-toggle');
        expect(html).toContain('.queue-history-task');
    });

    it('defines history item compact styles', () => {
        expect(html).toContain('.history-item');
        expect(html).toContain('.history-status-icon');
    });

    it('defines history date header styles', () => {
        expect(html).toContain('.history-date-header');
        expect(html).toContain('.date-group-label');
    });

    it('defines history load more button styles', () => {
        expect(html).toContain('.history-load-more');
        expect(html).toContain('.history-load-more-btn');
    });

    it('defines history loading spinner', () => {
        expect(html).toContain('.history-loading');
        expect(html).toContain('.history-loading-spinner');
    });

    it('defines spin animation for loading spinner', () => {
        expect(html).toContain('@keyframes spin');
    });
});

// ============================================================================
// Task preview scrolling layout
// ============================================================================

describe('SPA styles — task preview scrolling', () => {
    let html: string;
    beforeAll(() => { html = generateDashboardHtml(); });

    it('defines task-preview-content-wrapper as flex container', () => {
        expect(html).toContain('.task-preview-content-wrapper');
        // Extract the rule block
        const start = html.indexOf('.task-preview-content-wrapper {');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('display: flex');
        expect(rule).toContain('flex: 1');
    });

    it('task-preview-content-wrapper has min-height: 0 for flex shrinking', () => {
        const start = html.indexOf('.task-preview-content-wrapper {');
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('min-height: 0');
    });

    it('task-preview-content-wrapper has overflow: hidden to contain children', () => {
        const start = html.indexOf('.task-preview-content-wrapper {');
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('overflow: hidden');
    });

    it('task-preview-body has overflow-y: auto for scrolling', () => {
        const start = html.indexOf('.task-preview-body {');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('overflow-y: auto');
    });

    it('task-preview-body has min-height: 0 for flex shrinking', () => {
        const start = html.indexOf('.task-preview-body {');
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('min-height: 0');
    });

    it('task-preview-body has flex: 1 to fill available space', () => {
        const start = html.indexOf('.task-preview-body {');
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('flex: 1');
    });

    it('miller-preview-column is a flex column container', () => {
        // The shared rule for .task-file-preview, .miller-preview-column
        expect(html).toContain('.miller-preview-column');
        expect(html).toContain('flex-direction: column');
    });

    it('miller-preview-column has overflow: hidden to constrain children', () => {
        // The shared rule
        const start = html.indexOf('.task-file-preview,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('overflow: hidden');
        expect(rule).toContain('display: flex');
        expect(rule).toContain('flex-direction: column');
    });

    it('miller-columns has max-height constraint for scroll containment', () => {
        const start = html.indexOf('.miller-columns {');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('max-height:');
        expect(rule).toContain('overflow-y: hidden');
    });
});

// ============================================================================
// Markdown span-based rendering styles (md-h*, md-blockquote, etc.)
// ============================================================================

describe('Bundled CSS — markdown span-based rendering styles', () => {
    const html = generateDashboardHtml();

    it('defines heading styles for md-h1 through md-h6', () => {
        expect(html).toContain('.md-h1');
        expect(html).toContain('.md-h2');
        expect(html).toContain('.md-h3');
        expect(html).toContain('.md-h4');
        expect(html).toContain('.md-h5');
        expect(html).toContain('.md-h6');
    });

    it('md-h1 renders as block with large font and bottom border', () => {
        const start = html.indexOf('.task-preview-body .md-h1,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('display: block');
        expect(rule).toContain('font-weight: 700');
        expect(rule).toContain('border-bottom:');
    });

    it('md-h2 renders as block with border-bottom', () => {
        const start = html.indexOf('.task-preview-body .md-h2,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('display: block');
        expect(rule).toContain('font-weight: 700');
        expect(rule).toContain('border-bottom:');
    });

    it('md-h3 renders as block without border', () => {
        const start = html.indexOf('.task-preview-body .md-h3,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('display: block');
        expect(rule).toContain('font-weight: 600');
        expect(rule).not.toContain('border-bottom');
    });

    it('defines md-hash style for heading markers', () => {
        expect(html).toContain('.md-hash');
        const start = html.indexOf('.task-preview-body .md-hash,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('opacity:');
    });

    it('defines md-blockquote style', () => {
        expect(html).toContain('.md-blockquote');
        const start = html.indexOf('.task-preview-body .md-blockquote,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('border-left:');
        expect(rule).toContain('font-style: italic');
    });

    it('defines md-hr style', () => {
        expect(html).toContain('.md-hr');
        const start = html.indexOf('.task-preview-body .md-hr,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('display: block');
    });

    it('defines md-bold and md-italic styles', () => {
        expect(html).toContain('.md-bold');
        expect(html).toContain('.md-italic');
        expect(html).toContain('.md-bold-italic');
    });

    it('defines md-marker style with reduced opacity', () => {
        const start = html.indexOf('.task-preview-body .md-marker,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('opacity:');
    });

    it('defines md-strike style', () => {
        expect(html).toContain('.md-strike');
    });

    it('defines md-inline-code style', () => {
        const start = html.indexOf('.task-preview-body .md-inline-code,');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('font-family:');
        expect(rule).toContain('border-radius:');
    });

    it('defines md-link and md-link-text styles', () => {
        expect(html).toContain('.md-link');
        expect(html).toContain('.md-link-text');
        expect(html).toContain('.md-link-url');
    });

    it('defines md-list-marker style', () => {
        expect(html).toContain('.md-list-marker');
    });

    it('defines md-code-fence style', () => {
        expect(html).toContain('.md-code-fence');
    });

    it('styles apply to both task-preview-body and result-body', () => {
        expect(html).toContain('.task-preview-body .md-h1,');
        expect(html).toContain('.result-body .md-h1');
        expect(html).toContain('.task-preview-body .md-blockquote,');
        expect(html).toContain('.result-body .md-blockquote');
    });

    it('removes top margin from first heading in preview', () => {
        expect(html).toContain('.md-line:first-child .md-h1');
        expect(html).toContain('margin-top: 0');
    });
});

describe('Bundled CSS — context menu shortcut label', () => {
    const html = generateDashboardHtml();

    it('defines ctx-menu-shortcut class', () => {
        expect(html).toContain('.ctx-menu-shortcut');
    });

    it('ctx-menu-shortcut has margin-left auto for right-alignment', () => {
        const start = html.indexOf('.ctx-menu-shortcut');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('margin-left: auto');
    });

    it('ctx-menu-shortcut has secondary text color', () => {
        const start = html.indexOf('.ctx-menu-shortcut');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('color: var(--text-secondary)');
    });

    it('ctx-menu-shortcut has smaller font size', () => {
        const start = html.indexOf('.ctx-menu-shortcut');
        expect(start).toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        const rule = html.substring(start, end + 1);
        expect(rule).toContain('font-size: 11px');
    });
});
