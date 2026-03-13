/**
 * Tests for Router hash-parsing utilities — tabFromHash, VALID_REPO_SUB_TABS.
 *
 * Covers deep-link and refresh routing for all repo sub-tabs.
 */

import { describe, it, expect } from 'vitest';
import { tabFromHash, VALID_REPO_SUB_TABS, VALID_WIKI_PROJECT_TABS, VALID_WIKI_ADMIN_TABS, parseProcessDeepLink, parseWikiDeepLink, parseWorkflowsDeepLink, parseWorkflowsRunDeepLink, parseGitCommitDeepLink, parseGitFileDeepLink, parseWorkflowDeepLink, parseActivityDeepLink } from '../../../src/server/spa/client/react/layout/Router';
import { SHOW_WIKI_TAB } from '../../../src/server/spa/client/react/layout/TopBar';

// ─── tabFromHash ─────────────────────────────────────────────────

describe('tabFromHash', () => {
    it('returns "repos" for #repos', () => {
        expect(tabFromHash('#repos')).toBe('repos');
    });

    it('returns "repos" for #repos/some-id', () => {
        expect(tabFromHash('#repos/my-repo')).toBe('repos');
    });

    it('returns "repos" for #repos/some-id/queue (deep link)', () => {
        expect(tabFromHash('#repos/my-repo/queue')).toBe('repos');
    });

    it('returns "repos" for #repos/some-id/tasks', () => {
        expect(tabFromHash('#repos/my-repo/tasks')).toBe('repos');
    });

    it('returns "repos" for #repos/some-id/workflows', () => {
        expect(tabFromHash('#repos/my-repo/workflows')).toBe('repos');
    });

    it('returns "repos" for #repos/some-id/info', () => {
        expect(tabFromHash('#repos/my-repo/info')).toBe('repos');
    });

    it('returns "repos" for #tasks (alias)', () => {
        expect(tabFromHash('#tasks')).toBe('repos');
    });

    it('returns "processes" for #processes', () => {
        expect(tabFromHash('#processes')).toBe('processes');
    });

    it('returns "processes" for #process', () => {
        expect(tabFromHash('#process')).toBe('processes');
    });

    it('returns "processes" for #session', () => {
        expect(tabFromHash('#session')).toBe('processes');
    });

    it('returns "wiki" for #wiki (accessible via hash route even when tab hidden)', () => {
        expect(tabFromHash('#wiki')).toBe('wiki');
    });

    it('returns "admin" for #admin', () => {
        expect(tabFromHash('#admin')).toBe('admin');
    });

    it('returns "reports" for #reports', () => {
        expect(tabFromHash('#reports')).toBe('reports');
    });

    it('returns null for unknown hash', () => {
        expect(tabFromHash('#unknown')).toBeNull();
    });

    it('returns null for empty hash', () => {
        expect(tabFromHash('#')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(tabFromHash('')).toBeNull();
    });
});

// ─── VALID_REPO_SUB_TABS ────────────────────────────────────────

describe('VALID_REPO_SUB_TABS', () => {
    it('does not include "queue" (removed in Activity migration)', () => {
        expect(VALID_REPO_SUB_TABS.has('queue')).toBe(false);
    });

    it('includes "info"', () => {
        expect(VALID_REPO_SUB_TABS.has('info')).toBe(true);
    });

    it('includes "tasks"', () => {
        expect(VALID_REPO_SUB_TABS.has('tasks')).toBe(true);
    });

    it('includes "workflows"', () => {
        expect(VALID_REPO_SUB_TABS.has('workflows')).toBe(true);
    });

    it('includes "schedules"', () => {
        expect(VALID_REPO_SUB_TABS.has('schedules')).toBe(true);
    });

    it('does not include "chat" (removed in Activity migration)', () => {
        expect(VALID_REPO_SUB_TABS.has('chat')).toBe(false);
    });

    it('includes "git"', () => {
        expect(VALID_REPO_SUB_TABS.has('git')).toBe(true);
    });

    it('includes "wiki"', () => {
        expect(VALID_REPO_SUB_TABS.has('wiki')).toBe(true);
    });

    it('includes "copilot"', () => {
        expect(VALID_REPO_SUB_TABS.has('copilot')).toBe(true);
    });

    it('includes "workflow"', () => {
        expect(VALID_REPO_SUB_TABS.has('workflow')).toBe(true);
    });

    it('includes "explorer"', () => {
        expect(VALID_REPO_SUB_TABS.has('explorer')).toBe(true);
    });

    it('includes "activity"', () => {
        expect(VALID_REPO_SUB_TABS.has('activity')).toBe(true);
    });

    it('includes "pull-requests"', () => {
        expect(VALID_REPO_SUB_TABS.has('pull-requests')).toBe(true);
    });

    it('does not include unknown tab', () => {
        expect(VALID_REPO_SUB_TABS.has('settings')).toBe(false);
    });

    it('has exactly 11 entries', () => {
        expect(VALID_REPO_SUB_TABS.size).toBe(11);
    });
});

// ─── Deep-link parsing simulation ───────────────────────────────
// Mirrors the parsing logic in Router's handleHash effect to verify
// that queue deep-links resolve correctly.

describe('repo sub-tab deep-link parsing', () => {
    function parseRepoDeepLink(rawHash: string): { repoId: string | null; subTab: string | null } {
        const hash = rawHash.replace(/^#/, '');
        const parts = hash.split('/');
        if (parts[0] !== 'repos') return { repoId: null, subTab: null };
        const repoId = parts.length >= 2 && parts[1] ? decodeURIComponent(parts[1]) : null;
        const subTab = parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2]) ? parts[2] : null;
        return { repoId, subTab };
    }

    it('returns null subTab for removed #repos/my-repo/queue', () => {
        const result = parseRepoDeepLink('#repos/my-repo/queue');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBeNull();
    });

    it('parses #repos/my-repo/info correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/info');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('info');
    });

    it('parses #repos/my-repo/tasks correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/tasks');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('tasks');
    });

    it('parses #repos/my-repo/workflows correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/workflows');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('workflows');
    });

    it('parses #repos/my-repo/schedules correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/schedules');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('schedules');
    });

    it('returns null subTab for removed #repos/my-repo/chat', () => {
        const result = parseRepoDeepLink('#repos/my-repo/chat');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBeNull();
    });

    it('returns null subTab for #repos/my-repo (no sub-tab)', () => {
        const result = parseRepoDeepLink('#repos/my-repo');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBeNull();
    });

    it('returns null subTab for unknown sub-tab segment', () => {
        const result = parseRepoDeepLink('#repos/my-repo/settings');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBeNull();
    });

    it('handles URL-encoded repo IDs', () => {
        const result = parseRepoDeepLink('#repos/my%20repo/activity');
        expect(result.repoId).toBe('my repo');
        expect(result.subTab).toBe('activity');
    });

    it('returns null for #repos alone', () => {
        const result = parseRepoDeepLink('#repos');
        expect(result.repoId).toBeNull();
        expect(result.subTab).toBeNull();
    });

    it('returns null for non-repo hash', () => {
        const result = parseRepoDeepLink('#processes');
        expect(result.repoId).toBeNull();
        expect(result.subTab).toBeNull();
    });
});

describe('process deep-link parsing', () => {
    it('parses #process/:id', () => {
        expect(parseProcessDeepLink('#process/proc-1')).toBe('proc-1');
    });

    it('parses #session/:id', () => {
        expect(parseProcessDeepLink('#session/proc-2')).toBe('proc-2');
    });

    it('parses #processes/:id', () => {
        expect(parseProcessDeepLink('#processes/proc-3')).toBe('proc-3');
    });

    it('handles URL-encoded process ids', () => {
        expect(parseProcessDeepLink('#process/queue_task%2F1')).toBe('queue_task/1');
    });

    it('returns null when process id missing', () => {
        expect(parseProcessDeepLink('#process')).toBeNull();
    });

    it('returns null for unrelated hashes', () => {
        expect(parseProcessDeepLink('#repos/my-repo')).toBeNull();
    });
});

