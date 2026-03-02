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

    it('"info" is followed by "git" entry', () => {
        const infoIdx = SUB_TABS.findIndex(t => t.key === 'info');
        const gitIdx = SUB_TABS.findIndex(t => t.key === 'git');
        expect(gitIdx).toBe(infoIdx + 1);
    });

    it('"git" is the second entry', () => {
        expect(SUB_TABS[1].key).toBe('git');
    });

    it('has exactly 7 entries', () => {
        expect(SUB_TABS).toHaveLength(7);
    });

    it('contains all expected sub-tabs in order', () => {
        const keys = SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat']);
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

    it('destructures running, queued, and chatPending from useRepoQueueStats', () => {
        expect(REPO_DETAIL_SOURCE).toContain('running: queueRunningCount');
        expect(REPO_DETAIL_SOURCE).toContain('queued: queueQueuedCount');
        expect(REPO_DETAIL_SOURCE).toContain('chatPending: chatPendingCount');
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

    it('skips fetch if repoQueueMap already has task-level data for the repo', () => {
        expect(REPO_DETAIL_SOURCE).toContain('existing.running.length > 0 || existing.queued.length > 0 || existing.history.length > 0');
    });

    it('re-fetches when repoQueueMap has only stats-seeded (empty arrays) entry', () => {
        // The guard should NOT skip fetch when only a stats-only entry exists
        expect(REPO_DETAIL_SOURCE).toContain('existing.running.length > 0 || existing.queued.length > 0 || existing.history.length > 0');
        // Verifies the entry is checked for actual task data, not mere existence
        expect(REPO_DETAIL_SOURCE).not.toContain('if (queueState.repoQueueMap[ws.id]) return');
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
    it('destructures chatPending from useRepoQueueStats', () => {
        expect(REPO_DETAIL_SOURCE).toContain('chatPending: chatPendingCount');
    });

    it('does not destructure chatTotal, chatRunning, or chatQueued individually', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('chatTotal: chatTotalCount');
        expect(REPO_DETAIL_SOURCE).not.toContain('chatRunning: chatRunningCount');
        expect(REPO_DETAIL_SOURCE).not.toContain('chatQueued: chatQueuedCount');
    });

    it('renders chat pending badge only when chatPendingCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chat' && chatPendingCount > 0");
    });

    it('chat pending badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="chat-pending-badge"');
    });

    it('chat pending badge uses blue background', () => {
        const chatPendingLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-pending-badge'));
        expect(chatPendingLine).toContain('bg-[#0078d4]');
    });

    it('chat pending badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Pending chats"');
    });

    it('chat pending badge displays chatPendingCount', () => {
        const chatPendingLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-pending-badge'));
        expect(chatPendingLine).toContain('{chatPendingCount}');
    });

    it('does not render old chat-total-badge, chat-running-badge, or chat-queued-badge', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('chat-total-badge');
        expect(REPO_DETAIL_SOURCE).not.toContain('chat-running-badge');
        expect(REPO_DETAIL_SOURCE).not.toContain('chat-queued-badge');
    });

    it('only one chat badge exists (pending)', () => {
        const chatBadgeMatches = REPO_DETAIL_SOURCE.match(/chat-.*-badge/g) || [];
        expect(chatBadgeMatches.every(m => m === 'chat-pending-badge')).toBe(true);
    });

    it('chat badge renders after queue badges', () => {
        const queueBadgeIdx = REPO_DETAIL_SOURCE.indexOf('queue-queued-badge');
        const chatBadgeIdx = REPO_DETAIL_SOURCE.indexOf('chat-pending-badge');
        expect(chatBadgeIdx).toBeGreaterThan(queueBadgeIdx);
    });
});

