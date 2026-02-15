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

    it('defines collapsible prompt section', () => {
        expect(html).toContain('.prompt-section');
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
