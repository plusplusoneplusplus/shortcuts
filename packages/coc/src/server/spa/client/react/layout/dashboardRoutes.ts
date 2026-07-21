/**
 * dashboardRoutes — the SPA route registry.
 *
 * This module owns every pure route parser, canonicalizer, and hash builder for
 * the dashboard, plus `resolveDashboardRoute`, which turns one `location.hash`
 * into a single ordered list of typed {@link RouteEffect}s (state dispatches +
 * canonical navigations). The `Router` component reads the hash, builds a
 * {@link RouteContext}, calls `resolveDashboardRoute`, and hands the effects to
 * {@link applyRouteEffects} — so route recognition, legacy redirects, and stale-
 * selection clearing are one testable contract rather than an imperative
 * dispatcher.
 *
 * The parser/builder names are re-exported from `Router.tsx` for backward
 * compatibility with existing importers.
 */

import type {
    DashboardTab,
    RepoSubTab,
    WikiProjectTab,
    WikiAdminTab,
    MemorySubTab,
    SkillsSubTab,
    AdminSubTab,
    PrDetailTab,
    SettingsSection,
    UiLayoutMode,
} from '../types/dashboard';
import {
    SETTINGS_SECTION_VALUES,
    REPO_SUB_TAB_VALUES,
    WIKI_PROJECT_TAB_VALUES,
    WIKI_ADMIN_TAB_VALUES,
} from '../types/dashboard';
import type { NativeCliSessionProviderId } from '@plusplusoneplusplus/coc-client';
import { isQueueProcessId, toQueueProcessId } from '../utils/queue-process-id';
import type { AppAction, AppContextState } from '../contexts/AppContext';
import type { QueueAction, QueueContextState } from '../contexts/QueueContext';
import {
    stripHash,
    hashSegments,
    decodeSegment,
    encodeSegment,
    encodePath,
    decodePath,
    repoHashBase,
    tokenizeHash,
} from './routePath';

// ── Top-level tab parsing ─────────────────────────────────────────────────────

export function tabFromHash(hash: string): DashboardTab | null {
    const h = hashSegments(hash)[0].split('?')[0];
    if (h === 'repos' || h === 'tasks') return 'repos';
    if (h === 'wiki') return 'wiki';
    if (h === 'reports') return 'reports';
    if (h === 'stats') return 'stats';
    if (h === 'memory') return 'memory';
    if (h === 'skills') return 'skills';
    if (h === 'logs') return 'logs';
    if (h === 'servers') return 'servers';
    if (h === 'dreams-admin') return 'dreams-admin';
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
    const parts = hashSegments(hash);
    if (parts[0] !== 'wiki' || !parts[1]) return { wikiId: null, tab: null, componentId: null, adminTab: null };

    const wikiId = decodeSegment(parts[1]);

    if (parts.length >= 4 && parts[2] === 'component' && parts[3]) {
        return { wikiId, tab: 'browse', componentId: decodeSegment(parts[3]), adminTab: null };
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
    const parts = stripHash(hash).replace(/^\/+/, '').split('/');
    const root = parts[0];

    if ((root === 'process' || root === 'session') && parts[1]) {
        return decodeSegment(parts[1]);
    }
    if (root === 'processes' && parts[1]) {
        return decodeSegment(parts[1]);
    }

    return null;
}

export function parseWorkflowsDeepLink(hash: string): string | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && (parts[2] === 'templates' || parts[2] === 'workflows') && parts[3]) {
        // chat-template sub-path is handled separately
        if (parts[3] === 'chat-template') return null;
        return decodeSegment(parts[3]);
    }
    return null;
}

export function parseChatTemplateDeepLink(hash: string): string | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && (parts[2] === 'templates' || parts[2] === 'workflows') && parts[3] === 'chat-template' && parts[4]) {
        return decodeSegment(parts[4]);
    }
    return null;
}

export function parseWorkflowsRunDeepLink(hash: string): { workflowName: string; processId: string } | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && (parts[2] === 'templates' || parts[2] === 'workflows') && parts[3] && parts[4] === 'run' && parts[5]) {
        return {
            workflowName: decodeSegment(parts[3]),
            processId: decodeSegment(parts[5]),
        };
    }
    return null;
}

export function parseGitCommitDeepLink(hash: string): string | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'git' && parts[3]) {
        return decodeSegment(parts[3]);
    }
    return null;
}

export function parseGitFileDeepLink(hash: string): { commitHash: string; filePath: string } | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'git' && parts[3] && parts[4]) {
        return {
            commitHash: decodeSegment(parts[3]),
            filePath: decodeSegment(parts[4]),
        };
    }
    return null;
}