// ─── VALID_WIKI_PROJECT_TABS ────────────────────────────────────

describe('VALID_WIKI_PROJECT_TABS', () => {
    it('includes "browse"', () => {
        expect(VALID_WIKI_PROJECT_TABS.has('browse')).toBe(true);
    });

    it('includes "ask"', () => {
        expect(VALID_WIKI_PROJECT_TABS.has('ask')).toBe(true);
    });

    it('includes "graph"', () => {
        expect(VALID_WIKI_PROJECT_TABS.has('graph')).toBe(true);
    });

    it('includes "admin"', () => {
        expect(VALID_WIKI_PROJECT_TABS.has('admin')).toBe(true);
    });

    it('does not include unknown tab', () => {
        expect(VALID_WIKI_PROJECT_TABS.has('settings')).toBe(false);
    });

    it('has exactly 4 entries', () => {
        expect(VALID_WIKI_PROJECT_TABS.size).toBe(4);
    });
});

// ─── parseWikiDeepLink ──────────────────────────────────────────

describe('parseWikiDeepLink', () => {
    it('parses #wiki/my-wiki with no tab (defaults null)', () => {
        const result = parseWikiDeepLink('#wiki/my-wiki');
        expect(result.wikiId).toBe('my-wiki');
        expect(result.tab).toBeNull();
        expect(result.componentId).toBeNull();
        expect(result.adminTab).toBeNull();
    });

    it('parses #wiki/my-wiki/browse', () => {
        const result = parseWikiDeepLink('#wiki/my-wiki/browse');
        expect(result.wikiId).toBe('my-wiki');
        expect(result.tab).toBe('browse');
        expect(result.componentId).toBeNull();
        expect(result.adminTab).toBeNull();
    });

    it('parses #wiki/my-wiki/ask', () => {
        const result = parseWikiDeepLink('#wiki/my-wiki/ask');
        expect(result.wikiId).toBe('my-wiki');
        expect(result.tab).toBe('ask');
        expect(result.componentId).toBeNull();
        expect(result.adminTab).toBeNull();
    });

    it('parses #wiki/my-wiki/graph', () => {
        const result = parseWikiDeepLink('#wiki/my-wiki/graph');
        expect(result.wikiId).toBe('my-wiki');
        expect(result.tab).toBe('graph');
        expect(result.componentId).toBeNull();
        expect(result.adminTab).toBeNull();
    });

    it('parses #wiki/my-wiki/admin with no sub-tab', () => {
        const result = parseWikiDeepLink('#wiki/my-wiki/admin');
        expect(result.wikiId).toBe('my-wiki');
        expect(result.tab).toBe('admin');
        expect(result.componentId).toBeNull();
        expect(result.adminTab).toBeNull();
    });

    it('parses #wiki/my-wiki/component/comp-1', () => {
        const result = parseWikiDeepLink('#wiki/my-wiki/component/comp-1');
        expect(result.wikiId).toBe('my-wiki');
        expect(result.tab).toBe('browse');
        expect(result.componentId).toBe('comp-1');
        expect(result.adminTab).toBeNull();
    });

    it('handles URL-encoded wiki IDs', () => {
        const result = parseWikiDeepLink('#wiki/my%20wiki/ask');
        expect(result.wikiId).toBe('my wiki');
        expect(result.tab).toBe('ask');
        expect(result.adminTab).toBeNull();
    });

    it('handles URL-encoded component IDs', () => {
        const result = parseWikiDeepLink('#wiki/w1/component/comp%2Fone');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBe('browse');
        expect(result.componentId).toBe('comp/one');
    });

    it('returns null for unknown tab segment', () => {
        const result = parseWikiDeepLink('#wiki/my-wiki/settings');
        expect(result.wikiId).toBe('my-wiki');
        expect(result.tab).toBeNull();
        expect(result.componentId).toBeNull();
        expect(result.adminTab).toBeNull();
    });

    it('returns null wikiId for #wiki alone', () => {
        const result = parseWikiDeepLink('#wiki');
        expect(result.wikiId).toBeNull();
        expect(result.tab).toBeNull();
        expect(result.componentId).toBeNull();
    });

    it('returns null for non-wiki hash', () => {
        const result = parseWikiDeepLink('#repos/my-repo');
        expect(result.wikiId).toBeNull();
        expect(result.tab).toBeNull();
        expect(result.componentId).toBeNull();
    });

    it('returns null for empty hash', () => {
        const result = parseWikiDeepLink('#');
        expect(result.wikiId).toBeNull();
        expect(result.tab).toBeNull();
    });

    it('returns null for empty string', () => {
        const result = parseWikiDeepLink('');
        expect(result.wikiId).toBeNull();
        expect(result.tab).toBeNull();
    });

    it('component route takes precedence over tab matching', () => {
        const result = parseWikiDeepLink('#wiki/w1/component/admin');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBe('browse');
        expect(result.componentId).toBe('admin');
    });

    it('returns null componentId when component segment has no ID', () => {
        const result = parseWikiDeepLink('#wiki/w1/component');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBeNull();
        expect(result.componentId).toBeNull();
    });
});

// ─── VALID_WIKI_ADMIN_TABS ──────────────────────────────────────

describe('VALID_WIKI_ADMIN_TABS', () => {
    it('includes "generate"', () => {
        expect(VALID_WIKI_ADMIN_TABS.has('generate')).toBe(true);
    });

    it('includes "seeds"', () => {
        expect(VALID_WIKI_ADMIN_TABS.has('seeds')).toBe(true);
    });

    it('includes "config"', () => {
        expect(VALID_WIKI_ADMIN_TABS.has('config')).toBe(true);
    });

    it('includes "delete"', () => {
        expect(VALID_WIKI_ADMIN_TABS.has('delete')).toBe(true);
    });

    it('does not include unknown tab', () => {
        expect(VALID_WIKI_ADMIN_TABS.has('settings')).toBe(false);
    });

    it('has exactly 4 entries', () => {
        expect(VALID_WIKI_ADMIN_TABS.size).toBe(4);
    });
});

// ─── parseWikiDeepLink — admin sub-tabs ─────────────────────────

describe('parseWikiDeepLink — admin sub-tabs', () => {
    it('parses #wiki/w1/admin/generate', () => {
        const result = parseWikiDeepLink('#wiki/w1/admin/generate');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBe('admin');
        expect(result.adminTab).toBe('generate');
        expect(result.componentId).toBeNull();
    });

    it('parses #wiki/w1/admin/seeds', () => {
        const result = parseWikiDeepLink('#wiki/w1/admin/seeds');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBe('admin');
        expect(result.adminTab).toBe('seeds');
    });

    it('parses #wiki/w1/admin/config', () => {
        const result = parseWikiDeepLink('#wiki/w1/admin/config');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBe('admin');
        expect(result.adminTab).toBe('config');
    });

    it('parses #wiki/w1/admin/delete', () => {
        const result = parseWikiDeepLink('#wiki/w1/admin/delete');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBe('admin');
        expect(result.adminTab).toBe('delete');
    });

    it('returns null adminTab for unknown admin sub-tab', () => {
        const result = parseWikiDeepLink('#wiki/w1/admin/unknown');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBe('admin');
        expect(result.adminTab).toBeNull();
    });

    it('returns null adminTab for non-admin tab with sub-path', () => {
        const result = parseWikiDeepLink('#wiki/w1/ask/seeds');
        expect(result.wikiId).toBe('w1');
        expect(result.tab).toBe('ask');
        expect(result.adminTab).toBeNull();
    });

    it('handles URL-encoded wiki ID with admin sub-tab', () => {
        const result = parseWikiDeepLink('#wiki/my%20wiki/admin/config');
        expect(result.wikiId).toBe('my wiki');
        expect(result.tab).toBe('admin');
        expect(result.adminTab).toBe('config');
    });

    it('#wiki/w1/admin has null adminTab (defaults to generate in component)', () => {
        const result = parseWikiDeepLink('#wiki/w1/admin');
        expect(result.tab).toBe('admin');
        expect(result.adminTab).toBeNull();
    });
});