describe('RepoDetail Resume Queue button in header', () => {
    it('renders resume button with data-testid when queue is paused', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-header-resume-btn"');
    });

    it('only shows resume button when activeSubTab is queue and isRepoPaused', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'queue' && isRepoPaused");
    });

    it('resume button appears before Queue Task button', () => {
        const resumeIdx = REPO_DETAIL_SOURCE.indexOf('repo-header-resume-btn');
        const queueTaskIdx = REPO_DETAIL_SOURCE.indexOf('repo-queue-task-btn');
        expect(resumeIdx).toBeGreaterThan(-1);
        expect(queueTaskIdx).toBeGreaterThan(-1);
        expect(resumeIdx).toBeLessThan(queueTaskIdx);
    });

    it('uses secondary variant for resume button', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-header-resume-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('variant="secondary"');
    });

    it('resume button is disabled during loading', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-header-resume-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('disabled={isPauseResumeLoading}');
    });

    it('resume button text contains "Resume Queue"', () => {
        const lines = REPO_DETAIL_SOURCE.split('\n');
        const btnLine = lines.findIndex(l => l.includes('repo-header-resume-btn'));
        // Check a few lines after for text content
        const nearbyBlock = lines.slice(btnLine, btnLine + 5).join('\n');
        expect(nearbyBlock).toContain('Resume Queue');
    });

    it('derives isRepoPaused from queueState.repoQueueMap', () => {
        expect(REPO_DETAIL_SOURCE).toContain('queueState.repoQueueMap[ws.id]?.stats?.isPaused');
    });

    it('handleResumeQueue calls fetchApi with /queue/resume endpoint', () => {
        const fnStart = REPO_DETAIL_SOURCE.indexOf('handleResumeQueue');
        const fnBody = REPO_DETAIL_SOURCE.slice(fnStart, fnStart + 400);
        expect(fnBody).toContain("fetchApi('/queue/resume?repoId='");
        expect(fnBody).toContain("method: 'POST'");
    });

    it('handleResumeQueue resets isPauseResumeLoading in finally block', () => {
        const fnStart = REPO_DETAIL_SOURCE.indexOf('handleResumeQueue');
        const fnBody = REPO_DETAIL_SOURCE.slice(fnStart, fnStart + 400);
        expect(fnBody).toContain('finally');
        expect(fnBody).toContain('setIsPauseResumeLoading(false)');
    });

    it('isRepoPaused is memoized with useMemo', () => {
        expect(REPO_DETAIL_SOURCE).toContain('useMemo');
        const memoLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('isRepoPaused') && l.includes('useMemo'));
        expect(memoLine).toBeDefined();
    });
});

describe('RepoDetail Queue Task button in header', () => {
    it('renders + Queue Task button in header', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-queue-task-btn"');
    });

    it('is not gated behind activeSubTab queue conditional', () => {
        const lines = REPO_DETAIL_SOURCE.split('\n');
        const conditionLine = lines.findIndex(l => l.includes("activeSubTab === 'queue' && ("));
        const btnLine = lines.findIndex(l => l.includes('repo-queue-task-btn'));
        expect(conditionLine).toBe(-1);
        expect(btnLine).toBeGreaterThan(conditionLine);
    });

    it('dispatches OPEN_DIALOG with workspaceId on click', () => {
        expect(REPO_DETAIL_SOURCE).toContain("queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id })");
    });

    it('button appears before generate button in the header', () => {
        const queueBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-queue-task-btn');
        const genBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-generate-btn');
        expect(queueBtnIdx).toBeLessThan(genBtnIdx);
    });

    it('uses primary variant', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-queue-task-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('variant="primary"');
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
        expect(REPO_DETAIL_SOURCE).toContain('workspaceId={ws.id}');
    });

    it('mounts a fresh RepoGitTab on every repo switch via key={ws.id}', () => {
        // Ensure key prop is set so React fully remounts (and resets all state)
        // when the user switches between repos, preventing stale actionError/
        // refreshError from a previous repo appearing in the new one.
        expect(REPO_DETAIL_SOURCE).toContain('<RepoGitTab key={ws.id}');
    });
});

