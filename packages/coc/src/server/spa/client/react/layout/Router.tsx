/**
 * Router — hash-based routing for the SPA tabs.
 * Reads activeTab from AppContext, renders the appropriate view.
 */

import { useEffect, useLayoutEffect, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import type { AppContextState } from '../contexts/AppContext';
import { useQueue } from '../contexts/QueueContext';
import { ReposView } from '../repos';
import { WikiView } from '../wiki/WikiView';
import { SHOW_WIKI_TAB } from './TopBar';
import { isTerminalEnabled, isNotesEnabled } from '../utils/config';
import { getUiLayoutMode } from '../hooks/preferences/useUiLayoutMode';
import type { UiLayoutMode } from '../types/dashboard';
import { lazy, Suspense } from 'react';
import type { DashboardTab, RepoSubTab, WikiProjectTab, WikiAdminTab, MemorySubTab, SkillsSubTab, AdminSubTab, PrDetailTab, SettingsSection } from '../types/dashboard';
import { SETTINGS_SECTION_VALUES, REPO_SUB_TAB_VALUES, WIKI_PROJECT_TAB_VALUES, WIKI_ADMIN_TAB_VALUES } from '../types/dashboard';

const AdminPanel = lazy(() => import('../admin/AdminPanel').then(m => ({ default: m.AdminPanel })));
// Memory/Skills/Logs/Usage/Models/Servers no longer mount as standalone
// top-level views — they render embedded inside AdminPanel's right pane.
// All these tabs fall through to the admin shell so the sidebar stays mounted.

function StubView({ id, label }: { id: string; label: string }) {
    return <div id={id}>{label}</div>;
}

export function tabFromHash(hash: string): DashboardTab | null {
    const h = hash.replace(/^#/, '').split('/')[0].split('?')[0];
    if (h === 'repos' || h === 'tasks') return 'repos';
    if (h === 'wiki') return 'wiki';
    if (h === 'reports') return 'reports';
    if (h === 'stats') return 'stats';
    if (h === 'memory') return 'memory';
    if (h === 'skills') return 'skills';
    if (h === 'logs') return 'logs';
    if (h === 'models') return 'models';
    if (h === 'servers') return 'servers';
    if (h === 'admin') return 'admin';
    return null;
}

export const VALID_WIKI_PROJECT_TABS: Set<string> = new Set(WIKI_PROJECT_TAB_VALUES);
export const VALID_WIKI_ADMIN_TABS: Set<string> = new Set(WIKI_ADMIN_TAB_VALUES);

export interface WikiDeepLink {
    wikiId: string | null;
    tab: WikiProjectTab | null;
    componentId: string | null;
    adminTab: WikiAdminTab | null;
}

export function parseWikiDeepLink(hash: string): WikiDeepLink {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] !== 'wiki' || !parts[1]) return { wikiId: null, tab: null, componentId: null, adminTab: null };

    const wikiId = decodeURIComponent(parts[1]);

    if (parts.length >= 4 && parts[2] === 'component' && parts[3]) {
        return { wikiId, tab: 'browse', componentId: decodeURIComponent(parts[3]), adminTab: null };
    }

    if (parts.length >= 3 && VALID_WIKI_PROJECT_TABS.has(parts[2])) {
        const tab = parts[2] as WikiProjectTab;
        let adminTab: WikiAdminTab | null = null;
        if (tab === 'admin' && parts.length >= 4 && VALID_WIKI_ADMIN_TABS.has(parts[3])) {
            adminTab = parts[3] as WikiAdminTab;
        }
        return { wikiId, tab, componentId: null, adminTab };
    }

    return { wikiId, tab: null, componentId: null, adminTab: null };
}

export function parseProcessDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    const root = parts[0];

    if ((root === 'process' || root === 'session') && parts[1]) {
        return decodeURIComponent(parts[1]);
    }
    if (root === 'processes' && parts[1]) {
        return decodeURIComponent(parts[1]);
    }

    return null;
}

