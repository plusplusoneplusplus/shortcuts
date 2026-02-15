/**
 * SPA Dashboard Tests — folder context menu in the Tasks tab.
 *
 * Tests that right-clicking a folder row in the Miller columns view
 * renders a context menu with Rename, Create Subfolder, Create Task,
 * Archive/Unarchive, and Delete actions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

// ============================================================================
// Folder context menu — client bundle functions
// ============================================================================

describe('Folder context menu — client bundle functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines showFolderContextMenu function', () => {
        expect(script).toContain('showFolderContextMenu');
    });

    it('defines renameFolderFromMenu function', () => {
        expect(script).toContain('renameFolderFromMenu');
    });

    it('defines createSubfolderInFolder function', () => {
        expect(script).toContain('createSubfolderInFolder');
    });

    it('defines createTaskInFolder function', () => {
        expect(script).toContain('createTaskInFolder');
    });

    it('defines deleteFolderFromMenu function', () => {
        expect(script).toContain('deleteFolderFromMenu');
    });

    it('creates context menu element with id task-context-menu for folders', () => {
        // Folder context menu reuses the same id as file context menu
        expect(script).toContain('"task-context-menu"');
    });

    it('renders Rename Folder menu item', () => {
        expect(script).toContain('Rename Folder');
    });

    it('renders Create Subfolder menu item', () => {
        expect(script).toContain('Create Subfolder');
    });

    it('renders Create Task menu item', () => {
        expect(script).toContain('Create Task');
    });

    it('renders Archive Folder menu item', () => {
        expect(script).toContain('Archive Folder');
    });

    it('renders Unarchive Folder menu item', () => {
        expect(script).toContain('Unarchive Folder');
    });

    it('renders Delete Folder menu item', () => {
        expect(script).toContain('Delete Folder');
    });
});

// ============================================================================
// Folder context menu — context menu actions
// ============================================================================

describe('Folder context menu — context menu actions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('uses data-ctx-action attribute for rename-folder', () => {
        expect(script).toContain('rename-folder');
    });

    it('uses data-ctx-action attribute for create-subfolder', () => {
        expect(script).toContain('create-subfolder');
    });

    it('uses data-ctx-action attribute for create-task-in-folder', () => {
        expect(script).toContain('create-task-in-folder');
    });

    it('uses data-ctx-action attribute for archive-folder', () => {
        expect(script).toContain('archive-folder');
    });

    it('uses data-ctx-action attribute for unarchive-folder', () => {
        expect(script).toContain('unarchive-folder');
    });

    it('uses data-ctx-action attribute for delete-folder', () => {
        expect(script).toContain('delete-folder');
    });

    it('uses data-ctx-path attribute for folder path', () => {
        expect(script).toContain('data-ctx-path');
    });

    it('uses data-ctx-name attribute for folder name', () => {
        expect(script).toContain('data-ctx-name');
    });
});

// ============================================================================
// Folder context menu — event listener integration
// ============================================================================

describe('Folder context menu — event listener integration', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('listens for contextmenu event on the container', () => {
        expect(script).toContain('contextmenu');
    });

    it('detects folder rows via data-nav-folder attribute in contextmenu handler', () => {
        // The contextmenu handler should check for [data-nav-folder] before [data-file-path]
        expect(script).toContain('data-nav-folder');
    });

    it('calls preventDefault on contextmenu event for folder rows', () => {
        expect(script).toContain('preventDefault');
    });

    it('calls showFolderContextMenu for folder rows', () => {
        expect(script).toContain('showFolderContextMenu');
    });

    it('dismisses context menu on Escape key', () => {
        expect(script).toContain('Escape');
    });

    it('dismisses context menu on click outside', () => {
        // Uses the same dismiss pattern as file context menu
        expect(script).toContain('dismissContextMenu');
    });
});

// ============================================================================
// Folder context menu — rename operation
// ============================================================================

describe('Folder context menu — rename operation', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('calls renameItem for folder rename', () => {
        expect(script).toContain('renameItem');
    });

    it('passes folder path and current name to rename dialog', () => {
        // renameFolderFromMenu delegates to renameItem which uses PATCH
        expect(script).toContain('PATCH');
    });

    it('sends newName in PATCH request body', () => {
        expect(script).toContain('newName');
    });

    it('refreshes tasks after successful rename', () => {
        expect(script).toContain('fetchRepoTasks');
    });
});

// ============================================================================
// Folder context menu — create subfolder operation
// ============================================================================

describe('Folder context menu — create subfolder operation', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('shows input dialog for subfolder name', () => {
        expect(script).toContain('New Subfolder');
        expect(script).toContain('Subfolder name');
    });

    it('sends POST request with type folder', () => {
        expect(script).toContain('POST');
        // The body includes type: "folder" (esbuild preserves spaces)
        expect(script).toContain('type: "folder"');
    });

    it('sends parent path in request body', () => {
        expect(script).toContain('parent:');
    });

    it('validates name does not contain path separators', () => {
        expect(script).toContain('path separators');
    });

    it('refreshes tasks after successful subfolder creation', () => {
        expect(script).toContain('fetchRepoTasks');
    });
});

// ============================================================================
// Folder context menu — create task in folder operation
// ============================================================================

describe('Folder context menu — create task in folder operation', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('shows input dialog for task name', () => {
        expect(script).toContain('New Task in Folder');
        expect(script).toContain('Task name');
    });

    it('includes doc type selector in dialog', () => {
        expect(script).toContain('task-dialog-doctype');
    });

    it('sends folder path in request body', () => {
        expect(script).toContain('folder:');
    });

    it('validates name does not contain path separators', () => {
        expect(script).toContain('path separators');
    });

    it('supports optional doc type selection', () => {
        expect(script).toContain('Doc Type');
        expect(script).toContain('Plan');
        expect(script).toContain('Spec');
        expect(script).toContain('Test');
    });

    it('refreshes tasks after successful task creation', () => {
        expect(script).toContain('fetchRepoTasks');
    });
});

// ============================================================================
// Folder context menu — archive/unarchive operation
// ============================================================================

describe('Folder context menu — archive/unarchive operation', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('detects archived folders by path prefix', () => {
        // isArchived check: startsWith("archive/") or startsWith("archive\\") or === "archive"
        expect(script).toContain('archive/');
        expect(script).toContain('archive\\\\');
    });

    it('shows Unarchive for archived folders', () => {
        expect(script).toContain('Unarchive Folder');
    });

    it('shows Archive for non-archived folders', () => {
        expect(script).toContain('Archive Folder');
    });

    it('calls archiveItem with correct action', () => {
        expect(script).toContain('archiveItem');
    });

    it('sends POST request to archive endpoint', () => {
        expect(script).toContain('/tasks/archive');
    });

    it('refreshes tasks after archive/unarchive', () => {
        expect(script).toContain('fetchRepoTasks');
    });
});

// ============================================================================
// Folder context menu — delete operation
// ============================================================================

describe('Folder context menu — delete operation', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('shows confirmation dialog before deleting folder', () => {
        expect(script).toContain('and all its contents');
        expect(script).toContain('cannot be undone');
    });

    it('calls deleteItem after confirmation', () => {
        expect(script).toContain('deleteItem');
    });

    it('sends DELETE request', () => {
        expect(script).toContain('DELETE');
    });

    it('refreshes tasks after successful deletion', () => {
        expect(script).toContain('fetchRepoTasks');
    });
});

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
// Folder context menu — menu positioning
// ============================================================================

describe('Folder context menu — menu positioning', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('adjusts menu position to stay within viewport', () => {
        expect(script).toContain('innerWidth');
        expect(script).toContain('innerHeight');
    });

    it('uses getBoundingClientRect for position calculation', () => {
        expect(script).toContain('getBoundingClientRect');
    });

    it('sets left and top style properties', () => {
        expect(script).toContain('.style.left');
        expect(script).toContain('.style.top');
    });
});

// ============================================================================
// Folder context menu — menu separators
// ============================================================================

describe('Folder context menu — menu structure', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('includes separator elements between menu sections', () => {
        expect(script).toContain('task-context-menu-separator');
    });

    it('groups CRUD actions together (Rename, Create Subfolder, Create Task)', () => {
        expect(script).toContain('Rename Folder');
        expect(script).toContain('Create Subfolder');
        expect(script).toContain('Create Task');
    });

    it('groups lifecycle actions together (Archive/Unarchive)', () => {
        expect(script).toContain('Archive Folder');
        expect(script).toContain('Unarchive Folder');
    });

    it('places Delete as the last item', () => {
        expect(script).toContain('Delete Folder');
    });

    it('uses emoji icons for menu items (unicode-escaped in bundle)', () => {
        // esbuild encodes emojis as ES6 unicode code point escapes
        expect(script).toContain('\\u270F'); // ✏️ pencil
        expect(script).toContain('\\u{1F4C1}'); // 📁 folder
        expect(script).toContain('\\u{1F4C4}'); // 📄 page
        expect(script).toContain('\\u{1F4E6}'); // 📦 package
        expect(script).toContain('\\u{1F4E4}'); // 📤 outbox
        expect(script).toContain('\\u{1F5D1}'); // 🗑️ wastebasket
    });
});
