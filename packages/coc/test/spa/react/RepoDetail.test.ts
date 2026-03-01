/**
 * Tests for RepoDetail SUB_TABS and component wiring.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SUB_TABS } from '../../../src/server/spa/client/react/repos/RepoDetail';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoDetail.tsx'),
    'utf-8',
);

describe('RepoDetail SUB_TABS', () => {
    it('includes a "chat" entry', () => {
        const chatTab = SUB_TABS.find(t => t.key === 'chat');
        expect(chatTab).toBeDefined();
        expect(chatTab!.label).toBe('Chat');
    });

    it('"chat" is followed by "git" entry', () => {
        const chatIdx = SUB_TABS.findIndex(t => t.key === 'chat');
        const gitIdx = SUB_TABS.findIndex(t => t.key === 'git');
        expect(gitIdx).toBe(chatIdx + 1);
    });

    it('"git" is the last entry', () => {
        const last = SUB_TABS[SUB_TABS.length - 1];
        expect(last.key).toBe('git');
    });

    it('has exactly 7 entries', () => {
        expect(SUB_TABS).toHaveLength(7);
    });

    it('contains all expected sub-tabs in order', () => {
        const keys = SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['info', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'git']);
    });
});

describe('RepoDetail RepoChatTab wiring', () => {
    it('passes ws.rootPath (not ws.path) as workspacePath to RepoChatTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain('workspacePath={ws.rootPath}');
        expect(REPO_DETAIL_SOURCE).not.toContain('workspacePath={ws.path}');
    });

    it('passes initialSessionId from AppContext to RepoChatTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain('initialSessionId={state.selectedChatSessionId}');
    });

    it('clears selectedChatSessionId after consuming it (one-shot signal)', () => {
        expect(REPO_DETAIL_SOURCE).toContain("dispatch({ type: 'SET_SELECTED_CHAT_SESSION', id: null })");
    });
});

describe('RepoDetail Generate button in header', () => {
    it('imports GenerateTaskDialog', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { GenerateTaskDialog } from '../tasks/GenerateTaskDialog'");
    });

    it('renders generate button in the header row', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-generate-btn"');
    });

    it('generate button appears before edit button', () => {
        const genIdx = REPO_DETAIL_SOURCE.indexOf('repo-generate-btn');
        const editIdx = REPO_DETAIL_SOURCE.indexOf('repo-edit-btn');
        expect(genIdx).toBeLessThan(editIdx);
    });

    it('generate button uses primary variant', () => {
        const line = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('repo-generate-btn'));
        expect(line).toContain('variant="primary"');
    });

    it('passes onOpenGenerateDialog to TasksPanel', () => {
        expect(REPO_DETAIL_SOURCE).toContain('onOpenGenerateDialog={handleOpenGenerateDialog}');
    });

    it('renders GenerateTaskDialog when generateDialog.open is true', () => {
        expect(REPO_DETAIL_SOURCE).toContain('generateDialog.open');
        expect(REPO_DETAIL_SOURCE).toContain('<GenerateTaskDialog');
    });

    it('does not switch tabs when generate button is clicked (modal is tab-independent)', () => {
        const handler = REPO_DETAIL_SOURCE.match(/const handleOpenGenerateDialog = useCallback\([^)]*\) => \{([\s\S]*?)\}, \[/);
        expect(handler).toBeTruthy();
        const body = handler![1];
        expect(body).not.toContain("switchSubTab");
    });

    it('generateDialog state includes minimized boolean', () => {
        expect(REPO_DETAIL_SOURCE).toContain('minimized: boolean');
        expect(REPO_DETAIL_SOURCE).toContain('minimized: false');
    });

    it('passes minimized, onMinimize, and onRestore props to GenerateTaskDialog', () => {
        expect(REPO_DETAIL_SOURCE).toContain('minimized={generateDialog.minimized}');
        expect(REPO_DETAIL_SOURCE).toContain('onMinimize={');
        expect(REPO_DETAIL_SOURCE).toContain('onRestore={');
    });

    it('renders minimized badge on generate button when dialog is minimized', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="generate-minimized-badge"');
        expect(REPO_DETAIL_SOURCE).toContain('generateDialog.open && generateDialog.minimized');
    });
});

describe('RepoDetail Queue badge wiring', () => {
    it('imports useRepoQueueStats from hooks', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useRepoQueueStats } from '../hooks/useRepoQueueStats'");
    });

    it('destructures running, queued, chatRunning, chatQueued, and chatTotal from useRepoQueueStats', () => {
        expect(REPO_DETAIL_SOURCE).toContain('running: queueRunningCount');
        expect(REPO_DETAIL_SOURCE).toContain('queued: queueQueuedCount');
        expect(REPO_DETAIL_SOURCE).toContain('chatRunning: chatRunningCount');
        expect(REPO_DETAIL_SOURCE).toContain('chatQueued: chatQueuedCount');
        expect(REPO_DETAIL_SOURCE).toContain('chatTotal: chatTotalCount');
    });

    it('renders running badge only when queueRunningCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'queue' && queueRunningCount > 0");
    });

    it('renders queued badge only when queueQueuedCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'queue' && queueQueuedCount > 0");
    });

    it('running badge uses green background color', () => {
        expect(REPO_DETAIL_SOURCE).toContain('bg-[#16825d]');
    });

    it('queued badge uses blue background color matching tasks badge', () => {
        const badgeClass = 'bg-[#0078d4] text-white px-1 py-px rounded-full';
        const matches = REPO_DETAIL_SOURCE.split(badgeClass);
        expect(matches.length).toBeGreaterThanOrEqual(3);
    });

    it('running badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="queue-running-badge"');
    });

    it('queued badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="queue-queued-badge"');
    });

    it('running badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Running"');
    });

    it('queued badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Queued"');
    });

    it('running badge renders before queued badge', () => {
        const runningIdx = REPO_DETAIL_SOURCE.indexOf('queueRunningCount > 0');
        const queuedIdx = REPO_DETAIL_SOURCE.indexOf('queueQueuedCount > 0');
        expect(runningIdx).toBeLessThan(queuedIdx);
    });

    it('seeds repo queue map via useEffect on ws.id change', () => {
        expect(REPO_DETAIL_SOURCE).toContain("fetchApi('/queue?repoId='");
        expect(REPO_DETAIL_SOURCE).toContain("type: 'REPO_QUEUE_UPDATED'");
    });

    it('skips fetch if repoQueueMap already has data for the repo', () => {
        expect(REPO_DETAIL_SOURCE).toContain('if (queueState.repoQueueMap[ws.id]) return');
    });

    it('does not use combined queueCount variable', () => {
        expect(REPO_DETAIL_SOURCE).not.toMatch(/\bqueueCount\b/);
    });

    it('does not compute counts from raw repoQueue arrays directly', () => {
        // Counts now come from useRepoQueueStats, not from repoQueue.running.length
        expect(REPO_DETAIL_SOURCE).not.toContain('repoQueue.running.length');
        expect(REPO_DETAIL_SOURCE).not.toContain('repoQueue.queued.length');
    });
});

describe('RepoDetail Chat badge wiring', () => {
    it('destructures chatTotal and chatQueued from useRepoQueueStats', () => {
        expect(REPO_DETAIL_SOURCE).toContain('chatTotal: chatTotalCount');
        expect(REPO_DETAIL_SOURCE).toContain('chatQueued: chatQueuedCount');
    });

    it('renders chat total badge only when chatTotalCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chat' && chatTotalCount > 0");
    });

    it('chat total badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="chat-total-badge"');
    });

    it('chat total badge uses blue background matching tasks badge', () => {
        const chatTotalLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-total-badge'));
        expect(chatTotalLine).toContain('bg-[#0078d4]');
    });

    it('chat total badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Total chat sessions"');
    });

    it('chat total badge displays chatTotalCount', () => {
        const chatTotalLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-total-badge'));
        expect(chatTotalLine).toContain('{chatTotalCount}');
    });

    it('renders chat running badge only when chatRunningCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chat' && chatRunningCount > 0");
    });

    it('chat running badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="chat-running-badge"');
    });

    it('chat running badge uses green background for active sessions', () => {
        const chatBadgeLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-running-badge'));
        expect(chatBadgeLine).toContain('bg-[#16825d]');
    });

    it('chat running badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Active chats"');
    });

    it('chat running badge displays chatRunningCount', () => {
        const chatBadgeLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-running-badge'));
        expect(chatBadgeLine).toContain('{chatRunningCount}');
    });

    it('renders chat queued badge only when chatQueuedCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chat' && chatQueuedCount > 0");
    });

    it('chat queued badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="chat-queued-badge"');
    });

    it('chat queued badge uses blue background', () => {
        const chatQueuedLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-queued-badge'));
        expect(chatQueuedLine).toContain('bg-[#0078d4]');
    });

    it('chat queued badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Queued chats"');
    });

    it('chat queued badge displays chatQueuedCount', () => {
        const chatQueuedLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-queued-badge'));
        expect(chatQueuedLine).toContain('{chatQueuedCount}');
    });

    it('badge ordering: total (blue) → running (green) → queued (blue)', () => {
        const totalIdx = REPO_DETAIL_SOURCE.indexOf('chat-total-badge');
        const runningIdx = REPO_DETAIL_SOURCE.indexOf('chat-running-badge');
        const queuedIdx = REPO_DETAIL_SOURCE.indexOf('chat-queued-badge');
        expect(totalIdx).toBeLessThan(runningIdx);
        expect(runningIdx).toBeLessThan(queuedIdx);
    });

    it('chat badges render after queue badges', () => {
        const queueBadgeIdx = REPO_DETAIL_SOURCE.indexOf('queue-queued-badge');
        const chatBadgeIdx = REPO_DETAIL_SOURCE.indexOf('chat-total-badge');
        expect(chatBadgeIdx).toBeGreaterThan(queueBadgeIdx);
    });
});

describe('RepoDetail Git tab wiring', () => {
    it('imports RepoGitTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { RepoGitTab } from './RepoGitTab'");
    });

    it('includes git entry in SUB_TABS', () => {
        const gitTab = SUB_TABS.find(t => t.key === 'git');
        expect(gitTab).toBeDefined();
        expect(gitTab!.label).toBe('Git');
    });

    it('renders RepoGitTab when activeSubTab is git', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'git'");
        expect(REPO_DETAIL_SOURCE).toContain('<RepoGitTab');
    });

    it('passes workspaceId to RepoGitTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain('RepoGitTab workspaceId={ws.id}');
    });
});