/** Build a pop-out URL for git commit review. */
export function buildGitReviewPopOutUrl(workspaceId: string, commitHash: string, cloneBaseUrl?: string): string {
    const cloneParam = cloneBaseUrl ? `&cloneBaseUrl=${encodeURIComponent(cloneBaseUrl)}` : '';
    return `/?workspace=${encodeURIComponent(workspaceId)}${cloneParam}#popout/git-review/${encodeURIComponent(commitHash)}`;
}

/** Build a pop-out URL for branch-range review. */
export function buildGitBranchRangePopOutUrl(workspaceId: string, cloneBaseUrl?: string): string {
    const cloneParam = cloneBaseUrl ? `&cloneBaseUrl=${encodeURIComponent(cloneBaseUrl)}` : '';
    return `/?workspace=${encodeURIComponent(workspaceId)}${cloneParam}#popout/git-review/branch-range`;
}

/** Build a pop-out URL for PR review. */
export function buildGitPrPopOutUrl(workspaceId: string, repoId: string, prId: string | number, originId?: string, cloneBaseUrl?: string): string {
    const originParam = originId ? `&origin=${encodeURIComponent(originId)}` : '';
    const cloneParam = cloneBaseUrl ? `&cloneBaseUrl=${encodeURIComponent(cloneBaseUrl)}` : '';
    return `/?workspace=${encodeURIComponent(workspaceId)}&repo=${encodeURIComponent(repoId)}${originParam}${cloneParam}#popout/git-review/pr/${encodeURIComponent(String(prId))}`;
}

export function parseWorkflowDeepLink(hash: string): { repoId: string; processId: string } | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'workflow' && parts[3]) {
        return {
            repoId: decodeSegment(parts[1]),
            processId: decodeSegment(parts[3]),
        };
    }
    return null;
}

export const VALID_PR_DETAIL_TABS: Set<string> = new Set(['overview', 'files', 'commits', 'checks']);

export function parsePrDetailTab(hash: string): PrDetailTab {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'pull-requests' && parts[3] && parts[4] && VALID_PR_DETAIL_TABS.has(parts[4])) {
        return parts[4] as PrDetailTab;
    }
    return 'overview';
}

export function parseActivityDeepLink(hash: string): string | null {
    // Strip any `?query` (e.g. `?view=agents`) so it never bleeds into the taskId.
    const parts = tokenizeHash(hash).segments;
    if (parts[0] === 'repos' && parts[1] && (parts[2] === 'chats' || parts[2] === 'activity') && parts[3]) {
        if (parts[3] === 'ralph' || parts[3] === 'for-each' || parts[3] === 'map-reduce') return null;
        return decodeSegment(parts[3]);
    }
    return null;
}

/** Parse a tasks deep-link: `#repos/{wsId}/tasks/{taskId}`. */
export function parseTasksDeepLink(hash: string): string | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'tasks' && parts[3]) {
        if (parts[3] === 'ralph' || parts[3] === 'for-each' || parts[3] === 'map-reduce') return null;
        return decodeSegment(parts[3]);
    }
    return null;
}

/**
 * Parse a Ralph workflow deep-link:
 *   `#repos/{wsId}/(activity|chats|tasks)/ralph/{sessionId}`
 *   `#repos/{wsId}/(activity|chats|tasks)/ralph/{sessionId}/{filename}`
 *
 * Returns `{ workspaceId, sessionId, fileName? }` when the hash matches,
 * `null` otherwise. The chat-surface segment is allowed to be either alias
 * (matches `parseActivityDeepLink`). A trailing slash after `{sessionId}` is
 * treated the same as the bare session URL.
 */
export function parseRalphSessionDeepLink(
    hash: string,
): { workspaceId: string; sessionId: string; fileName?: string } | null {
    const parts = hashSegments(hash);
    if (
        parts[0] === 'repos' &&
        parts[1] &&
        (parts[2] === 'chats' || parts[2] === 'activity' || parts[2] === 'tasks') &&
        parts[3] === 'ralph' &&
        parts[4]
    ) {
        const parsed: { workspaceId: string; sessionId: string; fileName?: string } = {
            workspaceId: decodeSegment(parts[1]),
            sessionId: decodeSegment(parts[4]),
        };
        if (parts[5]) {
            parsed.fileName = decodeSegment(parts[5]);
        }
        return parsed;
    }
    return null;
}

/**
 * Parse a For Each run deep-link:
 *   `#repos/{wsId}/(activity|chats|tasks)/for-each/{runId}`
 */
export function parseForEachRunDeepLink(
    hash: string,
): { workspaceId: string; runId: string } | null {
    const parts = hashSegments(hash);
    if (
        parts[0] === 'repos' &&
        parts[1] &&
        (parts[2] === 'chats' || parts[2] === 'activity' || parts[2] === 'tasks') &&
        parts[3] === 'for-each' &&
        parts[4]
    ) {
        return {
            workspaceId: decodeSegment(parts[1]),
            runId: decodeSegment(parts[4]),
        };
    }
    return null;
}