// ─── wiki tab deep-link integration ─────────────────────────────
// Top-level #wiki route is hidden (SHOW_WIKI_TAB = false); wiki is only
// accessible under #repos/:id/wiki. The code remains for future re-enabling.

describe('wiki tab deep-link integration', () => {
    it('tabFromHash returns "wiki" for wiki routes (accessible via hash even when tab hidden)', () => {
        expect(tabFromHash('#wiki/my-wiki/browse')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/ask')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/graph')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/component/comp-1')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin/seeds')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin/config')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin/delete')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin/generate')).toBe('wiki');
    });

    it('parseWikiDeepLink still parses wiki hashes correctly', () => {
        const detail1 = parseWikiDeepLink('#wiki/w1/ask');
        expect(detail1.wikiId).toBe('w1');
        expect(detail1.tab).toBe('ask');

        const detail2 = parseWikiDeepLink('#wiki/w1/admin/seeds');
        expect(detail2.wikiId).toBe('w1');
        expect(detail2.tab).toBe('admin');
        expect(detail2.adminTab).toBe('seeds');
    });
});

// ─── parseWorkflowsDeepLink ──────────────────────────────────────

describe('parseWorkflowsDeepLink', () => {
    it('parses #repos/my-repo/workflows/my-pipe', () => {
        expect(parseWorkflowsDeepLink('#repos/my-repo/workflows/my-pipe')).toBe('my-pipe');
    });

    it('URL-decodes the pipeline name', () => {
        expect(parseWorkflowsDeepLink('#repos/my-repo/workflows/my%20pipe')).toBe('my pipe');
    });

    it('returns null when pipeline name is missing', () => {
        expect(parseWorkflowsDeepLink('#repos/my-repo/workflows')).toBeNull();
    });

    it('returns null for non-workflows sub-tab', () => {
        expect(parseWorkflowsDeepLink('#repos/my-repo/info')).toBeNull();
    });

    it('returns null for non-repo hash', () => {
        expect(parseWorkflowsDeepLink('#wiki/something')).toBeNull();
    });

    it('returns null for empty hash', () => {
        expect(parseWorkflowsDeepLink('#')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseWorkflowsDeepLink('')).toBeNull();
    });

    it('handles URL-encoded repo ID', () => {
        expect(parseWorkflowsDeepLink('#repos/my%20repo/workflows/pipe1')).toBe('pipe1');
    });

    it('returns null from bare #repos', () => {
        expect(parseWorkflowsDeepLink('#repos')).toBeNull();
    });

    it('returns null from #repos/ws-abc with no sub-tab', () => {
        expect(parseWorkflowsDeepLink('#repos/ws-abc')).toBeNull();
    });

    it('returns null from #processes/some-id', () => {
        expect(parseWorkflowsDeepLink('#processes/some-id')).toBeNull();
    });
});

// ─── handleHash wiki dispatch simulation ────────────────────────
// The top-level #wiki route is hidden (SHOW_WIKI_TAB = false); wiki is
// accessible under #repos/:id/wiki. The dispatch code remains for future
// re-enabling. These tests verify that #wiki hashes produce no dispatches
// while SHOW_WIKI_TAB is false.

describe('handleHash wiki dispatch simulation', () => {
    function simulateWikiHashDispatch(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const tab = tabFromHash('#' + hash);
        if (tab === 'wiki') {
            const wikiLink = parseWikiDeepLink('#' + hash);
            if (wikiLink.wikiId) {
                if (wikiLink.tab) {
                    dispatches.push({
                        type: 'SELECT_WIKI_WITH_TAB',
                        wikiId: wikiLink.wikiId,
                        tab: wikiLink.tab,
                        adminTab: wikiLink.adminTab,
                        componentId: wikiLink.componentId,
                    });
                } else {
                    dispatches.push({ type: 'SELECT_WIKI', wikiId: wikiLink.wikiId });
                }
            }
        }
        return dispatches;
    }

    it('dispatches correctly for #wiki hashes (accessible via hash route even when tab hidden)', () => {
        expect(simulateWikiHashDispatch('#wiki/w1/component/comp-1')).toHaveLength(1);
        expect(simulateWikiHashDispatch('#wiki/w1/ask')).toHaveLength(1);
        expect(simulateWikiHashDispatch('#wiki/w1')).toHaveLength(1);
        expect(simulateWikiHashDispatch('#wiki/w1/admin/seeds')).toHaveLength(1);
        // #wiki alone has no wikiId, so no dispatch
        expect(simulateWikiHashDispatch('#wiki')).toHaveLength(0);
    });

    it('dispatches nothing for non-wiki hash', () => {
        const dispatches = simulateWikiHashDispatch('#repos/my-repo');
        expect(dispatches).toHaveLength(0);
    });
});

// ─── workflow deep-link integration ────────────────────────────

describe('workflow deep-link integration', () => {
    it('tabFromHash returns "repos" for #repos/ws-abc/workflows/my-pipeline', () => {
        expect(tabFromHash('#repos/ws-abc/workflows/my-pipeline')).toBe('repos');
    });

    it('parseWorkflowsDeepLink and tabFromHash compose correctly for a pipeline deep link', () => {
        const hash = '#repos/ws-abc/workflows/my-pipeline';
        expect(tabFromHash(hash)).toBe('repos');
        expect(parseWorkflowsDeepLink(hash)).toBe('my-pipeline');
    });
});

// ─── handleHash pipeline integration (dispatch simulation) ──────

describe('handleHash workflow dispatch simulation', () => {
    // Mirrors the repos-branch logic from Router's handleHash effect
    function simulateHandleHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const tab = tabFromHash('#' + hash);
        if (tab === 'repos') {
            const parts = hash.split('/');
            if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                dispatches.push({ type: 'SET_SELECTED_REPO', id: decodeURIComponent(parts[1]) });
                if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                    dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: parts[2] });
                }
                if (parts[2] === 'workflows' && parts[3]) {
                    dispatches.push({ type: 'SET_SELECTED_WORKFLOW', name: decodeURIComponent(parts[3]) });
                } else if (parts[2] === 'workflows') {
                    dispatches.push({ type: 'SET_SELECTED_WORKFLOW', name: null });
                } else if (parts[2] && parts[2] !== 'workflows') {
                    dispatches.push({ type: 'SET_SELECTED_WORKFLOW', name: null });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SET_SELECTED_WORKFLOW with name for #repos/r1/workflows/pipe1', () => {
        const dispatches = simulateHandleHash('#repos/r1/workflows/pipe1');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'workflows' });
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_WORKFLOW', name: 'pipe1' });
    });

    it('dispatches SET_SELECTED_WORKFLOW with null for #repos/r1/workflows (no name)', () => {
        const dispatches = simulateHandleHash('#repos/r1/workflows');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'workflows' });
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_WORKFLOW', name: null });
    });

    it('dispatches SET_SELECTED_WORKFLOW with null for #repos/r1/tasks (different sub-tab)', () => {
        const dispatches = simulateHandleHash('#repos/r1/tasks');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'tasks' });
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_WORKFLOW', name: null });
    });

    it('does not dispatch SET_SELECTED_WORKFLOW when no sub-tab', () => {
        const dispatches = simulateHandleHash('#repos/r1');
        expect(dispatches.find(d => d.type === 'SET_SELECTED_WORKFLOW')).toBeUndefined();
    });
});