export function parseWorkflowsDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && (parts[2] === 'templates' || parts[2] === 'workflows') && parts[3]) {
        // chat-template sub-path is handled separately
        if (parts[3] === 'chat-template') return null;
        return decodeURIComponent(parts[3]);
    }
    return null;
}

export function parseChatTemplateDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && (parts[2] === 'templates' || parts[2] === 'workflows') && parts[3] === 'chat-template' && parts[4]) {
        return decodeURIComponent(parts[4]);
    }
    return null;
}

export function parseWorkflowsRunDeepLink(hash: string): { workflowName: string; processId: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && (parts[2] === 'templates' || parts[2] === 'workflows') && parts[3] && parts[4] === 'run' && parts[5]) {
        return {
            workflowName: decodeURIComponent(parts[3]),
            processId: decodeURIComponent(parts[5]),
        };
    }
    return null;
}

export function parseGitCommitDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'git' && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

export function parseGitFileDeepLink(hash: string): { commitHash: string; filePath: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'git' && parts[3] && parts[4]) {
        return {
            commitHash: decodeURIComponent(parts[3]),
            filePath: decodeURIComponent(parts[4]),
        };
    }
    return null;
}

/** Build a pop-out URL for git commit review. */
export function buildGitReviewPopOutUrl(workspaceId: string, commitHash: string): string {
    return `/?workspace=${encodeURIComponent(workspaceId)}#popout/git-review/${encodeURIComponent(commitHash)}`;
}

/** Build a pop-out URL for branch-range review. */
export function buildGitBranchRangePopOutUrl(workspaceId: string): string {
    return `/?workspace=${encodeURIComponent(workspaceId)}#popout/git-review/branch-range`;
}

/** Build a pop-out URL for PR review. */
export function buildGitPrPopOutUrl(workspaceId: string, repoId: string, prId: string | number): string {
    return `/?workspace=${encodeURIComponent(workspaceId)}&repo=${encodeURIComponent(repoId)}#popout/git-review/pr/${encodeURIComponent(String(prId))}`;
}

export function parseWorkflowDeepLink(hash: string): { repoId: string; processId: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'workflow' && parts[3]) {
        return {
            repoId: decodeURIComponent(parts[1]),
            processId: decodeURIComponent(parts[3]),
        };
    }
    return null;
}

export const VALID_PR_DETAIL_TABS: Set<string> = new Set(['overview', 'files', 'commits', 'checks']);

export function parsePrDetailTab(hash: string): PrDetailTab {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'pull-requests' && parts[3] && parts[4] && VALID_PR_DETAIL_TABS.has(parts[4])) {
        return parts[4] as PrDetailTab;
    }
    return 'overview';
}

export function parseActivityDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && (parts[2] === 'chats' || parts[2] === 'activity') && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

/** Parse a tasks deep-link: `#repos/{wsId}/tasks/{taskId}`. */
export function parseTasksDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'tasks' && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

/**
 * Parse a Ralph workflow deep-link:
 *   `#repos/{wsId}/(activity|chats|tasks)/ralph/{sessionId}`
 *
 * Returns `{ workspaceId, sessionId }` when the hash matches, `null`
 * otherwise. The chat-surface segment is allowed to be either alias
 * (matches `parseActivityDeepLink`).
 */
export function parseRalphSessionDeepLink(
    hash: string,
): { workspaceId: string; sessionId: string } | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (
        parts[0] === 'repos' &&
        parts[1] &&
        (parts[2] === 'chats' || parts[2] === 'activity' || parts[2] === 'tasks') &&
        parts[3] === 'ralph' &&
        parts[4]
    ) {
        return {
            workspaceId: decodeURIComponent(parts[1]),
            sessionId: decodeURIComponent(parts[4]),
        };
    }
    return null;
}

/**
 * Parse a note deep-link: `#repos/{wsId}/notes/{path/segments}`.
 * Each path segment is decoded individually so embedded `/` delimiters
 * within segment names (encoded as `%2F`) are preserved correctly.
 */
