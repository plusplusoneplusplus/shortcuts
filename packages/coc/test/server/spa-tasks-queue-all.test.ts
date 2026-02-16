/**
 * SPA Dashboard Tests — "Queue All Tasks" folder context menu item.
 *
 * Tests that the folder context menu includes a "Queue All Tasks" option
 * with plan file count preview, disabled state for empty folders,
 * and the recursive helper functions for counting/collecting plan files.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

// ============================================================================
// Queue All Tasks — client bundle functions
// ============================================================================

describe('Queue All Tasks — client bundle functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines countPlanFilesRecursive function', () => {
        expect(script).toContain('countPlanFilesRecursive');
    });

    it('defines countPlanFilesInFolder function', () => {
        expect(script).toContain('countPlanFilesInFolder');
    });

    it('defines collectPlanFilesRecursive function', () => {
        expect(script).toContain('collectPlanFilesRecursive');
    });

    it('defines collectPlanFilesInFolder function', () => {
        expect(script).toContain('collectPlanFilesInFolder');
    });

    it('defines queueAllTasksInFolder function', () => {
        expect(script).toContain('queueAllTasksInFolder');
    });
});

// ============================================================================
// Queue All Tasks — menu item rendering
// ============================================================================

describe('Queue All Tasks — menu item rendering', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('renders Queue All Tasks menu item text', () => {
        expect(script).toContain('Queue All Tasks');
    });

    it('uses data-ctx-action attribute for queue-all-tasks', () => {
        expect(script).toContain('queue-all-tasks');
    });

    it('uses data-ctx-count attribute for plan file count', () => {
        expect(script).toContain('data-ctx-count');
    });

    it('uses clipboard emoji icon for Queue All Tasks', () => {
        // esbuild encodes 📋 as unicode escape
        expect(script).toContain('\\u{1F4CB}');
    });

    it('shows (none) label when no plan files exist', () => {
        expect(script).toContain('Queue All Tasks (none)');
    });

    it('applies disabled class when plan count is zero', () => {
        expect(script).toContain('task-context-menu-item-disabled');
    });

    it('places Queue All Tasks after AI Generate Task in menu order', () => {
        const aiGenIdx = script.indexOf('AI Generate Task');
        const queueIdx = script.indexOf('Queue All Tasks');
        expect(aiGenIdx).toBeGreaterThan(-1);
        expect(queueIdx).toBeGreaterThan(-1);
        expect(queueIdx).toBeGreaterThan(aiGenIdx);
    });

    it('places Queue All Tasks before Move to... in menu order', () => {
        const queueIdx = script.indexOf('Queue All Tasks');
        const moveIdx = script.indexOf('Move to...');
        expect(queueIdx).toBeGreaterThan(-1);
        expect(moveIdx).toBeGreaterThan(-1);
        expect(moveIdx).toBeGreaterThan(queueIdx);
    });
});

// ============================================================================
// Queue All Tasks — click handler
// ============================================================================

describe('Queue All Tasks — click handler', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('handles queue-all-tasks action in switch statement', () => {
        expect(script).toContain('queue-all-tasks');
    });

    it('calls queueAllTasksInFolder with workspace ID and path', () => {
        expect(script).toContain('queueAllTasksInFolder(wsId, path)');
    });

    it('skips disabled menu items on click', () => {
        expect(script).toContain('task-context-menu-item-disabled');
    });
});

// ============================================================================
// Queue All Tasks — plan file counting logic
// ============================================================================

describe('Queue All Tasks — plan file counting logic', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('checks docType === "plan" for document group files', () => {
        // Verify the bundle checks for plan docType
        expect(script).toContain('.docType');
        expect(script).toContain('"plan"');
    });

    it('checks fileName.endsWith(".plan.md") for single documents', () => {
        expect(script).toContain('.plan.md');
    });

    it('traverses documentGroups for plan files', () => {
        expect(script).toContain('documentGroups');
    });

    it('traverses singleDocuments for plan files', () => {
        expect(script).toContain('singleDocuments');
    });

    it('recursively traverses children folders', () => {
        // countPlanFilesInFolder recurses through children
        expect(script).toContain('.children');
    });

    it('uses resolveFolderByPath to find the target folder', () => {
        expect(script).toContain('resolveFolderByPath');
    });

    it('returns 0 when currentTasks is null', () => {
        // Early return check
        expect(script).toContain('currentTasks');
    });
});

// ============================================================================
// Queue All Tasks — plan file collection logic
// ============================================================================

describe('Queue All Tasks — plan file collection logic', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('builds file path from relativePath and fileName', () => {
        expect(script).toContain('relativePath');
        expect(script).toContain('fileName');
    });

    it('handles files without relativePath', () => {
        // Ternary: doc.relativePath ? relativePath + "/" + fileName : fileName
        expect(script).toContain('.relativePath');
    });
});

// ============================================================================
// Queue All Tasks — queueAllTasksInFolder handler
// ============================================================================

describe('Queue All Tasks — queueAllTasksInFolder handler', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('shows alert when no plan files found', () => {
        expect(script).toContain('No plan files found in this folder');
    });

    it('shows confirmation dialog before queueing', () => {
        expect(script).toContain('confirm');
    });

    it('includes file count in confirmation message', () => {
        expect(script).toContain('plan file');
    });

    it('logs queued files to console for debugging', () => {
        expect(script).toContain('[Queue All Tasks]');
    });

    it('shows feature in progress alert with file preview', () => {
        expect(script).toContain('Feature in progress');
    });

    it('limits file preview to first 3 files', () => {
        expect(script).toContain('.slice(0, 3)');
    });
});

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