// ─── parseActivityDeepLink ───────────────────────────────────────

describe('parseActivityDeepLink', () => {
    it('parses #repos/my-repo/activity/task-1', () => {
        expect(parseActivityDeepLink('#repos/my-repo/activity/task-1')).toBe('task-1');
    });

    it('URL-decodes the task ID', () => {
        expect(parseActivityDeepLink('#repos/my-repo/activity/task%2F1')).toBe('task/1');
    });

    it('returns null when task ID is missing', () => {
        expect(parseActivityDeepLink('#repos/my-repo/activity')).toBeNull();
    });

    it('returns null for non-activity sub-tab', () => {
        expect(parseActivityDeepLink('#repos/my-repo/queue')).toBeNull();
    });

    it('returns null for non-repo hash', () => {
        expect(parseActivityDeepLink('#wiki/something')).toBeNull();
    });

    it('returns null for empty hash', () => {
        expect(parseActivityDeepLink('#')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseActivityDeepLink('')).toBeNull();
    });

    it('handles URL-encoded repo ID', () => {
        expect(parseActivityDeepLink('#repos/my%20repo/activity/task-1')).toBe('task-1');
    });

    it('returns null from bare #repos', () => {
        expect(parseActivityDeepLink('#repos')).toBeNull();
    });

    it('returns null from #repos/ws-abc with no sub-tab', () => {
        expect(parseActivityDeepLink('#repos/ws-abc')).toBeNull();
    });

    it('returns null from #processes/some-id', () => {
        expect(parseActivityDeepLink('#processes/some-id')).toBeNull();
    });

    it('handles task IDs with special characters', () => {
        expect(parseActivityDeepLink('#repos/r1/activity/task%20with%20spaces')).toBe('task with spaces');
    });
});

// ─── activity deep-link integration ─────────────────────────────

describe('activity deep-link integration', () => {
    it('tabFromHash returns "repos" for #repos/ws-abc/activity/task-1', () => {
        expect(tabFromHash('#repos/ws-abc/activity/task-1')).toBe('repos');
    });

    it('parseActivityDeepLink and tabFromHash compose correctly for an activity deep link', () => {
        const hash = '#repos/ws-abc/activity/task-1';
        expect(tabFromHash(hash)).toBe('repos');
        expect(parseActivityDeepLink(hash)).toBe('task-1');
    });
});

// ─── handleHash activity dispatch simulation ────────────────────

describe('handleHash activity dispatch simulation', () => {
    function simulateActivityHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const tab = tabFromHash('#' + hash);
        if (tab === 'repos') {
            const parts = hash.split('/');
            if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                dispatches.push({ type: 'SET_SELECTED_REPO', id: decodeURIComponent(parts[1]) });
                if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                    dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: parts[2] });
                }
                if (parts[2] === 'activity' && parts[3]) {
                    dispatches.push({ type: 'SELECT_QUEUE_TASK', id: decodeURIComponent(parts[3]) });
                } else if (parts[2] === 'activity') {
                    dispatches.push({ type: 'SELECT_QUEUE_TASK', id: null });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SELECT_QUEUE_TASK with task ID for #repos/r1/activity/task-1', () => {
        const dispatches = simulateActivityHash('#repos/r1/activity/task-1');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(dispatches).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'task-1' });
    });

    it('dispatches SELECT_QUEUE_TASK with null for #repos/r1/activity (no task)', () => {
        const dispatches = simulateActivityHash('#repos/r1/activity');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(dispatches).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: null });
    });

    it('does not dispatch SELECT_QUEUE_TASK for #repos/r1/workflows', () => {
        const dispatches = simulateActivityHash('#repos/r1/workflows');
        expect(dispatches.find(d => d.type === 'SELECT_QUEUE_TASK')).toBeUndefined();
    });

    it('does not dispatch SELECT_QUEUE_TASK for #repos/r1 (no sub-tab)', () => {
        const dispatches = simulateActivityHash('#repos/r1');
        expect(dispatches.find(d => d.type === 'SELECT_QUEUE_TASK')).toBeUndefined();
    });

    it('URL-decodes the task ID in dispatch', () => {
        const dispatches = simulateActivityHash('#repos/r1/activity/task%2Fone');
        expect(dispatches).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'task/one' });
    });

    it('dispatches SET_SELECTED_REPO alongside activity task selection', () => {
        const dispatches = simulateActivityHash('#repos/r1/activity/task-1');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'r1' });
        expect(dispatches).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'task-1' });
    });
});

// ─── repo sub-tab deep-link parsing — activity ──────────────────

describe('repo sub-tab deep-link parsing — activity', () => {
    function parseRepoDeepLink(rawHash: string): { repoId: string | null; subTab: string | null } {
        const hash = rawHash.replace(/^#/, '');
        const parts = hash.split('/');
        if (parts[0] !== 'repos') return { repoId: null, subTab: null };
        const repoId = parts.length >= 2 && parts[1] ? decodeURIComponent(parts[1]) : null;
        const subTab = parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2]) ? parts[2] : null;
        return { repoId, subTab };
    }

    it('parses #repos/my-repo/activity correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/activity');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('activity');
    });

    it('tabFromHash returns "repos" for #repos/ws-abc/activity', () => {
        expect(tabFromHash('#repos/ws-abc/activity')).toBe('repos');
    });

    it('handles URL-encoded repo IDs with activity sub-tab', () => {
        const result = parseRepoDeepLink('#repos/my%20repo/activity');
        expect(result.repoId).toBe('my repo');
        expect(result.subTab).toBe('activity');
    });
});

// ─── parseGitCommitDeepLink ─────────────────────────────────────

describe('parseGitCommitDeepLink', () => {
    it('parses #repos/my-repo/git/abc1234', () => {
        expect(parseGitCommitDeepLink('#repos/my-repo/git/abc1234')).toBe('abc1234');
    });

    it('URL-decodes the commit hash', () => {
        expect(parseGitCommitDeepLink('#repos/my-repo/git/abc%2F1')).toBe('abc/1');
    });

    it('returns null when commit hash is missing', () => {
        expect(parseGitCommitDeepLink('#repos/my-repo/git')).toBeNull();
    });

    it('returns null for non-git sub-tab', () => {
        expect(parseGitCommitDeepLink('#repos/my-repo/workflows')).toBeNull();
    });

    it('returns null for non-repo hash', () => {
        expect(parseGitCommitDeepLink('#wiki/something')).toBeNull();
    });

    it('returns null for empty hash', () => {
        expect(parseGitCommitDeepLink('#')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseGitCommitDeepLink('')).toBeNull();
    });

    it('handles URL-encoded repo ID', () => {
        expect(parseGitCommitDeepLink('#repos/my%20repo/git/abc1234')).toBe('abc1234');
    });

    it('returns null from bare #repos', () => {
        expect(parseGitCommitDeepLink('#repos')).toBeNull();
    });

    it('handles full 40-char SHA', () => {
        const fullSha = 'a'.repeat(40);
        expect(parseGitCommitDeepLink(`#repos/r1/git/${fullSha}`)).toBe(fullSha);
    });
});

// ─── git deep-link integration ──────────────────────────────────

describe('git deep-link integration', () => {
    it('tabFromHash returns "repos" for #repos/ws-abc/git/abc1234', () => {
        expect(tabFromHash('#repos/ws-abc/git/abc1234')).toBe('repos');
    });

    it('parseGitCommitDeepLink and tabFromHash compose correctly for a git deep link', () => {
        const hash = '#repos/ws-abc/git/abc1234';
        expect(tabFromHash(hash)).toBe('repos');
        expect(parseGitCommitDeepLink(hash)).toBe('abc1234');
    });
});

// ─── parseGitFileDeepLink ────────────────────────────────────────