export function parseNoteDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'notes' && parts[3]) {
        return parts.slice(3).map(decodeURIComponent).join('/');
    }
    return null;
}

/**
 * Build a hash string for a note deep-link.
 * Each segment of the note path is URI-encoded individually.
 */
export function buildNoteHash(wsId: string, notePath: string): string {
    const encodedPath = notePath.split('/').map(encodeURIComponent).join('/');
    return '#repos/' + encodeURIComponent(wsId) + '/notes/' + encodedPath;
}

export function buildRepoSubTabSuffix(
    tab: RepoSubTab,
    state: AppContextState,
    selectedTaskId?: string | null
): string {
    if (tab === 'settings') {
        return '/settings/' + encodeURIComponent(state.settingsSection);
    }
    if (tab === 'git') {
        if (!state.selectedGitCommitHash) return '/git';
        const hash = encodeURIComponent(state.selectedGitCommitHash);
        const file = state.selectedGitFilePath
            ? '/' + encodeURIComponent(state.selectedGitFilePath)
            : '';
        return '/git/' + hash + file;
    }
    if (tab === 'notes') {
        if (!state.selectedNotePath) return '/notes';
        return '/notes/' + state.selectedNotePath.split('/').map(encodeURIComponent).join('/');
    }
    if ((tab === 'chats' || tab === 'activity' || tab === 'tasks') && selectedTaskId) {
        return '/' + tab + '/' + encodeURIComponent(selectedTaskId);
    }
    return '/' + tab;
}

// ── Work-items deep-links ─────────────────────────────────────────────

export interface WorkItemDeepLink {
    itemId: string | null;
    sessionTaskId: string | null;
    commitHash: string | null;
    commitFilePath: string | null;
}

/**
 * Parse a work-items deep-link. Supported forms:
 *   #repos/{wsId}/work-items/{itemId}
 *   #repos/{wsId}/work-items/{itemId}/session/{taskId}
 *   #repos/{wsId}/work-items/{itemId}/commit/{sha}
 *   #repos/{wsId}/work-items/{itemId}/commit/{sha}/{filePath...}
 */
export function parseWorkItemDeepLink(hash: string): WorkItemDeepLink {
    const base: WorkItemDeepLink = { itemId: null, sessionTaskId: null, commitHash: null, commitFilePath: null };
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] !== 'repos' || !parts[1] || parts[2] !== 'work-items' || !parts[3]) return base;
    const itemId = decodeURIComponent(parts[3]);
    if (parts[4] === 'session' && parts[5]) {
        return { itemId, sessionTaskId: decodeURIComponent(parts[5]), commitHash: null, commitFilePath: null };
    }
    if (parts[4] === 'commit' && parts[5]) {
        const commitHash = decodeURIComponent(parts[5]);
        const commitFilePath = parts[6] ? parts.slice(6).map(decodeURIComponent).join('/') : null;
        return { itemId, sessionTaskId: null, commitHash, commitFilePath };
    }
    return { itemId, sessionTaskId: null, commitHash: null, commitFilePath: null };
}

/** Build `#repos/{wsId}/work-items/{itemId}` */
export function buildWorkItemHash(wsId: string, itemId: string): string {
    return '#repos/' + encodeURIComponent(wsId) + '/work-items/' + encodeURIComponent(itemId);
}

/** Build `#repos/{wsId}/work-items/{itemId}/session/{taskId}` */
export function buildWorkItemSessionHash(wsId: string, itemId: string, taskId: string): string {
    return '#repos/' + encodeURIComponent(wsId) + '/work-items/' + encodeURIComponent(itemId) + '/session/' + encodeURIComponent(taskId);
}

/** Build `#repos/{wsId}/work-items/{itemId}/commit/{sha}[/{filePath...}]` */
export function buildWorkItemCommitHash(wsId: string, itemId: string, commitHash: string, filePath?: string): string {
    let h = '#repos/' + encodeURIComponent(wsId) + '/work-items/' + encodeURIComponent(itemId) + '/commit/' + encodeURIComponent(commitHash);
    if (filePath) {
        h += '/' + filePath.split('/').map(encodeURIComponent).join('/');
    }
    return h;
}

