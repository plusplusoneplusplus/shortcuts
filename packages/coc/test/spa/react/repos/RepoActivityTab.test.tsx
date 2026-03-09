/**
 * Tests for RepoActivityTab — the unified Activity tab.
 *
 * Validates:
 * - RepoActivityTab exists and renders a queue-style left rail plus a conditional right pane
 * - All task types are rendered inline via ActivityChatDetail
 * - Follow-up child chat tasks remain hidden in the Activity left rail
 * - ActivityDetailPane always uses ActivityChatDetail
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
        const end = ACTIVITY_TAB_SOURCE.indexOf('}, [queueDispatch, workspaceId, isMobile, selectedTaskId, markSeen])', start);
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

    it('always renders ActivityChatDetail for selected tasks', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('<ActivityChatDetail');
    });

    it('does not import QueueTaskDetail', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).not.toContain('QueueTaskDetail');
    });

    it('does not route based on task type', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).not.toContain('isTopLevelChatTask');
    });

    it('shows empty-state placeholder when no task is selected', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('Select a task to view details');
    });

    it('empty state has clipboard icon', () => {
        expect(ACTIVITY_DETAIL_PANE_SOURCE).toContain('📋');
    });

    it('passes onBack prop to ActivityChatDetail', () => {
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

    it('vertically centers mode selector, input, and send button', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('flex items-center gap-2');
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

    it('shows PendingTaskInfoPanel for queued tasks', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('<PendingTaskInfoPanel');
    });

    it('passes cancel and moveToTop handlers', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('onCancel={handleCancel}');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('onMoveToTop={handleMoveToTop}');
    });

    it('imports MetaRow and FilePathValue from PendingTaskPayload', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain("import { MetaRow, FilePathValue } from '../queue/PendingTaskPayload'");
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

    it('consumes refreshVersion from QueueContext for re-click refresh', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain("useQueue()");
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('queueState.refreshVersion');
    });

    it('tracks last refresh version to detect re-click', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('lastRefreshVersionRef');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('lastRefreshVersionRef.current !== queueState.refreshVersion');
    });

    it('re-fetches queue task and process data on refresh', () => {
        // The refresh effect should fetch the queue task and process data
        const refreshEffectStart = ACTIVITY_CHAT_DETAIL_SOURCE.indexOf('Re-fetch conversation when user re-clicks');
        const refreshEffectEnd = ACTIVITY_CHAT_DETAIL_SOURCE.indexOf('// SSE for running tasks');
        const refreshEffect = ACTIVITY_CHAT_DETAIL_SOURCE.substring(refreshEffectStart, refreshEffectEnd);
        expect(refreshEffect).toContain('/queue/${encodeURIComponent(taskId)}');
        expect(refreshEffect).toContain('/processes/${encodeURIComponent(pid)}');
        expect(refreshEffect).toContain('queueState.refreshVersion');
    });

    it('has copy-conversation button with data-testid', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('data-testid="copy-conversation-btn"');
    });

    it('imports copyToClipboard and formatConversationAsText from utils/format', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('copyToClipboard');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('formatConversationAsText');
    });

    it('has copied state for copy button feedback', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('useState(false)');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('setCopied(true)');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('setCopied(false)');
    });

    it('copy button is disabled when loading or turns empty', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('disabled={loading || turns.length === 0}');
    });

    it('copy button calls formatConversationAsText with turns', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('formatConversationAsText(turns)');
    });

    it('copy button shows checkmark icon after copying (2s revert)', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('setCopied(false), 2000');
    });

    it('copy button has clipboard and checkmark SVG icons', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('M2 8L6 12L14 4');
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('copied ?');
    });

    it('header has right-side actions group with copy and metadata', () => {
        const headerStart = ACTIVITY_CHAT_DETAIL_SOURCE.indexOf('{/* Header */}');
        const headerEnd = ACTIVITY_CHAT_DETAIL_SOURCE.indexOf('{/* Conversation area */}');
        const headerBlock = ACTIVITY_CHAT_DETAIL_SOURCE.substring(headerStart, headerEnd);
        // The copy button and metadata popover are in a separate right-side div
        expect(headerBlock).toContain('copy-conversation-btn');
        expect(headerBlock).toContain('ConversationMetadataPopover');
    });
});

