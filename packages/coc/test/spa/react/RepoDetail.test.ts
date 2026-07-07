/**
 * Tests for RepoDetail SUB_TABS and component wiring.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SUB_TABS, VISIBLE_SUB_TABS } from '../../../src/server/spa/client/react/features/repo-detail/RepoDetail';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'),
    'utf-8',
);

// The sub-tab taxonomy and visibility logic were extracted into repoSubTabs.ts
// (shared with the remote-first shell). Source-level assertions about that logic
// read from this file.
const REPO_SUB_TABS_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'repoSubTabs.ts'),
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

    it('"chats" is followed by "cli-sessions" entry', () => {
        const chatsIdx = SUB_TABS.findIndex(t => t.key === 'chats');
        const cliSessionsIdx = SUB_TABS.findIndex(t => t.key === 'cli-sessions');
        expect(cliSessionsIdx).toBe(chatsIdx + 1);
    });

    it('"cli-sessions" is the second entry (between chats/activity and git)', () => {
        expect(SUB_TABS[1].key).toBe('cli-sessions');
    });

    it('"git" is the third entry, immediately after cli-sessions', () => {
        expect(SUB_TABS[2].key).toBe('git');
    });

    it('has exactly 14 entries', () => {
        expect(SUB_TABS).toHaveLength(14);
    });

    it('contains all expected sub-tabs in order', () => {
        const keys = SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['chats', 'cli-sessions', 'git', 'terminal', 'work-items', 'dreams', 'pull-requests', 'explorer', 'workflows', 'schedules', 'tasks', 'notes', 'settings', 'wiki']);
    });

    it('includes "wiki" entry without a shortcut', () => {
        const wikiTab = SUB_TABS.find(t => t.key === 'wiki');
        expect(wikiTab).toBeDefined();
        expect(wikiTab!.shortcut).toBeUndefined();
    });

    it('has explorer as the seventh tab (after pull requests)', () => {
        expect(SUB_TABS[7].key).toBe('explorer');
    });

    it('chats is the first entry', () => {
        expect(SUB_TABS[0].key).toBe('chats');
    });

    it('tasks tab has label "Tasks (Dep.)"', () => {
        const tasksTab = SUB_TABS.find(t => t.key === 'tasks');
        expect(tasksTab).toBeDefined();
        expect(tasksTab!.label).toBe('Tasks (Dep.)');
    });
});

describe('RepoDetail CLI Sessions placement (between Activity and Git)', () => {
    it('cli-sessions sits immediately after chats and immediately before git in SUB_TABS', () => {
        const chatsIdx = SUB_TABS.findIndex(t => t.key === 'chats');
        const cliSessionsIdx = SUB_TABS.findIndex(t => t.key === 'cli-sessions');
        const gitIdx = SUB_TABS.findIndex(t => t.key === 'git');
        expect(cliSessionsIdx).toBe(chatsIdx + 1);
        expect(gitIdx).toBe(cliSessionsIdx + 1);
    });

    it('keeps the same placement in VISIBLE_SUB_TABS', () => {
        const chatsIdx = VISIBLE_SUB_TABS.findIndex(t => t.key === 'chats');
        const cliSessionsIdx = VISIBLE_SUB_TABS.findIndex(t => t.key === 'cli-sessions');
        const gitIdx = VISIBLE_SUB_TABS.findIndex(t => t.key === 'git');
        expect(cliSessionsIdx).toBe(chatsIdx + 1);
        expect(gitIdx).toBe(cliSessionsIdx + 1);
    });

    it('groups cli-sessions with the activity/git/terminal divider group (group 1)', () => {
        // TAB_GROUP_INDEX is not exported; assert via source so cli-sessions does
        // not render as a divider-flanked island between Activity and Git.
        expect(REPO_SUB_TABS_SOURCE).toContain(
            "'chats': 1, 'activity': 1, 'cli-sessions': 1, 'copilot-sessions': 1, 'git': 1, 'terminal': 1,",
        );
        // cli-sessions / copilot-sessions must no longer be in the work-items group.
        const workItemsGroupLine = REPO_SUB_TABS_SOURCE
            .split('\n')
            .find(l => l.includes("'work-items': 2"));
        expect(workItemsGroupLine).toBeDefined();
        expect(workItemsGroupLine).not.toContain("'cli-sessions'");
        expect(workItemsGroupLine).not.toContain("'copilot-sessions'");
    });

    it('dev-workflow order places cli-sessions immediately after chats', () => {
        const devOrderMatch = REPO_SUB_TABS_SOURCE.match(/devWorkflowOrder.*?=\s*\[([\s\S]*?)\]/);
        expect(devOrderMatch).toBeTruthy();
        const keys = devOrderMatch![1].match(/'([^']+)'/g)!.map(k => k.replace(/'/g, ''));
        expect(keys[0]).toBe('chats');
        expect(keys[1]).toBe('cli-sessions');
    });
});

describe('RepoDetail VISIBLE_SUB_TABS', () => {
    it('excludes wiki when SHOW_WIKI_TAB is false', () => {
        expect(VISIBLE_SUB_TABS.find(t => t.key === 'wiki')).toBeUndefined();
    });

    it('has 13 entries (all SUB_TABS minus wiki)', () => {
        expect(VISIBLE_SUB_TABS).toHaveLength(13);
    });

    it('contains all non-wiki tabs in order', () => {
        const keys = VISIBLE_SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['chats', 'cli-sessions', 'git', 'terminal', 'work-items', 'dreams', 'pull-requests', 'explorer', 'workflows', 'schedules', 'tasks', 'notes', 'settings']);
    });

    it('renders visibleSubTabs.map in the tab strip', () => {
        expect(REPO_DETAIL_SOURCE).toContain('visibleSubTabs.map');
    });

    it('passes visibleSubTabs to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('tabs={visibleSubTabs}');
    });
});

describe('RepoDetail Dreams tab feature gating', () => {
    it('imports useDreamsEnabled hook', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useDreamsEnabled } from '../../hooks/feature-flags/useDreamsEnabled'");
    });

    it('calls useDreamsEnabled() inside the component', () => {
        expect(REPO_DETAIL_SOURCE).toContain('useDreamsEnabled()');
    });

    it('filters dreams tab from visibleSubTabs when disabled', () => {
        expect(REPO_SUB_TABS_SOURCE).toContain("t.key !== 'dreams'");
    });

    it('visibleSubTabs depends on dreamsEnabled', () => {
        expect(REPO_DETAIL_SOURCE).toContain('[isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled, pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, showPlanDepTab, uiLayoutMode, splitWorkspacePanelEnabled]');
    });

    it('redirects away from dreams when the feature is disabled (via the visibility guard)', () => {
        // The per-feature ref-guard effects were consolidated into a single
        // visibility-based redirect: a disabled dreams tab drops out of
        // visibleSubTabs, and any non-visible active tab falls back to chats.
        expect(REPO_DETAIL_SOURCE).toContain('if (isRepoSubTabVisible(activeSubTab, visibleSubTabs)) return;');
        expect(REPO_DETAIL_SOURCE).toContain("dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });");
    });

    it('guards DreamsPanel mounting on dreamsEnabled', () => {
        expect(REPO_DETAIL_SOURCE).toContain('{dreamsEnabled && (');
        expect(REPO_DETAIL_SOURCE).toContain('<DreamsPanel key={ws.id} workspaceId={ws.id} originId={workItemOriginId} />');
    });
});

describe('RepoDetail Activity tab rendering', () => {
    it('classic-mode chat wrapper renders RepoChatTab keyed for activity', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoChatTab key={`${ws.id}-activity`}');
    });

    it('dev-workflow chat wrapper renders RepoChatTab with mode="chats"', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoChatTab key={`${ws.id}-chats`}');
    });

    /**
     * Regression: a previous unconditional Router redirect from `/activity` to
     * `/chats` set `activeSubTab='chats'` even in classic mode, which gated
     * the activity wrapper on `activeSubTab === 'activity'` only and rendered
     * blank. The wrapper now accepts BOTH keys interchangeably so cross-mode
     * URLs (and any race during the async preferences fetch) still render.
     */
    it('classic-mode chat wrapper accepts both activity and chats keys', () => {
        // Anchor on the `RepoChatTab key=...-activity` line and inspect the preceding wrapper.
        const anchor = REPO_DETAIL_SOURCE.indexOf('<RepoChatTab key={`${ws.id}-activity`}');
        expect(anchor).toBeGreaterThan(-1);
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, anchor - 600), anchor);
        expect(block).toContain("uiLayoutMode === 'classic'");
        expect(block).toMatch(/activeSubTab === 'activity'.*\|\|.*activeSubTab === 'chats'/s);
    });

    it('dev-workflow chat wrapper accepts both chats and activity keys', () => {
        const anchor = REPO_DETAIL_SOURCE.indexOf('<RepoChatTab key={`${ws.id}-chats`}');
        expect(anchor).toBeGreaterThan(-1);
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, anchor - 600), anchor);
        expect(block).toContain("uiLayoutMode === 'dev-workflow'");
        expect(block).toMatch(/activeSubTab === 'chats'.*\|\|.*activeSubTab === 'activity'/s);
    });

    it('activity sub-tab uses overflow-hidden layout', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'activity'");
        const overflowLine = REPO_DETAIL_SOURCE.split('\n').find(l =>
            l.includes("activeSubTab === 'activity'") && l.includes('overflow-hidden')
        );
        expect(overflowLine).toBeDefined();
    });
});