export const VALID_REPO_SUB_TABS: Set<string> = new Set(REPO_SUB_TAB_VALUES);

/**
 * Resolve the canonical chat-tab segment for the current UI layout mode.
 * Classic mode names the chat surface `'activity'`; dev-workflow names it
 * `'chats'`. Used by the keyboard-shortcut handler to ensure Alt+A produces
 * the correct sub-tab key + URL for the user's current layout mode.
 *
 * The render path in `RepoDetail` accepts both keys interchangeably so cross-
 * mode URLs work without needing to redirect or rewrite the hash (which would
 * race with the asynchronous preferences fetch).
 */
export function resolveChatSubTab(mode: UiLayoutMode): RepoSubTab {
    return mode === 'classic' ? 'activity' : 'chats';
}

export const VALID_SETTINGS_SECTIONS: Set<string> = new Set(SETTINGS_SECTION_VALUES);
/** @deprecated Use VALID_SETTINGS_SECTIONS */
export const VALID_COPILOT_SECTIONS: Set<string> = VALID_SETTINGS_SECTIONS;

export function parseSettingsSection(hash: string): SettingsSection {
    const parts = hash.replace(/^#/, '').split('/');
    if (parts[0] === 'repos' && parts[2] === 'settings' && parts[3]) {
        const section = decodeURIComponent(parts[3]);
        if (VALID_SETTINGS_SECTIONS.has(section)) return section as SettingsSection;
    }
    return 'info';
}

/** @deprecated Use parseSettingsSection */
export function parseCopilotSection(hash: string): SettingsSection {
    return parseSettingsSection(hash);
}

const ALL_REPO_TAB_SHORTCUTS: Record<string, RepoSubTab> = {
    g: 'git',
    e: 'explorer',
    t: 'tasks',
    r: 'pull-requests',
    a: 'chats',
    w: 'workflows',
    s: 'schedules',
    c: 'settings',
    i: 'work-items',
    n: 'notes',
};

export const REPO_TAB_SHORTCUTS: Record<string, RepoSubTab> = SHOW_WIKI_TAB
    ? ALL_REPO_TAB_SHORTCUTS
    : Object.fromEntries(Object.entries(ALL_REPO_TAB_SHORTCUTS).filter(([, v]) => v !== 'wiki'));


export const VALID_ADMIN_SUB_TABS: Set<string> = new Set(['settings', 'providers', 'data', 'server', 'prompts', 'database', 'agents']);

/** Container-only admin sub-tabs (not included in the base set). */
const CONTAINER_ADMIN_SUB_TABS: Set<string> = new Set(['messaging']);

export function parseAdminSubTab(hash: string): AdminSubTab | null {
    const parts = hash.replace(/^#/, '').split('/');
    if (parts[0] !== 'admin') return null;
    if (parts.length >= 2 && (VALID_ADMIN_SUB_TABS.has(parts[1]) || CONTAINER_ADMIN_SUB_TABS.has(parts[1]))) return parts[1] as AdminSubTab;
    return null;
}

export interface AdminDatabaseDeepLink {
    table: string | null;
    page: number;
    sort: string | null;
    order: 'asc' | 'desc' | null;
}

export function parseAdminDatabaseDeepLink(hash: string): AdminDatabaseDeepLink {
    const defaults: AdminDatabaseDeepLink = { table: null, page: 1, sort: null, order: null };
    const cleaned = hash.replace(/^#/, '');
    // Split query string from path
    const [pathPart, queryPart] = cleaned.split('?');
    const parts = pathPart.split('/');
    if (parts[0] !== 'admin' || parts[1] !== 'database') return defaults;
    const table = parts[2] ? decodeURIComponent(parts[2]) : null;
    if (!table) return defaults;

    const params = new URLSearchParams(queryPart || '');
    const pageStr = params.get('page');
    const page = pageStr ? Math.max(1, parseInt(pageStr, 10) || 1) : 1;
    const sort = params.get('sort') ? decodeURIComponent(params.get('sort')!) : null;
    const rawOrder = params.get('order');
    const order: 'asc' | 'desc' | null = rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder : null;

    return { table, page, sort, order };
}

export function buildDbBrowserHash(table: string | null, page: number, sort: string | null, order: 'asc' | 'desc' | null): string {
    if (!table) return 'admin/database';
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (sort && order) {
        params.set('sort', sort);
        params.set('order', order);
    }
    const qs = params.toString();
    return `admin/database/${encodeURIComponent(table)}${qs ? '?' + qs : ''}`;
}

export function Router() {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();

    const switchTab = useCallback((tab: string) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: tab as DashboardTab });
    }, [dispatch]);

    // Register global switchTab for backward compat with legacy modules
    useEffect(() => {
        (window as any).switchTab = switchTab;
        return () => { delete (window as any).switchTab; };
    }, [switchTab]);

    // Handle hash changes — parse #repos/:id/:subTab
    // useLayoutEffect fires synchronously before browser paint so the correct
    // repo/section is already set on the first visible render, preventing a
    // blank-page flash when navigating directly to a deep-link (e.g. on refresh).
    useLayoutEffect(() => {
        const handleHash = () => {
            const hash = location.hash.replace(/^#/, '');
            const tab = tabFromHash('#' + hash);
            if (tab) {
                dispatch({ type: 'SET_ACTIVE_TAB', tab });
            } else if (!hash) {
                dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
                return;
            }

            // Parse repo deep links: #repos/:id or #repos/:id/:subTab
            if (tab === 'repos') {
                const parts = hash.split('/');
                if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                    const repoId = decodeURIComponent(parts[1]);
                    dispatch({ type: 'SET_SELECTED_REPO', id: repoId });
                    // Redirect legacy #repos/:id/workflows deep-links to workflows tab
                    if (parts[2] === 'workflows') {
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'workflows' as RepoSubTab });
                    }
                    // Redirect legacy #repos/:id/templates deep-links to workflows tab
                    if (parts[2] === 'templates') {
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'workflows' as RepoSubTab });
                        const suffix = parts.slice(3).map(encodeURIComponent).join('/');
                        location.replace('#repos/' + parts[1] + '/workflows' + (suffix ? '/' + suffix : ''));
                        return;
                    }
                    // Redirect legacy #repos/:id/settings/run-script-template to workflows tab
                    if (parts[2] === 'settings' && parts[3] === 'run-script-template') {
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'workflows' as RepoSubTab });
                        location.replace('#repos/' + parts[1] + '/workflows');
                        return;
                    }
                    if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: parts[2] as RepoSubTab });
                    }
                    // Workflow deep-link handling
                    if (parts[2] === 'workflows' && parts[3] === 'script-template' && parts[4]) {
                        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: decodeURIComponent(parts[4]) });
                        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
                        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: null });
                        dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                    } else if (parts[2] === 'workflows' && parts[3] === 'chat-template' && parts[4]) {
                        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: decodeURIComponent(parts[4]) });
                        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
                        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null });
                        dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                    } else if (parts[2] === 'workflows' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: decodeURIComponent(parts[3]) });
                        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: null });
                        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null });
                        // Workflow run detail: #repos/:id/workflows/:name/run/:processId
                        if (parts[4] === 'run' && parts[5]) {
                            dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: decodeURIComponent(parts[5]) });
                        } else {
                            dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                        }
                    } else if (parts[2] === 'workflows') {
                        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
                        dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                        dispatch({ type: 'SET_SELECTED_SKILL_TEMPLATE', id: null });
                        dispatch({ type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null });
                    } else if (parts[2] && parts[2] !== 'workflows') {
                        dispatch({ type: 'SET_SELECTED_WORKFLOW', name: null });
                        dispatch({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                    }
                    // Schedule deep-link handling: #repos/{id}/schedules/{scheduleId}
                    if (parts[2] === 'schedules' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_SCHEDULE', id: decodeURIComponent(parts[3]) });
                    } else if (parts[2] === 'schedules') {
                        dispatch({ type: 'SET_SELECTED_SCHEDULE', id: null });
                    }
                    // Chats / activity deep-link handling — select task when ID present.
                    // Both URL segments are aliases for the chat surface (the canonical
                    // key differs by layout mode). Treat them identically here.
                    // The `ralph/<sid>` sub-segment is a separate Ralph workflow link
                    // owned by RepoChatTab — leave the queue task selection alone.
                    if ((parts[2] === 'chats' || parts[2] === 'activity') && parts[3] && parts[3] !== 'ralph') {
                        const rawId = decodeURIComponent(parts[3]);
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: rawId, repoId });
                    } else if (parts[2] === 'chats' || parts[2] === 'activity') {
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId });
                    }
                    // Tasks deep-link handling — select task when ID present.
                    // Skip the `ralph/<sid>` sub-segment (handled by RepoChatTab).
                    if (parts[2] === 'tasks' && parts[3] && parts[3] !== 'ralph') {
                        const rawId = decodeURIComponent(parts[3]);
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: rawId, repoId });
                    } else if (parts[2] === 'tasks') {
                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId });
                    }
                    // Git commit deep-link handling
                    if (parts[2] === 'git' && parts[3]) {
                        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: decodeURIComponent(parts[3]) });
                        if (parts[4]) {
                            dispatch({ type: 'SET_GIT_FILE_PATH', filePath: decodeURIComponent(parts[4]) });
                        } else {
                            dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
                        }
                    } else if (parts[2] === 'git') {
                        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: null });
                        dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
                    }
                    // Wiki deep-link: #repos/{id}/wiki/{wikiId} and deeper paths
                    if (parts[2] === 'wiki' && parts[3]) {
                        const wikiId = decodeURIComponent(parts[3]);
                        if (parts[4] === 'component' && parts[5]) {
                            dispatch({
                                type: 'SET_REPO_WIKI_DEEP_LINK',
                                wikiId,
                                tab: 'browse',
                                componentId: decodeURIComponent(parts[5]),
                            });
                        } else if (parts[4] && VALID_WIKI_PROJECT_TABS.has(parts[4])) {
                            const tab = parts[4] as WikiProjectTab;
                            let adminTab: WikiAdminTab | null = null;
                            if (tab === 'admin' && parts[5] && VALID_WIKI_ADMIN_TABS.has(parts[5])) {
                                adminTab = parts[5] as WikiAdminTab;
                            }
                            dispatch({ type: 'SET_REPO_WIKI_DEEP_LINK', wikiId, tab, adminTab });
                        } else {
                            dispatch({ type: 'SET_REPO_WIKI_ID', wikiId });
                        }
                    } else if (parts[2] === 'wiki') {
                        dispatch({ type: 'SET_REPO_WIKI_ID', wikiId: null });
                    }
                    // Workflow detail deep-link: #repos/{id}/workflow/{processId}
                    if (parts[2] === 'workflow' && parts[3]) {
                        dispatch({ type: 'SET_WORKFLOW_PROCESS', processId: decodeURIComponent(parts[3]) });
                    } else if (parts[2] === 'workflow') {
                        dispatch({ type: 'SET_WORKFLOW_PROCESS', processId: null });
                    }
                    // Explorer deep-link: #repos/{id}/explorer/{path}
                    if (parts[2] === 'explorer' && parts[3]) {
                        dispatch({ type: 'SET_EXPLORER_PATH', path: decodeURIComponent(parts.slice(3).join('/')) });
                    } else if (parts[2] === 'explorer') {
                        dispatch({ type: 'SET_EXPLORER_PATH', path: null });
                    }
                    // Notes deep-link: #repos/{id}/notes/{path/segments}
                    if (parts[2] === 'notes' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: parts.slice(3).map(decodeURIComponent).join('/') });
                    } else if (parts[2] === 'notes') {
                        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: null });
                    }
                    // Pull-requests deep-link: #repos/{id}/pull-requests and #repos/{id}/pull-requests/{prNumber}/{subTab}
                    if (parts[2] === 'pull-requests' && parts[3]) {
                        dispatch({ type: 'SET_SELECTED_PR', prId: decodeURIComponent(parts[3]) });
                        const subTab = (parts[4] && VALID_PR_DETAIL_TABS.has(parts[4]) ? parts[4] : 'overview') as PrDetailTab;
                        dispatch({ type: 'SET_PR_DETAIL_TAB', tab: subTab });
                    } else if (parts[2] === 'pull-requests') {
                        dispatch({ type: 'CLEAR_SELECTED_PR' });
                    }
                    // Work-items deep-link: #repos/{id}/work-items[/{itemId}[/session/{taskId}|/commit/{sha}[/{filePath}]]]
                    if (parts[2] === 'work-items') {
                        if (parts[3]) {
                            const link = parseWorkItemDeepLink('#' + hash);
                            dispatch({
                                type: 'SET_WORK_ITEM_DEEP_LINK',
                                workItemId: link.itemId,
                                sessionTaskId: link.sessionTaskId,
                                commitHash: link.commitHash,
                                commitFilePath: link.commitFilePath,
                            });
                        } else {
                            dispatch({ type: 'SET_WORK_ITEM_DEEP_LINK', workItemId: null });
                        }
                    }
                    // Settings section deep-link: #repos/{id}/settings/{section}
                    if (parts[2] === 'settings') {
                        if (parts[3] === 'display') {
                            dispatch({ type: 'SET_ADMIN_SUB_TAB', tab: 'settings' });
                            location.replace('#admin/settings');
                            return;
                        }
                        dispatch({ type: 'SET_SETTINGS_SECTION', section: parseSettingsSection('#' + hash) });
                    }
                    // Backward compat: redirect old #repos/{id}/copilot/{section} → settings
                    if (parts[2] === 'copilot') {
                        const section = parts[3] && VALID_SETTINGS_SECTIONS.has(parts[3]) ? parts[3] : 'mcp';
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'settings' });
                        dispatch({ type: 'SET_SETTINGS_SECTION', section: section as SettingsSection });
                        location.replace('#repos/' + parts[1] + '/settings/' + section);
                        return;
                    }
                    // Backward compat: redirect old #repos/{id}/info → settings/info
                    if (parts[2] === 'info') {
                        dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'settings' });
                        dispatch({ type: 'SET_SETTINGS_SECTION', section: 'info' });
                        location.replace('#repos/' + parts[1] + '/settings/info');
                        return;
                    }
                }
            }

            // Parse wiki deep links: #wiki/:id, #wiki/:id/:tab, #wiki/:id/component/:compId
            if (tab === 'wiki') {
                const wikiLink = parseWikiDeepLink('#' + hash);
                if (wikiLink.wikiId) {
                    if (wikiLink.tab) {
                        dispatch({ type: 'SELECT_WIKI_WITH_TAB', wikiId: wikiLink.wikiId, tab: wikiLink.tab, adminTab: wikiLink.adminTab, componentId: wikiLink.componentId });
                    } else {
                        dispatch({ type: 'SELECT_WIKI', wikiId: wikiLink.wikiId });
                    }
                } else {
                    dispatch({ type: 'SELECT_WIKI', wikiId: null });
                }
            }

            // Parse memory sub-tab deep links: #memory/:subTab
            if (tab === 'memory') {
                const parts = hash.split('/');
                if (parts.length >= 2 && (parts[1] === 'facts' || parts[1] === 'review' || parts[1] === 'episodes' || parts[1] === 'settings')) {
                    dispatch({ type: 'SET_MEMORY_SUB_TAB', tab: parts[1] as MemorySubTab });
                }
            }

            // Parse skills sub-tab deep links: #skills/:subTab
            if (tab === 'skills') {
                const parts = hash.split('/');
                if (parts.length >= 2 && (parts[1] === 'installed' || parts[1] === 'gallery' || parts[1] === 'config')) {
                    dispatch({ type: 'SET_SKILLS_SUB_TAB', tab: parts[1] as SkillsSubTab });
                }
                // Backward compat: redirect old #skills/bundled → #skills/gallery
                if (parts.length >= 2 && parts[1] === 'bundled') {
                    dispatch({ type: 'SET_SKILLS_SUB_TAB', tab: 'gallery' });
                    location.replace('#skills/gallery');
                    return;
                }
            }

            // Parse admin sub-tab deep links: #admin/:subTab
            if (tab === 'admin') {
                const subTab = parseAdminSubTab('#' + hash);
                dispatch({ type: 'SET_ADMIN_SUB_TAB', tab: subTab ?? 'settings' });
                // Parse database deep-link: #admin/database/{table}?page=N&sort=col&order=asc|desc
                if (subTab === 'database') {
                    const dbLink = parseAdminDatabaseDeepLink(hash);
                    dispatch({ type: 'SET_ADMIN_DB_DEEP_LINK', table: dbLink.table, page: dbLink.page, sort: dbLink.sort, order: dbLink.order });
                }
            }
        };
        handleHash();
        window.addEventListener('hashchange', handleHash);
        return () => window.removeEventListener('hashchange', handleHash);
    }, [dispatch, queueDispatch]);

    // Keyboard shortcuts for repo sub-tabs:
    //   Alt+<letter> → switches to the corresponding sub-tab (see REPO_TAB_SHORTCUTS)
    //   Alt+Q → opens the Queue Task dialog for the selected repo
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (state.activeTab !== 'repos' || !state.selectedRepoId) return;

            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const letter = e.code.replace('Key', '').toLowerCase();
                if (letter === 'q') {
                    e.preventDefault();
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId: state.selectedRepoId });
                    return;
                }
                const rawTab = REPO_TAB_SHORTCUTS[letter];
                if (rawTab) {
                    if (rawTab === 'terminal' && !isTerminalEnabled()) return;
                    if (rawTab === 'notes' && !isNotesEnabled()) return;
                    // The 'chats' shortcut maps to the chat surface, whose canonical
                    // sub-tab key differs by layout mode (`'activity'` in classic).
                    const tab: RepoSubTab = rawTab === 'chats' ? resolveChatSubTab(getUiLayoutMode()) : rawTab;
                    e.preventDefault();
                    dispatch({ type: 'SET_REPO_SUB_TAB', tab });
                    const selectedTaskId = queueState.selectedTaskIdByRepo?.[state.selectedRepoId] ?? queueState.selectedTaskId;
                    location.hash = '#repos/' + encodeURIComponent(state.selectedRepoId) + buildRepoSubTabSuffix(tab, state, selectedTaskId);
                }
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [
        dispatch,
        queueDispatch,
        queueState.selectedTaskId,
        queueState.selectedTaskIdByRepo,
        state.activeTab,
        state.selectedGitCommitHash,
        state.selectedGitFilePath,
        state.selectedNotePath,
        state.selectedRepoId,
        state.settingsSection,
    ]);

    switch (state.activeTab) {
        case 'repos':
            return <ReposView />;
        case 'wiki':
            return <WikiView />;
        // The admin shell hosts itself plus the tool views as embedded
        // right-pane content. All of these dashboard tabs render the exact
        // same React tree; AdminPanel switches on `state.activeTab` to
        // decide what to mount in `<main>`. Memory is included here so the
        // admin sidebar always remains visible on the left.
        case 'admin':
        case 'memory':
        case 'skills':
        case 'logs':
        case 'stats':
        case 'models':
        case 'servers':
            return (
                <Suspense fallback={<div className="flex items-center justify-center h-full text-[#888]">Loading…</div>}>
                    <div className="h-full overflow-hidden" data-testid="admin-scroll-container">
                        <AdminPanel />
                    </div>
                </Suspense>
            );
        case 'reports':
            return <StubView id="view-reports" label="Reports" />;
        default:
            return <ReposView />;
    }
}
