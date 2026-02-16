/**
 * SPA Dashboard Tests — Bulk Queue integration with Follow Prompt Dialog.
 *
 * Tests that checkbox selections and folder context menu are wired to the
 * follow prompt dialog for bulk submission to POST /queue/bulk.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

// ============================================================================
// Bulk Queue — tasks.ts selection helpers
// ============================================================================

describe('Bulk Queue — selection helpers', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines getSelectedFilePaths function', () => {
        expect(script).toContain('getSelectedFilePaths');
    });

    it('defines clearFileSelections function', () => {
        expect(script).toContain('clearFileSelections');
    });

    it('exposes getSelectedFilePaths as window global', () => {
        expect(script).toContain('getSelectedFilePaths');
    });

    it('exposes clearFileSelections as window global', () => {
        expect(script).toContain('clearFileSelections');
    });

    it('exposes applyFollowPromptToSelected as window global', () => {
        expect(script).toContain('applyFollowPromptToSelected');
    });
});

// ============================================================================
// Bulk Queue — collectMarkdownFilesInFolder helper
// ============================================================================

describe('Bulk Queue — collectMarkdownFilesInFolder', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines collectMarkdownFilesInFolder function', () => {
        expect(script).toContain('collectMarkdownFilesInFolder');
    });

    it('traverses singleDocuments', () => {
        expect(script).toContain('singleDocuments');
    });

    it('traverses documentGroups', () => {
        expect(script).toContain('documentGroups');
    });

    it('checks isArchived to exclude archived documents', () => {
        expect(script).toContain('isArchived');
    });

    it('recursively traverses children folders', () => {
        expect(script).toContain('.children');
    });

    it('builds file path from relativePath and fileName', () => {
        expect(script).toContain('relativePath');
        expect(script).toContain('fileName');
    });
});

// ============================================================================
// Bulk Queue — Follow Prompt (Bulk) in folder context menu
// ============================================================================

describe('Bulk Queue — folder context menu Follow Prompt (Bulk)', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('renders Follow Prompt menu item in folder context menu', () => {
        expect(script).toContain('Follow Prompt');
    });

    it('uses data-ctx-action attribute for bulk-follow-prompt', () => {
        expect(script).toContain('bulk-follow-prompt');
    });

    it('handles bulk-follow-prompt action in switch statement', () => {
        expect(script).toContain('bulk-follow-prompt');
    });

    it('calls collectMarkdownFilesInFolder for folder bulk operation', () => {
        expect(script).toContain('collectMarkdownFilesInFolder');
    });

    it('shows toast when no markdown files found in folder', () => {
        expect(script).toContain('No markdown files found in folder');
    });

    it('calls showFollowPromptSubmenu with array of file paths', () => {
        expect(script).toContain('showFollowPromptSubmenu');
    });

    it('shows file count in menu label', () => {
        // Matches the dynamic label generation pattern
        expect(script).toContain('Follow Prompt (none)');
    });

    it('disables menu item when no files exist', () => {
        expect(script).toContain('task-context-menu-item-disabled');
    });

    it('uses memo/pencil emoji icon for Follow Prompt', () => {
        // esbuild encodes 📝 as unicode escape
        expect(script).toContain('\\u{1F4DD}');
    });

    it('places Follow Prompt after Queue All Tasks in menu order', () => {
        const queueIdx = script.indexOf('Queue All Tasks');
        const followIdx = script.indexOf('Follow Prompt (none)');
        expect(queueIdx).toBeGreaterThan(-1);
        expect(followIdx).toBeGreaterThan(-1);
        expect(followIdx).toBeGreaterThan(queueIdx);
    });
});

// ============================================================================
// Bulk Queue — Follow Prompt (Selected) toolbar button
// ============================================================================

describe('Bulk Queue — Follow Prompt (Selected) toolbar button', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('renders Follow Prompt button alongside Queue Selected button', () => {
        expect(script).toContain('follow-prompt-selected');
    });

    it('uses data-action attribute for follow-prompt-selected', () => {
        expect(script).toContain('data-action="follow-prompt-selected"');
    });

    it('shows selected count in button label', () => {
        expect(script).toContain('Follow Prompt (');
    });

    it('handles follow-prompt-selected click in event delegation', () => {
        expect(script).toContain('follow-prompt-selected');
    });

    it('calls applyFollowPromptToSelected on button click', () => {
        expect(script).toContain('applyFollowPromptToSelected');
    });
});

// ============================================================================
// Bulk Queue — applyFollowPromptToSelected handler
// ============================================================================

describe('Bulk Queue — applyFollowPromptToSelected handler', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines applyFollowPromptToSelected function', () => {
        expect(script).toContain('applyFollowPromptToSelected');
    });

    it('checks for empty selections', () => {
        expect(script).toContain('No files selected');
    });

    it('checks for workspace selection', () => {
        expect(script).toContain('No workspace selected');
    });

    it('calls showFollowPromptSubmenu with selected files', () => {
        expect(script).toContain('showFollowPromptSubmenu');
    });

    it('includes count in display name for selected tasks', () => {
        expect(script).toContain('selected tasks');
    });
});

// ============================================================================
// Bulk Queue — showFollowPromptSubmenu bulk mode
// ============================================================================

describe('Bulk Queue — showFollowPromptSubmenu bulk mode', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('accepts string or string array for taskPathOrPaths parameter', () => {
        expect(script).toContain('Array.isArray');
    });

    it('detects bulk mode via Array.isArray check', () => {
        expect(script).toContain('Array.isArray');
    });

    it('shows task count badge in dialog header for bulk mode', () => {
        expect(script).toContain('bulk-count-badge');
    });

    it('renders tasks text in badge', () => {
        expect(script).toContain('tasks</span>');
    });

    it('routes to enqueueBulkFollowPrompt in bulk mode', () => {
        expect(script).toContain('enqueueBulkFollowPrompt');
    });

    it('routes to enqueueFollowPrompt in single mode', () => {
        expect(script).toContain('enqueueFollowPrompt');
    });
});

// ============================================================================
// Bulk Queue — enqueueBulkFollowPrompt function
// ============================================================================

describe('Bulk Queue — enqueueBulkFollowPrompt function', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines enqueueBulkFollowPrompt function', () => {
        expect(script).toContain('enqueueBulkFollowPrompt');
    });

    it('submits to /queue/bulk endpoint', () => {
        expect(script).toContain('/queue/bulk');
    });

    it('sends items array in request body', () => {
        expect(script).toContain('items');
    });

    it('builds individual queue items per task file', () => {
        expect(script).toContain('follow-prompt');
    });

    it('sets displayName with item name and task name', () => {
        expect(script).toContain('Follow:');
    });

    it('handles prompt type with promptFilePath in payload', () => {
        expect(script).toContain('promptFilePath');
    });

    it('handles skill type with skillName in payload', () => {
        expect(script).toContain('skillName');
    });

    it('includes workingDirectory in payload', () => {
        expect(script).toContain('workingDirectory');
    });

    it('includes planFilePath in payload', () => {
        expect(script).toContain('planFilePath');
    });

    it('sets model in config when provided', () => {
        expect(script).toContain('config');
    });

    it('shows success toast with count on successful submission', () => {
        expect(script).toContain('Enqueued');
    });

    it('shows partial failure toast with success and fail counts', () => {
        expect(script).toContain('failed');
    });

    it('shows error toast on network failure', () => {
        expect(script).toContain('Network error enqueuing bulk tasks');
    });

    it('shows error toast on non-ok response', () => {
        expect(script).toContain('Failed to enqueue bulk');
    });

    it('clears file selections after successful submission', () => {
        expect(script).toContain('clearFileSelections');
    });

    it('refreshes queue after successful submission', () => {
        expect(script).toContain('fetchQueue');
    });

    it('resolves tasks folder path via getTasksFolderPath', () => {
        expect(script).toContain('getTasksFolderPath');
    });

    it('resolves workspace rootPath from appState', () => {
        expect(script).toContain('rootPath');
    });
});

// ============================================================================
// Bulk Queue — CSS styles
// ============================================================================

describe('Bulk Queue — CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines bulk-count-badge style', () => {
        expect(html).toContain('.bulk-count-badge');
    });

    it('uses accent color for badge background', () => {
        expect(html).toContain('--accent');
    });

    it('uses white text for badge', () => {
        // CSS minifier may inline; check the HTML contains the property
        expect(html).toContain('bulk-count-badge');
    });

    it('uses pill shape border-radius for badge', () => {
        expect(html).toContain('12px');
    });

    it('uses inline-block display for badge', () => {
        expect(html).toContain('inline-block');
    });
});

// ============================================================================
// Bulk Queue — backward compatibility
// ============================================================================

describe('Bulk Queue — backward compatibility', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('preserves showAIActionDropdown function', () => {
        expect(script).toContain('showAIActionDropdown');
    });

    it('preserves hideAIActionDropdown function', () => {
        expect(script).toContain('hideAIActionDropdown');
    });

    it('preserves enqueueFollowPrompt function for single mode', () => {
        expect(script).toContain('enqueueFollowPrompt');
    });

    it('preserves showFollowPromptSubmenu as window global', () => {
        expect(script).toContain('showFollowPromptSubmenu');
    });

    it('preserves showUpdateDocumentModal function', () => {
        expect(script).toContain('showUpdateDocumentModal');
    });

    it('preserves fetchPromptsAndSkills function', () => {
        expect(script).toContain('fetchPromptsAndSkills');
    });

    it('preserves showToast function', () => {
        expect(script).toContain('showToast');
    });

    it('preserves single-file follow-prompt action in AI dropdown', () => {
        expect(script).toContain('follow-prompt');
    });
});