/**
 * Parse a Map Reduce run deep-link:
 *   `#repos/{wsId}/(activity|chats|tasks)/map-reduce/{runId}`
 */
export function parseMapReduceRunDeepLink(
    hash: string,
): { workspaceId: string; runId: string } | null {
    const parts = hashSegments(hash);
    if (
        parts[0] === 'repos' &&
        parts[1] &&
        (parts[2] === 'chats' || parts[2] === 'activity' || parts[2] === 'tasks') &&
        parts[3] === 'map-reduce' &&
        parts[4]
    ) {
        return {
            workspaceId: decodeSegment(parts[1]),
            runId: decodeSegment(parts[4]),
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
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'notes' && parts[3]) {
        return decodePath(parts.slice(3));
    }
    return null;
}

/**
 * Build a hash string for a note deep-link.
 * Each segment of the note path is URI-encoded individually.
 */
export function buildNoteHash(wsId: string, notePath: string): string {
    return repoHashBase(wsId) + '/notes/' + encodePath(notePath);
}

/**
 * Parse a native CLI Sessions deep-link:
 *   `#repos/{wsId}/cli-sessions/{provider}`
 *   `#repos/{wsId}/cli-sessions/{provider}/{sessionId}`
 *
 * Legacy `#repos/{wsId}/copilot-sessions/{sessionId}` links are treated as
 * Copilot provider links so shared/bookmarked URLs keep working.
 */
export function parseNativeCliSessionDeepLink(
    hash: string,
): { workspaceId: string; provider: NativeCliSessionProviderId; sessionId: string | null } | null {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'cli-sessions') {
        const provider = parts[3] ? decodeSegment(parts[3]) : 'copilot';
        if (provider !== 'copilot' && provider !== 'codex' && provider !== 'claude') return null;
        return {
            workspaceId: decodeSegment(parts[1]),
            provider,
            sessionId: parts[4] ? decodeSegment(parts[4]) : null,
        };
    }
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'copilot-sessions') {
        return {
            workspaceId: decodeSegment(parts[1]),
            provider: 'copilot',
            sessionId: parts[3] ? decodeSegment(parts[3]) : null,
        };
    }
    return null;
}

/**
 * Build a CLI Sessions hash. Omitting `sessionId` addresses the provider tab.
 */
export function buildNativeCliSessionHash(wsId: string, provider: NativeCliSessionProviderId, sessionId?: string | null): string {
    const base = repoHashBase(wsId) + '/cli-sessions/' + encodeSegment(provider);
    return sessionId ? base + '/' + encodeSegment(sessionId) : base;
}

/** @deprecated Use parseNativeCliSessionDeepLink. */
export function parseNativeCopilotSessionDeepLink(hash: string): { workspaceId: string; sessionId: string | null } | null {
    const parsed = parseNativeCliSessionDeepLink(hash);
    if (!parsed || parsed.provider !== 'copilot') return null;
    return { workspaceId: parsed.workspaceId, sessionId: parsed.sessionId };
}

/** @deprecated Use buildNativeCliSessionHash. */
export function buildNativeCopilotSessionHash(wsId: string, sessionId?: string | null): string {
    const base = repoHashBase(wsId) + '/copilot-sessions';
    return sessionId ? base + '/' + encodeSegment(sessionId) : base;
}