describe('RepoDetail: Queue tab removed', () => {
    it('does not render RepoQueueTab', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('RepoQueueTab');
    });

    it('chat and queue are not in visible SUB_TABS', () => {
        expect(SUB_TABS.find(t => t.key === 'chat')).toBeUndefined();
        expect(SUB_TABS.find(t => t.key === 'queue')).toBeUndefined();
    });
});

describe('RepoDetail Activity badge wiring', () => {
    it('imports useRepoQueueStats from hooks', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useRepoQueueStats } from '../../queue/hooks/useRepoQueueStats'");
    });

    it('destructures running and queued from useRepoQueueStats', () => {
        expect(REPO_DETAIL_SOURCE).toContain('running: queueRunningCount');
        expect(REPO_DETAIL_SOURCE).toContain('queued: queueQueuedCount');
    });

    it('does not destructure chatPending (removed from visible nav)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('chatPending: chatPendingCount');
    });

    it('renders chats running badge only when queueRunningCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chats' && queueRunningCount > 0");
    });

    it('renders chats queued badge only when queueQueuedCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chats' && queueQueuedCount > 0");
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

});

describe('RepoDetail Notes tab badge wiring', () => {
    it('does not render an auto-commit indicator in the Notes tab', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="notes-autocommit-badge"');
        expect(REPO_DETAIL_SOURCE).not.toContain('Auto-commit active');
    });

    it('does not subscribe the repo tab strip to notes auto-commit state', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('useNotesAutoCommit');
    });
});

