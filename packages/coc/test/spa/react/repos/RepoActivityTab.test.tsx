/**
 * Tests for RepoActivityTab — the unified Activity tab.
 *
 * Validates:
 * - RepoActivityTab exists and renders a queue-style left rail plus a conditional right pane
 * - Selecting a top-level chat task renders inline chat detail (ActivityChatDetail)
 * - Selecting a non-chat task renders QueueTaskDetail
 * - Follow-up child chat tasks remain hidden in the Activity left rail
 * - RepoQueueTab continues to work (shared ActivityListPane)
 * - ActivityDetailPane switches between chat and queue detail
 * - Mobile layout with back/list behavior
 * - Empty state rendering
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPOS_DIR = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos');

const ACTIVITY_TAB_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'RepoActivityTab.tsx'), 'utf-8');
const ACTIVITY_LIST_PANE_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityListPane.tsx'), 'utf-8');
const ACTIVITY_CHAT_DETAIL_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityChatDetail.tsx'), 'utf-8');
const ACTIVITY_DETAIL_PANE_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityDetailPane.tsx'), 'utf-8');
const REPO_QUEUE_TAB_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'RepoQueueTab.tsx'), 'utf-8');
const INDEX_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'index.ts'), 'utf-8');
const REPO_DETAIL_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'RepoDetail.tsx'), 'utf-8');

// ── RepoActivityTab structure ──────────────────────────────────────────

describe('RepoActivityTab: component structure', () => {
    it('exports RepoActivityTab function component', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('export function RepoActivityTab');
    });

    it('accepts workspaceId prop', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('workspaceId: string');
    });

    it('uses ActivityListPane for the left rail', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain("import { ActivityListPane } from './ActivityListPane'");
        expect(ACTIVITY_TAB_SOURCE).toContain('<ActivityListPane');
    });

    it('uses ActivityDetailPane for the right pane', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain("import { ActivityDetailPane } from './ActivityDetailPane'");
        expect(ACTIVITY_TAB_SOURCE).toContain('<ActivityDetailPane');
    });

    it('uses useQueue and useApp contexts', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('useQueue()');
        expect(ACTIVITY_TAB_SOURCE).toContain('useApp()');
    });

    it('uses useBreakpoint for responsive layout', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('useBreakpoint()');
    });
});

// ── Split-panel layout ─────────────────────────────────────────────────

describe('RepoActivityTab: split-panel layout', () => {
    it('uses flex h-full overflow-hidden layout', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('flex h-full overflow-hidden');
    });

    it('has data-testid for the split-panel container', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('data-testid="activity-split-panel"');
    });

    it('has a left panel with flex-shrink-0 and border-r', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('flex-shrink-0 border-r border-[#e0e0e0]');
    });

    it('has tablet-responsive width', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain("isTablet ? 'w-64' : 'w-80'");
    });

    it('has a right panel with flex-1 min-w-0', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('flex-1 min-w-0 overflow-hidden');
    });

    it('has data-testid for the detail panel', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('data-testid="activity-detail-panel"');
    });
});

// ── Activity-specific selectTask behavior ──────────────────────────────

describe('RepoActivityTab: selectTask keeps chat inline', () => {
    let selectTaskBlock: string;

    beforeAll(() => {
        const start = ACTIVITY_TAB_SOURCE.indexOf('const selectTask = useCallback');
        const end = ACTIVITY_TAB_SOURCE.indexOf('}, [queueDispatch, workspaceId, isMobile, selectedTaskId])', start);
        selectTaskBlock = ACTIVITY_TAB_SOURCE.substring(start, end + 60);
    });

    it('does NOT dispatch SET_SELECTED_CHAT_SESSION for chat tasks', () => {
        expect(selectTaskBlock).not.toContain('SET_SELECTED_CHAT_SESSION');
    });

    it('does NOT dispatch SET_REPO_SUB_TAB for chat tasks', () => {
        expect(selectTaskBlock).not.toContain('SET_REPO_SUB_TAB');
    });

    it('dispatches SELECT_QUEUE_TASK for regular selection', () => {
        expect(selectTaskBlock).toContain('SELECT_QUEUE_TASK');
    });

    it('updates hash to activity path', () => {
        expect(selectTaskBlock).toContain('/activity/');
    });

    it('still navigates run-workflow tasks to workflow detail', () => {
        expect(selectTaskBlock).toContain("task?.type === 'run-workflow'");
        expect(selectTaskBlock).toContain('/workflow/');
    });

    it('supports re-click refresh', () => {
        expect(selectTaskBlock).toContain('REFRESH_SELECTED_QUEUE_TASK');
    });

    it('sets mobileShowDetail on mobile', () => {
        expect(selectTaskBlock).toContain('if (isMobile) setMobileShowDetail(true)');
    });
});

// ── ActivityDetailPane: routing logic ──────────────────────────────────

describe('ActivityDetailPane: detail routing', () => {
    it('exports ActivityDetailPane function component', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('export function ActivityDetailPane');
    });

    it('imports ActivityChatDetail', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain("import { ActivityChatDetail } from './ActivityChatDetail'");
    });

    it('imports QueueTaskDetail', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain("import { QueueTaskDetail } from '../queue/QueueTaskDetail'");
    });

    it('has isTopLevelChatTask helper', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('function isTopLevelChatTask');
    });

    it('checks task type is chat', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain("task?.type === 'chat'");
    });

    it('excludes follow-up chat tasks (those with payload.processId)', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('payload?.processId');
    });

    it('renders ActivityChatDetail for top-level chat tasks', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('<ActivityChatDetail');
    });

    it('renders QueueTaskDetail for non-chat tasks', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('<QueueTaskDetail');
    });

    it('shows empty-state placeholder when no task is selected', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('Select a task to view details');
    });

    it('empty state has clipboard icon', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('📋');
    });

    it('passes onBack prop to both detail components', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('onBack={onBack}');
    });
});

// ── ActivityChatDetail ─────────────────────────────────────────────────

describe('ActivityChatDetail: inline chat detail', () => {
    it('exports ActivityChatDetail function component', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('export function ActivityChatDetail');
    });

    it('accepts taskId and onBack props', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('taskId: string');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('onBack?: () => void');
    });

    it('derives processId from task', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('task?.processId ?? (taskId ? `queue_${taskId}` : null)');
    });

    it('loads queue task data on mount', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('/queue/${encodeURIComponent(taskId)}');
    });

    it('loads process conversation data', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('/processes/${encodeURIComponent(pid)}');
    });

    it('uses getConversationTurns from chatConversationUtils', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain("import { getConversationTurns } from '../chat/chatConversationUtils'");
    });

    it('renders ConversationTurnBubble for turns', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('<ConversationTurnBubble');
    });

    it('has SSE streaming for running tasks', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('new EventSource');
    });

    it('polls for queued-to-running transition', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('setInterval');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain("task?.status !== 'queued'");
    });

    it('supports follow-up messages', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('/message');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('sendFollowUp');
    });

    it('handles session expiry (410)', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('response.status === 410');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('setSessionExpired(true)');
    });

    it('has data-testid for the chat detail container', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('data-testid="activity-chat-detail"');
    });

    it('has a back button with data-testid', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('data-testid="activity-chat-back-btn"');
    });

    it('has a chat input with data-testid', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('data-testid="activity-chat-input"');
    });

    it('has a send button with data-testid', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('data-testid="activity-chat-send-btn"');
    });

    it('shows loading spinner', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('Loading conversation...');
    });

    it('shows waiting state for queued tasks', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('Waiting to start');
    });

    it('shows no-data message', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('No conversation data available');
    });

    it('supports resume CLI', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('resume-cli');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('Resume CLI');
    });

    it('supports image paste', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('useImagePaste');
    });

    it('has scroll-to-bottom button', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('Scroll to bottom');
    });
});

// ── ActivityListPane: shared left rail ─────────────────────────────────

describe('ActivityListPane: shared list component', () => {
    it('exports ActivityListPane function component', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function ActivityListPane');
    });

    it('exports isChatFollowUp helper', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function isChatFollowUp');
    });

    it('filters out chat follow-up tasks (payload.processId)', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("task.type === 'chat' && !!(task as any).payload?.processId");
    });

    it('exports taskMatchesFilter helper', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function taskMatchesFilter');
    });

    it('exports getTaskTypeIcon helper', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function getTaskTypeIcon');
    });

    it('exports getTaskPromptPreview helper', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function getTaskPromptPreview');
    });

    it('exports QueueTaskItem component', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function QueueTaskItem');
    });

    it('renders running/queued/history sections', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('Running Tasks');
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('Queued Tasks');
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('Completed Tasks');
    });

    it('supports filter dropdown', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="queue-filter-dropdown"');
    });

    it('supports pause/resume', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="repo-pause-resume-btn"');
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="queue-paused-banner"');
    });

    it('supports drag and drop', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('useQueueDragDrop');
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('draggable={!isMobile}');
    });

    it('supports pause markers', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="pause-marker-row"');
    });

    it('supports context menu', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('ContextMenu');
    });

    it('has empty state with queue task button', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="repo-queue-task-btn-empty"');
    });

    it('has empty state with paused resume button', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="repo-pause-resume-btn-empty"');
    });

    it('has refresh button', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="queue-refresh-btn"');
    });
});

// ── RepoQueueTab still works ───────────────────────────────────────────

describe('RepoQueueTab: continues to work with shared ActivityListPane', () => {
    it('imports ActivityListPane', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain("import { ActivityListPane } from './ActivityListPane'");
    });

    it('renders ActivityListPane', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('<ActivityListPane');
    });

    it('still imports QueueTaskDetail', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain("import { QueueTaskDetail } from '../queue/QueueTaskDetail'");
    });

    it('still renders QueueTaskDetail when a task is selected', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('<QueueTaskDetail />');
    });

    it('still has data-testid for split-panel', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('data-testid="repo-queue-split-panel"');
    });

    it('still has data-testid for detail panel', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('data-testid="repo-queue-detail-panel"');
    });

    it('still has data-testid for mobile list', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('data-testid="repo-queue-mobile-list"');
    });

    it('still navigates chat tasks to Chat tab', () => {
        const selectBlock = REPO_QUEUE_TAB_SOURCE.substring(
            REPO_QUEUE_TAB_SOURCE.indexOf('const selectTask = useCallback'),
            REPO_QUEUE_TAB_SOURCE.indexOf('}, [queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId])')
        );
        expect(selectBlock).toContain('SET_SELECTED_CHAT_SESSION');
        expect(selectBlock).toContain('SET_REPO_SUB_TAB');
    });

    it('still shows empty-state placeholder', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('Select a task to view details');
    });

    it('has flex h-full overflow-hidden layout', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('flex h-full overflow-hidden');
    });

    it('has left panel with flex-shrink-0 and border-r', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('flex-shrink-0 border-r border-[#e0e0e0]');
    });
});

// ── Barrel export ──────────────────────────────────────────────────────

describe('repos/index.ts: exports RepoActivityTab', () => {
    it('exports RepoActivityTab', () => {
        expect(INDEX_SOURCE).toContain("export { RepoActivityTab } from './RepoActivityTab'");
    });
});

// ── RepoDetail wiring ──────────────────────────────────────────────────

describe('RepoDetail: wires RepoActivityTab for activity sub-tab', () => {
    it('imports RepoActivityTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { RepoActivityTab } from './RepoActivityTab'");
    });

    it('renders RepoActivityTab for activity sub-tab', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'activity' && <RepoActivityTab");
    });

    it('still renders RepoQueueTab for queue sub-tab', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'queue' && <RepoQueueTab");
    });
});

// ── Mobile layout ──────────────────────────────────────────────────────

describe('RepoActivityTab: mobile layout', () => {
    it('has mobileShowDetail state', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('const [mobileShowDetail, setMobileShowDetail] = useState(false)');
    });

    it('renders mobile branch when isMobile', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('if (isMobile)');
    });

    it('mobile branch has data-testid for split panel', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('data-testid="activity-split-panel"');
    });

    it('mobile branch has data-testid for mobile list', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('data-testid="activity-mobile-list"');
    });

    it('mobile branch toggles between list and detail', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('mobileShowDetail && selectedTaskId');
    });

    it('passes onBack to ActivityDetailPane on mobile', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('onBack={() => setMobileShowDetail(false)}');
    });

    it('resets mobileShowDetail when selection is cleared', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('if (!selectedTaskId) setMobileShowDetail(false)');
    });
});

// ── Data fetching ──────────────────────────────────────────────────────

describe('RepoActivityTab: data fetching', () => {
    it('fetches queue data on mount', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain("fetchApi('/queue?repoId='");
    });

    it('fetches history data', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain("fetchApi('/queue/history?repoId='");
    });

    it('applies per-repo WS updates', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('repoQueueMap[workspaceId]');
    });

    it('dispatches REPO_QUEUE_UPDATED', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('REPO_QUEUE_UPDATED');
    });

    it('clears selection when task is removed', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain("SELECT_QUEUE_TASK', id: null");
    });

    it('has loading state', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('Loading queue...');
    });

    it('has live timer for running tasks', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('setInterval(() => setNow(Date.now()), 1000)');
    });

    it('supports pause/resume', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('/queue/resume');
        expect(ACTIVITY_TAB_SOURCE).toContain('/queue/pause');
    });
});

// ── Hidden follow-up chat tasks ────────────────────────────────────────

describe('ActivityListPane: hidden follow-up chat tasks', () => {
    it('isChatFollowUp checks for payload.processId', () => {
        const fn = ACTIVITY_LIST_PANE_SOURCE.substring(
            ACTIVITY_LIST_PANE_SOURCE.indexOf('export function isChatFollowUp'),
            ACTIVITY_LIST_PANE_SOURCE.indexOf('}', ACTIVITY_LIST_PANE_SOURCE.indexOf('export function isChatFollowUp')) + 1,
        );
        expect(fn).toContain("task.type === 'chat'");
        expect(fn).toContain('payload?.processId');
    });

    it('filters follow-ups from running tasks', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('running.filter(t => !isChatFollowUp(t)');
    });

    it('filters follow-ups from queued tasks', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('!isChatFollowUp(t) && taskMatchesFilter');
    });

    it('filters follow-ups from history tasks', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('history.filter(t => !isChatFollowUp(t)');
    });

    it('filters follow-ups from allTasks used for filter options', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('.filter((t: any) => !isChatFollowUp(t))');
    });
});
