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
    it('includes an "activity" entry', () => {
        const activityTab = SUB_TABS.find(t => t.key === 'activity');
        expect(activityTab).toBeDefined();
        expect(activityTab!.label).toBe('Activity');
    });

    it('does not include separate "chat" or "queue" entries', () => {
        expect(SUB_TABS.find(t => t.key === 'chat')).toBeUndefined();
        expect(SUB_TABS.find(t => t.key === 'queue')).toBeUndefined();
    });

    it('"activity" is followed by "git" entry', () => {
        const activityIdx = SUB_TABS.findIndex(t => t.key === 'activity');
        const gitIdx = SUB_TABS.findIndex(t => t.key === 'git');
        expect(gitIdx).toBe(activityIdx + 1);
    });

    it('"git" is the second entry', () => {
        expect(SUB_TABS[1].key).toBe('git');
    });

    it('has exactly 9 entries', () => {
        expect(SUB_TABS).toHaveLength(9);
    });

    it('contains all expected sub-tabs in order', () => {
        const keys = SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['activity', 'git', 'tasks', 'pull-requests', 'info', 'explorer', 'workflows', 'schedules', 'copilot']);
    });

    it('does not include "wiki" entry in visible tabs', () => {
        const wikiTab = SUB_TABS.find(t => t.key === 'wiki');
        expect(wikiTab).toBeUndefined();
    });

    it('has tasks as the third tab (after git)', () => {
        expect(SUB_TABS[2].key).toBe('tasks');
    });

    it('activity is the first entry', () => {
        expect(SUB_TABS[0].key).toBe('activity');
    });

    it('tasks tab has label "Plans"', () => {
        const tasksTab = SUB_TABS.find(t => t.key === 'tasks');
        expect(tasksTab).toBeDefined();
        expect(tasksTab!.label).toBe('Plans');
    });
});

describe('RepoDetail Activity tab rendering', () => {
    it('activity sub-tab renders RepoActivityTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'activity' && <RepoActivityTab");
    });

    it('activity is in SUB_TABS (visible in tab strip)', () => {
        const activityTab = SUB_TABS.find(t => t.key === 'activity');
        expect(activityTab).toBeDefined();
    });

    it('activity sub-tab uses overflow-hidden layout like queue', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'activity'");
        const overflowLine = REPO_DETAIL_SOURCE.split('\n').find(l =>
            l.includes("activeSubTab === 'activity'") && l.includes('overflow-hidden')
        );
        expect(overflowLine).toBeDefined();
    });
});

describe('RepoDetail: Chat/Queue tabs removed', () => {
    it('does not render RepoChatTab', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('RepoChatTab');
    });

    it('does not render RepoQueueTab', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('RepoQueueTab');
    });

    it('chat and queue are not in visible SUB_TABS', () => {
        expect(SUB_TABS.find(t => t.key === 'chat')).toBeUndefined();
        expect(SUB_TABS.find(t => t.key === 'queue')).toBeUndefined();
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

describe('RepoDetail Activity badge wiring', () => {
    it('imports useRepoQueueStats from hooks', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useRepoQueueStats } from '../hooks/useRepoQueueStats'");
    });

    it('destructures running and queued from useRepoQueueStats', () => {
        expect(REPO_DETAIL_SOURCE).toContain('running: queueRunningCount');
        expect(REPO_DETAIL_SOURCE).toContain('queued: queueQueuedCount');
    });

    it('does not destructure chatPending (removed from visible nav)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('chatPending: chatPendingCount');
    });

    it('renders activity running badge only when queueRunningCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'activity' && queueRunningCount > 0");
    });

    it('renders activity queued badge only when queueQueuedCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'activity' && queueQueuedCount > 0");
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
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="activity-running-badge"');
    });

    it('queued badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="activity-queued-badge"');
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

    it('does not use combined queueCount variable', () => {
        expect(REPO_DETAIL_SOURCE).not.toMatch(/\bqueueCount\b/);
    });

    it('does not compute counts from raw repoQueue arrays directly', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('repoQueue.running.length');
        expect(REPO_DETAIL_SOURCE).not.toContain('repoQueue.queued.length');
    });

    it('does not render old queue-running-badge or queue-queued-badge', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="queue-running-badge"');
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="queue-queued-badge"');
    });

    it('does not render chat-pending-badge', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="chat-pending-badge"');
    });
});

