/**
 * Tests for Router pure-function helpers — tabFromHash, parseWikiDeepLink,
 * parseProcessDeepLink and friends.
 *
 * The Router component itself drives complex AppContext + QueueContext mutations;
 * those reducer tests live in context/AppContext.test.tsx and context/QueueContext.test.tsx.
 */

import { describe, it, expect } from 'vitest';
import {
    tabFromHash,
    parseWikiDeepLink,
    parseProcessDeepLink,
    parseWorkflowsDeepLink,
    parseGitCommitDeepLink,
    parseSettingsSection,
    VALID_REPO_SUB_TABS,
    VALID_SETTINGS_SECTIONS,
    VALID_WIKI_PROJECT_TABS,
    VALID_WIKI_ADMIN_TABS,
    parseAdminSubTab,
    VALID_ADMIN_SUB_TABS,
    parseAdminDatabaseDeepLink,
    buildDbBrowserHash,
} from '../../src/server/spa/client/react/layout/Router';
import {
    SETTINGS_SECTION_VALUES,
    REPO_SUB_TAB_VALUES,
    WIKI_PROJECT_TAB_VALUES,
    WIKI_ADMIN_TAB_VALUES,
} from '../../src/server/spa/client/react/types/dashboard';

// ── tabFromHash ───────────────────────────────────────────────────────────────

describe('tabFromHash', () => {
    it('returns null for #processes (no longer routed)', () => {
        expect(tabFromHash('#processes')).toBeNull();
    });

    it('returns null for #processes/abc123 (no longer routed)', () => {
        expect(tabFromHash('#processes/abc123')).toBeNull();
    });

    it('returns null for legacy #process (no longer routed)', () => {
        expect(tabFromHash('#process')).toBeNull();
    });

    it('returns null for legacy #session (no longer routed)', () => {
        expect(tabFromHash('#session')).toBeNull();
    });

    it('returns "repos" for #repos', () => {
        expect(tabFromHash('#repos')).toBe('repos');
    });

    it('returns "repos" for #repos/myid/git', () => {
        expect(tabFromHash('#repos/myid/git')).toBe('repos');
    });

    it('returns "repos" for legacy #tasks', () => {
        expect(tabFromHash('#tasks')).toBe('repos');
    });

    it('returns "wiki" for #wiki/myid/components', () => {
        expect(tabFromHash('#wiki/myid/components')).toBe('wiki');
    });

    it('returns "memory" for #memory/entries', () => {
        expect(tabFromHash('#memory/entries')).toBe('memory');
    });

    it('returns null for unknown route #foobar', () => {
        expect(tabFromHash('#foobar')).toBe(null);
    });

    it('returns null for empty hash', () => {
        expect(tabFromHash('#')).toBe(null);
    });

    it('returns "admin" for #admin', () => {
        expect(tabFromHash('#admin')).toBe('admin');
    });

    it('returns null for #models (standalone models route removed)', () => {
        expect(tabFromHash('#models')).toBe(null);
    });
});

// ── parseWikiDeepLink ─────────────────────────────────────────────────────────

describe('parseWikiDeepLink', () => {
    it('returns correct wikiId for #wiki/myid', () => {
        const r = parseWikiDeepLink('#wiki/myid');
        expect(r.wikiId).toBe('myid');
        expect(r.tab).toBe(null);
    });

    it('returns wikiId and tab for #wiki/myid/browse', () => {
        const r = parseWikiDeepLink('#wiki/myid/browse');
        expect(r.wikiId).toBe('myid');
        expect(r.tab).toBe('browse');
    });

    it('returns componentId for #wiki/myid/component/comp-1', () => {
        const r = parseWikiDeepLink('#wiki/myid/component/comp-1');
        expect(r.wikiId).toBe('myid');
        expect(r.componentId).toBe('comp-1');
        expect(r.tab).toBe('browse');
    });

    it('returns admin tab for #wiki/myid/admin/generate', () => {
        const r = parseWikiDeepLink('#wiki/myid/admin/generate');
        expect(r.wikiId).toBe('myid');
        expect(r.tab).toBe('admin');
        expect(r.adminTab).toBe('generate');
    });

    it('returns null wikiId for non-wiki hash', () => {
        const r = parseWikiDeepLink('#repos/some-id');
        expect(r.wikiId).toBe(null);
    });
});

