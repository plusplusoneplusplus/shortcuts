/**
 * SPA Dashboard Tests — folder context menu in the Tasks tab.
 *
 * Tests that the CSS styles for folder context menus are still present
 * in the dashboard HTML template. The folder context menu JS functionality
 * has been removed with tasks.ts (to be re-implemented in React).
 */

import { describe, it, expect } from 'vitest';
import { generateDashboardHtml } from './spa-test-helpers';

// ============================================================================
// Folder context menu — CSS styles
// ============================================================================

describe('Folder context menu — CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines ctx-menu-icon style', () => {
        expect(html).toContain('.ctx-menu-icon');
    });

    it('defines task-context-menu-item-danger style', () => {
        expect(html).toContain('.task-context-menu-item-danger');
    });

    it('defines danger hover style with red background', () => {
        expect(html).toContain('.task-context-menu-item-danger:hover');
    });

    it('reuses task-context-menu container styles', () => {
        expect(html).toContain('.task-context-menu');
    });

    it('reuses task-context-menu-item styles', () => {
        expect(html).toContain('.task-context-menu-item');
    });

    it('reuses task-context-menu-separator styles', () => {
        expect(html).toContain('.task-context-menu-separator');
    });

    it('positions context menu with fixed positioning', () => {
        expect(html).toContain('position: fixed');
    });

    it('uses high z-index for context menu', () => {
        expect(html).toContain('z-index: 10000');
    });
});

// ============================================================================
// Folder context menu — AI Generate dialog CSS styles
// ============================================================================

describe('Folder context menu — AI Generate dialog CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines ai-gen-mode-tabs style', () => {
        expect(html).toContain('.ai-gen-mode-tabs');
    });

    it('defines ai-gen-mode-tab style', () => {
        expect(html).toContain('.ai-gen-mode-tab');
    });

    it('defines active mode tab style', () => {
        expect(html).toContain('.ai-gen-mode-tab.active');
    });

    it('defines disabled mode tab style', () => {
        expect(html).toContain('.ai-gen-mode-tab:disabled');
    });

    it('defines ai-gen-depth-select style', () => {
        expect(html).toContain('.ai-gen-depth-select');
    });

    it('defines ai-gen-hint style', () => {
        expect(html).toContain('.ai-gen-hint');
    });

    it('defines ai-gen-error style', () => {
        expect(html).toContain('.ai-gen-error');
    });

    it('defines ai-gen-optional style', () => {
        expect(html).toContain('.ai-gen-optional');
    });

    it('defines ai-gen-divider style', () => {
        expect(html).toContain('.ai-gen-divider');
    });

    it('defines ai-gen-no-features style', () => {
        expect(html).toContain('.ai-gen-no-features');
    });

    it('defines ai-gen-mode-content style', () => {
        expect(html).toContain('.ai-gen-mode-content');
    });
});