describe('RepoDetail Resume Queue button in header', () => {
    it('renders resume button with data-testid when queue is paused', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-header-resume-btn"');
    });

    it('shows resume button when activeSubTab is chats or tasks and isRepoPaused', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'chats'");
        expect(REPO_DETAIL_SOURCE).toContain('isRepoPaused');
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

describe('RepoDetail header context drop targets', () => {
    it('wraps Queue Task and Ask header buttons in context drop targets', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-queue-task-drop-target"');
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-ask-drop-target"');
    });

    it('opens the queue dialog with attached context instead of submitting on drop', () => {
        expect(REPO_DETAIL_SOURCE).toContain('handleHeaderContextDrop');
        expect(REPO_DETAIL_SOURCE).toContain("type: 'OPEN_DIALOG'");
        expect(REPO_DETAIL_SOURCE).toContain('attachedContext: [validation.payload]');
        expect(REPO_DETAIL_SOURCE).not.toContain('queue.enqueue');
    });

    it('uses shared session-context drop validation for header drops', () => {
        expect(REPO_DETAIL_SOURCE).toContain('validateSessionContextDrop');
        expect(REPO_DETAIL_SOURCE).toContain('readSessionContextDropPayload');
        expect(REPO_DETAIL_SOURCE).toContain('dataTransferHasSessionContext');
        expect(REPO_DETAIL_SOURCE).toContain('repo-header-context-drop-feedback');
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
        const queueBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-launch-cli-btn');
        const scriptBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        expect(queueBtnIdx).toBeGreaterThan(-1);
        expect(scriptBtnIdx).toBeGreaterThan(-1);
        expect(scriptBtnIdx).toBeGreaterThan(queueBtnIdx);
    });

    it('uses primary variant', () => {
        const idx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        const block = REPO_DETAIL_SOURCE.substring(Math.max(0, idx - 300), idx);
        expect(block).toContain('variant="primary"');
    });

    it('has title "Run a prompt or script in this repo"', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Run a prompt or script in this repo"');
    });

    it('Run Prompt / Script button label is rendered in the desktop header', () => {
        // The desktop overflow popover (classic) and inline action bar (dev-workflow)
        // both render the script-runner button using the user-facing label
        // "Run Prompt / Script" (renamed from the legacy "Prompt & Script"
        // wording, which is still used by the underlying dialog title and the
        // global product-name references elsewhere in the SPA).
        expect(REPO_DETAIL_SOURCE).toContain('Run Prompt / Script');
    });
});

