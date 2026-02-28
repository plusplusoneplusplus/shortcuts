/**
 * Tests for Router hash-parsing utilities — tabFromHash, VALID_REPO_SUB_TABS.
 *
 * Covers deep-link and refresh routing for all repo sub-tabs including 'queue'.
 */

import { describe, it, expect } from 'vitest';
import { tabFromHash, VALID_REPO_SUB_TABS, VALID_WIKI_PROJECT_TABS, VALID_WIKI_ADMIN_TABS, parseProcessDeepLink, parseWikiDeepLink, parsePipelineDeepLink, parseQueueDeepLink } from '../../../src/server/spa/client/react/layout/Router';

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

    it('returns "repos" for #repos/some-id/pipelines', () => {
        expect(tabFromHash('#repos/my-repo/pipelines')).toBe('repos');
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

    it('returns "wiki" for #wiki', () => {
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
    it('includes "queue"', () => {
        expect(VALID_REPO_SUB_TABS.has('queue')).toBe(true);
    });

    it('includes "info"', () => {
        expect(VALID_REPO_SUB_TABS.has('info')).toBe(true);
    });

    it('includes "tasks"', () => {
        expect(VALID_REPO_SUB_TABS.has('tasks')).toBe(true);
    });

    it('includes "pipelines"', () => {
        expect(VALID_REPO_SUB_TABS.has('pipelines')).toBe(true);
    });

    it('includes "schedules"', () => {
        expect(VALID_REPO_SUB_TABS.has('schedules')).toBe(true);
    });

    it('includes "chat"', () => {
        expect(VALID_REPO_SUB_TABS.has('chat')).toBe(true);
    });

    it('does not include unknown tab', () => {
        expect(VALID_REPO_SUB_TABS.has('settings')).toBe(false);
    });

    it('has exactly 6 entries', () => {
        expect(VALID_REPO_SUB_TABS.size).toBe(6);
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

    it('parses #repos/my-repo/queue correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/queue');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('queue');
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

    it('parses #repos/my-repo/pipelines correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/pipelines');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('pipelines');
    });

    it('parses #repos/my-repo/schedules correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/schedules');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('schedules');
    });

    it('parses #repos/my-repo/chat correctly', () => {
        const result = parseRepoDeepLink('#repos/my-repo/chat');
        expect(result.repoId).toBe('my-repo');
        expect(result.subTab).toBe('chat');
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
        const result = parseRepoDeepLink('#repos/my%20repo/queue');
        expect(result.repoId).toBe('my repo');
        expect(result.subTab).toBe('queue');
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

describe('wiki tab deep-link integration', () => {
    it('tabFromHash returns "wiki" for all wiki tab routes', () => {
        expect(tabFromHash('#wiki/my-wiki/browse')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/ask')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/graph')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin')).toBe('wiki');
    });

    it('tabFromHash returns "wiki" for wiki component route', () => {
        expect(tabFromHash('#wiki/my-wiki/component/comp-1')).toBe('wiki');
    });

    it('tabFromHash returns "wiki" for admin sub-tab routes', () => {
        expect(tabFromHash('#wiki/my-wiki/admin/seeds')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin/config')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin/delete')).toBe('wiki');
        expect(tabFromHash('#wiki/my-wiki/admin/generate')).toBe('wiki');
    });

    it('tab and component can be parsed after tabFromHash', () => {
        const hash = '#wiki/w1/ask';
        const tab = tabFromHash(hash);
        expect(tab).toBe('wiki');
        const detail = parseWikiDeepLink(hash);
        expect(detail.wikiId).toBe('w1');
        expect(detail.tab).toBe('ask');
    });

    it('admin sub-tab can be parsed after tabFromHash', () => {
        const hash = '#wiki/w1/admin/seeds';
        const tab = tabFromHash(hash);
        expect(tab).toBe('wiki');
        const detail = parseWikiDeepLink(hash);
        expect(detail.wikiId).toBe('w1');
        expect(detail.tab).toBe('admin');
        expect(detail.adminTab).toBe('seeds');
    });
});

// ─── parsePipelineDeepLink ──────────────────────────────────────

describe('parsePipelineDeepLink', () => {
    it('parses #repos/my-repo/pipelines/my-pipe', () => {
        expect(parsePipelineDeepLink('#repos/my-repo/pipelines/my-pipe')).toBe('my-pipe');
    });

    it('URL-decodes the pipeline name', () => {
        expect(parsePipelineDeepLink('#repos/my-repo/pipelines/my%20pipe')).toBe('my pipe');
    });

    it('returns null when pipeline name is missing', () => {
        expect(parsePipelineDeepLink('#repos/my-repo/pipelines')).toBeNull();
    });

    it('returns null for non-pipelines sub-tab', () => {
        expect(parsePipelineDeepLink('#repos/my-repo/info')).toBeNull();
    });

    it('returns null for non-repo hash', () => {
        expect(parsePipelineDeepLink('#wiki/something')).toBeNull();
    });

    it('returns null for empty hash', () => {
        expect(parsePipelineDeepLink('#')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parsePipelineDeepLink('')).toBeNull();
    });

    it('handles URL-encoded repo ID', () => {
        expect(parsePipelineDeepLink('#repos/my%20repo/pipelines/pipe1')).toBe('pipe1');
    });

    it('returns null from bare #repos', () => {
        expect(parsePipelineDeepLink('#repos')).toBeNull();
    });

    it('returns null from #repos/ws-abc with no sub-tab', () => {
        expect(parsePipelineDeepLink('#repos/ws-abc')).toBeNull();
    });

    it('returns null from #processes/some-id', () => {
        expect(parsePipelineDeepLink('#processes/some-id')).toBeNull();
    });
});

// ─── handleHash wiki dispatch simulation ────────────────────────
// Mirrors the wiki-branch logic from Router's handleHash effect to verify
// that component deep-links dispatch atomically (no intermediate clearing).

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

    it('dispatches single SELECT_WIKI_WITH_TAB with componentId for component deep-link', () => {
        const dispatches = simulateWikiHashDispatch('#wiki/w1/component/comp-1');
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toEqual({
            type: 'SELECT_WIKI_WITH_TAB',
            wikiId: 'w1',
            tab: 'browse',
            adminTab: null,
            componentId: 'comp-1',
        });
    });

    it('does not dispatch separate SELECT_WIKI_COMPONENT for component deep-link', () => {
        const dispatches = simulateWikiHashDispatch('#wiki/w1/component/comp-1');
        expect(dispatches.find(d => d.type === 'SELECT_WIKI_COMPONENT')).toBeUndefined();
    });

    it('dispatches SELECT_WIKI_WITH_TAB with null componentId for tab-only link', () => {
        const dispatches = simulateWikiHashDispatch('#wiki/w1/ask');
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toEqual({
            type: 'SELECT_WIKI_WITH_TAB',
            wikiId: 'w1',
            tab: 'ask',
            adminTab: null,
            componentId: null,
        });
    });

    it('dispatches SELECT_WIKI for wiki without tab', () => {
        const dispatches = simulateWikiHashDispatch('#wiki/w1');
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toEqual({ type: 'SELECT_WIKI', wikiId: 'w1' });
    });

    it('dispatches SELECT_WIKI_WITH_TAB with adminTab for admin deep-link', () => {
        const dispatches = simulateWikiHashDispatch('#wiki/w1/admin/seeds');
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toEqual({
            type: 'SELECT_WIKI_WITH_TAB',
            wikiId: 'w1',
            tab: 'admin',
            adminTab: 'seeds',
            componentId: null,
        });
    });

    it('handles URL-encoded component IDs', () => {
        const dispatches = simulateWikiHashDispatch('#wiki/w1/component/comp%2Fone');
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0].componentId).toBe('comp/one');
    });

    it('dispatches nothing for plain #wiki (no wikiId)', () => {
        const dispatches = simulateWikiHashDispatch('#wiki');
        expect(dispatches).toHaveLength(0);
    });

    it('dispatches nothing for non-wiki hash', () => {
        const dispatches = simulateWikiHashDispatch('#repos/my-repo');
        expect(dispatches).toHaveLength(0);
    });
});

