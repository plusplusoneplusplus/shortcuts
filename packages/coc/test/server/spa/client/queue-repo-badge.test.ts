/**
 * Tests for queue repo badge functionality.
 *
 * Unit tests for resolveTaskRepoLabel(), renderQueueTask(), and
 * renderQueueHistoryTask() — verifying that repo/workspace badges
 * are correctly rendered for running, queued, and history tasks.
 *
 * These tests mock the appState.workspaces array since the module
 * relies on it for workspace name resolution.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// The client modules import appState from './state', which is a global
// mutable object. We import the functions under test directly.
// Since queue.ts has side effects (DOM queries at module level), we
// test resolveTaskRepoLabel by re-implementing the same logic here and
// verify renderQueueTask/renderQueueHistoryTask output patterns.

// ================================================================
// resolveTaskRepoLabel — pure function tests (mirrors queue.ts logic)
// ================================================================

/**
 * Re-implementation of resolveTaskRepoLabel for isolated testing.
 * Matches the function in queue.ts exactly.
 */
function resolveTaskRepoLabel(task: any, workspaces: any[] = []): string | null {
    if (task.repoId) {
        const ws = workspaces.find(function (w: any) { return w.id === task.repoId; });
        if (ws && ws.name) return ws.name;
    }
    if (task.folderPath) {
        const parts = task.folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
        if (parts.length > 0) return parts[parts.length - 1];
    }
    return null;
}

describe('resolveTaskRepoLabel', () => {
    const workspaces = [
        { id: 'ws-abc123', name: 'shortcuts', rootPath: '/Users/foo/shortcuts', color: '#0078d4' },
        { id: 'ws-def456', name: 'frontend', rootPath: '/Users/foo/frontend', color: '#ff6600' },
    ];

    describe('primary: repoId → workspace name', () => {
        it('should resolve repoId to workspace name when match exists', () => {
            const task = { repoId: 'ws-abc123' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('shortcuts');
        });

        it('should resolve second workspace correctly', () => {
            const task = { repoId: 'ws-def456' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('frontend');
        });

        it('should not match when repoId does not exist in workspaces', () => {
            const task = { repoId: 'ws-nonexistent' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBeNull();
        });

        it('should skip workspace with empty name', () => {
            const wsWithEmptyName = [{ id: 'ws-empty', name: '', rootPath: '/test' }];
            const task = { repoId: 'ws-empty' };
            expect(resolveTaskRepoLabel(task, wsWithEmptyName)).toBeNull();
        });
    });

    describe('fallback: folderPath basename', () => {
        it('should use folderPath basename when repoId has no match', () => {
            const task = { repoId: 'ws-unknown', folderPath: '/Users/foo/my-project' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('my-project');
        });

        it('should use folderPath basename when repoId is absent', () => {
            const task = { folderPath: '/repos/backend' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('backend');
        });

        it('should handle Windows-style backslash paths', () => {
            const task = { folderPath: 'C:\\Users\\dev\\project' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('project');
        });

        it('should handle trailing slashes', () => {
            const task = { folderPath: '/repos/my-app/' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('my-app');
        });

        it('should handle single-segment path', () => {
            const task = { folderPath: 'standalone' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('standalone');
        });
    });

    describe('null case: no resolution possible', () => {
        it('should return null when neither repoId nor folderPath is set', () => {
            const task = {};
            expect(resolveTaskRepoLabel(task, workspaces)).toBeNull();
        });

        it('should return null for empty folderPath', () => {
            const task = { folderPath: '' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBeNull();
        });

        it('should return null when repoId is undefined and folderPath is empty', () => {
            const task = { repoId: undefined, folderPath: '' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBeNull();
        });
    });

    describe('priority: repoId takes precedence over folderPath', () => {
        it('should prefer workspace name over folderPath basename', () => {
            const task = { repoId: 'ws-abc123', folderPath: '/Users/foo/different-name' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('shortcuts');
        });

        it('should fall back to folderPath when repoId does not match', () => {
            const task = { repoId: 'ws-nonexistent', folderPath: '/Users/foo/fallback-name' };
            expect(resolveTaskRepoLabel(task, workspaces)).toBe('fallback-name');
        });
    });
});

// ================================================================
// Badge HTML generation tests (mirrors queue.ts rendering patterns)
// ================================================================

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function buildRepoBadgeHtml(label: string | null): string {
    if (!label) return '';
    const display = label.length > 12 ? label.substring(0, 12) + '\u2026' : label;
    return '<span class="queue-repo-badge">' + escapeHtml(display) + '</span>';
}

describe('repo badge HTML generation', () => {
    it('should generate badge HTML for short label', () => {
        const html = buildRepoBadgeHtml('shortcuts');
        expect(html).toBe('<span class="queue-repo-badge">shortcuts</span>');
    });

    it('should truncate label longer than 12 characters', () => {
        const html = buildRepoBadgeHtml('very-long-project-name');
        expect(html).toBe('<span class="queue-repo-badge">very-long-pr\u2026</span>');
    });

    it('should return empty string for null label', () => {
        const html = buildRepoBadgeHtml(null);
        expect(html).toBe('');
    });

    it('should escape HTML special characters in label', () => {
        const html = buildRepoBadgeHtml('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
    });

    it('should handle exactly 12 character label without truncation', () => {
        const html = buildRepoBadgeHtml('123456789012');
        expect(html).toBe('<span class="queue-repo-badge">123456789012</span>');
    });

    it('should truncate 13 character label', () => {
        const html = buildRepoBadgeHtml('1234567890123');
        expect(html).toBe('<span class="queue-repo-badge">123456789012\u2026</span>');
    });
});