// ── parseProcessDeepLink ──────────────────────────────────────────────────────

describe('parseProcessDeepLink', () => {
    it('returns process id for #processes/abc123', () => {
        expect(parseProcessDeepLink('#processes/abc123')).toBe('abc123');
    });

    it('returns process id for #process/abc123 (legacy)', () => {
        expect(parseProcessDeepLink('#process/abc123')).toBe('abc123');
    });

    it('returns process id for #session/abc123 (legacy)', () => {
        expect(parseProcessDeepLink('#session/abc123')).toBe('abc123');
    });

    it('returns null for plain #processes (no id)', () => {
        expect(parseProcessDeepLink('#processes')).toBe(null);
    });

    it('URL-decodes special characters in the process id', () => {
        expect(parseProcessDeepLink('#processes/hello%20world')).toBe('hello world');
    });
});

// ── parseWorkflowsDeepLink ────────────────────────────────────────────────────

describe('parseWorkflowsDeepLink', () => {
    it('returns workflow name for #repos/r1/workflows/my-workflow', () => {
        expect(parseWorkflowsDeepLink('#repos/r1/workflows/my-workflow')).toBe('my-workflow');
    });

    it('returns null when not a workflow deep link', () => {
        expect(parseWorkflowsDeepLink('#repos/r1/info')).toBe(null);
    });
});

// ── parseGitCommitDeepLink ────────────────────────────────────────────────────

describe('parseGitCommitDeepLink', () => {
    it('returns commit hash for #repos/r1/git/abc123', () => {
        expect(parseGitCommitDeepLink('#repos/r1/git/abc123')).toBe('abc123');
    });

    it('returns null for non-git deep link', () => {
        expect(parseGitCommitDeepLink('#repos/r1/info')).toBe(null);
    });
});

// ── parseSettingsSection ──────────────────────────────────────────────────────

describe('parseSettingsSection', () => {
    it('returns "mcp" for #repos/r1/settings/mcp', () => {
        expect(parseSettingsSection('#repos/r1/settings/mcp')).toBe('mcp');
    });

    it('returns "skills" for #repos/r1/settings/skills', () => {
        expect(parseSettingsSection('#repos/r1/settings/skills')).toBe('skills');
    });

    it('returns default "info" for unknown section', () => {
        expect(parseSettingsSection('#repos/r1/settings/unknown')).toBe('info');
    });

    it('returns default "info" for removed repo display settings section', () => {
        expect(parseSettingsSection('#repos/r1/settings/display')).toBe('info');
    });

    // Regression: #repos/:id/settings/memory must resolve to "memory" so that
    // refreshing the memory settings page does not show a blank panel.
    it('returns "memory" for #repos/r1/settings/memory', () => {
        expect(parseSettingsSection('#repos/r1/settings/memory')).toBe('memory');
    });

    // Regression: 'notes' was missing from VALID_SETTINGS_SECTIONS — the notes
    // settings page would always fall back to the default "info" panel.
    it('returns "notes" for #repos/r1/settings/notes', () => {
        expect(parseSettingsSection('#repos/r1/settings/notes')).toBe('notes');
    });
});

// ── VALID_REPO_SUB_TABS ───────────────────────────────────────────────────────

describe('VALID_REPO_SUB_TABS', () => {
    it('includes expected tabs', () => {
        expect(VALID_REPO_SUB_TABS.has('settings')).toBe(true);
        expect(VALID_REPO_SUB_TABS.has('git')).toBe(true);
        expect(VALID_REPO_SUB_TABS.has('tasks')).toBe(true);
        expect(VALID_REPO_SUB_TABS.has('templates')).toBe(true);
        expect(VALID_REPO_SUB_TABS.has('dreams')).toBe(true);
    });

    it('does not include removed tabs', () => {
        expect(VALID_REPO_SUB_TABS.has('info')).toBe(false);
        expect(VALID_REPO_SUB_TABS.has('copilot')).toBe(false);
    });

    it('is derived from REPO_SUB_TAB_VALUES — exact same members', () => {
        expect(VALID_REPO_SUB_TABS.size).toBe(REPO_SUB_TAB_VALUES.length);
        for (const v of REPO_SUB_TAB_VALUES) {
            expect(VALID_REPO_SUB_TABS.has(v)).toBe(true);
        }
    });
});