// ─── pipeline deep-link integration ────────────────────────────

describe('pipeline deep-link integration', () => {
    it('tabFromHash returns "repos" for #repos/ws-abc/pipelines/my-pipeline', () => {
        expect(tabFromHash('#repos/ws-abc/pipelines/my-pipeline')).toBe('repos');
    });

    it('parsePipelineDeepLink and tabFromHash compose correctly for a pipeline deep link', () => {
        const hash = '#repos/ws-abc/pipelines/my-pipeline';
        expect(tabFromHash(hash)).toBe('repos');
        expect(parsePipelineDeepLink(hash)).toBe('my-pipeline');
    });
});

// ─── handleHash pipeline integration (dispatch simulation) ──────

describe('handleHash pipeline dispatch simulation', () => {
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
                if (parts[2] === 'pipelines' && parts[3]) {
                    dispatches.push({ type: 'SET_SELECTED_PIPELINE', name: decodeURIComponent(parts[3]) });
                } else if (parts[2] === 'pipelines') {
                    dispatches.push({ type: 'SET_SELECTED_PIPELINE', name: null });
                } else if (parts[2] && parts[2] !== 'pipelines') {
                    dispatches.push({ type: 'SET_SELECTED_PIPELINE', name: null });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SET_SELECTED_PIPELINE with name for #repos/r1/pipelines/pipe1', () => {
        const dispatches = simulateHandleHash('#repos/r1/pipelines/pipe1');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'pipelines' });
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_PIPELINE', name: 'pipe1' });
    });

    it('dispatches SET_SELECTED_PIPELINE with null for #repos/r1/pipelines (no name)', () => {
        const dispatches = simulateHandleHash('#repos/r1/pipelines');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'pipelines' });
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_PIPELINE', name: null });
    });

    it('dispatches SET_SELECTED_PIPELINE with null for #repos/r1/tasks (different sub-tab)', () => {
        const dispatches = simulateHandleHash('#repos/r1/tasks');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'tasks' });
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_PIPELINE', name: null });
    });

    it('does not dispatch SET_SELECTED_PIPELINE when no sub-tab', () => {
        const dispatches = simulateHandleHash('#repos/r1');
        expect(dispatches.find(d => d.type === 'SET_SELECTED_PIPELINE')).toBeUndefined();
    });
});