describe('RepoDetail Git tab wiring', () => {
    it('imports RepoGitTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { RepoGitTab } from '../git/RepoGitTab'");
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

    it('mounts a fresh RepoChatTab on every repo switch via key containing ws.id', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoChatTab key={`${ws.id}');
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

    it('renders tasks tab using RepoChatTab with mode="tasks"', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoChatTab key={`${ws.id}-tasks`}');
        expect(REPO_DETAIL_SOURCE).toContain('mode="tasks"');
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
        const scriptBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        expect(launchIdx).toBeGreaterThan(-1);
        expect(scriptBtnIdx).toBeGreaterThan(-1);
        expect(launchIdx).toBeLessThan(scriptBtnIdx);
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

    it('uses buildRepoSubTabSuffix to build the URL suffix', () => {
        expect(REPO_DETAIL_SOURCE).toContain('buildRepoSubTabSuffix(tab, state, selectedTaskId)');
    });

    it('passes the repo-scoped selected task id into the shared URL builder', () => {
        expect(REPO_DETAIL_SOURCE).toContain('queueState.selectedTaskIdByRepo[ws.id]');
    });

    it('no longer has a private getTabSuffix helper', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('function getTabSuffix');
    });

    it('does not have info tab shortcut', () => {
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
        expect(REPO_DETAIL_SOURCE).toContain("import { useGitInfo } from '../git/hooks/useGitInfo'");
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

describe('RepoDetail Tasks tab rendering', () => {
    it('renders tasks tab with RepoChatTab mode="tasks" via ternary', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'tasks' ? (");
    });

    it('wraps tasks RepoChatTab in a div with overflow-hidden', () => {
        const overflowLine = REPO_DETAIL_SOURCE.split('\n').find(l =>
            l.includes("activeSubTab === 'tasks'") && l.includes('overflow-hidden')
        );
        // The overflow-hidden is on the wrapping div near the tasks ternary
        expect(REPO_DETAIL_SOURCE).toContain('mode="tasks"');
    });

    it('tasks tab wrapper uses overflow-hidden layout', () => {
        const tasksIdx = REPO_DETAIL_SOURCE.indexOf("activeSubTab === 'tasks' ? (");
        const block = REPO_DETAIL_SOURCE.substring(tasksIdx, tasksIdx + 200);
        expect(block).toContain('overflow-hidden');
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

describe('RepoDetail dev-workflow tab relabeling and reorder', () => {
    it('dev-workflow branch relabels schedules to "Jobs"', () => {
        expect(REPO_SUB_TABS_SOURCE).toContain("'schedules': 'Jobs'");
    });

    it('dev-workflow branch relabels pull-requests to "Full Requests"', () => {
        expect(REPO_SUB_TABS_SOURCE).toContain("'pull-requests': 'Full Requests'");
    });

    it('dev-workflow branch defines the correct tab order', () => {
        expect(REPO_SUB_TABS_SOURCE).toContain(
            "'chats', 'cli-sessions', 'work-items', 'dreams', 'schedules', 'explorer',",
        );
        expect(REPO_SUB_TABS_SOURCE).toContain(
            "'workflows', 'git', 'terminal', 'pull-requests', 'tasks', 'settings',",
        );
    });

    it('classic branch does NOT apply dev-workflow relabels', () => {
        // Classic branch relabels Tasks as Plans, not Jobs/Full Requests
        const classicBlock = REPO_SUB_TABS_SOURCE.split("if (uiLayoutMode === 'classic')")[1]?.split('} else {')[0] ?? '';
        expect(classicBlock).not.toContain("'Jobs'");
        expect(classicBlock).not.toContain("'Full Requests'");
    });

    it('dev-workflow appends dynamic tabs after the fixed order', () => {
        // The else branch must iterate tabMap leftovers (notes, wiki) after the ordered array
        expect(REPO_SUB_TABS_SOURCE).toContain("// Append dynamic tabs");
        expect(REPO_SUB_TABS_SOURCE).toContain("for (const [, tab] of tabMap)");
    });

    it('tab keys are unchanged — only labels differ', () => {
        // devWorkflowOrder uses the same keys as SUB_TABS
        const devOrderMatch = REPO_SUB_TABS_SOURCE.match(/devWorkflowOrder.*?=\s*\[([\s\S]*?)\]/);
        expect(devOrderMatch).toBeTruthy();
        const keys = devOrderMatch![1].match(/'([^']+)'/g)!.map(k => k.replace(/'/g, ''));
        for (const key of keys) {
            expect(SUB_TABS.find(t => t.key === key)).toBeDefined();
        }
    });
});

/**
 * Split "Workspace" panel integration (feature flag `splitWorkspacePanel`).
 * These source-structure assertions guard the RepoDetail wiring that makes the
 * whole feature go live: the flag hook, the computeVisibleSubTabs pass-through,
 * mounting SplitWorkspacePanel with both reused tabs feeding ONE shared detail
 * container, and the strict off-path no-op. See AC-02..AC-07.
 */
describe('RepoDetail split-workspace panel wiring', () => {
    it('imports SplitWorkspacePanel and the flag hook', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { SplitWorkspacePanel } from './SplitWorkspacePanel'");
        expect(REPO_DETAIL_SOURCE).toContain("import { useSplitWorkspacePanelEnabled } from '../../hooks/feature-flags/useSplitWorkspacePanelEnabled'");
    });

    it('reads the flag via the hook and feeds it into computeVisibleSubTabs (AC-02)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const splitWorkspacePanelEnabled = useSplitWorkspacePanelEnabled();');
        // Passed as an opt so git is hidden + chat relabeled "Workspace" when on.
        const memoCall = REPO_DETAIL_SOURCE.split('computeVisibleSubTabs({')[1]?.split('})')[0] ?? '';
        expect(memoCall).toContain('splitWorkspacePanelEnabled');
    });

    it('owns last-clicked state (default chat) and a state-backed detail node (AC-04)', () => {
        expect(REPO_DETAIL_SOURCE).toContain("const [splitLastClicked, setSplitLastClicked] = useState<'chat' | 'git'>('chat')");
        // State-backed node (not a plain ref) so the portal mounts once the slot exists.
        expect(REPO_DETAIL_SOURCE).toContain('const [splitDetailNode, setSplitDetailNode] = useState<HTMLDivElement | null>(null)');
    });

    it('mounts SplitWorkspacePanel only when the flag is on (AC-02 mount half)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('{splitWorkspacePanelEnabled && (');
        expect(REPO_DETAIL_SOURCE).toContain('<SplitWorkspacePanel');
    });

    it('feeds the chat list into the panel as a split-workspace RepoChatTab (AC-03/04)', () => {
        const anchor = REPO_DETAIL_SOURCE.indexOf('<SplitWorkspacePanel');
        expect(anchor).toBeGreaterThan(-1);
        const block = REPO_DETAIL_SOURCE.substring(anchor, anchor + 3000);
        expect(block).toContain('chatList={');
        expect(block).toContain('<RepoChatTab');
        expect(block).toContain('key={`${ws.id}-split-chat`}');
        expect(block).toContain("layout=\"split-workspace\"");
    });

    it('feeds the git list into the panel as a split-workspace RepoGitTab, git-gated (AC-05)', () => {
        const anchor = REPO_DETAIL_SOURCE.indexOf('<SplitWorkspacePanel');
        const block = REPO_DETAIL_SOURCE.substring(anchor, anchor + 3000);
        expect(block).toContain('gitList={isGitRepo ? (');
        expect(block).toContain('key={`${ws.id}-split-git`}');
    });

    it('hoists the git toolbar into the section header via a portal host, git-gated', () => {
        // A dedicated state node mirrors the splitDetailNode pattern.
        expect(REPO_DETAIL_SOURCE).toContain('const [splitGitHeaderNode, setSplitGitHeaderNode] = useState<HTMLDivElement | null>(null)');
        const anchor = REPO_DETAIL_SOURCE.indexOf('<SplitWorkspacePanel');
        const block = REPO_DETAIL_SOURCE.substring(anchor, anchor + 3000);
        // RepoGitTab portals its compact toolbar into the header host node...
        expect(block).toContain('headerToolbarContainer={splitGitHeaderNode}');
        // ...which RepoDetail renders inside the panel's git header slot.
        expect(block).toContain('gitHeaderExtra={isGitRepo ? (');
        expect(block).toContain('ref={setSplitGitHeaderNode}');
        expect(block).toContain('data-testid="split-workspace-git-header-toolbar"');
    });

    it('points BOTH tabs at the SAME shared detail container (AC-04 single pane)', () => {
        const anchor = REPO_DETAIL_SOURCE.indexOf('<SplitWorkspacePanel');
        const block = REPO_DETAIL_SOURCE.substring(anchor, anchor + 3000);
        // Both tabs receive detailContainer={splitDetailNode}; the detail slot is the
        // single ref target both portal into.
        const containerRefs = block.match(/detailContainer=\{splitDetailNode\}/g) ?? [];
        expect(containerRefs.length).toBe(2);
        expect(block).toContain('ref={setSplitDetailNode}');
    });

    it('routes last-selection-wins: chat active vs git active are mirror opposites (AC-04)', () => {
        const anchor = REPO_DETAIL_SOURCE.indexOf('<SplitWorkspacePanel');
        const block = REPO_DETAIL_SOURCE.substring(anchor, anchor + 3000);
        expect(block).toContain("detailActive={splitLastClicked === 'chat'}");
        expect(block).toContain("onActivateDetail={() => setSplitLastClicked('chat')}");
        expect(block).toContain("detailActive={splitLastClicked === 'git'}");
        expect(block).toContain("onActivateDetail={() => setSplitLastClicked('git')}");
    });

    it('off-path is a strict no-op: standalone chat blocks are gated by !flag (AC-01)', () => {
        expect(REPO_DETAIL_SOURCE).toContain("!splitWorkspacePanelEnabled && uiLayoutMode === 'classic'");
        expect(REPO_DETAIL_SOURCE).toContain("!splitWorkspacePanelEnabled && uiLayoutMode === 'dev-workflow'");
    });

    it('suppresses the standalone git block when the flag is on (AC-02/05)', () => {
        // The always-mounted standalone git tab is gated on !flag so git is not
        // double-mounted (it now lives inside the split panel).
        expect(REPO_DETAIL_SOURCE).toContain('{!splitWorkspacePanelEnabled && isGitRepo && <div');
    });
});
