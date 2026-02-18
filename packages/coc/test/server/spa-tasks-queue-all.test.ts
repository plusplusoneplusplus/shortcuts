/**
 * SPA Dashboard Tests — "Queue All Tasks" feature.
 *
 * After the React migration, the folder context menu JS logic from tasks.ts
 * has been removed. CSS styles for disabled menu items are preserved.
 */

import { describe, it, expect } from 'vitest';
import { generateDashboardHtml } from './spa-test-helpers';

// ============================================================================
// Queue All Tasks — CSS styles
// ============================================================================

describe('Queue All Tasks — CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines task-context-menu-item-disabled style', () => {
        expect(html).toContain('.task-context-menu-item-disabled');
    });

    it('defines disabled hover style', () => {
        expect(html).toContain('.task-context-menu-item-disabled:hover');
    });

    it('uses not-allowed cursor for disabled items', () => {
        expect(html).toContain('not-allowed');
    });

    it('uses opacity for disabled state visual', () => {
        expect(html).toContain('opacity');
    });

    it('uses vscode-disabledForeground CSS variable', () => {
        expect(html).toContain('--vscode-disabledForeground');
    });
});
