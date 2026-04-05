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
} from '../../src/server/spa/client/react/layout/Router';

// ── tabFromHash ───────────────────────────────────────────────────────────────

describe('tabFromHash', () => {
    it('returns "processes" for #processes', () => {
        expect(tabFromHash('#processes')).toBe('processes');
    });

    it('returns "processes" for #processes/abc123', () => {
        expect(tabFromHash('#processes/abc123')).toBe('processes');
    });

    it('returns "processes" for legacy #process', () => {
        expect(tabFromHash('#process')).toBe('processes');
    });

    it('returns "processes" for legacy #session', () => {
        expect(tabFromHash('#session')).toBe('processes');
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

    it('returns "models" for #models', () => {
        expect(tabFromHash('#models')).toBe('models');
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

    // Regression: #repos/:id/settings/memory must resolve to "memory" so that
    // refreshing the memory settings page does not show a blank panel.
    it('returns "memory" for #repos/r1/settings/memory', () => {
        expect(parseSettingsSection('#repos/r1/settings/memory')).toBe('memory');
    });
});

// ── VALID_REPO_SUB_TABS ───────────────────────────────────────────────────────

describe('VALID_REPO_SUB_TABS', () => {
    it('includes expected tabs', () => {
        expect(VALID_REPO_SUB_TABS.has('settings')).toBe(true);
        expect(VALID_REPO_SUB_TABS.has('git')).toBe(true);
        expect(VALID_REPO_SUB_TABS.has('tasks')).toBe(true);
        expect(VALID_REPO_SUB_TABS.has('templates')).toBe(true);
    });

    it('does not include removed tabs', () => {
        expect(VALID_REPO_SUB_TABS.has('info')).toBe(false);
        expect(VALID_REPO_SUB_TABS.has('copilot')).toBe(false);
    });
});