describe('RepoDetail Resume Queue button in header', () => {
    it('renders resume button with data-testid when queue is paused', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-header-resume-btn"');
    });

    it('shows resume button when activeSubTab is activity and isRepoPaused', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'activity'");
        expect(REPO_DETAIL_SOURCE).toContain('isRepoPaused');
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

describe('RepoDetail Ask button in header', () => {
    it('renders Ask button with data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-ask-btn"');
    });

    it('dispatches OPEN_DIALOG with mode ask on click', () => {
        expect(REPO_DETAIL_SOURCE).toContain("queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id, mode: 'ask' })");
    });

    it('Ask button appears after Queue Task button', () => {
        const queueBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-queue-task-btn');
        const askBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-ask-btn');
        expect(queueBtnIdx).toBeGreaterThan(-1);
        expect(askBtnIdx).toBeGreaterThan(-1);
        expect(askBtnIdx).toBeGreaterThan(queueBtnIdx);
    });

    it('Ask button appears before Generate Plan button', () => {
        const askBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-ask-btn');
        const genBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-generate-btn');
        expect(askBtnIdx).toBeLessThan(genBtnIdx);
    });

    it('uses primary variant', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-ask-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('variant="primary"');
    });

    it('mobile overflow menu includes Ask option', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-ask"');
    });

    it('mobile Ask option dispatches OPEN_DIALOG with mode ask', () => {
        const askIdx = REPO_DETAIL_SOURCE.indexOf('repo-more-ask');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, askIdx - 300), askIdx + 200);
        expect(block).toContain("mode: 'ask'");
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
        expect(REPO_DETAIL_SOURCE).toContain('<RepoGitTab key={ws.id}');
    });

    it('mounts a fresh RepoActivityTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoActivityTab key={ws.id}');
    });

    it('mounts a fresh RepoSchedulesTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoSchedulesTab key={ws.id}');
    });

    it('mounts a fresh RepoCopilotTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoCopilotTab key={ws.id}');
    });

    it('mounts a fresh ExplorerPanel on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<ExplorerPanel key={ws.id}');
    });

    it('mounts a fresh TasksPanel on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toMatch(/<TasksPanel[\s\S]*?key=\{ws\.id\}/);
    });

    it('mounts a fresh RepoInfoTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoInfoTab key={ws.id}');
    });

    it('mounts a fresh WorkflowsTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<WorkflowsTab key={ws.id}');
    });

    it('mounts a fresh RepoWikiTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoWikiTab key={ws.id}');
    });

    it('mounts a fresh WorkflowDetailView on every repo switch via key={state.selectedWorkflowProcessId}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<WorkflowDetailView key={state.selectedWorkflowProcessId}');
    });
});

describe('RepoDetail New Chat button removed from header', () => {
    it('does not render repo-new-chat-btn', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-new-chat-btn"');
    });

    it('does not render repo-new-chat-split-btn', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-new-chat-split-btn"');
    });

    it('does not render repo-new-chat-dropdown-toggle', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-new-chat-dropdown-toggle"');
    });

    it('does not render repo-new-chat-dropdown-menu', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-new-chat-dropdown-menu"');
    });

    it('does not import NewChatDialog', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain("import { NewChatDialog }");
    });

    it('does not render NewChatDialog', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('<NewChatDialog');
    });

    it('does not have chatDialog state', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('setChatDialog');
    });

    it('does not have handleNewChatFromTopBar', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('handleNewChatFromTopBar');
    });

    it('does not have handleLaunchInTerminal', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('handleLaunchInTerminal');
    });
});

describe('RepoDetail Launch CLI button in header', () => {
    it('renders Launch CLI button with data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-launch-cli-btn"');
    });

    it('uses secondary variant', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-launch-cli-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('variant="secondary"');
    });

    it('button has title "Open CLI in terminal"', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Open CLI in terminal"');
    });

    it('button appears before Queue Task button', () => {
        const launchIdx = REPO_DETAIL_SOURCE.indexOf('repo-launch-cli-btn');
        const queueTaskIdx = REPO_DETAIL_SOURCE.indexOf('repo-queue-task-btn');
        expect(launchIdx).toBeGreaterThan(-1);
        expect(queueTaskIdx).toBeGreaterThan(-1);
        expect(launchIdx).toBeLessThan(queueTaskIdx);
    });

    it('button is disabled during loading', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-launch-cli-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('disabled={isLaunchingCli}');
    });

    it('handleLaunchCli calls fetchApi with /chat/launch-terminal endpoint', () => {
        const fnStart = REPO_DETAIL_SOURCE.indexOf('handleLaunchCli');
        const fnBody = REPO_DETAIL_SOURCE.slice(fnStart, fnStart + 400);
        expect(fnBody).toContain("fetchApi('/chat/launch-terminal'");
        expect(fnBody).toContain("method: 'POST'");
    });

    it('handleLaunchCli sends workingDirectory in request body', () => {
        const fnStart = REPO_DETAIL_SOURCE.indexOf('handleLaunchCli');
        const fnBody = REPO_DETAIL_SOURCE.slice(fnStart, fnStart + 400);
        expect(fnBody).toContain('workingDirectory: ws.rootPath');
    });

    it('handleLaunchCli resets isLaunchingCli in finally block', () => {
        const fnStart = REPO_DETAIL_SOURCE.indexOf('handleLaunchCli');
        const fnBody = REPO_DETAIL_SOURCE.slice(fnStart, fnStart + 400);
        expect(fnBody).toContain('finally');
        expect(fnBody).toContain('setIsLaunchingCli(false)');
    });

    it('button is always visible (not gated on sub-tab or pause state)', () => {
        const lines = REPO_DETAIL_SOURCE.split('\n');
        const btnLineIdx = lines.findIndex(l => l.includes('repo-launch-cli-btn'));
        const precedingBlock = lines.slice(Math.max(0, btnLineIdx - 10), btnLineIdx).join('\n');
        expect(precedingBlock).not.toContain("activeSubTab ===");
    });

    it('mobile overflow menu includes Launch CLI option', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-launch-cli"');
    });

    it('mobile Launch CLI option appears before Queue Task in overflow', () => {
        const launchIdx = REPO_DETAIL_SOURCE.indexOf('repo-more-launch-cli');
        const queueIdx = REPO_DETAIL_SOURCE.indexOf('repo-more-queue-task');
        expect(launchIdx).toBeLessThan(queueIdx);
    });
});

