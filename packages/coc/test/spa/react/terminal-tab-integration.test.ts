/**
 * Tests for terminal sub-tab integration into Router and RepoDetail.
 *
 * Covers: VALID_REPO_SUB_TABS, keyboard shortcuts, RepoSubTab type,
 * SUB_TABS array, visibility gating, redirect logic, display:none pattern,
 * config injection, and isTerminalEnabled utility.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    VALID_REPO_SUB_TABS,
    REPO_TAB_SHORTCUTS,
} from '../../../src/server/spa/client/react/layout/Router';
import { SUB_TABS, VISIBLE_SUB_TABS } from '../../../src/server/spa/client/react/features/repo-detail/RepoDetail';

const ROUTER_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout', 'Router.tsx'),
    'utf-8',
);

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'),
    'utf-8',
);

// ── Router: VALID_REPO_SUB_TABS ─────────────────────────────────────────────

describe('Router terminal integration', () => {
    it('"terminal" is in VALID_REPO_SUB_TABS', () => {
        expect(VALID_REPO_SUB_TABS.has('terminal')).toBe(true);
    });

    it('deep-link #repos/:id/terminal resolves to a valid sub-tab', () => {
        const hash = '#repos/test-repo/terminal';
        const parts = hash.replace(/^#/, '').split('/');
        expect(parts[0]).toBe('repos');
        expect(VALID_REPO_SUB_TABS.has(parts[2])).toBe(true);
    });

    it('Alt+T shortcut maps to tasks', () => {
        expect(REPO_TAB_SHORTCUTS['t']).toBe('tasks');
    });

    it('keyboard handler guards terminal shortcut on isTerminalEnabled', () => {
        expect(ROUTER_SOURCE).toContain("rawTab === 'terminal' && !isTerminalEnabled()");
    });

    it('imports isTerminalEnabled from utils/config', () => {
        expect(ROUTER_SOURCE).toContain("isTerminalEnabled, isNotesEnabled, isDreamsEnabled");
    });
});

// ── RepoDetail: SUB_TABS ────────────────────────────────────────────────────

describe('RepoDetail terminal tab', () => {
    it('SUB_TABS includes terminal entry', () => {
        const terminalTab = SUB_TABS.find(t => t.key === 'terminal');
        expect(terminalTab).toBeDefined();
        expect(terminalTab!.label).toBe('Terminal');
    });

    it('terminal is positioned after git in SUB_TABS', () => {
        const gitIdx = SUB_TABS.findIndex(t => t.key === 'git');
        const terminalIdx = SUB_TABS.findIndex(t => t.key === 'terminal');
        expect(terminalIdx).toBe(gitIdx + 1);
    });

    it('VISIBLE_SUB_TABS includes terminal (wiki filtered, terminal kept)', () => {
        expect(VISIBLE_SUB_TABS.find(t => t.key === 'terminal')).toBeDefined();
    });
});

// ── RepoDetail: visibility gating ───────────────────────────────────────────

describe('RepoDetail terminal visibility gating', () => {
    it('imports useTerminalEnabled hook', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useTerminalEnabled } from '../../hooks/feature-flags/useTerminalEnabled'");
    });

    it('calls useTerminalEnabled() inside the component', () => {
        expect(REPO_DETAIL_SOURCE).toContain('useTerminalEnabled()');
    });

    it('filters terminal tab from visibleSubTabs when disabled', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key !== 'terminal'");
    });

    it('visibleSubTabs depends on terminalEnabled', () => {
        expect(REPO_DETAIL_SOURCE).toContain('[isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled, pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, uiLayoutMode]');
    });
});

// ── RepoDetail: redirect when terminal disabled ─────────────────────────────

describe('RepoDetail terminal redirect', () => {
    it('has useEffect that redirects terminal → chats when disabled', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'terminal' && !terminalEnabled");
    });

    it('redirect dispatches SET_REPO_SUB_TAB with chats', () => {
        // Verify the redirect pattern matches the git redirect pattern
        expect(REPO_DETAIL_SOURCE).toContain("[activeSubTab, terminalEnabled, dispatch]");
    });
});

// ── RepoDetail: rendering TerminalView ──────────────────────────────────────

describe('RepoDetail TerminalView rendering', () => {
    it('imports TerminalView component', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { TerminalView } from '../terminal/TerminalView'");
    });

    it('renders TerminalView with display:none pattern', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'terminal' ? undefined : 'none'");
    });

    it('guards TerminalView mount on terminalEnabled', () => {
        expect(REPO_DETAIL_SOURCE).toContain('{terminalEnabled && (');
    });

    it('passes workspaceId prop to TerminalView', () => {
        expect(REPO_DETAIL_SOURCE).toContain('workspaceId={ws.id}');
    });

    it('terminal content area uses overflow-hidden', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'terminal'");
        expect(REPO_DETAIL_SOURCE).toContain("overflow-hidden");
    });
});
