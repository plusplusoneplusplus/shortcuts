/**
 * SPA Dashboard Tests — tasks module, context menu, name display, URL routing, styles, WebSocket
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

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

    it('has exactly 3 tab buttons (Processes, Repos, Reports)', () => {
        const tabBtnMatches = html.match(/class="tab-btn[^"]*"/g);
        expect(tabBtnMatches).toBeTruthy();
        expect(tabBtnMatches!.length).toBe(3);
    });
});

// ============================================================================
// Tasks as Repo Sub-Page — client bundle repos module
// ============================================================================

describe('Tasks as repo sub-page — client bundle repos module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines repo sub-tab bar with Info, Pipelines, Tasks', () => {
        expect(script).toContain('repo-sub-tab-bar');
        expect(script).toContain('data-subtab="info"');
        expect(script).toContain('data-subtab="pipelines"');
        expect(script).toContain('data-subtab="tasks"');
    });

    it('defines activeRepoSubTab state', () => {
        expect(script).toContain('activeRepoSubTab');
    });

    it('defines RepoSubTab type values', () => {
        expect(script).toContain('"info"');
        expect(script).toContain('"pipelines"');
        expect(script).toContain('"tasks"');
    });

    it('renders sub-tab content based on active tab', () => {
        expect(script).toContain('renderSubTabContent');
        expect(script).toContain('renderInfoTab');
        expect(script).toContain('renderPipelinesTab');
        expect(script).toContain('renderTasksTab');
    });

    it('renders task count badge on Tasks sub-tab', () => {
        expect(script).toContain('repo-sub-tab-badge');
    });

    it('renders tasks toolbar in tasks sub-tab', () => {
        expect(script).toContain('repo-tasks-toolbar');
        expect(script).toContain('repo-tasks-new-btn');
        expect(script).toContain('repo-tasks-folder-btn');
        expect(script).toContain('repo-tasks-ai-btn');
    });

    it('renders tasks tree container in tasks sub-tab', () => {
        expect(script).toContain('repo-tasks-tree');
    });

    it('fetches task count for each workspace', () => {
        expect(script).toContain('countTasks');
        expect(script).toContain('taskCount');
    });

    it('shows task count in repo sidebar items', () => {
        expect(script).toContain('taskBadge');
    });

    it('renders pipelines in dedicated sub-tab', () => {
        expect(script).toContain('renderPipelinesTab');
        expect(script).toContain('repo-pipeline-list');
    });

    it('renders info tab with metadata grid and recent processes', () => {
        expect(script).toContain('renderInfoTab');
        expect(script).toContain('meta-grid');
        expect(script).toContain('repo-processes-list');
    });

    it('wires tasks toolbar buttons to task functions', () => {
        expect(script).toContain('wireTasksToolbar');
        expect(script).toContain('createRepoTask');
        expect(script).toContain('createRepoFolder');
        expect(script).toContain('showRepoAIGenerateDialog');
    });

    it('updates hash with sub-tab suffix', () => {
        expect(script).toContain('hashSuffix');
    });

    it('only shows 3 top-level view IDs (no view-tasks)', () => {
        expect(script).toContain('view-processes');
        expect(script).toContain('view-repos');
        expect(script).toContain('view-reports');
        // view-tasks should NOT appear in the viewIds array
        expect(script).not.toContain("'view-tasks'");
    });
});

// ============================================================================
// Tasks as Repo Sub-Page — client bundle tasks module
// ============================================================================

describe('Tasks as repo sub-page — client bundle tasks module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines fetchRepoTasks function', () => {
        expect(script).toContain('fetchRepoTasks');
    });

    it('defines createRepoTask function', () => {
        expect(script).toContain('createRepoTask');
    });

    it('defines createRepoFolder function', () => {
        expect(script).toContain('createRepoFolder');
    });

    it('defines showRepoAIGenerateDialog function', () => {
        expect(script).toContain('showRepoAIGenerateDialog');
    });

    it('renders tasks tree into repo-tasks-tree container', () => {
        expect(script).toContain('repo-tasks-tree');
    });

    it('exposes fetchRepoTasks on window', () => {
        expect(script).toContain('fetchRepoTasks');
    });

    it('exposes createRepoTask on window', () => {
        expect(script).toContain('createRepoTask');
    });

    it('exposes createRepoFolder on window', () => {
        expect(script).toContain('createRepoFolder');
    });

    it('exposes showRepoAIGenerateDialog on window', () => {
        expect(script).toContain('showRepoAIGenerateDialog');
    });

    it('renders Miller columns with folders and documents', () => {
        expect(script).toContain('miller-column');
        expect(script).toContain('miller-row');
        expect(script).toContain('data-nav-folder');
    });

    it('supports task CRUD operations with workspace ID', () => {
        expect(script).toContain('/tasks');
        expect(script).toContain('method:');
    });

    it('supports status display in Miller columns', () => {
        expect(script).toContain('miller-status');
        expect(script).toContain('STATUS_ICONS');
    });

    it('supports archive folder styling', () => {
        expect(script).toContain('task-archive-folder');
        expect(script).toContain('archive');
    });

    it('does not contain standalone workspace selector', () => {
        expect(script).not.toContain('tasks-workspace-select');
        expect(script).not.toContain('initTasksWorkspaceSelector');
    });

    it('does not contain populateTasksWorkspaces', () => {
        expect(script).not.toContain('populateTasksWorkspaces');
    });

    it('renders empty state for missing tasks folder', () => {
        expect(script).toContain('No tasks folder found');
        expect(script).toContain('.vscode/tasks/');
    });
});

// ============================================================================
// Task name display (baseName/fileName)
// ============================================================================

describe('Tasks as repo sub-page — task name display (baseName/fileName)', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('uses baseName for document group display name', () => {
        // The rendering code should reference group.baseName for display
        expect(script).toContain('.baseName');
    });

    it('uses fileName for document path construction', () => {
        // The rendering code should reference doc.fileName for paths
        expect(script).toContain('.fileName');
    });

    it('uses docType for document row display in groups', () => {
        // Document rows within groups show the docType suffix
        expect(script).toContain('.docType');
    });

    it('defines TaskFolder interface with children, documentGroups, singleDocuments', () => {
        // The client-side types should match the API response shape
        expect(script).toContain('documentGroups');
        expect(script).toContain('singleDocuments');
        expect(script).toContain('children');
    });

    it('renders single documents using baseName', () => {
        // Miller column rows use doc.baseName for display
        expect(script).toContain('miller-row-name');
        expect(script).toContain('baseName');
    });

    it('constructs document paths from relativePath and fileName', () => {
        // Path construction should combine relativePath + "/" + fileName
        expect(script).toContain('relativePath');
        expect(script).toContain('fileName');
    });
});

// ============================================================================
// Tasks URL routing
// ============================================================================

describe('Tasks as repo sub-page — URL routing', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('handles #repos/{id}/tasks route', () => {
        // The regex pattern for sub-tab routes
        expect(script).toContain('repos\\/([^/]+)\\/(tasks|pipelines|info)');
    });

    it('handles #repos/{id}/pipelines route', () => {
        expect(script).toContain('pipelines');
    });

    it('redirects #tasks to #repos for backward compatibility', () => {
        // The old #tasks route should redirect to #repos
        expect(script).toContain('"#repos"');
    });

    it('passes sub-tab to showRepoDetail', () => {
        // The routing code passes the matched sub-tab group
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
// Tasks WebSocket integration
// ============================================================================

describe('Tasks as repo sub-page — WebSocket integration', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('imports fetchRepoTasks in websocket module', () => {
        expect(script).toContain('fetchRepoTasks');
    });

    it('handles tasks-changed WebSocket events', () => {
        expect(script).toContain('tasks-changed');
    });

    it('re-fetches tasks when workspace matches', () => {
        expect(script).toContain('selectedWorkspaceId');
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
// Tasks context menu — client bundle functions
// ============================================================================

describe('Tasks context menu — client bundle functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines dismissContextMenu function', () => {
        expect(script).toContain('dismissContextMenu');
    });

    it('defines showTaskContextMenu function', () => {
        expect(script).toContain('showTaskContextMenu');
    });

    it('defines resolveFileStatus function', () => {
        expect(script).toContain('resolveFileStatus');
    });

    it('defines findDocStatus function', () => {
        expect(script).toContain('findDocStatus');
    });

    it('creates context menu element with id task-context-menu', () => {
        expect(script).toContain('task-context-menu');
    });

    it('renders Change Status label in context menu', () => {
        expect(script).toContain('Change Status');
    });

    it('uses data-ctx-action attribute for status actions', () => {
        expect(script).toContain('data-ctx-action');
    });

    it('uses data-ctx-status attribute for target status', () => {
        expect(script).toContain('data-ctx-status');
    });

    it('uses data-ctx-path attribute for file path', () => {
        expect(script).toContain('data-ctx-path');
    });

    it('listens for contextmenu event on container', () => {
        expect(script).toContain('contextmenu');
    });

    it('calls preventDefault on contextmenu event', () => {
        expect(script).toContain('preventDefault');
    });

    it('calls updateStatus when a status submenu item is clicked', () => {
        expect(script).toContain('updateStatus');
    });

    it('dismisses context menu on Escape key', () => {
        expect(script).toContain('Escape');
    });

    it('renders all four status options in submenu', () => {
        // STATUS_CYCLE has pending, in-progress, done, future
        expect(script).toContain('STATUS_CYCLE');
    });

    it('highlights current status with ctx-active class', () => {
        expect(script).toContain('ctx-active');
    });

    it('adjusts menu position to stay within viewport', () => {
        expect(script).toContain('innerWidth');
        expect(script).toContain('innerHeight');
    });

    it('uses set-status as the context action identifier', () => {
        expect(script).toContain('set-status');
    });
});