describe('RepoDetail Wiki badge wiring', () => {
    it('renders wiki generating badge with data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="wiki-generating-badge"');
    });

    it('wiki generating badge uses animate-pulse', () => {
        const line = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('wiki-generating-badge'));
        expect(line || REPO_DETAIL_SOURCE).toContain('animate-pulse');
    });

    it('wiki generating badge uses green bg-[#16825d]', () => {
        const lines = REPO_DETAIL_SOURCE.split('\n');
        const badgeLine = lines.findIndex(l => l.includes('wiki-generating-badge'));
        const context = lines.slice(Math.max(0, badgeLine - 5), badgeLine + 1).join('\n');
        expect(context).toContain('bg-[#16825d]');
    });

    it('wiki generating badge is gated on wikiGeneratingCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'wiki' && wikiGeneratingCount > 0");
    });

    it('renders wiki warning badge with data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="wiki-warning-badge"');
    });

    it('wiki warning badge uses amber bg-[#f59e0b]', () => {
        const lines = REPO_DETAIL_SOURCE.split('\n');
        const badgeLine = lines.findIndex(l => l.includes('wiki-warning-badge'));
        const context = lines.slice(Math.max(0, badgeLine - 5), badgeLine + 1).join('\n');
        expect(context).toContain('bg-[#f59e0b]');
    });

    it('wiki warning badge is suppressed when generating', () => {
        expect(REPO_DETAIL_SOURCE).toContain('wikiWarningCount > 0 && wikiGeneratingCount === 0');
    });

    it('filters wikis by ws.rootPath for badge counts', () => {
        expect(REPO_DETAIL_SOURCE).toContain('w.repoPath === ws.rootPath');
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
        const hashDispatchIdx = switchFnBody.indexOf("SET_GIT_COMMIT_HASH");
        const ifIdx = switchFnBody.indexOf("if (tab !== 'git')");
        expect(hashDispatchIdx).toBeGreaterThan(ifIdx);
    });
});

describe('RepoDetail MobileTabBar Activity badge wiring', () => {
    it('passes activityCount to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('activityCount={');
    });

    it('does not pass chatPendingCount to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('chatPendingCount={');
    });

    it('does not pass queueRunningCount directly to MobileTabBar', () => {
        const mobileBarSection = REPO_DETAIL_SOURCE.substring(
            REPO_DETAIL_SOURCE.indexOf('<MobileTabBar'),
            REPO_DETAIL_SOURCE.indexOf('<MobileTabBar') + 400,
        );
        expect(mobileBarSection).not.toContain('queueRunningCount={');
    });
});

describe('RepoDetail Git tab ahead/behind badge', () => {
    it('imports useGitInfo from hooks', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useGitInfo } from '../hooks/useGitInfo'");
    });

    it('calls useGitInfo with workspace id', () => {
        expect(REPO_DETAIL_SOURCE).toContain('useGitInfo(ws.id)');
    });

    it('destructures ahead and behind from useGitInfo', () => {
        expect(REPO_DETAIL_SOURCE).toContain('gitAhead');
        expect(REPO_DETAIL_SOURCE).toContain('gitBehind');
    });

    it('renders ahead/behind badge only for git tab', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'git' && (gitAhead > 0 || gitBehind > 0)");
    });

    it('renders ahead indicator with ↑ symbol', () => {
        expect(REPO_DETAIL_SOURCE).toContain('↑{gitAhead}');
    });

    it('renders behind indicator with ↓ symbol', () => {
        expect(REPO_DETAIL_SOURCE).toContain('↓{gitBehind}');
    });

    it('badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="git-ahead-behind-badge"');
    });

    it('ahead count span has data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="git-ahead-count"');
    });

    it('behind count span has data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="git-behind-count"');
    });

    it('badge uses muted/small styling (opacity-70 and text-[10px])', () => {
        const badgeIdx = REPO_DETAIL_SOURCE.indexOf('git-ahead-behind-badge');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, badgeIdx - 200), badgeIdx + 50);
        expect(block).toContain('opacity-70');
        expect(block).toContain('text-[10px]');
    });

    it('behind count is only rendered when gitBehind > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain('gitBehind > 0');
    });

    it('ahead count is only rendered when gitAhead > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain('gitAhead > 0');
    });
});