// ── VALID_SETTINGS_SECTIONS ───────────────────────────────────────────────────

describe('VALID_SETTINGS_SECTIONS', () => {
    // Regression: 'notes' was missing from the hand-rolled set while present in SettingsSection.
    it('includes "notes"', () => {
        expect(VALID_SETTINGS_SECTIONS.has('notes')).toBe(true);
    });

    it('does not include "display"', () => {
        expect(VALID_SETTINGS_SECTIONS.has('display')).toBe(false);
    });

    it('is derived from SETTINGS_SECTION_VALUES — exact same members', () => {
        expect(VALID_SETTINGS_SECTIONS.size).toBe(SETTINGS_SECTION_VALUES.length);
        for (const v of SETTINGS_SECTION_VALUES) {
            expect(VALID_SETTINGS_SECTIONS.has(v)).toBe(true);
        }
    });
});

// ── VALID_WIKI_PROJECT_TABS ───────────────────────────────────────────────────

describe('VALID_WIKI_PROJECT_TABS', () => {
    it('is derived from WIKI_PROJECT_TAB_VALUES — exact same members', () => {
        expect(VALID_WIKI_PROJECT_TABS.size).toBe(WIKI_PROJECT_TAB_VALUES.length);
        for (const v of WIKI_PROJECT_TAB_VALUES) {
            expect(VALID_WIKI_PROJECT_TABS.has(v)).toBe(true);
        }
    });
});

// ── VALID_WIKI_ADMIN_TABS ─────────────────────────────────────────────────────

describe('VALID_WIKI_ADMIN_TABS', () => {
    it('is derived from WIKI_ADMIN_TAB_VALUES — exact same members', () => {
        expect(VALID_WIKI_ADMIN_TABS.size).toBe(WIKI_ADMIN_TAB_VALUES.length);
        for (const v of WIKI_ADMIN_TAB_VALUES) {
            expect(VALID_WIKI_ADMIN_TABS.has(v)).toBe(true);
        }
    });
});

// ── VALID_ADMIN_SUB_TABS includes database ────────────────────────────────────

describe('VALID_ADMIN_SUB_TABS', () => {
    it('includes database', () => {
        expect(VALID_ADMIN_SUB_TABS.has('database')).toBe(true);
    });
});

// ── parseAdminSubTab ──────────────────────────────────────────────────────────

describe('parseAdminSubTab', () => {
    it('returns "database" for #admin/database', () => {
        expect(parseAdminSubTab('#admin/database')).toBe('database');
    });
});

// ── parseAdminDatabaseDeepLink ────────────────────────────────────────────────

describe('parseAdminDatabaseDeepLink', () => {
    it('parses table from #admin/database/processes', () => {
        const r = parseAdminDatabaseDeepLink('#admin/database/processes');
        expect(r.table).toBe('processes');
        expect(r.page).toBe(1);
    });

    it('parses full deep-link with all params', () => {
        const r = parseAdminDatabaseDeepLink('#admin/database/processes?page=2&sort=created_at&order=desc');
        expect(r).toEqual({ table: 'processes', page: 2, sort: 'created_at', order: 'desc' });
    });

    it('returns defaults for non-database hash', () => {
        const r = parseAdminDatabaseDeepLink('#admin/settings');
        expect(r).toEqual({ table: null, page: 1, sort: null, order: null });
    });
});

// ── buildDbBrowserHash ────────────────────────────────────────────────────────

describe('buildDbBrowserHash', () => {
    it('builds hash with table only', () => {
        expect(buildDbBrowserHash('processes', 1, null, null)).toBe('admin/database/processes');
    });

    it('roundtrips with parseAdminDatabaseDeepLink', () => {
        const hash = buildDbBrowserHash('processes', 3, 'id', 'asc');
        const parsed = parseAdminDatabaseDeepLink('#' + hash);
        expect(parsed).toEqual({ table: 'processes', page: 3, sort: 'id', order: 'asc' });
    });
});