describe('parseGitFileDeepLink', () => {
    it('parses commit hash and file path', () => {
        const result = parseGitFileDeepLink('#repos/my-repo/git/abc1234/src%2Findex.ts');
        expect(result).toEqual({ commitHash: 'abc1234', filePath: 'src/index.ts' });
    });

    it('URL-decodes the file path', () => {
        const result = parseGitFileDeepLink('#repos/r1/git/abc/path%2Fto%2Ffile.ts');
        expect(result).toEqual({ commitHash: 'abc', filePath: 'path/to/file.ts' });
    });

    it('handles simple file name without subdirectory', () => {
        const result = parseGitFileDeepLink('#repos/r1/git/abc1234/README.md');
        expect(result).toEqual({ commitHash: 'abc1234', filePath: 'README.md' });
    });

    it('returns null when file path segment is missing', () => {
        expect(parseGitFileDeepLink('#repos/my-repo/git/abc1234')).toBeNull();
    });

    it('returns null when commit hash is missing', () => {
        expect(parseGitFileDeepLink('#repos/my-repo/git')).toBeNull();
    });

    it('returns null for non-git sub-tab', () => {
        expect(parseGitFileDeepLink('#repos/my-repo/workflows/abc/file.ts')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseGitFileDeepLink('')).toBeNull();
    });

    it('returns null for bare #repos', () => {
        expect(parseGitFileDeepLink('#repos')).toBeNull();
    });

    it('URL-decodes the repo ID but still parses correctly', () => {
        const result = parseGitFileDeepLink('#repos/my%20repo/git/abc/src%2Fmain.ts');
        expect(result).toEqual({ commitHash: 'abc', filePath: 'src/main.ts' });
    });

    it('handles deeply nested file path', () => {
        const encoded = encodeURIComponent('a/b/c/deep.ts');
        const result = parseGitFileDeepLink(`#repos/r1/git/sha123/${encoded}`);
        expect(result).toEqual({ commitHash: 'sha123', filePath: 'a/b/c/deep.ts' });
    });
});

// ─── handleHash git dispatch simulation ─────────────────────────

describe('handleHash git dispatch simulation', () => {
    function simulateGitHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const tab = tabFromHash('#' + hash);
        if (tab === 'repos') {
            const parts = hash.split('/');
            if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                dispatches.push({ type: 'SET_SELECTED_REPO', id: decodeURIComponent(parts[1]) });
                if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                    dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: parts[2] });
                }
                // Git commit deep-link handling (mirrors Router.tsx)
                if (parts[2] === 'git' && parts[3]) {
                    dispatches.push({ type: 'SET_GIT_COMMIT_HASH', hash: decodeURIComponent(parts[3]) });
                    if (parts[4]) {
                        dispatches.push({ type: 'SET_GIT_FILE_PATH', filePath: decodeURIComponent(parts[4]) });
                    } else {
                        dispatches.push({ type: 'CLEAR_GIT_FILE_PATH' });
                    }
                } else if (parts[2] === 'git') {
                    dispatches.push({ type: 'SET_GIT_COMMIT_HASH', hash: null });
                    dispatches.push({ type: 'CLEAR_GIT_FILE_PATH' });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SET_GIT_COMMIT_HASH with commit hash for #repos/r1/git/abc1234', () => {
        const dispatches = simulateGitHash('#repos/r1/git/abc1234');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
        expect(dispatches).toContainEqual({ type: 'SET_GIT_COMMIT_HASH', hash: 'abc1234' });
    });

    it('dispatches SET_GIT_COMMIT_HASH with null for #repos/r1/git (no hash)', () => {
        const dispatches = simulateGitHash('#repos/r1/git');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
        expect(dispatches).toContainEqual({ type: 'SET_GIT_COMMIT_HASH', hash: null });
    });

    it('does not dispatch SET_GIT_COMMIT_HASH for #repos/r1/workflows', () => {
        const dispatches = simulateGitHash('#repos/r1/workflows');
        expect(dispatches.find(d => d.type === 'SET_GIT_COMMIT_HASH')).toBeUndefined();
    });

    it('does not dispatch SET_GIT_COMMIT_HASH for #repos/r1 (no sub-tab)', () => {
        const dispatches = simulateGitHash('#repos/r1');
        expect(dispatches.find(d => d.type === 'SET_GIT_COMMIT_HASH')).toBeUndefined();
    });

    it('URL-decodes the commit hash in dispatch', () => {
        const dispatches = simulateGitHash('#repos/r1/git/abc%2Fone');
        expect(dispatches).toContainEqual({ type: 'SET_GIT_COMMIT_HASH', hash: 'abc/one' });
    });

    it('dispatches SET_SELECTED_REPO alongside git commit selection', () => {
        const dispatches = simulateGitHash('#repos/r1/git/abc1234');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'r1' });
        expect(dispatches).toContainEqual({ type: 'SET_GIT_COMMIT_HASH', hash: 'abc1234' });
    });

    it('dispatches CLEAR_GIT_FILE_PATH when only commit hash (no file segment)', () => {
        const dispatches = simulateGitHash('#repos/r1/git/abc1234');
        expect(dispatches).toContainEqual({ type: 'CLEAR_GIT_FILE_PATH' });
    });

    it('dispatches SET_GIT_FILE_PATH when file segment is present', () => {
        const encoded = encodeURIComponent('src/index.ts');
        const dispatches = simulateGitHash(`#repos/r1/git/abc1234/${encoded}`);
        expect(dispatches).toContainEqual({ type: 'SET_GIT_COMMIT_HASH', hash: 'abc1234' });
        expect(dispatches).toContainEqual({ type: 'SET_GIT_FILE_PATH', filePath: 'src/index.ts' });
    });

    it('does not dispatch CLEAR_GIT_FILE_PATH when file segment is present', () => {
        const encoded = encodeURIComponent('src/main.ts');
        const dispatches = simulateGitHash(`#repos/r1/git/abc/${encoded}`);
        expect(dispatches.find(d => d.type === 'CLEAR_GIT_FILE_PATH')).toBeUndefined();
    });

    it('URL-decodes the file path in SET_GIT_FILE_PATH dispatch', () => {
        const encoded = encodeURIComponent('packages/core/src/utils.ts');
        const dispatches = simulateGitHash(`#repos/r1/git/sha/${encoded}`);
        expect(dispatches).toContainEqual({ type: 'SET_GIT_FILE_PATH', filePath: 'packages/core/src/utils.ts' });
    });

    it('dispatches CLEAR_GIT_FILE_PATH when #repos/r1/git (no hash)', () => {
        const dispatches = simulateGitHash('#repos/r1/git');
        expect(dispatches).toContainEqual({ type: 'CLEAR_GIT_FILE_PATH' });
    });
});

// ─── wiki repo sub-tab deep-link ─────────────────────────────────

describe('wiki repo sub-tab deep-link', () => {
    function parseRepoDeepLink(rawHash: string): { repoId: string | null; subTab: string | null } {
        const hash = rawHash.replace(/^#/, '');
        const parts = hash.split('/');
        if (parts[0] !== 'repos') return { repoId: null, subTab: null };
        const repoId = parts.length >= 2 && parts[1] ? decodeURIComponent(parts[1]) : null;
        const subTab = parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2]) ? parts[2] : null;
        return { repoId, subTab };
    }

    it('parses #repos/my-repo/wiki correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/wiki');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('wiki');
    });

    it('tabFromHash returns "repos" for #repos/ws-abc/wiki', () => {
        expect(tabFromHash('#repos/ws-abc/wiki')).toBe('repos');
    });

    it('handles URL-encoded repo IDs with wiki sub-tab', () => {
        const result = parseRepoDeepLink('#repos/my%20repo/wiki');
        expect(result.repoId).toBe('my repo');
        expect(result.subTab).toBe('wiki');
    });
});

// ─── handleHash wiki repo sub-tab dispatch simulation ───────────

