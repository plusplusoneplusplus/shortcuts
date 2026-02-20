/**
 * Tests for Router hash-parsing utilities — tabFromHash, VALID_REPO_SUB_TABS.
 *
 * Covers deep-link and refresh routing for all repo sub-tabs including 'queue'.
 */

import { describe, it, expect } from 'vitest';
import { tabFromHash, VALID_REPO_SUB_TABS, parseProcessDeepLink } from '../../../src/server/spa/client/react/layout/Router';

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