// ── ActivityListPane: shared left rail ─────────────────────────────────

describe('ActivityListPane: shared list component', () => {
    it('exports ActivityListPane function component', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function ActivityListPane');
    });

    it('does not export legacy isChatFollowUp helper', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).not.toContain('export function isChatFollowUp');
    });

    it('exports taskMatchesFilter helper', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function taskMatchesFilter');
    });

    it('exports getTaskTypeIcon helper', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('export function getTaskTypeIcon');
    });

    it('getTaskTypeIcon returns mode-based icons for chat tasks matching chat mode selector', () => {
        // Icons should match the chat mode selector: 💡 Ask, 📋 Plan, 🤖 Autopilot
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("payload.mode === 'ask') return '💡'");
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("payload.mode === 'plan') return '📋'");
    });

    it('getTaskTypeIcon returns ▶️ for run-workflow and ⚡ for run-script', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("type === 'run-workflow') return '▶️'");
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("type === 'run-script') return '⚡'");
    });

    it('getTaskTypeIcon uses mode as primary icon for chat tasks without context overrides', () => {
        // The function should NOT override mode-based icons with context-based icons
        // (e.g., skills, taskGeneration, resolveComments, files should not change the icon)
        expect(ACTIVITY_LIST_PANE_SOURCE).not.toMatch(/getTaskTypeIcon[\s\S]*?context\?\.skills/);
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

    it('does not render RepoQueueTab (removed in Activity migration)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('RepoQueueTab');
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

// ── Reused follow-up chat tasks remain visible ─────────────────────────

describe('ActivityListPane: reused follow-up chat tasks stay visible', () => {
    it('does not filter running tasks with isChatFollowUp', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('running.filter(t => taskMatchesFilter(t, filterType))');
    });

    it('does not filter queued tasks with isChatFollowUp', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("queued.filter(t => t.kind === 'pause-marker' || taskMatchesFilter(t, filterType))");
    });

    it('does not filter history tasks with isChatFollowUp', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('history.filter(t => taskMatchesFilter(t, filterType))');
    });

    it('does not filter allTasks with isChatFollowUp', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("[...running, ...queued.filter((t: any) => t.kind !== 'pause-marker'), ...history]");
    });
});

// ── Unseen activity tracking ───────────────────────────────────────────

const UNSEEN_HOOK_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks', 'useUnseenActivity.ts'),
    'utf-8',
);

describe('useUnseenActivity hook: structure', () => {
    it('exports useUnseenActivity function', () => {
        expect(UNSEEN_HOOK_SOURCE).toContain('export function useUnseenActivity');
    });

    it('accepts workspaceId, history, and selectedTaskId params', () => {
        expect(UNSEEN_HOOK_SOURCE).toContain('workspaceId: string');
        expect(UNSEEN_HOOK_SOURCE).toContain('history: any[]');
        expect(UNSEEN_HOOK_SOURCE).toContain('selectedTaskId: string | null');
    });

    it('returns unseenTaskIds, unseenCount, markSeen, and markAllSeen', () => {
        expect(UNSEEN_HOOK_SOURCE).toContain('unseenTaskIds');
        expect(UNSEEN_HOOK_SOURCE).toContain('unseenCount');
        expect(UNSEEN_HOOK_SOURCE).toContain('markSeen');
        expect(UNSEEN_HOOK_SOURCE).toContain('markAllSeen');
    });

    it('persists to localStorage with workspace-scoped key', () => {
        expect(UNSEEN_HOOK_SOURCE).toContain("'coc-unseen-'");
        expect(UNSEEN_HOOK_SOURCE).toContain('localStorage');
    });

    it('seeds all existing history as seen on first visit', () => {
        expect(UNSEEN_HOOK_SOURCE).toContain('hadPriorStateRef');
        expect(UNSEEN_HOOK_SOURCE).toContain('seededRef');
    });

    it('auto-marks selected task as seen when it completes', () => {
        expect(UNSEEN_HOOK_SOURCE).toContain('selectedTaskId');
        expect(UNSEEN_HOOK_SOURCE).toContain('task?.completedAt');
    });

    it('compares completedAt for unseen detection', () => {
        expect(UNSEEN_HOOK_SOURCE).toContain("seen !== task.completedAt");
    });

    it('cleans up stale entries for tasks no longer in history', () => {
        expect(UNSEEN_HOOK_SOURCE).toContain('lastCleanupRef');
        expect(UNSEEN_HOOK_SOURCE).toContain('stale');
    });
});