describe('handleHash wiki repo sub-tab dispatch simulation', () => {
    function simulateWikiRepoHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const tab = tabFromHash('#' + hash);
        if (tab === 'repos') {
            const parts = hash.split('/');
            if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                dispatches.push({ type: 'SET_SELECTED_REPO', id: decodeURIComponent(parts[1]) });
                if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                    dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: parts[2] });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SET_REPO_SUB_TAB with wiki for #repos/r1/wiki', () => {
        const dispatches = simulateWikiRepoHash('#repos/r1/wiki');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
    });

    it('dispatches SET_SELECTED_REPO alongside wiki sub-tab', () => {
        const dispatches = simulateWikiRepoHash('#repos/r1/wiki');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'r1' });
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
    });

    it('does not dispatch SET_REPO_SUB_TAB for #repos/r1 (no sub-tab)', () => {
        const dispatches = simulateWikiRepoHash('#repos/r1');
        expect(dispatches.find(d => d.type === 'SET_REPO_SUB_TAB')).toBeUndefined();
    });
});

// ─── W keyboard shortcut simulation ─────────────────────────────
// Mirrors the W-key useEffect handler logic from Router.tsx

describe('W keyboard shortcut simulation', () => {
    type MockEvent = {
        key: string;
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
        target?: { tagName?: string; isContentEditable?: boolean };
    };
    type MockState = { activeTab: string; selectedRepoId: string | null };

    function simulateWKeyHandler(
        e: MockEvent,
        state: MockState,
    ): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const target = e.target ?? { tagName: 'BODY', isContentEditable: false };
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return dispatches;
        if (e.ctrlKey || e.metaKey || e.altKey) return dispatches;
        if (state.activeTab !== 'repos' || !state.selectedRepoId) return dispatches;
        if (e.key === 'w' || e.key === 'W') {
            dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
        }
        return dispatches;
    }

    const repoState: MockState = { activeTab: 'repos', selectedRepoId: 'my-repo' };

    it('dispatches SET_REPO_SUB_TAB wiki for key W', () => {
        const dispatches = simulateWKeyHandler({ key: 'W' }, repoState);
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
    });

    it('dispatches SET_REPO_SUB_TAB wiki for lowercase key w', () => {
        const dispatches = simulateWKeyHandler({ key: 'w' }, repoState);
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
    });

    it('does not dispatch when activeTab is not repos', () => {
        const dispatches = simulateWKeyHandler({ key: 'W' }, { activeTab: 'wiki', selectedRepoId: 'my-repo' });
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when selectedRepoId is null', () => {
        const dispatches = simulateWKeyHandler({ key: 'W' }, { activeTab: 'repos', selectedRepoId: null });
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when target is INPUT', () => {
        const dispatches = simulateWKeyHandler({ key: 'W', target: { tagName: 'INPUT' } }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when target is TEXTAREA', () => {
        const dispatches = simulateWKeyHandler({ key: 'W', target: { tagName: 'TEXTAREA' } }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when target is contentEditable', () => {
        const dispatches = simulateWKeyHandler({ key: 'W', target: { tagName: 'DIV', isContentEditable: true } }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when ctrlKey is pressed', () => {
        const dispatches = simulateWKeyHandler({ key: 'W', ctrlKey: true }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when metaKey is pressed', () => {
        const dispatches = simulateWKeyHandler({ key: 'W', metaKey: true }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when altKey is pressed', () => {
        const dispatches = simulateWKeyHandler({ key: 'W', altKey: true }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch for unrelated keys', () => {
        const dispatches = simulateWKeyHandler({ key: 'c' }, repoState);
        expect(dispatches).toHaveLength(0);
    });
});

// ─── A keyboard shortcut simulation ─────────────────────────────
// Mirrors the A-key useEffect handler logic from Router.tsx

describe('A keyboard shortcut simulation', () => {
    type MockEvent = {
        key: string;
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
        target?: { tagName?: string; isContentEditable?: boolean };
    };
    type MockState = { activeTab: string; selectedRepoId: string | null };

    function simulateAKeyHandler(
        e: MockEvent,
        state: MockState,
    ): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const target = e.target ?? { tagName: 'BODY', isContentEditable: false };
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return dispatches;
        if (e.ctrlKey || e.metaKey || e.altKey) return dispatches;
        if (state.activeTab !== 'repos' || !state.selectedRepoId) return dispatches;
        if (e.key === 'a' || e.key === 'A') {
            dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        }
        return dispatches;
    }

    const repoState: MockState = { activeTab: 'repos', selectedRepoId: 'my-repo' };

    it('dispatches SET_REPO_SUB_TAB activity for key A', () => {
        const dispatches = simulateAKeyHandler({ key: 'A' }, repoState);
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
    });

    it('dispatches SET_REPO_SUB_TAB activity for lowercase key a', () => {
        const dispatches = simulateAKeyHandler({ key: 'a' }, repoState);
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
    });

    it('does not dispatch when activeTab is not repos', () => {
        const dispatches = simulateAKeyHandler({ key: 'A' }, { activeTab: 'wiki', selectedRepoId: 'my-repo' });
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when selectedRepoId is null', () => {
        const dispatches = simulateAKeyHandler({ key: 'A' }, { activeTab: 'repos', selectedRepoId: null });
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when target is INPUT', () => {
        const dispatches = simulateAKeyHandler({ key: 'A', target: { tagName: 'INPUT' } }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when target is TEXTAREA', () => {
        const dispatches = simulateAKeyHandler({ key: 'A', target: { tagName: 'TEXTAREA' } }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when target is contentEditable', () => {
        const dispatches = simulateAKeyHandler({ key: 'A', target: { tagName: 'DIV', isContentEditable: true } }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when ctrlKey is pressed', () => {
        const dispatches = simulateAKeyHandler({ key: 'A', ctrlKey: true }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when metaKey is pressed', () => {
        const dispatches = simulateAKeyHandler({ key: 'A', metaKey: true }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch when altKey is pressed', () => {
        const dispatches = simulateAKeyHandler({ key: 'A', altKey: true }, repoState);
        expect(dispatches).toHaveLength(0);
    });

    it('does not dispatch for unrelated keys', () => {
        const dispatches = simulateAKeyHandler({ key: 'c' }, repoState);
        expect(dispatches).toHaveLength(0);
    });
});

// ─── handleHash wiki deep-link in repos context ──────────────────

describe('handleHash wiki deep-link dispatch simulation (repos context)', () => {
    function simulateRepoWikiHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const parts = hash.split('/');
        if (parts[0] !== 'repos' || !parts[1]) return dispatches;

        dispatches.push({ type: 'SET_SELECTED_REPO', id: decodeURIComponent(parts[1]) });
        if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
            dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: parts[2] });
        }

        if (parts[2] === 'wiki' && parts[3]) {
            const wikiId = decodeURIComponent(parts[3]);
            if (parts[4] === 'component' && parts[5]) {
                dispatches.push({
                    type: 'SET_REPO_WIKI_DEEP_LINK',
                    wikiId,
                    tab: 'browse',
                    componentId: decodeURIComponent(parts[5]),
                });
            } else if (parts[4] && VALID_WIKI_PROJECT_TABS.has(parts[4])) {
                const tab = parts[4];
                let adminTab: string | null = null;
                if (tab === 'admin' && parts[5] && VALID_WIKI_ADMIN_TABS.has(parts[5])) {
                    adminTab = parts[5];
                }
                dispatches.push({ type: 'SET_REPO_WIKI_DEEP_LINK', wikiId, tab, adminTab });
            } else {
                dispatches.push({ type: 'SET_REPO_WIKI_ID', wikiId });
            }
        } else if (parts[2] === 'wiki') {
            dispatches.push({ type: 'SET_REPO_WIKI_ID', wikiId: null });
        }

        return dispatches;
    }

    it('#repos/{id}/wiki/{wikiId} dispatches SET_REPO_WIKI_ID', () => {
        const dispatches = simulateRepoWikiHash('#repos/my-repo/wiki/my-wiki');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_WIKI_ID', wikiId: 'my-wiki' });
    });

    it('#repos/{id}/wiki/{wikiId}/ask dispatches SET_REPO_WIKI_DEEP_LINK with tab', () => {
        const dispatches = simulateRepoWikiHash('#repos/my-repo/wiki/my-wiki/ask');
        expect(dispatches).toContainEqual({
            type: 'SET_REPO_WIKI_DEEP_LINK',
            wikiId: 'my-wiki',
            tab: 'ask',
            adminTab: null,
        });
    });

    it('#repos/{id}/wiki/{wikiId}/component/{cId} dispatches with componentId', () => {
        const dispatches = simulateRepoWikiHash('#repos/my-repo/wiki/my-wiki/component/auth-module');
        expect(dispatches).toContainEqual({
            type: 'SET_REPO_WIKI_DEEP_LINK',
            wikiId: 'my-wiki',
            tab: 'browse',
            componentId: 'auth-module',
        });
    });

    it('#repos/{id}/wiki/{wikiId}/admin/seeds dispatches with adminTab', () => {
        const dispatches = simulateRepoWikiHash('#repos/my-repo/wiki/my-wiki/admin/seeds');
        expect(dispatches).toContainEqual({
            type: 'SET_REPO_WIKI_DEEP_LINK',
            wikiId: 'my-wiki',
            tab: 'admin',
            adminTab: 'seeds',
        });
    });

    it('#repos/{id}/wiki (no wikiId) dispatches SET_REPO_WIKI_ID with null', () => {
        const dispatches = simulateRepoWikiHash('#repos/my-repo/wiki');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_WIKI_ID', wikiId: null });
    });

    it('URL-encoded wikiId is properly decoded', () => {
        const dispatches = simulateRepoWikiHash('#repos/my-repo/wiki/wiki%20with%20spaces');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_WIKI_ID', wikiId: 'wiki with spaces' });
    });

    it('dispatches SET_REPO_SUB_TAB wiki alongside wiki deep-link', () => {
        const dispatches = simulateRepoWikiHash('#repos/my-repo/wiki/my-wiki');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
    });
});

// ─── parseWorkflowDeepLink ──────────────────────────────────────

describe('parseWorkflowDeepLink', () => {
    it('parses #repos/my-repo/workflow/proc-1', () => {
        const result = parseWorkflowDeepLink('#repos/my-repo/workflow/proc-1');
        expect(result).toEqual({ repoId: 'my-repo', processId: 'proc-1' });
    });

    it('URL-decodes both repoId and processId', () => {
        const result = parseWorkflowDeepLink('#repos/my%20repo/workflow/proc%2F1');
        expect(result).toEqual({ repoId: 'my repo', processId: 'proc/1' });
    });

    it('returns null when processId is missing', () => {
        expect(parseWorkflowDeepLink('#repos/my-repo/workflow')).toBeNull();
    });

    it('returns null for non-workflow sub-tab', () => {
        expect(parseWorkflowDeepLink('#repos/my-repo/workflows/pipe1')).toBeNull();
    });

    it('returns null for non-repo hash', () => {
        expect(parseWorkflowDeepLink('#wiki/something')).toBeNull();
    });

    it('returns null for empty hash', () => {
        expect(parseWorkflowDeepLink('#')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseWorkflowDeepLink('')).toBeNull();
    });

    it('handles URL-encoded repo ID', () => {
        const result = parseWorkflowDeepLink('#repos/my%20repo/workflow/proc-1');
        expect(result?.repoId).toBe('my repo');
        expect(result?.processId).toBe('proc-1');
    });

    it('returns null from bare #repos', () => {
        expect(parseWorkflowDeepLink('#repos')).toBeNull();
    });

    it('returns null from #repos/ws-abc with no sub-tab', () => {
        expect(parseWorkflowDeepLink('#repos/ws-abc')).toBeNull();
    });

    it('returns null from #processes/some-id', () => {
        expect(parseWorkflowDeepLink('#processes/some-id')).toBeNull();
    });
});

// ─── workflow deep-link integration ─────────────────────────────

describe('workflow deep-link integration', () => {
    it('tabFromHash returns "repos" for #repos/ws-abc/workflow/proc-1', () => {
        expect(tabFromHash('#repos/ws-abc/workflow/proc-1')).toBe('repos');
    });

    it('parseWorkflowDeepLink and tabFromHash compose correctly for a workflow deep link', () => {
        const hash = '#repos/ws-abc/workflow/proc-1';
        expect(tabFromHash(hash)).toBe('repos');
        const result = parseWorkflowDeepLink(hash);
        expect(result?.repoId).toBe('ws-abc');
        expect(result?.processId).toBe('proc-1');
    });
});

// ─── handleHash workflow dispatch simulation ────────────────────

describe('handleHash workflow dispatch simulation', () => {
    function simulateWorkflowHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const tab = tabFromHash('#' + hash);
        if (tab === 'repos') {
            const parts = hash.split('/');
            if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                dispatches.push({ type: 'SET_SELECTED_REPO', id: decodeURIComponent(parts[1]) });
                if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                    dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: parts[2] });
                }
                // Workflow deep-link handling (mirrors Router.tsx)
                if (parts[2] === 'workflow' && parts[3]) {
                    dispatches.push({ type: 'SET_WORKFLOW_PROCESS', processId: decodeURIComponent(parts[3]) });
                } else if (parts[2] === 'workflow') {
                    dispatches.push({ type: 'SET_WORKFLOW_PROCESS', processId: null });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SET_WORKFLOW_PROCESS with processId for #repos/r1/workflow/proc-1', () => {
        const dispatches = simulateWorkflowHash('#repos/r1/workflow/proc-1');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'workflow' });
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_PROCESS', processId: 'proc-1' });
    });

    it('dispatches SET_WORKFLOW_PROCESS with null for #repos/r1/workflow (no processId)', () => {
        const dispatches = simulateWorkflowHash('#repos/r1/workflow');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'workflow' });
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_PROCESS', processId: null });
    });

    it('does not dispatch SET_WORKFLOW_PROCESS for #repos/r1/workflows', () => {
        const dispatches = simulateWorkflowHash('#repos/r1/workflows');
        expect(dispatches.find(d => d.type === 'SET_WORKFLOW_PROCESS')).toBeUndefined();
    });

    it('does not dispatch SET_WORKFLOW_PROCESS for #repos/r1 (no sub-tab)', () => {
        const dispatches = simulateWorkflowHash('#repos/r1');
        expect(dispatches.find(d => d.type === 'SET_WORKFLOW_PROCESS')).toBeUndefined();
    });

    it('URL-decodes the processId in dispatch', () => {
        const dispatches = simulateWorkflowHash('#repos/r1/workflow/proc%2Fone');
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_PROCESS', processId: 'proc/one' });
    });

    it('dispatches SET_SELECTED_REPO alongside workflow process selection', () => {
        const dispatches = simulateWorkflowHash('#repos/r1/workflow/proc-1');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'r1' });
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_PROCESS', processId: 'proc-1' });
    });
});