// ─── parseQueueDeepLink ─────────────────────────────────────────

describe('parseQueueDeepLink', () => {
    it('parses #repos/my-repo/queue/task-1', () => {
        expect(parseQueueDeepLink('#repos/my-repo/queue/task-1')).toBe('task-1');
    });

    it('URL-decodes the task ID', () => {
        expect(parseQueueDeepLink('#repos/my-repo/queue/task%2F1')).toBe('task/1');
    });

    it('returns null when task ID is missing', () => {
        expect(parseQueueDeepLink('#repos/my-repo/queue')).toBeNull();
    });

    it('returns null for non-queue sub-tab', () => {
        expect(parseQueueDeepLink('#repos/my-repo/pipelines')).toBeNull();
    });

    it('returns null for non-repo hash', () => {
        expect(parseQueueDeepLink('#wiki/something')).toBeNull();
    });

    it('returns null for empty hash', () => {
        expect(parseQueueDeepLink('#')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseQueueDeepLink('')).toBeNull();
    });

    it('handles URL-encoded repo ID', () => {
        expect(parseQueueDeepLink('#repos/my%20repo/queue/task-1')).toBe('task-1');
    });

    it('returns null from bare #repos', () => {
        expect(parseQueueDeepLink('#repos')).toBeNull();
    });

    it('returns null from #repos/ws-abc with no sub-tab', () => {
        expect(parseQueueDeepLink('#repos/ws-abc')).toBeNull();
    });

    it('returns null from #processes/some-id', () => {
        expect(parseQueueDeepLink('#processes/some-id')).toBeNull();
    });

    it('handles task IDs with special characters', () => {
        expect(parseQueueDeepLink('#repos/r1/queue/task%20with%20spaces')).toBe('task with spaces');
    });
});

// ─── queue deep-link integration ────────────────────────────────

describe('queue deep-link integration', () => {
    it('tabFromHash returns "repos" for #repos/ws-abc/queue/task-1', () => {
        expect(tabFromHash('#repos/ws-abc/queue/task-1')).toBe('repos');
    });

    it('parseQueueDeepLink and tabFromHash compose correctly for a queue deep link', () => {
        const hash = '#repos/ws-abc/queue/task-1';
        expect(tabFromHash(hash)).toBe('repos');
        expect(parseQueueDeepLink(hash)).toBe('task-1');
    });
});

// ─── handleHash queue dispatch simulation ───────────────────────

describe('handleHash queue dispatch simulation', () => {
    function simulateQueueHash(rawHash: string): Array<{ type: string; [key: string]: any }> {
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
                // Queue deep-link handling (mirrors Router.tsx)
                if (parts[2] === 'queue' && parts[3]) {
                    dispatches.push({ type: 'SELECT_QUEUE_TASK', id: decodeURIComponent(parts[3]) });
                } else if (parts[2] === 'queue') {
                    dispatches.push({ type: 'SELECT_QUEUE_TASK', id: null });
                }
            }
        }
        return dispatches;
    }

    it('dispatches SELECT_QUEUE_TASK with task ID for #repos/r1/queue/task-1', () => {
        const dispatches = simulateQueueHash('#repos/r1/queue/task-1');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'queue' });
        expect(dispatches).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'task-1' });
    });

    it('dispatches SELECT_QUEUE_TASK with null for #repos/r1/queue (no task)', () => {
        const dispatches = simulateQueueHash('#repos/r1/queue');
        expect(dispatches).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'queue' });
        expect(dispatches).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: null });
    });

    it('does not dispatch SELECT_QUEUE_TASK for #repos/r1/pipelines', () => {
        const dispatches = simulateQueueHash('#repos/r1/pipelines');
        expect(dispatches.find(d => d.type === 'SELECT_QUEUE_TASK')).toBeUndefined();
    });

    it('does not dispatch SELECT_QUEUE_TASK for #repos/r1 (no sub-tab)', () => {
        const dispatches = simulateQueueHash('#repos/r1');
        expect(dispatches.find(d => d.type === 'SELECT_QUEUE_TASK')).toBeUndefined();
    });

    it('URL-decodes the task ID in dispatch', () => {
        const dispatches = simulateQueueHash('#repos/r1/queue/task%2Fone');
        expect(dispatches).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'task/one' });
    });

    it('dispatches SET_SELECTED_REPO alongside queue task selection', () => {
        const dispatches = simulateQueueHash('#repos/r1/queue/task-1');
        expect(dispatches).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'r1' });
        expect(dispatches).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'task-1' });
    });
});