export function buildRepoSubTabSuffix(
    tab: RepoSubTab,
    state: AppContextState,
    selectedTaskId?: string | null
): string {
    if (tab === 'settings') {
        return '/settings/' + encodeSegment(state.settingsSection);
    }
    if (tab === 'git') {
        if (!state.selectedGitCommitHash) return '/git';
        const hash = encodeSegment(state.selectedGitCommitHash);
        const file = state.selectedGitFilePath
            ? '/' + encodeSegment(state.selectedGitFilePath)
            : '';
        return '/git/' + hash + file;
    }
    if (tab === 'notes') {
        if (!state.selectedNotePath) return '/notes';
        return '/notes/' + encodePath(state.selectedNotePath);
    }
    if ((tab === 'chats' || tab === 'activity' || tab === 'tasks') && selectedTaskId) {
        return '/' + tab + '/' + encodeSegment(selectedTaskId);
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
    const parts = hashSegments(hash);
    if (parts[0] !== 'repos' || !parts[1] || parts[2] !== 'work-items' || !parts[3]) return base;
    const itemId = decodeSegment(parts[3]);
    if (parts[4] === 'session' && parts[5]) {
        return { itemId, sessionTaskId: decodeSegment(parts[5]), commitHash: null, commitFilePath: null };
    }
    if (parts[4] === 'commit' && parts[5]) {
        const commitHash = decodeSegment(parts[5]);
        const commitFilePath = parts[6] ? decodePath(parts.slice(6)) : null;
        return { itemId, sessionTaskId: null, commitHash, commitFilePath };
    }
    return { itemId, sessionTaskId: null, commitHash: null, commitFilePath: null };
}

/** Build `#repos/{wsId}/work-items/{itemId}` */
export function buildWorkItemHash(wsId: string, itemId: string): string {
    return repoHashBase(wsId) + '/work-items/' + encodeSegment(itemId);
}

/** Build `#repos/{wsId}/work-items/{itemId}/session/{taskId}` */
export function buildWorkItemSessionHash(wsId: string, itemId: string, taskId: string): string {
    return repoHashBase(wsId) + '/work-items/' + encodeSegment(itemId) + '/session/' + encodeSegment(taskId);
}

/** Build `#repos/{wsId}/work-items/{itemId}/commit/{sha}[/{filePath...}]` */
export function buildWorkItemCommitHash(wsId: string, itemId: string, commitHash: string, filePath?: string): string {
    let h = repoHashBase(wsId) + '/work-items/' + encodeSegment(itemId) + '/commit/' + encodeSegment(commitHash);
    if (filePath) {
        h += '/' + encodePath(filePath);
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

function taskMatchesProcessDeepLink(task: any, processId: string): boolean {
    const id = typeof task?.id === 'string' ? task.id : null;
    const taskProcessId = typeof task?.processId === 'string' ? task.processId : null;
    return taskProcessId === processId
        || id === processId
        || (!!id && !isQueueProcessId(id) && toQueueProcessId(id) === processId);
}

export function findRepoIdForProcessDeepLink(
    queueState: QueueContextState,
    processId: string,
    fallbackRepoId: string | null,
): string | null {
    for (const [repoId, queue] of Object.entries(queueState.repoQueueMap ?? {})) {
        if ([...(queue.running ?? []), ...(queue.queued ?? [])].some((task) => taskMatchesProcessDeepLink(task, processId))) {
            return repoId;
        }
    }
    for (const [repoId, history] of Object.entries(queueState.repoHistoryMap ?? {})) {
        if ((history.items ?? []).some((task) => taskMatchesProcessDeepLink(task, processId))) {
            return repoId;
        }
    }
    return fallbackRepoId;
}

export function parseSettingsSection(hash: string): SettingsSection {
    const parts = hashSegments(hash);
    if (parts[0] === 'repos' && parts[2] === 'settings' && parts[3]) {
        const section = decodeSegment(parts[3]);
        if (VALID_SETTINGS_SECTIONS.has(section)) return section as SettingsSection;
    }
    return 'info';
}

/** @deprecated Use parseSettingsSection */
export function parseCopilotSection(hash: string): SettingsSection {
    return parseSettingsSection(hash);
}

export const VALID_ADMIN_SUB_TABS: Set<string> = new Set(['settings', 'providers', 'data', 'server', 'prompts', 'database', 'agents']);

/** Container-only admin sub-tabs (not included in the base set). */
const CONTAINER_ADMIN_SUB_TABS: Set<string> = new Set(['messaging']);

export function parseAdminSubTab(hash: string): AdminSubTab | null {
    const parts = hashSegments(hash);
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
    const { segments: parts, query } = tokenizeHash(hash);
    if (parts[0] !== 'admin' || parts[1] !== 'database') return defaults;
    const table = parts[2] ? decodeSegment(parts[2]) : null;
    if (!table) return defaults;

    const params = new URLSearchParams(query || '');
    const pageStr = params.get('page');
    const page = pageStr ? Math.max(1, parseInt(pageStr, 10) || 1) : 1;
    const sort = params.get('sort') ? decodeSegment(params.get('sort')!) : null;
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
    return `admin/database/${encodeSegment(table)}${qs ? '?' + qs : ''}`;
}

// ── Route resolution ──────────────────────────────────────────────────────────

/**
 * Ambient context a route needs to resolve. `getUiLayoutMode`/`isSchedulesInSlide`
 * are getters so they are read lazily, exactly where the imperative dispatcher
 * read them (never for routes that do not depend on them).
 */
export interface RouteContext {
    queueState: QueueContextState;
    selectedRepoId: string | null;
    repoRouteState: Record<string, string>;
    repoTabState: Record<string, RepoSubTab>;
    getUiLayoutMode: () => UiLayoutMode;
    isSchedulesInSlide: () => boolean;
}

/** A single ordered side effect a resolved route asks the applier to perform. */
export type RouteEffect =
    | { kind: 'app'; action: AppAction }
    | { kind: 'queue'; action: QueueAction }
    | { kind: 'navigate'; hash: string; mode: 'replace' | 'replaceState' };

export interface RouteResolution {
    effects: RouteEffect[];
}

/**
 * Resolve `#repos/...` deep-links into effects. Pushes onto the shared `effects`
 * list in the exact order the imperative dispatcher ran, and returns early on a
 * legacy redirect so no effects follow the canonical `location.replace`.
 */
function resolveReposRoute(hashIn: string, ctx: RouteContext, effects: RouteEffect[]): void {
    let hash = hashIn;
    let parts = hash.split('/');
    if (!(parts.length >= 2 && parts[0] === 'repos' && parts[1])) return;

    const repoId = decodeSegment(parts[1]);
    if (!parts[2]) {
        // Expand a bare `#repos/{id}` to its remembered sub-route (or the default
        // chat tab) and canonicalize the URL, then keep parsing the expansion.
        const suffix = ctx.repoRouteState[repoId] ?? '/' + (ctx.repoTabState[repoId] ?? 'chats');
        const nextHash = '#repos/' + parts[1] + suffix;
        effects.push({ kind: 'navigate', hash: nextHash, mode: 'replaceState' });
        hash = stripHash(nextHash).split('?')[0];
        parts = hash.split('/');
    }
    effects.push({ kind: 'app', action: { type: 'SET_SELECTED_REPO', id: repoId } });

    // Redirect legacy #repos/:id/workflows deep-links to workflows tab
    if (parts[2] === 'workflows') {
        effects.push({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'workflows' } });
    }
    // Redirect legacy #repos/:id/templates deep-links to workflows tab
    if (parts[2] === 'templates') {
        effects.push({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'workflows' } });
        const suffix = parts.slice(3).map(encodeSegment).join('/');
        effects.push({ kind: 'navigate', hash: '#repos/' + parts[1] + '/workflows' + (suffix ? '/' + suffix : ''), mode: 'replace' });
        return;
    }
    // Redirect legacy #repos/:id/settings/run-script-template to workflows tab
    if (parts[2] === 'settings' && parts[3] === 'run-script-template') {
        effects.push({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'workflows' } });
        effects.push({ kind: 'navigate', hash: '#repos/' + parts[1] + '/workflows', mode: 'replace' });
        return;
    }
    if (
        parts.length >= 3 &&
        parts[2] !== 'copilot' &&
        parts[2] !== 'info' &&
        !(parts[2] === 'settings' && parts[3] === 'display')
    ) {
        effects.push({ kind: 'app', action: { type: 'RECORD_REPO_ROUTE_SUFFIX', repoId, suffix: '/' + parts.slice(2).join('/') } });
    }
    if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
        // When the schedules-in-slide flag is ON, schedule routes
        // (#repos/{id}/schedules/...) live in the chat-list "Scheduled" slide +
        // main pane, not the standalone Schedules sub-tab. Keep the chat surface
        // mounted so RepoChatTab can host the schedule detail/editor. Flag OFF ⇒
        // unchanged.
        if (parts[2] === 'schedules' && ctx.isSchedulesInSlide()) {
            effects.push({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: resolveChatSubTab(ctx.getUiLayoutMode()) } });
        } else {
            effects.push({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: parts[2] as RepoSubTab } });
        }
    }
    // Workflow deep-link handling
    if (parts[2] === 'workflows' && parts[3] === 'script-template' && parts[4]) {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: decodeSegment(parts[4]) } });
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_WORKFLOW', name: null } });
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SKILL_TEMPLATE', id: null } });
        effects.push({ kind: 'app', action: { type: 'SET_WORKFLOW_RUN_PROCESS', processId: null } });
    } else if (parts[2] === 'workflows' && parts[3] === 'chat-template' && parts[4]) {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SKILL_TEMPLATE', id: decodeSegment(parts[4]) } });
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_WORKFLOW', name: null } });
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null } });
        effects.push({ kind: 'app', action: { type: 'SET_WORKFLOW_RUN_PROCESS', processId: null } });
    } else if (parts[2] === 'workflows' && parts[3]) {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_WORKFLOW', name: decodeSegment(parts[3]) } });
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SKILL_TEMPLATE', id: null } });
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null } });
        // Workflow run detail: #repos/:id/workflows/:name/run/:processId
        if (parts[4] === 'run' && parts[5]) {
            effects.push({ kind: 'app', action: { type: 'SET_WORKFLOW_RUN_PROCESS', processId: decodeSegment(parts[5]) } });
        } else {
            effects.push({ kind: 'app', action: { type: 'SET_WORKFLOW_RUN_PROCESS', processId: null } });
        }
    } else if (parts[2] === 'workflows') {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_WORKFLOW', name: null } });
        effects.push({ kind: 'app', action: { type: 'SET_WORKFLOW_RUN_PROCESS', processId: null } });
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SKILL_TEMPLATE', id: null } });
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SCRIPT_TEMPLATE', id: null } });
    } else if (parts[2] && parts[2] !== 'workflows') {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_WORKFLOW', name: null } });
        effects.push({ kind: 'app', action: { type: 'SET_WORKFLOW_RUN_PROCESS', processId: null } });
    }
    // Schedule deep-link handling: #repos/{id}/schedules/{scheduleId}.
    // `/schedules/new` is the create route (flag ON) — it carries no selected id,
    // so treat it like the bare list route here.
    if (parts[2] === 'schedules' && parts[3] && parts[3] !== 'new') {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SCHEDULE', id: decodeSegment(parts[3]) } });
    } else if (parts[2] === 'schedules') {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_SCHEDULE', id: null } });
    }
    // Chats / activity deep-link handling — select task when ID present. Both URL
    // segments are aliases for the chat surface (canonical key differs by layout
    // mode). Parent-run sub-segments are owned by RepoChatTab detail panes.
    if ((parts[2] === 'chats' || parts[2] === 'activity') && parts[3] && parts[3] !== 'ralph' && parts[3] !== 'for-each') {
        effects.push({ kind: 'queue', action: { type: 'SELECT_QUEUE_TASK', id: decodeSegment(parts[3]), repoId } });
    } else if (parts[2] === 'chats' || parts[2] === 'activity') {
        effects.push({ kind: 'queue', action: { type: 'SELECT_QUEUE_TASK', id: null, repoId } });
    }
    // Tasks deep-link handling — select task when ID present. Skip parent-run
    // sub-segments (handled by RepoChatTab).
    if (parts[2] === 'tasks' && parts[3] && parts[3] !== 'ralph' && parts[3] !== 'for-each') {
        effects.push({ kind: 'queue', action: { type: 'SELECT_QUEUE_TASK', id: decodeSegment(parts[3]), repoId } });
    } else if (parts[2] === 'tasks') {
        effects.push({ kind: 'queue', action: { type: 'SELECT_QUEUE_TASK', id: null, repoId } });
    }
    // Git commit deep-link handling
    if (parts[2] === 'git' && parts[3]) {
        effects.push({ kind: 'app', action: { type: 'SET_GIT_COMMIT_HASH', hash: decodeSegment(parts[3]) } });
        if (parts[4]) {
            effects.push({ kind: 'app', action: { type: 'SET_GIT_FILE_PATH', filePath: decodeSegment(parts[4]) } });
        } else {
            effects.push({ kind: 'app', action: { type: 'CLEAR_GIT_FILE_PATH' } });
        }
    } else if (parts[2] === 'git') {
        effects.push({ kind: 'app', action: { type: 'SET_GIT_COMMIT_HASH', hash: null } });
        effects.push({ kind: 'app', action: { type: 'CLEAR_GIT_FILE_PATH' } });
    }
    // Wiki deep-link: #repos/{id}/wiki/{wikiId} and deeper paths
    if (parts[2] === 'wiki' && parts[3]) {
        const wikiId = decodeSegment(parts[3]);
        if (parts[4] === 'component' && parts[5]) {
            effects.push({ kind: 'app', action: { type: 'SET_REPO_WIKI_DEEP_LINK', wikiId, tab: 'browse', componentId: decodeSegment(parts[5]) } });
        } else if (parts[4] && VALID_WIKI_PROJECT_TABS.has(parts[4])) {
            const tab = parts[4] as WikiProjectTab;
            let adminTab: WikiAdminTab | null = null;
            if (tab === 'admin' && parts[5] && VALID_WIKI_ADMIN_TABS.has(parts[5])) {
                adminTab = parts[5] as WikiAdminTab;
            }
            effects.push({ kind: 'app', action: { type: 'SET_REPO_WIKI_DEEP_LINK', wikiId, tab, adminTab } });
        } else {
            effects.push({ kind: 'app', action: { type: 'SET_REPO_WIKI_ID', wikiId } });
        }
    } else if (parts[2] === 'wiki') {
        effects.push({ kind: 'app', action: { type: 'SET_REPO_WIKI_ID', wikiId: null } });
    }
    // Workflow detail deep-link: #repos/{id}/workflow/{processId}
    if (parts[2] === 'workflow' && parts[3]) {
        effects.push({ kind: 'app', action: { type: 'SET_WORKFLOW_PROCESS', processId: decodeSegment(parts[3]) } });
    } else if (parts[2] === 'workflow') {
        effects.push({ kind: 'app', action: { type: 'SET_WORKFLOW_PROCESS', processId: null } });
    }
    // Explorer deep-link: #repos/{id}/explorer/{path}
    if (parts[2] === 'explorer' && parts[3]) {
        effects.push({ kind: 'app', action: { type: 'SET_EXPLORER_PATH', path: decodeSegment(parts.slice(3).join('/')) } });
    } else if (parts[2] === 'explorer') {
        effects.push({ kind: 'app', action: { type: 'SET_EXPLORER_PATH', path: null } });
    }
    // Notes deep-link: #repos/{id}/notes/{path/segments}
    if (parts[2] === 'notes' && parts[3]) {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_NOTE_PATH', notePath: decodePath(parts.slice(3)) } });
    } else if (parts[2] === 'notes') {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_NOTE_PATH', notePath: null } });
    }
    // Pull-requests deep-link: #repos/{id}/pull-requests and #repos/{id}/pull-requests/{prNumber}/{subTab}
    if (parts[2] === 'pull-requests' && parts[3]) {
        effects.push({ kind: 'app', action: { type: 'SET_SELECTED_PR', prId: decodeSegment(parts[3]) } });
        const subTab = (parts[4] && VALID_PR_DETAIL_TABS.has(parts[4]) ? parts[4] : 'overview') as PrDetailTab;
        effects.push({ kind: 'app', action: { type: 'SET_PR_DETAIL_TAB', tab: subTab } });
    } else if (parts[2] === 'pull-requests') {
        effects.push({ kind: 'app', action: { type: 'CLEAR_SELECTED_PR' } });
    }
    // Work-items deep-link: #repos/{id}/work-items[/{itemId}[/session/{taskId}|/commit/{sha}[/{filePath}]]]
    if (parts[2] === 'work-items') {
        if (parts[3]) {
            const link = parseWorkItemDeepLink('#' + hash);
            effects.push({
                kind: 'app',
                action: {
                    type: 'SET_WORK_ITEM_DEEP_LINK',
                    workItemId: link.itemId,
                    sessionTaskId: link.sessionTaskId,
                    commitHash: link.commitHash,
                    commitFilePath: link.commitFilePath,
                },
            });
        } else {
            effects.push({ kind: 'app', action: { type: 'SET_WORK_ITEM_DEEP_LINK', workItemId: null } });
        }
    }
    // Settings section deep-link: #repos/{id}/settings/{section}
    if (parts[2] === 'settings') {
        if (parts[3] === 'display') {
            effects.push({ kind: 'app', action: { type: 'SET_ADMIN_SUB_TAB', tab: 'settings' } });
            effects.push({ kind: 'navigate', hash: '#admin/settings', mode: 'replace' });
            return;
        }
        effects.push({ kind: 'app', action: { type: 'SET_SETTINGS_SECTION', section: parseSettingsSection('#' + hash) } });
    }
    // Backward compat: redirect old #repos/{id}/copilot/{section} → settings
    if (parts[2] === 'copilot') {
        const section = parts[3] && VALID_SETTINGS_SECTIONS.has(parts[3]) ? parts[3] : 'mcp';
        effects.push({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'settings' } });
        effects.push({ kind: 'app', action: { type: 'SET_SETTINGS_SECTION', section: section as SettingsSection } });
        effects.push({ kind: 'navigate', hash: '#repos/' + parts[1] + '/settings/' + section, mode: 'replace' });
        return;
    }
    // Backward compat: redirect old #repos/{id}/info → settings/info
    if (parts[2] === 'info') {
        effects.push({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: 'settings' } });
        effects.push({ kind: 'app', action: { type: 'SET_SETTINGS_SECTION', section: 'info' } });
        effects.push({ kind: 'navigate', hash: '#repos/' + parts[1] + '/settings/info', mode: 'replace' });
        return;
    }
}

