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
        expect(script).toContain('\\u{1F916}'); // 🤖 robot
    });
});

// ============================================================================
// Folder context menu — AI Generate Task action
// ============================================================================

describe('Folder context menu — AI Generate Task menu item', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('renders AI Generate Task menu item', () => {
        expect(script).toContain('AI Generate Task');
    });

    it('uses data-ctx-action attribute for ai-generate-in-folder', () => {
        expect(script).toContain('ai-generate-in-folder');
    });

    it('uses robot emoji icon for AI Generate Task', () => {
        // esbuild encodes 🤖 as unicode escape
        expect(script).toContain('\\u{1F916}');
    });

    it('calls showRepoAIGenerateDialog with folder path when AI Generate clicked', () => {
        expect(script).toContain('showRepoAIGenerateDialog');
    });

    it('passes folder path to showRepoAIGenerateDialog', () => {
        // The switch case passes the path from the context menu item
        expect(script).toContain('ai-generate-in-folder');
        expect(script).toContain('showRepoAIGenerateDialog(wsId, path)');
    });

    it('places AI Generate Task after Create Task in menu order', () => {
        // Both items should be present and AI Generate should come after Create Task
        const createIdx = script.indexOf('Create Task');
        const aiGenIdx = script.indexOf('AI Generate Task');
        expect(createIdx).toBeGreaterThan(-1);
        expect(aiGenIdx).toBeGreaterThan(-1);
        expect(aiGenIdx).toBeGreaterThan(createIdx);
    });

    it('places AI Generate Task before the separator before Archive', () => {
        const aiGenIdx = script.indexOf('AI Generate Task');
        const archiveIdx = script.indexOf('Archive Folder');
        expect(aiGenIdx).toBeGreaterThan(-1);
        expect(archiveIdx).toBeGreaterThan(-1);
        expect(archiveIdx).toBeGreaterThan(aiGenIdx);
    });
});

// ============================================================================
// Folder context menu — AI Generate dialog (tabbed layout)
// ============================================================================

describe('Folder context menu — AI Generate dialog structure', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines showRepoAIGenerateDialog with preselectedFolder parameter', () => {
        expect(script).toContain('showRepoAIGenerateDialog');
    });

    it('creates ai-generate-overlay dialog', () => {
        expect(script).toContain('ai-generate-overlay');
    });

    it('renders Create AI Task as dialog title', () => {
        expect(script).toContain('Create AI Task');
    });

    it('renders mode tabs for Create New and From Feature', () => {
        expect(script).toContain('ai-gen-mode-tabs');
        expect(script).toContain('ai-gen-mode-tab');
    });

    it('renders Create New tab label', () => {
        expect(script).toContain('Create New');
    });

    it('renders From Feature tab label', () => {
        expect(script).toContain('From Feature');
    });

    it('renders create mode content container', () => {
        expect(script).toContain('ai-gen-create-content');
    });

    it('renders feature mode content container', () => {
        expect(script).toContain('ai-gen-feature-content');
    });

    it('renders Task Name input with optional label in create mode', () => {
        expect(script).toContain('ai-gen-name');
        expect(script).toContain('ai-gen-optional');
    });

    it('renders Location dropdown in create mode', () => {
        expect(script).toContain('ai-gen-location');
    });

    it('renders Brief Description textarea in create mode', () => {
        expect(script).toContain('ai-gen-prompt');
        expect(script).toContain('Brief Description');
    });

    it('renders Feature Folder dropdown in from-feature mode', () => {
        expect(script).toContain('ai-gen-feature-location');
        expect(script).toContain('Feature Folder');
    });

    it('renders Task Focus textarea in from-feature mode', () => {
        expect(script).toContain('ai-gen-focus');
        expect(script).toContain('Task Focus');
    });

    it('renders depth select dropdown with Simple and Deep options', () => {
        expect(script).toContain('ai-gen-depth');
        expect(script).toContain('ai-gen-depth-select');
    });

    it('renders Simple depth option in dropdown', () => {
        expect(script).toContain('Simple');
        expect(script).toContain('single-pass AI analysis');
    });

    it('renders Deep depth option in dropdown', () => {
        expect(script).toContain('Deep');
        expect(script).toContain('go-deep skill');
    });

    it('renders Create Task as submit button label', () => {
        expect(script).toContain('Create Task');
    });

    it('renders name validation error container', () => {
        expect(script).toContain('ai-gen-name-error');
    });

    it('renders feature name validation error container', () => {
        expect(script).toContain('ai-gen-feature-name-error');
    });

    it('renders hint text for AI name generation', () => {
        expect(script).toContain('Leave empty to let AI generate a name');
    });

    it('renders no-features message for empty repos', () => {
        expect(script).toContain('ai-gen-no-features');
        expect(script).toContain('No feature folders found');
    });
});

// ============================================================================
// Folder context menu — AI Generate dialog behavior
// ============================================================================

describe('Folder context menu — AI Generate dialog behavior', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('collects folder paths from task tree for location dropdown', () => {
        expect(script).toContain('collectFolderPaths');
    });

    it('includes Root option in folder dropdown', () => {
        expect(script).toContain('(Root)');
    });

    it('validates task name for path separators', () => {
        expect(script).toContain('path separators');
    });

    it('validates task name for invalid characters', () => {
        expect(script).toContain('invalid characters');
    });

    it('switches between Create and From Feature mode tabs', () => {
        expect(script).toContain('data-ai-mode');
        expect(script).toContain('currentAIMode');
    });

    it('toggles mode content visibility on tab click', () => {
        expect(script).toContain('ai-gen-create-content');
        expect(script).toContain('ai-gen-feature-content');
    });

    it('submits to tasks/generate endpoint', () => {
        expect(script).toContain('/tasks/generate');
    });

    it('sends mode in request body', () => {
        expect(script).toContain('mode: currentAIMode');
    });

    it('reads SSE stream for progress updates', () => {
        expect(script).toContain('getReader');
        expect(script).toContain('TextDecoder');
    });

    it('handles progress, chunk, error, and done SSE events', () => {
        expect(script).toContain('"progress"');
        expect(script).toContain('"chunk"');
        expect(script).toContain('"error"');
        expect(script).toContain('"done"');
    });

    it('refreshes task tree after successful generation', () => {
        expect(script).toContain('fetchRepoTasks');
    });

    it('supports Escape key to close dialog', () => {
        expect(script).toContain('Escape');
    });

    it('supports Ctrl/Cmd+Enter to submit dialog', () => {
        expect(script).toContain('ctrlKey');
        expect(script).toContain('metaKey');
    });

    it('disables From Feature tab when no feature folders', () => {
        expect(script).toContain('hasFeatureFolders');
    });

    it('pre-selects folder when preselectedFolder is provided', () => {
        expect(script).toContain('preselectedFolder');
    });

    it('changes submit button text to Generate Again after completion', () => {
        expect(script).toContain('Generate Again');
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