describe('RepoActivityTab: unseen activity wiring', () => {
    it('imports useUnseenActivity hook', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain("import { useUnseenActivity } from '../hooks/useUnseenActivity'");
    });

    it('calls useUnseenActivity with workspaceId, history, and selectedTaskId', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('useUnseenActivity(workspaceId, history, selectedTaskId)');
    });

    it('destructures unseenTaskIds and markSeen from the hook', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('unseenTaskIds');
        expect(ACTIVITY_TAB_SOURCE).toContain('markSeen');
    });

    it('destructures markAllSeen from the hook', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('markAllSeen');
    });

    it('passes onMarkAllRead to ActivityListPane', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('onMarkAllRead={markAllSeen}');
    });

    it('calls markSeen in selectTask', () => {
        const selectTaskStart = ACTIVITY_TAB_SOURCE.indexOf('const selectTask = useCallback');
        const selectTaskEnd = ACTIVITY_TAB_SOURCE.indexOf('}, [queueDispatch, workspaceId, isMobile, selectedTaskId, markSeen])', selectTaskStart);
        const selectTaskBlock = ACTIVITY_TAB_SOURCE.substring(selectTaskStart, selectTaskEnd + 70);
        expect(selectTaskBlock).toContain('markSeen(id)');
    });

    it('passes unseenTaskIds to ActivityListPane', () => {
        expect(ACTIVITY_TAB_SOURCE).toContain('unseenTaskIds={unseenTaskIds}');
    });
});

describe('ActivityListPane: unseen activity indicators', () => {
    it('accepts unseenTaskIds prop in interface', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('unseenTaskIds?: Set<string>');
    });

    it('destructures unseenTaskIds from props', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('unseenTaskIds,');
    });

    it('renders unseen dot indicator with data-testid', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="unseen-dot"');
    });

    it('uses blue dot circle for unseen indicator', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('rounded-full bg-[#0078d4]');
    });

    it('applies font-semibold to unseen task names', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('isUnseen && "font-semibold"');
    });

    it('shows unseen count badge on Completed Tasks header', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="unseen-count-badge"');
    });

    it('unseen count badge uses blue background pill style', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('bg-[#0078d4] text-white px-1.5 py-px rounded-full');
    });

    it('sets data-unseen attribute on unseen history cards', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-unseen={isUnseen || undefined}');
    });

    it('computes isUnseen per history task', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("unseenTaskIds?.has(task.id)");
    });

    it('highlights prompt preview text for unseen tasks', () => {
        // Unseen tasks show prompt preview in foreground color instead of muted
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('isUnseen ? "text-[#1e1e1e] dark:text-[#cccccc]"');
    });
});

describe('ActivityListPane: mark all read button', () => {
    it('accepts onMarkAllRead prop in interface', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('onMarkAllRead?: () => void');
    });

    it('destructures onMarkAllRead from props', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('onMarkAllRead,');
    });

    it('renders mark-all-read button with data-testid', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('data-testid="mark-all-read-btn"');
    });

    it('mark-all-read button calls onMarkAllRead on click', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('onClick={onMarkAllRead}');
    });

    it('mark-all-read button only shows when there are unseen tasks', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('onMarkAllRead && unseenTaskIds && filteredHistory.some(t => unseenTaskIds.has(t.id))');
    });

    it('mark-all-read button has "Mark all read" label', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain('Mark all read');
    });
});
