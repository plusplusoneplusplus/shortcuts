/**
 * SPA Dashboard Tests — React Tasks panel, context menu, URL routing, styles, WebSocket.
 * Tasks are now rendered by React components (TasksPanel, TaskTree, TaskPreview)
 * instead of the vanilla tasks.ts module.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

// ============================================================================
// Tasks as Repo Sub-Page — HTML structure
// ============================================================================

describe('Tasks as repo sub-page — HTML structure', () => {
    const html = generateDashboardHtml();

    it('does not contain a top-level Tasks tab button', () => {
        expect(html).not.toContain('data-tab="tasks"');
    });

    it('does not contain a standalone view-tasks element', () => {
        expect(html).not.toContain('id="view-tasks"');
    });

    it('does not contain tasks-workspace-select dropdown', () => {
        expect(html).not.toContain('id="tasks-workspace-select"');
    });

    it('does not contain standalone tasks toolbar buttons', () => {
        expect(html).not.toContain('id="tasks-new-task-btn"');
        expect(html).not.toContain('id="tasks-new-folder-btn"');
        expect(html).not.toContain('id="tasks-ai-generate-btn"');
    });

    it('has exactly 3 tab buttons (Repos, Processes, Wiki)', () => {
        const tabBtnMatches = html.match(/<button[^>]*class="top-bar-tab[^"]*"/g);
        expect(tabBtnMatches).toBeTruthy();
        expect(tabBtnMatches!.length).toBe(3);
    });
});

// ============================================================================
// Tasks React components exist
// ============================================================================

describe('React tasks component files', () => {
    const tasksDir = path.join(CLIENT_DIR, 'react', 'tasks');

    const expectedFiles = [
        'TasksPanel.tsx',
        'TaskTree.tsx',
        'TaskTreeItem.tsx',
        'TaskPreview.tsx',
        'TaskActions.tsx',
    ];

    for (const file of expectedFiles) {
        it(`should have react/tasks/${file}`, () => {
            expect(fs.existsSync(path.join(tasksDir, file))).toBe(true);
        });
    }

    it('should have TaskContext in react/context', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'react', 'context', 'TaskContext.tsx'))).toBe(true);
    });

    it('should have useTaskTree hook', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'react', 'hooks', 'useTaskTree.ts'))).toBe(true);
    });

    it('should have useMermaid hook', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'react', 'hooks', 'useMermaid.ts'))).toBe(true);
    });

    it('should not have vanilla tasks.ts', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'tasks.ts'))).toBe(false);
    });

    it('should not have vanilla task-mermaid.ts', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'task-mermaid.ts'))).toBe(false);
    });
});

// ============================================================================
// Tasks as Repo Sub-Page — React repos components
// ============================================================================

describe('Tasks as repo sub-page — React repos components', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines activeRepoSubTab state', () => {
        expect(script).toContain('activeRepoSubTab');
    });

    it('defines RepoSubTab type values', () => {
        expect(script).toContain('"info"');
        expect(script).toContain('"pipelines"');
        expect(script).toContain('"tasks"');
    });

    it('fetches task count for each workspace', () => {
        expect(script).toContain('countTasks');
        expect(script).toContain('taskCount');
    });

    it('renders TasksPanel component instead of stub', () => {
        expect(script).not.toContain('Tasks coming in commit 007');
        expect(script).toContain('Loading tasks');
    });

    it('renders pipelines empty state', () => {
        expect(script).toContain('No pipelines found');
    });

    it('renders Recent Processes section in info tab', () => {
        expect(script).toContain('Recent Processes');
    });

    it('only shows 3 top-level view IDs (no view-tasks)', () => {
        expect(script).toContain('view-processes');
        expect(script).toContain('view-repos');
        expect(script).toContain('view-reports');
        expect(script).not.toContain("'view-tasks'");
    });
});

// ============================================================================
// Tasks React components — bundle content
// ============================================================================

describe('Tasks React components — bundle content', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('contains TasksPanel component', () => {
        expect(script).toContain('TasksPanel');
    });

    it('contains TaskTree component', () => {
        expect(script).toContain('task-tree');
    });

    it('contains TaskPreview component with preview body', () => {
        expect(script).toContain('task-preview-body');
    });

    it('contains TaskContext with reducer actions', () => {
        expect(script).toContain('SET_OPEN_FILE_PATH');
        expect(script).toContain('TOGGLE_SELECTED_FILE');
        expect(script).toContain('CLEAR_SELECTION');
        expect(script).toContain('TOGGLE_SHOW_CONTEXT_FILES');
    });

    it('contains useTaskTree hook fetching tasks API', () => {
        expect(script).toContain('/tasks?showArchived=true');
        expect(script).toContain('comment-counts');
    });

    it('contains context file filtering', () => {
        expect(script).toContain('isContextFile');
        expect(script).toContain('readme.md');
        expect(script).toContain('claude.md');
    });

    it('contains TaskFolder type fields', () => {
        expect(script).toContain('documentGroups');
        expect(script).toContain('singleDocuments');
        expect(script).toContain('.baseName');
        expect(script).toContain('.fileName');
    });

    it('contains folderToNodes helper', () => {
        expect(script).toContain('folderToNodes');
    });

    it('renders empty state for missing tasks folder', () => {
        expect(script).toContain('No tasks folder found');
        expect(script).toContain('.vscode/tasks/');
    });

    it('uses selectedFilePaths state', () => {
        expect(script).toContain('selectedFilePaths');
    });

    it('renders task-checkbox on file rows', () => {
        expect(script).toContain('task-checkbox');
    });

    it('renders comment-sidebar component', () => {
        expect(script).toContain('comment-sidebar');
    });

    it('renders ai-actions-stub placeholder', () => {
        expect(script).toContain('ai-actions-stub');
    });

    it('handles tasks-changed WebSocket events', () => {
        expect(script).toContain('tasks-changed');
    });

    it('contains stopPropagation for checkbox events', () => {
        expect(script).toContain('stopPropagation');
    });
});

// ============================================================================
// Tasks URL routing
// ============================================================================

describe('Tasks as repo sub-page — URL routing', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('handles #repos/{id}/tasks route', () => {
        expect(script).toContain('repos\\/([^/]+)\\/(tasks|pipelines|info)');
    });

    it('handles #repos/{id}/pipelines route', () => {
        expect(script).toContain('pipelines');
    });

    it('redirects #tasks to #repos for backward compatibility', () => {
        expect(script).toContain('"#repos"');
    });

    it('passes sub-tab to showRepoDetail', () => {
        expect(script).toContain('showRepoDetail');
    });
});

// ============================================================================
// Tasks CSS styles
// ============================================================================

describe('Tasks as repo sub-page — CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines repo sub-tab bar styles', () => {
        expect(html).toContain('.repo-sub-tab-bar');
    });

    it('defines repo sub-tab button styles', () => {
        expect(html).toContain('.repo-sub-tab');
    });

    it('defines active sub-tab styles', () => {
        expect(html).toContain('.repo-sub-tab.active');
    });

    it('defines sub-tab badge styles', () => {
        expect(html).toContain('.repo-sub-tab-badge');
    });

    it('defines sub-tab content container', () => {
        expect(html).toContain('.repo-sub-tab-content');
    });

    it('defines repo tasks toolbar styles', () => {
        expect(html).toContain('.repo-tasks-toolbar');
    });

    it('preserves Miller columns styles', () => {
        expect(html).toContain('.miller-columns');
        expect(html).toContain('.miller-column');
        expect(html).toContain('.miller-row');
        expect(html).toContain('.miller-column-header');
        expect(html).toContain('.task-tree-icon');
    });

    it('preserves task status badge styles', () => {
        expect(html).toContain('.task-status-badge');
        expect(html).toContain('.task-status-pending');
        expect(html).toContain('.task-status-in-progress');
        expect(html).toContain('.task-status-done');
        expect(html).toContain('.task-status-future');
    });

    it('does not contain standalone tasks container styles', () => {
        expect(html).not.toContain('.tasks-container');
        expect(html).not.toContain('.tasks-header');
        expect(html).not.toContain('.tasks-header-right');
    });
});

// ============================================================================
// Tasks context menu — CSS styles
// ============================================================================

describe('Tasks context menu — CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines task-context-menu container style', () => {
        expect(html).toContain('.task-context-menu');
    });

    it('defines task-context-menu-item style', () => {
        expect(html).toContain('.task-context-menu-item');
    });

    it('defines has-submenu indicator style', () => {
        expect(html).toContain('.has-submenu');
    });

    it('defines task-context-submenu style', () => {
        expect(html).toContain('.task-context-submenu');
    });

    it('defines task-context-submenu-item style', () => {
        expect(html).toContain('.task-context-submenu-item');
    });

    it('defines ctx-status-icon style', () => {
        expect(html).toContain('.ctx-status-icon');
    });

    it('defines ctx-status-label style', () => {
        expect(html).toContain('.ctx-status-label');
    });

    it('defines ctx-active style for current status highlight', () => {
        expect(html).toContain('.ctx-active');
    });

    it('defines task-context-menu-separator style', () => {
        expect(html).toContain('.task-context-menu-separator');
    });

    it('positions context menu with fixed positioning', () => {
        expect(html).toContain('position: fixed');
    });

    it('positions submenu absolutely relative to parent', () => {
        expect(html).toContain('position: absolute');
    });

    it('uses high z-index for context menu', () => {
        expect(html).toContain('z-index: 10000');
    });
});

// ============================================================================
// Checkbox selection UI — CSS styles
// ============================================================================

describe('Checkbox selection UI — CSS styles', () => {
    const html = generateDashboardHtml();

    it('defines task-checkbox style', () => {
        expect(html).toContain('.task-checkbox');
    });

    it('defines miller-bulk-action-btn style', () => {
        expect(html).toContain('.miller-bulk-action-btn');
    });

    it('uses accent color for checkbox', () => {
        expect(html).toContain('accent-color: var(--accent)');
    });

    it('uses accent color for bulk action button background', () => {
        expect(html).toContain('.miller-bulk-action-btn');
    });

    it('makes miller-column-header a flex container for button placement', () => {
        expect(html).toMatch(/\.miller-column-header\s*\{[^}]*display:\s*flex/);
    });

    it('defines hover state for bulk action button', () => {
        expect(html).toContain('.miller-bulk-action-btn:hover');
    });
});