describe('RepoDetail New Chat button in header', () => {
    it('renders + New Chat button with data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-new-chat-btn"');
    });

    it('uses primary variant and sm size', () => {
        const line = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('repo-new-chat-btn'));
        expect(line).toBeDefined();
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-new-chat-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('variant="primary"');
        expect(block).toContain('size="sm"');
    });

    it('button text is "+ New Chat"', () => {
        const lines = REPO_DETAIL_SOURCE.split('\n');
        const btnIdx = lines.findIndex(l => l.includes('repo-new-chat-btn'));
        const nearbyBlock = lines.slice(btnIdx, btnIdx + 5).join('\n');
        expect(nearbyBlock).toContain('+ New Chat');
    });

    it('button appears before Queue Task button', () => {
        const newChatIdx = REPO_DETAIL_SOURCE.indexOf('repo-new-chat-btn');
        const queueBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-queue-task-btn');
        expect(newChatIdx).toBeGreaterThan(-1);
        expect(newChatIdx).toBeLessThan(queueBtnIdx);
    });

    it('has handleNewChatFromTopBar handler that calls switchSubTab to chat', () => {
        expect(REPO_DETAIL_SOURCE).toContain('handleNewChatFromTopBar');
        const fnStart = REPO_DETAIL_SOURCE.indexOf('handleNewChatFromTopBar');
        const fnBody = REPO_DETAIL_SOURCE.slice(fnStart, fnStart + 300);
        expect(fnBody).toContain("switchSubTab('chat')");
    });

    it('handleNewChatFromTopBar accepts readOnly parameter with default false', () => {
        const fnStart = REPO_DETAIL_SOURCE.indexOf('const handleNewChatFromTopBar');
        const fnBody = REPO_DETAIL_SOURCE.slice(fnStart, fnStart + 300);
        expect(fnBody).toContain('readOnly = false');
    });

    it('increments newChatTrigger count and sets readOnly on click', () => {
        expect(REPO_DETAIL_SOURCE).toContain('setNewChatTrigger');
        expect(REPO_DETAIL_SOURCE).toContain('prev.count + 1');
    });

    it('newChatTrigger state is an object with count and readOnly', () => {
        expect(REPO_DETAIL_SOURCE).toContain('{ count: 0, readOnly: false, useProjectRoot: false }');
    });

    it('passes newChatTrigger prop to RepoChatTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain('newChatTrigger={newChatTrigger}');
    });

    it('button has a title attribute', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-new-chat-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('title=');
    });

    it('renders split button container with data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-new-chat-split-btn"');
    });

    it('renders dropdown toggle button', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-new-chat-dropdown-toggle"');
    });

    it('renders dropdown menu with normal and read-only options', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-new-chat-dropdown-menu"');
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-new-chat-option-normal"');
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-new-chat-option-readonly"');
    });

    it('renders project-root option in dropdown', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-new-chat-option-project-root"');
        expect(REPO_DETAIL_SOURCE).toContain('New Chat (Project Root)');
    });

    it('project-root option calls handleNewChatFromTopBar(false, true)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('handleNewChatFromTopBar(false, true)');
    });

    it('handleNewChatFromTopBar accepts useProjectRoot parameter', () => {
        const fnStart = REPO_DETAIL_SOURCE.indexOf('const handleNewChatFromTopBar');
        const fnBody = REPO_DETAIL_SOURCE.slice(fnStart, fnStart + 300);
        expect(fnBody).toContain('useProjectRoot');
    });

    it('newChatTrigger state includes useProjectRoot', () => {
        expect(REPO_DETAIL_SOURCE).toContain('useProjectRoot: false');
        expect(REPO_DETAIL_SOURCE).toContain('useProjectRoot');
    });

    it('read-only option calls handleNewChatFromTopBar(true)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('handleNewChatFromTopBar(true)');
    });

    it('normal option calls handleNewChatFromTopBar(false)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('handleNewChatFromTopBar(false)');
    });

    it('primary button calls handleNewChatFromTopBar(false)', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-new-chat-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('handleNewChatFromTopBar(false)');
    });
});

describe('RepoDetail switchSubTab git deep-link', () => {
    it('dispatches SET_GIT_COMMIT_HASH with null when switching away from git', () => {
        expect(REPO_DETAIL_SOURCE).toContain("dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: null })");
    });

    it('only clears git commit hash when switching to non-git tab', () => {
        const switchFnStart = REPO_DETAIL_SOURCE.indexOf('const switchSubTab');
        const switchFnBody = REPO_DETAIL_SOURCE.slice(switchFnStart, switchFnStart + 400);
        expect(switchFnBody).toContain("tab !== 'git'");
    });

    it('does not clear git commit hash when switching to git tab', () => {
        const switchFnStart = REPO_DETAIL_SOURCE.indexOf('const switchSubTab');
        const switchFnBody = REPO_DETAIL_SOURCE.slice(switchFnStart, switchFnStart + 400);
        expect(switchFnBody).toContain("if (tab !== 'git')");
        // Ensure the dispatch is inside the conditional (not unconditional)
        const hashDispatchIdx = switchFnBody.indexOf("SET_GIT_COMMIT_HASH");
        const ifIdx = switchFnBody.indexOf("if (tab !== 'git')");
        expect(hashDispatchIdx).toBeGreaterThan(ifIdx);
    });
});