// ─── parseWorkflowsRunDeepLink ────────────────────────────────────

describe('parseWorkflowsRunDeepLink', () => {
    it('parses #repos/my-repo/workflows/my-pipe/run/proc-1', () => {
        const result = parseWorkflowsRunDeepLink('#repos/my-repo/workflows/my-pipe/run/proc-1');
        expect(result).toEqual({ workflowName: 'my-pipe', processId: 'proc-1' });
    });

    it('URL-decodes workflowName and processId', () => {
        const result = parseWorkflowsRunDeepLink('#repos/my-repo/workflows/my%20pipe/run/proc%2F1');
        expect(result).toEqual({ workflowName: 'my pipe', processId: 'proc/1' });
    });

    it('handles queue_ prefixed processId', () => {
        const result = parseWorkflowsRunDeepLink('#repos/ws-1/workflows/pipe1/run/queue_abc123');
        expect(result).toEqual({ workflowName: 'pipe1', processId: 'queue_abc123' });
    });

    it('returns null when processId is missing', () => {
        expect(parseWorkflowsRunDeepLink('#repos/my-repo/workflows/my-pipe/run')).toBeNull();
    });

    it('returns null when "run" segment is absent', () => {
        expect(parseWorkflowsRunDeepLink('#repos/my-repo/workflows/my-pipe')).toBeNull();
    });

    it('returns null for non-workflows sub-tab', () => {
        expect(parseWorkflowsRunDeepLink('#repos/my-repo/workflow/proc-1')).toBeNull();
    });

    it('returns null for non-repo hash', () => {
        expect(parseWorkflowsRunDeepLink('#wiki/something')).toBeNull();
    });

    it('returns null for empty hash', () => {
        expect(parseWorkflowsRunDeepLink('#')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseWorkflowsRunDeepLink('')).toBeNull();
    });
});

