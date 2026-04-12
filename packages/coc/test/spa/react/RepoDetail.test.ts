/**
 * Tests for RepoDetail SUB_TABS and component wiring.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SUB_TABS, BASE_VISIBLE_SUB_TABS } from '../../../src/server/spa/client/react/repos/RepoDetail';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoDetail.tsx'),
    'utf-8',
);

describe('RepoDetail SUB_TABS', () => {
    it('includes a "chats" entry', () => {
        const chatsTab = SUB_TABS.find(t => t.key === 'chats');
        expect(chatsTab).toBeDefined();
        expect(chatsTab!.label).toBe('Chats');
    });

    it('does not include separate "chat" or "queue" entries', () => {
        expect(SUB_TABS.find(t => t.key === 'chat')).toBeUndefined();
        expect(SUB_TABS.find(t => t.key === 'queue')).toBeUndefined();
    });

    it('"chats" is followed by "work-items" entry', () => {
        const chatsIdx = SUB_TABS.findIndex(t => t.key === 'chats');
        const workItemsIdx = SUB_TABS.findIndex(t => t.key === 'work-items');
        expect(workItemsIdx).toBe(chatsIdx + 1);
    });

    it('"work-items" is the second entry', () => {
        expect(SUB_TABS[1].key).toBe('work-items');
    });

    it('has exactly 10 entries', () => {
        expect(SUB_TABS).toHaveLength(10);
    });

    it('contains all expected sub-tabs in order', () => {
        const keys = SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['chats', 'work-items', 'git', 'pull-requests', 'workflows', 'schedules', 'explorer', 'tasks', 'settings', 'wiki']);
    });

    it('includes "wiki" entry', () => {
        const wikiTab = SUB_TABS.find(t => t.key === 'wiki');
        expect(wikiTab).toBeDefined();
    });

    it('has git as the third tab (after work-items)', () => {
        expect(SUB_TABS[2].key).toBe('git');
    });

    it('chats is the first entry', () => {
        expect(SUB_TABS[0].key).toBe('chats');
    });

    it('tasks tab has label "Tasks"', () => {
        const tasksTab = SUB_TABS.find(t => t.key === 'tasks');
        expect(tasksTab).toBeDefined();
        expect(tasksTab!.label).toBe('Tasks');
    });
});

describe('RepoDetail BASE_VISIBLE_SUB_TABS', () => {
    it('excludes wiki when SHOW_WIKI_TAB is false', () => {
        expect(BASE_VISIBLE_SUB_TABS.find(t => t.key === 'wiki')).toBeUndefined();
    });

    it('has 9 entries (all SUB_TABS minus wiki)', () => {
        expect(VISIBLE_SUB_TABS).toHaveLength(9);
    });

    it('contains all non-wiki tabs in order', () => {
        const keys = VISIBLE_SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['chats', 'work-items', 'git', 'pull-requests', 'workflows', 'schedules', 'explorer', 'tasks', 'settings']);
    });

    it('renders visibleSubTabs.map in the tab strip', () => {
        expect(REPO_DETAIL_SOURCE).toContain('visibleSubTabs.map');
    });

    it('passes visibleSubTabs to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('tabs={visibleSubTabs}');
    });
});

describe('RepoDetail Activity tab rendering', () => {
    it('chats sub-tab renders RepoActivityTab with mode="chats"', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'chats'");
        expect(REPO_DETAIL_SOURCE).toContain('<RepoActivityTab');
        expect(REPO_DETAIL_SOURCE).toContain('mode="chats"');
    });

    it('tasks sub-tab renders RepoActivityTab with mode="tasks"', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'tasks'");
        expect(REPO_DETAIL_SOURCE).toContain('mode="tasks"');
    });

    it('chats is in SUB_TABS (visible in tab strip)', () => {
        const chatsTab = SUB_TABS.find(t => t.key === 'chats');
        expect(chatsTab).toBeDefined();
    });

    it('chats sub-tab uses overflow-hidden layout', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'chats'");
        const overflowLine = REPO_DETAIL_SOURCE.split('\n').find(l =>
            l.includes("activeSubTab === 'chats'") && l.includes('overflow-hidden')
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

    it('generate button is removed from the header (moved to NewChatArea quick actions)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-generate-btn"');
    });

    it('edit button is also removed', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('repo-edit-btn');
    });

    it('passes onOpenGenerateDialog to GenerateTaskDialog or header', () => {
        expect(REPO_DETAIL_SOURCE).toContain('handleOpenGenerateDialog');
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

    it('minimized badge is removed along with the generate button', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="generate-minimized-badge"');
    });
});

describe('RepoDetail Activity badge wiring', () => {
    it('imports useRepoQueueStats from hooks', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useRepoQueueStats } from '../hooks/useRepoQueueStats'");
    });

    it('destructures chatsRunning, chatsQueued, tasksRunning, tasksQueued from useRepoQueueStats', () => {
        expect(REPO_DETAIL_SOURCE).toContain('chatsRunning');
        expect(REPO_DETAIL_SOURCE).toContain('chatsQueued');
        expect(REPO_DETAIL_SOURCE).toContain('tasksRunning');
        expect(REPO_DETAIL_SOURCE).toContain('tasksQueued');
    });

    it('does not destructure chatPending (removed from visible nav)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('chatPending: chatPendingCount');
    });

    it('renders chats running badge only when chatsRunning > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chats' && chatsRunning > 0");
    });

    it('renders chats queued badge only when chatsQueued > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chats' && chatsQueued > 0");
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
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="chats-running-badge"');
    });

    it('queued badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="chats-queued-badge"');
    });

    it('running badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Running"');
    });

    it('queued badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Queued"');
    });

    it('running badge renders before queued badge', () => {
        const runningIdx = REPO_DETAIL_SOURCE.indexOf('chatsRunning > 0');
        const queuedIdx = REPO_DETAIL_SOURCE.indexOf('chatsQueued > 0');
        expect(runningIdx).toBeLessThan(queuedIdx);
    });

    it('seeds repo queue map via useEffect on ws.id change', () => {
        expect(REPO_DETAIL_SOURCE).toContain("fetchApi('/queue?repoId='");
        expect(REPO_DETAIL_SOURCE).toContain("type: 'REPO_QUEUE_UPDATED'");
    });

    it('skips fetch if repoQueueMap already has task-level data for the repo', () => {
        expect(REPO_DETAIL_SOURCE).toContain('existing.running.length > 0 || existing.queued.length > 0');
    });

    it('does not access history on repoQueueMap entries (history is not part of queue state)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('existing.history');
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

    it('Queue Task button tooltip includes Alt+Q hint', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Queue a new task (Alt+Q)"');
    });

    it('mobile menu Queue Task label includes Alt+Q hint', () => {
        expect(REPO_DETAIL_SOURCE).toContain('Queue Task (Alt+Q)');
    });
});

describe('RepoDetail Resume Queue button in header', () => {
    it('renders resume button with data-testid when queue is paused', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-header-resume-btn"');
    });

    it('shows resume button when activeSubTab is chats or tasks and isRepoPaused', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'chats'");
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'tasks'");
        expect(REPO_DETAIL_SOURCE).toContain('isRepoPaused');
    });

    it('resume button appears before Run Script button', () => {
        const resumeIdx = REPO_DETAIL_SOURCE.indexOf('repo-header-resume-btn');
        const runScriptIdx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        expect(resumeIdx).toBeGreaterThan(-1);
        expect(runScriptIdx).toBeGreaterThan(-1);
        expect(resumeIdx).toBeLessThan(runScriptIdx);
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
    it('Queue Task button removed from header (access via NewChatArea)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-queue-task-btn"');
    });
});

describe('RepoDetail Ask button in header', () => {
    it('Ask button removed from header (access via NewChatArea)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-ask-btn"');
    });

    it('does not have a mobile ask entry in the overflow menu', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-ask"');
    });
});

describe('RepoDetail Run Script button in header', () => {
    it('renders Run Script button with data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-run-script-btn"');
    });

    it('dispatches OPEN_SCRIPT_DIALOG with workspaceId on click', () => {
        expect(REPO_DETAIL_SOURCE).toContain("queueDispatch({ type: 'OPEN_SCRIPT_DIALOG', workspaceId: ws.id })");
    });

    it('Run Script button appears after Launch CLI button', () => {
        const launchIdx = REPO_DETAIL_SOURCE.indexOf('repo-launch-cli-btn');
        const scriptBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        expect(launchIdx).toBeGreaterThan(-1);
        expect(scriptBtnIdx).toBeGreaterThan(-1);
        expect(scriptBtnIdx).toBeGreaterThan(launchIdx);
    });

    it('Run Script is the last button in the desktop toolbar', () => {
        const scriptBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        // No Queue Task, Ask, or Generate buttons follow it
        expect(REPO_DETAIL_SOURCE).not.toContain('repo-queue-task-btn');
        expect(REPO_DETAIL_SOURCE).not.toContain('repo-ask-btn');
        expect(REPO_DETAIL_SOURCE).not.toContain('repo-generate-btn');
        expect(scriptBtnIdx).toBeGreaterThan(-1);
    });

    it('uses primary variant', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('variant="primary"');
    });

    it('has title "Run a script in this repo"', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Run a script in this repo"');
    });

    it('mobile Run Script action is passed to MobileTabBar via actions prop', () => {
        // Run Script action moved from inline BottomSheet to MobileTabBar actions prop
        expect(REPO_DETAIL_SOURCE).toContain("label: 'Run Script'");
        expect(REPO_DETAIL_SOURCE).toContain("icon: '⚡'");
        expect(REPO_DETAIL_SOURCE).toContain("type: 'OPEN_SCRIPT_DIALOG', workspaceId: ws.id");
    });

    it('mobile Run Script action appears in MobileTabBar actions array', () => {
        const actionsIdx = REPO_DETAIL_SOURCE.indexOf("label: 'Run Script'");
        expect(actionsIdx).toBeGreaterThan(-1);
    });

    it('mobile overflow menu does not include Ask (Ask is a top-level button)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-ask"');
    });

    it('mobile Run Script dispatches OPEN_SCRIPT_DIALOG with workspaceId via actions', () => {
        const actionsIdx = REPO_DETAIL_SOURCE.indexOf("label: 'Run Script'");
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, actionsIdx - 100), actionsIdx + 200);
        expect(block).toContain("type: 'OPEN_SCRIPT_DIALOG'");
        expect(block).toContain('workspaceId: ws.id');
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

    it('mounts a fresh RepoActivityTab on every repo switch via key containing ws.id', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoActivityTab key={`${ws.id}');
    });

    it('mounts a fresh RepoSchedulesTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoSchedulesTab key={ws.id}');
    });

    it('mounts a fresh RepoSettingsTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoSettingsTab key={ws.id}');
    });

    it('mounts a fresh ExplorerPanel on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<ExplorerPanel key={ws.id}');
    });

    it('no longer references TasksPanel (removed from RepoDetail)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('<TasksPanel');
    });

    it('no longer mounts a separate RepoInfoTab (merged into RepoSettingsTab)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('<RepoInfoTab');
    });

    it('mounts a fresh TemplatesTab on every repo switch via key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<TemplatesTab key={ws.id}');
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

    it('button appears before Run Script button', () => {
        const launchIdx = REPO_DETAIL_SOURCE.indexOf('repo-launch-cli-btn');
        const runScriptIdx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        expect(launchIdx).toBeGreaterThan(-1);
        expect(runScriptIdx).toBeGreaterThan(-1);
        expect(launchIdx).toBeLessThan(runScriptIdx);
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

    it('mobile overflow menu does not include Launch CLI (hidden on mobile)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-launch-cli"');
    });

    it('Launch CLI is only in desktop toolbar', () => {
        const launchIdx = REPO_DETAIL_SOURCE.indexOf('repo-launch-cli-btn');
        expect(launchIdx).toBeGreaterThan(-1);
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
    it('does NOT dispatch SET_GIT_COMMIT_HASH when switching tabs (state is preserved)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain("dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: null })");
    });

    it('uses getTabSuffix to build the URL suffix', () => {
        expect(REPO_DETAIL_SOURCE).toContain('getTabSuffix(tab, state)');
    });

    it('getTabSuffix restores commit hash in URL when git tab has a selected commit', () => {
        expect(REPO_DETAIL_SOURCE).toContain('state.selectedGitCommitHash');
        expect(REPO_DETAIL_SOURCE).toContain("return '/git/' + hash + file");
    });

    it('getTabSuffix includes file path in URL when git tab has a selected file', () => {
        expect(REPO_DETAIL_SOURCE).toContain('state.selectedGitFilePath');
        expect(REPO_DETAIL_SOURCE).toContain("encodeURIComponent(state.selectedGitFilePath)");
    });

    it('getTabSuffix returns /git when no commit is selected', () => {
        expect(REPO_DETAIL_SOURCE).toContain("return '/git'");
    });

    it('getTabSuffix preserves settings section in URL', () => {
        expect(REPO_DETAIL_SOURCE).toContain("return '/settings/' + state.settingsSection");
    });

    it('getTabSuffix does not have info tab shortcut', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain("if (tab === 'info') return ''");
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

// ── TasksPanel always-mounted (keep-alive: no re-fetch on tab switch) ───────────

describe('RepoDetail TasksPanel always-mounted', () => {
    it('does NOT conditionally render TasksPanel with a ternary', () => {
        // If conditionally rendered, the component unmounts/remounts on tab switch,
        // triggering 3 API fetches. It must stay always-mounted.
        expect(REPO_DETAIL_SOURCE).not.toContain("activeSubTab === 'tasks' ? (");
        expect(REPO_DETAIL_SOURCE).not.toContain("activeSubTab === 'tasks' &&");
    });

    it('wraps TasksPanel in a div with display:none when inactive', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'tasks' ? undefined : 'none'");
    });

    it('tasks tab wrapper uses overflow-hidden layout', () => {
        const overflowLine = REPO_DETAIL_SOURCE.split('\n').find(l =>
            l.includes("activeSubTab === 'tasks'") && l.includes('overflow-hidden')
        );
        expect(overflowLine).toBeDefined();
    });
});

// ── PullRequestsTab always-mounted (regression: auto-refresh on tab switch) ────

describe('RepoDetail PullRequestsTab always-mounted', () => {
    it('does NOT conditionally render PullRequestsTab with &&', () => {
        // If conditionally rendered, the component remounts on every tab switch,
        // triggering the useEffect fetch automatically. It must stay always-mounted.
        expect(REPO_DETAIL_SOURCE).not.toContain("activeSubTab === 'pull-requests' && (");
        expect(REPO_DETAIL_SOURCE).not.toContain("activeSubTab === 'pull-requests' && <PullRequestsTab");
    });

    it('wraps PullRequestsTab in a div with display:none when inactive', () => {
        // The always-mounted pattern: display toggled via style prop, not conditional render.
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'pull-requests' ? undefined : 'none'");
    });

    it('pull-requests tab uses overflow-hidden layout (component manages its own scroll)', () => {
        const overflowLine = REPO_DETAIL_SOURCE.split('\n').find(l =>
            l.includes("activeSubTab === 'pull-requests'") && l.includes('overflow-hidden')
        );
        expect(overflowLine).toBeDefined();
    });
});