/**
 * Convert one `location.hash` value into an ordered list of typed effects.
 *
 * This is the single route-resolution contract: every legacy redirect, stale-
 * selection clear, and state dispatch that used to live inside the router's
 * imperative `handleHash` is expressed here as a `RouteEffect`, in the exact
 * order it previously ran. Pure and context-injected, so it is unit-testable
 * without a mounted router.
 */
export function resolveDashboardRoute(rawHash: string, ctx: RouteContext): RouteResolution {
    const effects: RouteEffect[] = [];
    // Strip any `?query` before parsing the path — it's metadata for components
    // (which read it from location.hash directly), never part of the routed path.
    const hash = stripHash(rawHash).split('?')[0];

    const processDeepLinkId = parseProcessDeepLink('#' + hash);
    if (processDeepLinkId) {
        const repoId = findRepoIdForProcessDeepLink(ctx.queueState, processDeepLinkId, ctx.selectedRepoId);
        effects.push({ kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } });
        if (repoId) {
            const chatTab = resolveChatSubTab(ctx.getUiLayoutMode());
            effects.push({ kind: 'app', action: { type: 'SET_SELECTED_REPO', id: repoId } });
            effects.push({ kind: 'app', action: { type: 'SET_REPO_SUB_TAB', tab: chatTab } });
            effects.push({ kind: 'queue', action: { type: 'SELECT_QUEUE_TASK', id: processDeepLinkId, repoId } });
            const nextHash = repoHashBase(repoId) + '/' + chatTab + '/' + encodeSegment(processDeepLinkId);
            effects.push({ kind: 'navigate', hash: nextHash, mode: 'replaceState' });
        }
        return { effects };
    }

    const tab = tabFromHash('#' + hash);
    if (tab) {
        effects.push({ kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab } });
    } else if (!hash) {
        effects.push({ kind: 'app', action: { type: 'SET_ACTIVE_TAB', tab: 'repos' } });
        return { effects };
    }

    if (tab === 'repos') {
        resolveReposRoute(hash, ctx, effects);
    }

    // Parse wiki deep links: #wiki/:id, #wiki/:id/:tab, #wiki/:id/component/:compId
    if (tab === 'wiki') {
        const wikiLink = parseWikiDeepLink('#' + hash);
        if (wikiLink.wikiId) {
            if (wikiLink.tab) {
                effects.push({ kind: 'app', action: { type: 'SELECT_WIKI_WITH_TAB', wikiId: wikiLink.wikiId, tab: wikiLink.tab, adminTab: wikiLink.adminTab, componentId: wikiLink.componentId } });
            } else {
                effects.push({ kind: 'app', action: { type: 'SELECT_WIKI', wikiId: wikiLink.wikiId } });
            }
        } else {
            effects.push({ kind: 'app', action: { type: 'SELECT_WIKI', wikiId: null } });
        }
    }

    // Parse memory sub-tab deep links: #memory/:subTab
    if (tab === 'memory') {
        const parts = hash.split('/');
        if (parts.length >= 2 && (parts[1] === 'facts' || parts[1] === 'review' || parts[1] === 'episodes' || parts[1] === 'settings')) {
            effects.push({ kind: 'app', action: { type: 'SET_MEMORY_SUB_TAB', tab: parts[1] as MemorySubTab } });
        }
    }

    // Parse skills sub-tab deep links: #skills/:subTab
    if (tab === 'skills') {
        const parts = hash.split('/');
        if (parts.length >= 2 && (parts[1] === 'installed' || parts[1] === 'gallery' || parts[1] === 'config')) {
            effects.push({ kind: 'app', action: { type: 'SET_SKILLS_SUB_TAB', tab: parts[1] as SkillsSubTab } });
        }
        // Backward compat: redirect old #skills/bundled → #skills/gallery
        if (parts.length >= 2 && parts[1] === 'bundled') {
            effects.push({ kind: 'app', action: { type: 'SET_SKILLS_SUB_TAB', tab: 'gallery' } });
            effects.push({ kind: 'navigate', hash: '#skills/gallery', mode: 'replace' });
            return { effects };
        }
    }

    // Parse admin sub-tab deep links: #admin/:subTab
    if (tab === 'admin') {
        const subTab = parseAdminSubTab('#' + hash);
        effects.push({ kind: 'app', action: { type: 'SET_ADMIN_SUB_TAB', tab: subTab ?? 'settings' } });
        // Parse database deep-link: #admin/database/{table}?page=N&sort=col&order=asc|desc
        if (subTab === 'database') {
            const dbLink = parseAdminDatabaseDeepLink(hash);
            effects.push({ kind: 'app', action: { type: 'SET_ADMIN_DB_DEEP_LINK', table: dbLink.table, page: dbLink.page, sort: dbLink.sort, order: dbLink.order } });
        }
    }

    return { effects };
}

/**
 * Apply resolved route effects in order: state dispatches go to the app/queue
 * reducers; navigations canonicalize the URL. `replace` always runs (legacy
 * redirects); `replaceState` runs only when the hash actually changes.
 */
export function applyRouteEffects(
    effects: RouteEffect[],
    handlers: {
        dispatch: (action: AppAction) => void;
        queueDispatch: (action: QueueAction) => void;
    },
): void {
    for (const effect of effects) {
        switch (effect.kind) {
            case 'app':
                handlers.dispatch(effect.action);
                break;
            case 'queue':
                handlers.queueDispatch(effect.action);
                break;
            case 'navigate':
                if (effect.mode === 'replace') {
                    location.replace(effect.hash);
                } else if (location.hash !== effect.hash) {
                    window.history.replaceState(null, '', effect.hash);
                }
                break;
        }
    }
}