// ─── handleHash workflow run dispatch simulation ─────────────────

describe('handleHash workflow run dispatch simulation', () => {
    function simulateWorkflowRunHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const tab = tabFromHash('#' + hash);
        if (tab === 'repos') {
            const parts = hash.split('/');
            if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                dispatches.push({ type: 'SET_SELECTED_REPO', id: decodeURIComponent(parts[1]) });
                if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                    dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: parts[2] });
                }
                // Workflow deep-link handling (mirrors Router.tsx)
                if (parts[2] === 'workflows' && parts[3]) {
                    dispatches.push({ type: 'SET_SELECTED_WORKFLOW', name: decodeURIComponent(parts[3]) });
                    if (parts[4] === 'run' && parts[5]) {
                        dispatches.push({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: decodeURIComponent(parts[5]) });
                    } else {
                        dispatches.push({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                    }
                } else if (parts[2] === 'workflows') {
                    dispatches.push({ type: 'SET_SELECTED_WORKFLOW', name: null });
                    dispatches.push({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                } else if (parts[2] && parts[2] !== 'workflows') {
                    dispatches.push({ type: 'SET_SELECTED_WORKFLOW', name: null });
                    dispatches.push({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SET_WORKFLOW_RUN_PROCESS for #repos/r1/workflows/pipe1/run/proc-1', () => {
        const dispatches = simulateWorkflowRunHash('#repos/r1/workflows/pipe1/run/proc-1');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_WORKFLOW', name: 'pipe1' });
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: 'proc-1' });
    });

    it('dispatches SET_WORKFLOW_RUN_PROCESS null for #repos/r1/workflows/pipe1 (no run)', () => {
        const dispatches = simulateWorkflowRunHash('#repos/r1/workflows/pipe1');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_WORKFLOW', name: 'pipe1' });
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
    });

    it('dispatches SET_WORKFLOW_RUN_PROCESS null for #repos/r1/workflows (no name)', () => {
        const dispatches = simulateWorkflowRunHash('#repos/r1/workflows');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_WORKFLOW', name: null });
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
    });

    it('dispatches SET_WORKFLOW_RUN_PROCESS null for non-workflow sub-tab', () => {
        const dispatches = simulateWorkflowRunHash('#repos/r1/tasks');
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: null });
    });

    it('URL-decodes processId in dispatch', () => {
        const dispatches = simulateWorkflowRunHash('#repos/r1/workflows/pipe1/run/queue_abc%2F1');
        expect(dispatches).toContainEqual({ type: 'SET_WORKFLOW_RUN_PROCESS', processId: 'queue_abc/1' });
    });
});

// ─── Router source-level smoke: A shortcut for Activity ──────────

describe('Router source-level: A keyboard shortcut for Activity', () => {
    const ROUTER_SOURCE = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout', 'Router.tsx'),
        'utf-8',
    );

    it('has an A-key handler that dispatches activity sub-tab', () => {
        expect(ROUTER_SOURCE).toContain("e.key === 'a' || e.key === 'A'");
        expect(ROUTER_SOURCE).toContain("tab: 'activity'");
    });

    it('A shortcut updates hash to activity route', () => {
        expect(ROUTER_SOURCE).toContain("+ '/activity'");
    });

    it('no longer has a C-key handler for chat', () => {
        expect(ROUTER_SOURCE).not.toContain("e.key === 'c' || e.key === 'C'");
        expect(ROUTER_SOURCE).not.toContain("tab: 'chat'");
    });

    it('activity route is in VALID_REPO_SUB_TABS', () => {
        expect(VALID_REPO_SUB_TABS.has('activity')).toBe(true);
    });
});

// ─── pull-requests deep-link dispatch simulation ──────────────────

describe('handleHash pull-requests dispatch simulation', () => {
    function simulatePrHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
        const dispatches: Array<{ type: string; [key: string]: any }> = [];
        const hash = rawHash.replace(/^#/, '');
        const tab = tabFromHash('#' + hash);
        if (tab === 'repos') {
            const parts = hash.split('/');
            if (parts.length >= 2 && parts[0] === 'repos' && parts[1]) {
                dispatches.push({ type: 'SET_SELECTED_REPO', id: decodeURIComponent(parts[1]) });
                if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
                    dispatches.push({ type: 'SET_REPO_SUB_TAB', tab: parts[2] });
                }
                // Pull-requests deep-link handling (mirrors Router.tsx)
                if (parts[2] === 'pull-requests' && parts[3]) {
                    dispatches.push({ type: 'SET_SELECTED_PR', prId: decodeURIComponent(parts[3]) });
                } else if (parts[2] === 'pull-requests') {
                    dispatches.push({ type: 'CLEAR_SELECTED_PR' });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SET_REPO_SUB_TAB pull-requests for #repos/r1/pull-requests', () => {
        const dispatches = simulatePrHash('#repos/r1/pull-requests');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'pull-requests' });
    });

    it('dispatches CLEAR_SELECTED_PR for #repos/r1/pull-requests (list route)', () => {
        const dispatches = simulatePrHash('#repos/r1/pull-requests');
        expect(dispatches).toContainEqual({ type: 'CLEAR_SELECTED_PR' });
    });

    it('dispatches SET_SELECTED_PR for #repos/r1/pull-requests/42', () => {
        const dispatches = simulatePrHash('#repos/r1/pull-requests/42');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'pull-requests' });
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_PR', prId: '42' });
    });

    it('does not dispatch CLEAR_SELECTED_PR for #repos/r1/pull-requests/42', () => {
        const dispatches = simulatePrHash('#repos/r1/pull-requests/42');
        expect(dispatches.find(d => d.type === 'CLEAR_SELECTED_PR')).toBeUndefined();
    });

    it('URL-decodes the prId', () => {
        const dispatches = simulatePrHash('#repos/r1/pull-requests/abc%2F123');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_PR', prId: 'abc/123' });
    });

    it('dispatches SET_SELECTED_REPO alongside PR actions', () => {
        const dispatches = simulatePrHash('#repos/my-repo/pull-requests/7');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'my-repo' });
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_PR', prId: '7' });
    });

    it('tabFromHash returns "repos" for #repos/r1/pull-requests', () => {
        expect(tabFromHash('#repos/r1/pull-requests')).toBe('repos');
    });

    it('tabFromHash returns "repos" for #repos/r1/pull-requests/42', () => {
        expect(tabFromHash('#repos/r1/pull-requests/42')).toBe('repos');
    });

    it('pull-requests is in VALID_REPO_SUB_TABS', () => {
        expect(VALID_REPO_SUB_TABS.has('pull-requests')).toBe(true);
    });
});
