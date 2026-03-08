/**
 * Tests for RepoActivityTab — the unified Activity tab.
 *
 * Validates:
 * - RepoActivityTab exists and renders a queue-style left rail plus a conditional right pane
 * - Selecting a top-level chat task renders inline chat detail (ActivityChatDetail)
 * - Selecting a non-chat task renders QueueTaskDetail
 * - Follow-up child chat tasks remain hidden in the Activity left rail
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

    it('shows metadata grid for queued tasks', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain('data-testid="queued-task-meta"');
    });

    it('displays task ID in queued metadata', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain("label=\"Task ID\"");
    });

    it('displays model in queued metadata', () => {
        expect(ACTIVITY_CHAT_DETAIL_SOURCE).toContain("label=\"Model\"");
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
