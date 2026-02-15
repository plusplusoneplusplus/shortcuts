/**
 * Tests for the extracted client TypeScript source files.
 *
 * Validates:
 * - All 11 client source files exist with correct structure
 * - Correct import/export relationships between modules
 * - No `var` declarations remain (all converted to const/let)
 * - All window globals are assigned for onclick handlers
 * - Config injection pattern is correctly implemented
 * - Shared state module exports required state objects
 * - Circular dependencies are safe (cross-references only in function bodies)
 * - HTML template injects __DASHBOARD_CONFIG__ and uses bundled script
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', 'src', 'server', 'spa', 'client');
const SPA_DIR = path.resolve(__dirname, '..', 'src', 'server', 'spa');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// File existence
// ============================================================================

describe('client source file existence', () => {
    const expectedFiles = [
        'config.ts', 'state.ts', 'utils.ts', 'theme.ts',
        'core.ts', 'sidebar.ts', 'detail.ts', 'filters.ts',
        'queue.ts', 'websocket.ts', 'index.ts',
        'tasks.ts', 'repos.ts',
    ];

    for (const file of expectedFiles) {
        it(`should have client/${file}`, () => {
            expect(fs.existsSync(path.join(CLIENT_DIR, file))).toBe(true);
        });
    }
});

// ============================================================================
// No `var` declarations (all converted to const/let)
// ============================================================================

describe('var to const/let conversion', () => {
    const sourceFiles = [
        'config.ts', 'state.ts', 'utils.ts', 'theme.ts',
        'core.ts', 'sidebar.ts', 'detail.ts', 'filters.ts',
        'queue.ts', 'websocket.ts',
    ];

    for (const file of sourceFiles) {
        it(`${file} should not contain top-level var declarations`, () => {
            const content = readClientFile(file);
            // Match standalone 'var ' at start of line (not inside strings)
            const varMatches = content.match(/^\s*var\s+/gm);
            expect(varMatches).toBeNull();
        });
    }
});

// ============================================================================
// Config module
// ============================================================================

describe('client/config.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('config.ts'); });

    it('exports getApiBase function', () => {
        expect(content).toContain('export function getApiBase');
    });

    it('exports getWsPath function', () => {
        expect(content).toContain('export function getWsPath');
    });

    it('reads from window.__DASHBOARD_CONFIG__', () => {
        expect(content).toContain('__DASHBOARD_CONFIG__');
    });

    it('provides fallback defaults', () => {
        expect(content).toContain("apiBasePath: '/api'");
        expect(content).toContain("wsPath: '/ws'");
    });

    it('defines DashboardConfig interface', () => {
        expect(content).toContain('interface DashboardConfig');
    });
});

// ============================================================================
// State module
// ============================================================================

describe('client/state.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('state.ts'); });

    it('exports AppState interface', () => {
        expect(content).toContain('export interface AppState');
    });

    it('exports QueueState interface', () => {
        expect(content).toContain('export interface QueueState');
    });

    it('exports appState with required fields', () => {
        expect(content).toContain('export const appState');
        expect(content).toContain('processes: []');
        expect(content).toContain('selectedId: null');
        expect(content).toContain('expandedGroups: {}');
        expect(content).toContain('liveTimers: {}');
    });

    it('exports queueState with required fields', () => {
        expect(content).toContain('export const queueState');
        expect(content).toContain('queued: []');
        expect(content).toContain('running: []');
        expect(content).toContain('history: []');
        expect(content).toContain('isPaused: false');
    });

    it('assigns appState to window', () => {
        expect(content).toContain('(window as any).appState = appState');
    });
});

// ============================================================================
// Utils module
// ============================================================================

describe('client/utils.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('utils.ts'); });

    it('exports formatDuration', () => {
        expect(content).toContain('export function formatDuration');
    });

    it('exports formatRelativeTime', () => {
        expect(content).toContain('export function formatRelativeTime');
    });

    it('exports statusIcon', () => {
        expect(content).toContain('export function statusIcon');
    });

    it('exports statusLabel', () => {
        expect(content).toContain('export function statusLabel');
    });

    it('exports typeLabel', () => {
        expect(content).toContain('export function typeLabel');
    });

    it('exports copyToClipboard', () => {
        expect(content).toContain('export function copyToClipboard');
    });

    it('exports escapeHtmlClient', () => {
        expect(content).toContain('export function escapeHtmlClient');
    });

    it('assigns copyToClipboard to window', () => {
        expect(content).toContain('(window as any).copyToClipboard = copyToClipboard');
    });

    it('uses real unicode escapes (not double-escaped)', () => {
        expect(content).not.toContain('\\\\u');
    });
});

// ============================================================================
// Theme module
// ============================================================================

describe('client/theme.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('theme.ts'); });

    it('exports initTheme', () => {
        expect(content).toContain('export function initTheme');
    });

    it('exports toggleTheme', () => {
        expect(content).toContain('export function toggleTheme');
    });

    it('exports applyTheme', () => {
        expect(content).toContain('export function applyTheme');
    });

    it('uses real unicode for theme icons', () => {
        expect(content).toContain('\\u{1F317}');
        expect(content).toContain('\\u{1F319}');
        expect(content).toContain('\\u2600\\uFE0F');
    });

    it('has no imports (self-contained)', () => {
        expect(content).not.toMatch(/^import /m);
    });
});

// ============================================================================
// Core module
// ============================================================================

describe('client/core.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('core.ts'); });

    it('imports from config', () => {
        expect(content).toContain("from './config'");
    });

    it('imports from state', () => {
        expect(content).toContain("from './state'");
    });

    it('imports from theme', () => {
        expect(content).toContain("from './theme'");
    });

    it('imports from filters', () => {
        expect(content).toContain("from './filters'");
    });

    it('imports from sidebar', () => {
        expect(content).toContain("from './sidebar'");
    });

    it('imports from detail', () => {
        expect(content).toContain("from './detail'");
    });

    it('exports init function', () => {
        expect(content).toContain('export async function init');
    });

    it('exports fetchApi function', () => {
        expect(content).toContain('export async function fetchApi');
    });

    it('exports getFilteredProcesses function', () => {
        expect(content).toContain('export function getFilteredProcesses');
    });

    it('exports navigateToProcess function', () => {
        expect(content).toContain('export function navigateToProcess');
    });

    it('uses getApiBase() instead of API_BASE variable', () => {
        expect(content).toContain('getApiBase()');
        expect(content).not.toContain("var API_BASE");
    });

    it('assigns navigateToProcess to window', () => {
        expect(content).toContain('(window as any).navigateToProcess = navigateToProcess');
    });

    it('exposes setHashSilent on window as __setHashSilent', () => {
        expect(content).toContain('(window as any).__setHashSilent = setHashSilent');
    });

    it('handles #repos/{id}/tasks/{filePath} deep link', () => {
        expect(content).toContain('repoTaskFileMatch');
        expect(content).toContain('openTaskFileFromHash');
    });

    it('does not call init() at top level', () => {
        // init() is called from index.ts, not core.ts
        const lines = content.split('\n');
        const topLevelInitCalls = lines.filter(line =>
            line.trim() === 'init();' && !line.includes('//')
        );
        expect(topLevelInitCalls.length).toBe(0);
    });
});

// ============================================================================
// Sidebar module
// ============================================================================

describe('client/sidebar.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('sidebar.ts'); });

    it('imports from state', () => {
        expect(content).toContain("from './state'");
    });

    it('imports from config', () => {
        expect(content).toContain("from './config'");
    });

    it('imports from utils', () => {
        expect(content).toContain("from './utils'");
    });

    it('imports from core', () => {
        expect(content).toContain("from './core'");
    });

    it('imports from detail', () => {
        expect(content).toContain("from './detail'");
    });

    it('exports renderProcessList', () => {
        expect(content).toContain('export function renderProcessList');
    });

    it('exports selectProcess', () => {
        expect(content).toContain('export function selectProcess');
    });

    it('exports updateActiveItem', () => {
        expect(content).toContain('export function updateActiveItem');
    });

    it('uses getApiBase() for clear completed', () => {
        expect(content).toContain('getApiBase()');
    });
});

// ============================================================================
// Detail module
// ============================================================================

describe('client/detail.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('detail.ts'); });

    it('imports from config', () => {
        expect(content).toContain("from './config'");
    });

    it('imports from state', () => {
        expect(content).toContain("from './state'");
    });

    it('imports from utils', () => {
        expect(content).toContain("from './utils'");
    });

    it('imports from core', () => {
        expect(content).toContain("from './core'");
    });

    it('exports renderDetail', () => {
        expect(content).toContain('export function renderDetail');
    });

    it('exports clearDetail', () => {
        expect(content).toContain('export function clearDetail');
    });

    it('exports renderMarkdown', () => {
        expect(content).toContain('export function renderMarkdown');
    });

    it('exports inlineFormat', () => {
        expect(content).toContain('export function inlineFormat');
    });

    it('exports showQueueTaskDetail', () => {
        expect(content).toContain('export function showQueueTaskDetail');
    });

    it('exports copyQueueTaskResult', () => {
        expect(content).toContain('export function copyQueueTaskResult');
    });

    it('assigns clearDetail to window', () => {
        expect(content).toContain('(window as any).clearDetail = clearDetail');
    });

    it('assigns copyQueueTaskResult to window', () => {
        expect(content).toContain('(window as any).copyQueueTaskResult = copyQueueTaskResult');
    });

    it('assigns showQueueTaskDetail to window', () => {
        expect(content).toContain('(window as any).showQueueTaskDetail = showQueueTaskDetail');
    });

    it('exports copyConversationOutput', () => {
        expect(content).toContain('export function copyConversationOutput');
    });

    it('assigns copyConversationOutput to window', () => {
        expect(content).toContain('(window as any).copyConversationOutput = copyConversationOutput');
    });

    it('uses getApiBase() instead of API_BASE', () => {
        expect(content).toContain('getApiBase()');
        expect(content).not.toContain("var API_BASE");
    });

    it('uses real backtick regex (not escaped)', () => {
        expect(content).toContain('/^```/');
    });

    it('uses real unicode for middle dot', () => {
        expect(content).toContain('\\u00B7');
    });
});

// ============================================================================
// Filters module
// ============================================================================

describe('client/filters.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('filters.ts'); });

    it('imports from state', () => {
        expect(content).toContain("from './state'");
    });

    it('imports from core', () => {
        expect(content).toContain("from './core'");
    });

    it('imports from sidebar', () => {
        expect(content).toContain("from './sidebar'");
    });

    it('imports from detail', () => {
        expect(content).toContain("from './detail'");
    });

    it('exports debounce', () => {
        expect(content).toContain('export function debounce');
    });

    it('exports populateWorkspaces', () => {
        expect(content).toContain('export function populateWorkspaces');
    });
});

// ============================================================================
// Queue module
// ============================================================================

describe('client/queue.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('queue.ts'); });

    it('imports from config', () => {
        expect(content).toContain("from './config'");
    });

    it('imports from state', () => {
        expect(content).toContain("from './state'");
    });

    it('imports from core', () => {
        expect(content).toContain("from './core'");
    });

    it('imports from utils', () => {
        expect(content).toContain("from './utils'");
    });

    it('imports from detail', () => {
        expect(content).toContain("from './detail'");
    });

    it('uses getApiBase() instead of API_BASE', () => {
        expect(content).toContain('getApiBase()');
        expect(content).not.toContain("var API_BASE");
    });

    it('imports queueState from state (not local var)', () => {
        expect(content).not.toMatch(/^\s*(?:const|let|var)\s+queueState\s*=/m);
    });

    it('exports fetchQueue', () => {
        expect(content).toContain('export async function fetchQueue');
    });

    it('exports renderQueuePanel', () => {
        expect(content).toContain('export function renderQueuePanel');
    });

    it('assigns all required window globals', () => {
        expect(content).toContain('(window as any).showEnqueueDialog = showEnqueueDialog');
        expect(content).toContain('(window as any).hideEnqueueDialog = hideEnqueueDialog');
        expect(content).toContain('(window as any).queuePause = queuePause');
        expect(content).toContain('(window as any).queueResume = queueResume');
        expect(content).toContain('(window as any).queueClear = queueClear');
        expect(content).toContain('(window as any).queueClearHistory = queueClearHistory');
        expect(content).toContain('(window as any).queueCancelTask = queueCancelTask');
        expect(content).toContain('(window as any).queueMoveUp = queueMoveUp');
        expect(content).toContain('(window as any).queueMoveToTop = queueMoveToTop');
        expect(content).toContain('(window as any).toggleQueueHistory = toggleQueueHistory');
        expect(content).toContain('(window as any).showQueueTaskDetail = showQueueTaskDetail');
    });

    it('uses proper TypeScript typing for poll interval', () => {
        expect(content).toContain('ReturnType<typeof setInterval>');
    });
});

// ============================================================================
// WebSocket module
// ============================================================================

describe('client/websocket.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('websocket.ts'); });

    it('imports getWsPath from config', () => {
        expect(content).toContain("getWsPath");
        expect(content).toContain("from './config'");
    });

    it('imports from state', () => {
        expect(content).toContain("from './state'");
    });

    it('imports from core', () => {
        expect(content).toContain("from './core'");
    });

    it('imports from sidebar', () => {
        expect(content).toContain("from './sidebar'");
    });

    it('imports from detail', () => {
        expect(content).toContain("from './detail'");
    });

    it('imports from queue', () => {
        expect(content).toContain("from './queue'");
    });

    it('exports connectWebSocket', () => {
        expect(content).toContain('export function connectWebSocket');
    });

    it('exports handleWsMessage', () => {
        expect(content).toContain('export function handleWsMessage');
    });

    it('uses getWsPath() instead of hardcoded wsPath', () => {
        expect(content).toContain('getWsPath()');
    });

    it('calls connectWebSocket() at top level', () => {
        // There should be exactly one top-level call (column 0) plus one inside onclose handler
        expect(content).toMatch(/^connectWebSocket\(\);$/m);
    });
});

// ============================================================================
// Index (entry point)
// ============================================================================

describe('client/index.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('index.ts'); });

    it('imports all 8 modules plus config and state', () => {
        expect(content).toContain("import './config'");
        expect(content).toContain("import './state'");
        expect(content).toContain("import './utils'");
        expect(content).toContain("import './theme'");
        expect(content).toContain("import { init } from './core'");
        expect(content).toContain("import './sidebar'");
        expect(content).toContain("import './detail'");
        expect(content).toContain("import './filters'");
        expect(content).toContain("import './queue'");
        expect(content).toContain("import './websocket'");
    });

    it('calls init() at end', () => {
        expect(content).toContain('init()');
    });

    it('imports modules in correct dependency order', () => {
        const configIdx = content.indexOf("import './config'");
        const stateIdx = content.indexOf("import './state'");
        const utilsIdx = content.indexOf("import './utils'");
        const themeIdx = content.indexOf("import './theme'");
        const coreIdx = content.indexOf("import { init }");
        const sidebarIdx = content.indexOf("import './sidebar'");
        const detailIdx = content.indexOf("import './detail'");
        const filtersIdx = content.indexOf("import './filters'");
        const queueIdx = content.indexOf("import './queue'");
        const wsIdx = content.indexOf("import './websocket'");

        expect(configIdx).toBeLessThan(stateIdx);
        expect(stateIdx).toBeLessThan(utilsIdx);
        expect(utilsIdx).toBeLessThan(themeIdx);
        expect(themeIdx).toBeLessThan(coreIdx);
        expect(coreIdx).toBeLessThan(sidebarIdx);
        expect(sidebarIdx).toBeLessThan(detailIdx);
        expect(detailIdx).toBeLessThan(filtersIdx);
        expect(filtersIdx).toBeLessThan(queueIdx);
        expect(queueIdx).toBeLessThan(wsIdx);
    });
});

// ============================================================================
// HTML template — config injection
// ============================================================================

describe('html-template.ts — config injection', () => {
    let content: string;
    beforeAll(() => {
        content = fs.readFileSync(path.join(SPA_DIR, 'html-template.ts'), 'utf8');
    });

    it('injects window.__DASHBOARD_CONFIG__ in a script block', () => {
        expect(content).toContain('window.__DASHBOARD_CONFIG__');
    });

    it('injects apiBasePath into config', () => {
        expect(content).toContain("apiBasePath: '${escapeHtml(apiBasePath)}'");
    });

    it('injects wsPath into config', () => {
        expect(content).toContain("wsPath: '${escapeHtml(wsPath)}'");
    });

    it('does not import getDashboardScript', () => {
        expect(content).not.toContain("from './scripts'");
    });

    it('reads client bundles from file at module level', () => {
        expect(content).toContain('bundleCss');
        expect(content).toContain('bundleJs');
        expect(content).toContain('bundle.css');
        expect(content).toContain('bundle.js');
    });
});

// ============================================================================
// Old scripts directory removed
// ============================================================================

describe('old scripts files removed', () => {
    it('scripts/ directory should not exist', () => {
        expect(fs.existsSync(path.join(SPA_DIR, 'scripts'))).toBe(false);
    });

    it('scripts.ts assembler should not exist', () => {
        expect(fs.existsSync(path.join(SPA_DIR, 'scripts.ts'))).toBe(false);
    });
});

// ============================================================================
// Window globals completeness
// ============================================================================

describe('window global assignments', () => {
    it('should have all 23 required window globals across client modules', () => {
        const allContent = [
            'state.ts', 'utils.ts', 'core.ts', 'detail.ts', 'queue.ts',
            'tasks.ts', 'repos.ts',
        ].map(f => readClientFile(f)).join('\n');

        const expectedGlobals = [
            'appState',
            'copyToClipboard',
            'navigateToProcess',
            'clearDetail',
            'copyQueueTaskResult',
            'copyConversationOutput',
            'showQueueTaskDetail',
            'showEnqueueDialog',
            'hideEnqueueDialog',
            'queuePause',
            'queueResume',
            'queueClear',
            'queueClearHistory',
            'queueCancelTask',
            'queueMoveUp',
            'queueMoveToTop',
            'toggleQueueHistory',
            'fetchRepoTasks',
            'createRepoTask',
            'createRepoFolder',
            'showRepoAIGenerateDialog',
            'openTaskFileFromHash',
            '__setHashSilent',
        ];

        for (const name of expectedGlobals) {
            expect(allContent).toContain(`(window as any).${name} =`);
        }
    });
});

// ============================================================================
// Tasks module
// ============================================================================

describe('client/tasks.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('tasks.ts'); });

    it('imports from state', () => {
        expect(content).toContain("from './state'");
    });

    it('imports from config', () => {
        expect(content).toContain("from './config'");
    });

    it('imports from core', () => {
        expect(content).toContain("from './core'");
    });

    it('imports from utils', () => {
        expect(content).toContain("from './utils'");
    });

    it('exports fetchRepoTasks', () => {
        expect(content).toContain('export async function fetchRepoTasks');
    });

    it('exports createRepoTask', () => {
        expect(content).toContain('export async function createRepoTask');
    });

    it('exports createRepoFolder', () => {
        expect(content).toContain('export async function createRepoFolder');
    });

    it('exports showRepoAIGenerateDialog', () => {
        expect(content).toContain('export function showRepoAIGenerateDialog');
    });

    it('assigns required window globals', () => {
        expect(content).toContain('(window as any).fetchRepoTasks = fetchRepoTasks');
        expect(content).toContain('(window as any).createRepoTask = createRepoTask');
        expect(content).toContain('(window as any).createRepoFolder = createRepoFolder');
        expect(content).toContain('(window as any).showRepoAIGenerateDialog = showRepoAIGenerateDialog');
    });

    it('prevents duplicate event listener attachment', () => {
        expect(content).toContain('treeListenerAttached');
        expect(content).toContain('treeListenerContainer');
    });

    it('has renderMarkdown function for file preview', () => {
        expect(content).toContain('function renderMarkdown');
    });

    it('has openTaskFile function for click-to-open', () => {
        expect(content).toContain('async function openTaskFile');
    });

    it('has closeTaskPreview function', () => {
        expect(content).toContain('function closeTaskPreview');
    });

    it('has openTaskFileFromHash for deep-link navigation', () => {
        expect(content).toContain('async function openTaskFileFromHash');
    });

    it('exposes openTaskFileFromHash on window', () => {
        expect(content).toContain('(window as any).openTaskFileFromHash = openTaskFileFromHash');
    });

    it('has updateTaskHash for URL state management', () => {
        expect(content).toContain('function updateTaskHash');
    });

    it('updates taskPanelState.openFilePath on open', () => {
        expect(content).toContain('taskPanelState.openFilePath = filePath');
    });

    it('clears taskPanelState.openFilePath on close', () => {
        expect(content).toContain('taskPanelState.openFilePath = null');
    });

    it('adds split-open class to layout when file is opened', () => {
        expect(content).toContain('split-open');
    });

    it('removes split-open class when preview is closed', () => {
        expect(content).toContain("layout.classList.remove('split-open')");
    });

    it('uses __setHashSilent from window for URL updates', () => {
        expect(content).toContain('__setHashSilent');
    });

    it('has countFolderItems function for recursive item counting', () => {
        expect(content).toContain('function countFolderItems');
    });

    it('renders folder count badge in folder rows', () => {
        expect(content).toContain('task-folder-count');
    });

    it('countFolderItems counts singleDocuments', () => {
        expect(content).toContain('folder.singleDocuments');
    });

    it('countFolderItems counts documentGroups', () => {
        expect(content).toContain('folder.documentGroups');
    });

    it('countFolderItems recurses into children', () => {
        expect(content).toContain('countFolderItems(child)');
    });

    it('renders file rows with data-file-path attribute', () => {
        expect(content).toContain('data-file-path');
    });

    it('handles folder row clicks for expand/collapse', () => {
        expect(content).toContain("target.closest('.task-folder-row')");
    });

    it('handles file row clicks for opening preview', () => {
        expect(content).toContain("target.closest('[data-file-path]')");
    });

    it('fetches file content via API for preview', () => {
        expect(content).toContain('/tasks/content?path=');
    });

    it('renderMarkdown strips YAML frontmatter', () => {
        expect(content).toContain('Strip YAML frontmatter');
    });

    it('renderMarkdown handles headings', () => {
        expect(content).toContain('<h1>');
        expect(content).toContain('<h2>');
        expect(content).toContain('<h3>');
        expect(content).toContain('<h4>');
    });

    it('renderMarkdown handles code blocks', () => {
        expect(content).toContain('<pre><code');
    });

    it('renderMarkdown handles checkboxes', () => {
        expect(content).toContain('task-checkbox');
    });

    it('renderMarkdown handles bold and italic', () => {
        expect(content).toContain('<strong>');
        expect(content).toContain('<em>');
    });
});

// ============================================================================
// Repos module
// ============================================================================

describe('client/repos.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('repos.ts'); });

    it('imports from state', () => {
        expect(content).toContain("from './state'");
    });

    it('imports from config', () => {
        expect(content).toContain("from './config'");
    });

    it('imports from core', () => {
        expect(content).toContain("from './core'");
    });

    it('imports from utils', () => {
        expect(content).toContain("from './utils'");
    });

    it('exports switchTab', () => {
        expect(content).toContain('export function switchTab');
    });

    it('exports fetchReposData', () => {
        expect(content).toContain('export async function fetchReposData');
    });

    it('exports showRepoDetail', () => {
        expect(content).toContain('export function showRepoDetail');
    });

    it('exports showAddRepoDialog', () => {
        expect(content).toContain('export function showAddRepoDialog');
    });

    it('assigns required window globals', () => {
        expect(content).toContain('(window as any).switchTab = switchTab');
        expect(content).toContain('(window as any).showAddRepoDialog = showAddRepoDialog');
        expect(content).toContain('(window as any).showRepoDetail = showRepoDetail');
    });

    it('renders tasks sub-tab with toolbar', () => {
        expect(content).toContain('repo-tasks-new-btn');
        expect(content).toContain('repo-tasks-folder-btn');
        expect(content).toContain('repo-tasks-ai-btn');
    });

    it('renders tasks split layout container', () => {
        expect(content).toContain('tasks-split-layout');
        expect(content).toContain('task-file-preview');
    });

    it('showRepoDetail accepts optional taskFile parameter', () => {
        expect(content).toContain('taskFile?: string');
    });

    it('includes task file path in URL hash', () => {
        expect(content).toContain("encodeURIComponent(taskFile)");
    });
});

// ============================================================================
// State module — TaskPanelState
// ============================================================================

describe('client/state.ts — TaskPanelState', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('state.ts'); });

    it('exports TaskPanelState interface', () => {
        expect(content).toContain('export interface TaskPanelState');
    });

    it('exports taskPanelState with required fields', () => {
        expect(content).toContain('export const taskPanelState');
        expect(content).toContain('selectedWorkspaceId: null');
        expect(content).toContain('expandedFolders: {}');
        expect(content).toContain('openFilePath: null');
    });
});

// ============================================================================
// CSS — Task styles
// ============================================================================

describe('styles.css — Task styles', () => {
    let cssContent: string;
    beforeAll(() => {
        cssContent = fs.readFileSync(path.join(CLIENT_DIR, 'styles.css'), 'utf8');
    });

    it('has task tree styles', () => {
        expect(cssContent).toContain('.tasks-tree');
        expect(cssContent).toContain('.task-tree-row');
        expect(cssContent).toContain('.task-tree-toggle');
        expect(cssContent).toContain('.task-tree-children');
    });

    it('has hidden class for collapsed children', () => {
        expect(cssContent).toContain('.task-tree-children.hidden');
    });

    it('has task status badge styles', () => {
        expect(cssContent).toContain('.task-status-badge');
        expect(cssContent).toContain('.task-status-pending');
        expect(cssContent).toContain('.task-status-in-progress');
        expect(cssContent).toContain('.task-status-done');
        expect(cssContent).toContain('.task-status-future');
    });

    it('has clickable folder row cursor', () => {
        expect(cssContent).toContain('.task-folder-row');
    });

    it('has active file highlight style', () => {
        expect(cssContent).toContain('.task-file-active');
    });

    it('has horizontal split layout styles', () => {
        expect(cssContent).toContain('.tasks-split-layout');
        expect(cssContent).toContain('.split-open');
        expect(cssContent).toContain('.tasks-split-layout.split-open .tasks-tree');
        expect(cssContent).toContain('.tasks-split-layout.split-open .task-file-preview');
    });

    it('has file preview panel styles', () => {
        expect(cssContent).toContain('.task-file-preview');
        expect(cssContent).toContain('.task-preview-header');
        expect(cssContent).toContain('.task-preview-body');
        expect(cssContent).toContain('.task-preview-close');
        expect(cssContent).toContain('.task-preview-title');
    });

    it('has preview body markdown rendering styles', () => {
        expect(cssContent).toContain('.task-preview-body h1');
        expect(cssContent).toContain('.task-preview-body code');
        expect(cssContent).toContain('.task-preview-body pre');
        expect(cssContent).toContain('.task-preview-body blockquote');
    });

    it('has checkbox styling', () => {
        expect(cssContent).toContain('.task-checkbox');
        expect(cssContent).toContain('.task-checkbox.checked');
    });

    it('has loading and error states for preview', () => {
        expect(cssContent).toContain('.task-preview-loading');
        expect(cssContent).toContain('.task-preview-error');
    });

    it('has folder item count badge style', () => {
        expect(cssContent).toContain('.task-folder-count');
    });
});

// ============================================================================
// Escape character correctness
// ============================================================================

describe('escape character conversion', () => {
    it('no double-escaped unicode in any client file', () => {
        const sourceFiles = [
            'config.ts', 'state.ts', 'utils.ts', 'theme.ts',
            'core.ts', 'sidebar.ts', 'detail.ts', 'filters.ts',
            'queue.ts', 'websocket.ts',
        ];
        for (const file of sourceFiles) {
            const content = readClientFile(file);
            // Double-escaped unicode like \\u{1F504} should not exist
            expect(content).not.toMatch(/\\\\u\{/);
            expect(content).not.toMatch(/\\\\u[0-9A-Fa-f]{4}/);
        }
    });
});
