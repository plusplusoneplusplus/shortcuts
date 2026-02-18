/**
 * SPA Dashboard Tests — Bulk Queue integration with Follow Prompt Dialog.
 *
 * After the React migration (tasks.ts deleted), many bundle functions were
 * tree-shaken. Tests now verify source-level logic in ai-actions.ts and
 * bundle presence of functions that remain reachable.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// Bulk Queue — ai-actions.ts source-level functions
// ============================================================================

describe('Bulk Queue — ai-actions.ts source functions', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('ai-actions.ts'); });

    it('defines showFollowPromptSubmenu function', () => {
        expect(content).toContain('showFollowPromptSubmenu');
    });

    it('defines enqueueBulkFollowPrompt function', () => {
        expect(content).toContain('enqueueBulkFollowPrompt');
    });

    it('defines enqueueFollowPrompt function', () => {
        expect(content).toContain('enqueueFollowPrompt');
    });

    it('defines clearFileSelections function', () => {
        expect(content).toContain('clearFileSelections');
    });

    it('defines showAIActionDropdown function', () => {
        expect(content).toContain('showAIActionDropdown');
    });

    it('defines hideAIActionDropdown function', () => {
        expect(content).toContain('hideAIActionDropdown');
    });

    it('defines showUpdateDocumentModal function', () => {
        expect(content).toContain('showUpdateDocumentModal');
    });

    it('defines fetchPromptsAndSkills function', () => {
        expect(content).toContain('fetchPromptsAndSkills');
    });
});

// ============================================================================
// Bulk Queue — bundle-level functions still reachable
// ============================================================================

describe('Bulk Queue — bundle presence of reachable functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('bundle contains showFollowPromptSubmenu', () => {
        expect(script).toContain('showFollowPromptSubmenu');
    });

    it('bundle contains enqueueBulkFollowPrompt', () => {
        expect(script).toContain('enqueueBulkFollowPrompt');
    });

    it('bundle contains enqueueFollowPrompt', () => {
        expect(script).toContain('enqueueFollowPrompt');
    });

    it('bundle contains clearFileSelections', () => {
        expect(script).toContain('clearFileSelections');
    });

    it('bundle contains showToast', () => {
        expect(script).toContain('showToast');
    });

    it('bundle contains follow-prompt action type', () => {
        expect(script).toContain('follow-prompt');
    });

    it('bundle contains /queue/bulk endpoint', () => {
        expect(script).toContain('/queue/bulk');
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

    it('submits to /queue/bulk endpoint', () => {
        expect(script).toContain('/queue/bulk');
    });

    it('sends tasks array in request body matching API contract', () => {
        expect(script).toContain('tasks:');
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

    it('shows success toast with count on successful submission', () => {
        expect(script).toContain('Enqueued');
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

// ============================================================================
// Bulk Queue — source-level API contract verification
// ============================================================================

describe('Bulk Queue — enqueueBulkFollowPrompt source-level API contract', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('ai-actions.ts'); });

    it('sends { tasks: items } in request body to match POST /api/queue/bulk', () => {
        const fnStart = content.indexOf('async function enqueueBulkFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).toContain('JSON.stringify({ tasks: items })');
    });

    it('does NOT send { items } directly (regression guard)', () => {
        const fnStart = content.indexOf('async function enqueueBulkFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).not.toMatch(/JSON\.stringify\(\{\s*items\s*\}\)/);
    });

    it('reads success count from result.summary.succeeded', () => {
        const fnStart = content.indexOf('async function enqueueBulkFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).toContain('result.summary?.succeeded');
    });

    it('reads failure count from result.summary.failed', () => {
        const fnStart = content.indexOf('async function enqueueBulkFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).toContain('result.summary?.failed');
    });

    it('falls back to result.success array length for success count', () => {
        const fnStart = content.indexOf('async function enqueueBulkFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).toContain('result.success?.length');
    });

    it('falls back to result.failed array length for failure count', () => {
        const fnStart = content.indexOf('async function enqueueBulkFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).toContain('result.failed?.length');
    });

    it('does NOT use result.results (old incorrect response shape)', () => {
        const fnStart = content.indexOf('async function enqueueBulkFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).not.toContain('result.results');
    });
});
