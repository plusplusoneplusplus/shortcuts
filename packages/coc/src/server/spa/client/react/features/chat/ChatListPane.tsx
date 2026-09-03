/**
 * ChatListPane — shared queue-style left rail for Activity and Queue tabs.
 *
 * Renders running/queued/history sections with filters, drag/drop,
 * pause markers, context menus, and selection highlighting.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef, useContext } from 'react';
import { Card, Button, cn } from '../../ui';
import { copyToClipboard, formatDuration, formatRelativeTime, statusLabel } from '../../utils/format';
import { ensureQueueProcessId, isQueueProcessId, toQueueProcessId } from '../../utils/queue-process-id';
import { buildRows } from './conversation/ConversationMetadataPopover';
import { useQueueDragDrop } from '../../queue/hooks/useQueueDragDrop';
import { useQueueTouchDragDrop } from '../../queue/hooks/useQueueTouchDragDrop';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { RenameDialog } from '../../ui/RenameDialog';
import { useCocClient } from '../../repos/cloneRouting';
import { useWorkflowProgress } from '../workflow/hooks/useWorkflowProgress';
import { ScheduledSlideSchedules } from '../schedules/ScheduledSlideSchedules';
import { getDraft } from './hooks/useDraftStore';
import { useLongPress } from '../../hooks/ui/useLongPress';
import { useChatPrefs } from '../../contexts/ChatPreferencesContext';
import { usePopOut } from '../../contexts/PopOutContext';
import { ToastContext } from '../../contexts/ToastContext';
import { isDesktopShell } from '../../hooks/ui/useDesktopShell';
import { openChatPopOut } from './hooks/useChatWindowActions';
import { useQueue } from '../../contexts/QueueContext';
import { useApp } from '../../contexts/AppContext';
import { useDisplaySettings } from '../../hooks/preferences/useDisplaySettings';
import { useScopedFindShortcut, isWithinDetailPane } from '../../hooks/useScopedFindShortcut';
import { SwipeableHistoryItem } from './SwipeableHistoryItem';
import { SummarizeChatDialog } from './SummarizeChatDialog';
import { groupHistoryByPlanFile, type HistoryGroup } from '../git/history-grouping';
import { HistoryGroupHeader, computeAggregateMode } from '../git/commits/HistoryGroupHeader';
import { groupByRalphSession, type RalphHistoryEntry, type RalphSession } from './ralph-session-grouping';
import { RalphSessionRow } from './RalphSessionRow';
import { groupByForEachRun, getForEachEntryTimestamp, getForEachRunId, type ForEachRunGroup, type ForEachRunHistoryEntry } from './for-each-run-grouping';
import { ForEachRunRow } from './ForEachRunRow';
import { groupByMapReduceRun, getMapReduceEntryTimestamp, getMapReduceRunId, type MapReduceRunGroup, type MapReduceRunHistoryEntry } from './map-reduce-run-grouping';
import { useTaskGroupExpansion } from './task-group-expansion';
import { buildForEachRunCopyInfo, buildMapReduceRunCopyInfo, buildRalphSessionCopyInfo } from './task-group-copy-info';
import { MapReduceRunRow } from './MapReduceRunRow';
import { buildSpawnedTreeChatView, collectSpawnedEntryTasks, getSpawnedEntryTimestamp, getSpawnedNodeId, isSpawnedTreeEntry, partitionSpawnedTreesByArchived, type SpawnedTreeEntry, type SpawnedTreeNode } from './spawned-tree-grouping';
import { SpawnedTreeRow } from './SpawnedTreeRow';
import { isSpawnedTreeViewEnabled, loadCollapsedSpawnedRootIds, toggleCollapsedSpawnedRoot } from './spawned-tree-view-state';
import { getGroupPinKey, isPinnedGroupEntry, mergePinnedEntries, partitionPinnedGroups, type PinnedGroupEntry, type PinnedListEntry } from './group-pinning';
import { isRalphEnabled, isCronEnabled, isSessionContextAttachmentsEnabled, isForEachEnabled, isMapReduceEnabled, isCommitChatLensEnabled } from '../../utils/config';
import { getListModeConfig } from './list-mode-config';
import { useChatFoldersEnabled } from '../../hooks/feature-flags/useChatFoldersEnabled';
import { useChatFolders } from './hooks/useChatFolders';
import { useChatFolderMembership } from './hooks/useChatFolderMembership';
import { useGroupFolders } from './hooks/useGroupFolders';
import { ChatFolderSection, ChatFolderChip } from './ChatFolderSection';
import { ChatFolderArchiveDialog } from './ChatFolderArchiveDialog';
import { ChatFolderDeleteDialog } from './ChatFolderDeleteDialog';
import { ChatFolderUndoToast } from './ChatFolderUndoToast';
import { folderNameExists } from './chat-folder-mutations';
import { useChatFolderMutations } from './hooks/useChatFolderMutations';
import { useChatFolderAssignment } from './hooks/useChatFolderAssignment';
import { useChatFolderDragDrop } from './hooks/useChatFolderDragDrop';
import { useChatListDragAutoScroll } from './hooks/useChatListDragAutoScroll';
import { useChatFolderArchive } from './hooks/useChatFolderArchive';
import { buildArchiveUndoMessage, canArchiveFolder } from './chat-folder-archive';
import {
    anySelectionFiled,
    buildMoveToFolderLabel,
    shouldShowFolderFilter,
} from './chat-folder-assignment';
import { CHAT_FOLDER_COLORS } from '../../../../../processes/chat-folder-validation';
import type { ChatFolderColor } from '@plusplusoneplusplus/coc-client';
import {
    buildChatFolderRows,
    buildFolderMemberCounts,
    buildGroupFolderIndex,
    buildSearchChatFolderRows,
    groupEntriesByFolder,
    partitionFiledEntries,
    resolveEntryFolderId,
    type ChatFolderRow,
} from './chat-folder-tree';
import { getGroupFolderKey, type GroupFolderTarget } from './group-folder-key';
import { collapseAllChatFolders, loadCollapsedChatFolderIds, toggleCollapsedChatFolder } from './chat-folder-view-state';
import { useAllCrons, type ProcessCronState } from './hooks/useAllCrons';
import { CronIcon } from './icons/CronIcon';
import { isRalphTask } from '../../../../../tasks/task-types';
import { getProviderDotClasses, getTaskChatProvider } from './ProviderBadge';
import { normalizeChatMode } from '../../repos/modeConfig';
import { createRalphSessionContextDragPayload, createSessionContextDragPayload, writeSessionContextDragBundle, writeSessionContextDragData, type SessionContextDragPayload } from './sessionContextDrag';
import { dataTransferHasSessionContext, readSessionContextDropPayloads } from './sessionContextDrop';
import { pushNewChatSeedContext } from './newChatSeedContext';
import type { AgentProvidersQuotaResponse, ForEachRunSummary, MapReduceRunSummary, ProcessGroupFolderType, ProcessGroupPin, ProcessGroupPinType } from '@plusplusoneplusplus/coc-client';
import { useAgentProvidersQuota } from '../../shared/useAgentProvidersQuota';
import { formatQuotaTypeLabel, getMostConstrainedProviderQuota, getQuotaPercent, getQuotaRiskClass, getTightestFiniteQuotaType } from '../../shared/quotaUtils';

/** Primary task types surfaced as individual filter options. */
export const TASK_TYPE_LABELS: Record<string, string> = {
    'chat': 'Chat',
    'run-workflow': 'Run Workflow',
    'run-script': 'Prompt & Script',
};

/** Mode-based labels for chat tasks. */
const CHAT_MODE_LABELS: Record<string, string> = {
    'ask': 'Ask',
    'autopilot': 'Autopilot',
    'ralph': 'Ralph',
    'map-reduce': 'Map Reduce',
};

export type ActivityTabMode = 'chats' | 'tasks';

type QueuePauseOptions = { durationHours?: number; until?: number | string };
type PauseMenuScope = 'all' | 'autopilot';
type PauseDurationHours = NonNullable<QueuePauseOptions['durationHours']>;
type GroupPinMenuTarget = {
    type: ProcessGroupPinType;
    groupId: string;
    isPinned: boolean;
    label: string;
};
const PAUSE_HOUR_PRESETS = [1, 2, 3, 4, 8] as const;
const EMPTY_GROUP_PINS: ProcessGroupPin[] = [];

/** Session category labels for display and filtering. */
export const SESSION_CATEGORY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    'generating-code': { label: 'Generating Code', icon: '⚙️', color: 'text-blue-600 dark:text-blue-400' },
    'resolve-plan-comments': { label: 'Resolve Plan', icon: '📥', color: 'text-purple-600 dark:text-purple-400' },
    'resolve-commit-comments': { label: 'Resolve Commit', icon: '🔺', color: 'text-amber-600 dark:text-amber-400' },
};

export function getSessionCategory(task: any): string | undefined {
    return task.payload?.sessionCategory as string | undefined;
}

/** Returns true if a task belongs to the Chats tab (any chat mode, not a work-item execution). */
export function isChatTask(task: any): boolean {
    if (task.type !== 'chat') return false;
    // Work-item executions historically used type:'chat' — exclude them from the Chats tab.
    // Queue items carry workItemId on payload; history items carry it at the top level.
    if (task.workItemId || task.payload?.workItemId) return false;
    return true;
}
const isChat = isChatTask;

/** Returns true if a task is an automation (run-script or run-workflow).
 *  Activity-tab scope-switcher uses this to surface the "Automations" segment. */
export function isAutomationTask(task: any): boolean {
    return task.type === 'run-script' || task.type === 'run-workflow';
}
const isAutomation = isAutomationTask;

/** Returns true if a task is a scheduled-job run — i.e. it carries a
 *  `scheduleId` (on `payload.scheduleId` or top-level `task.scheduleId`).
 *  Mirrors the 📅 icon check in {@link getTaskTypeIcon}. The Activity-tab
 *  "Scheduled" scope (internal id `'loops'`) groups these runs together with
 *  chats that have an attached `/cron`. */
export function isScheduledTask(task: any): boolean {
    return Boolean(task?.payload?.scheduleId || task?.scheduleId);
}

/** Internal scope id for the Activity segmented control. Note the id `'loops'`
 *  is retained for backwards compatibility (localStorage value + test ids) even
 *  though its visible label is now "Scheduled". */
export type ActivityScope = 'chat' | 'auto' | 'loops' | 'all';

/** Pure membership test for the Activity scope segmented control. `hasCron`
 *  indicates the task's process has an active/paused `/cron` attached.
 *  - `chat` → chat tasks that are NOT scheduled runs
 *  - `auto` → automations that are NOT scheduled runs
 *  - `loops` (labelled "Scheduled") → scheduled runs OR chats with a `/cron`
 *  - `all` → everything (true superset, still includes scheduled runs)
 *  Extracted as a pure helper so scope membership is unit-testable without
 *  rendering the component. */
export function taskInScope(scope: ActivityScope, task: any, hasCron: boolean): boolean {
    if (scope === 'all') return true;
    if (scope === 'chat') return isChatTask(task) && !isScheduledTask(task);
    if (scope === 'auto') return isAutomationTask(task) && !isScheduledTask(task);
    if (scope === 'loops') return isScheduledTask(task) || hasCron;
    return true;
}

/** Get a display title for a chat task, falling back to a truncated prompt preview. */
/**
 * The drag image for a multi-selection drag: the primary row's title plus a
 * count chip (AC-07). The node must be in the document when `setDragImage`
 * snapshots it, so it is parked off-screen and the caller removes it on
 * `dragend` — no timer is involved, because a timer outliving component
 * teardown is exactly the failure shape this feature has to avoid.
 */
function createMultiSelectDragImage(
    dataTransfer: DataTransfer,
    label: string,
    count: number,
): HTMLElement | null {
    if (typeof document === 'undefined' || typeof (dataTransfer as any)?.setDragImage !== 'function') {return null;}
    const node = document.createElement('div');
    node.setAttribute('data-testid', 'chat-folder-drag-image');
    node.style.cssText = [
        'position:fixed', 'top:-1000px', 'left:-1000px', 'pointer-events:none',
        'padding:4px 8px', 'border-radius:4px', 'font:12px/1 sans-serif',
        'background:#1e1e1e', 'color:#cccccc', 'white-space:nowrap',
    ].join(';');
    node.textContent = count > 1 ? `${label}  (${count})` : label;
    document.body.appendChild(node);
    try {
        (dataTransfer as any).setDragImage(node, 12, 12);
    } catch {
        node.remove();
        return null;
    }
    return node;
}

function getChatTitle(task: any): string {
    if (task.displayName) return task.displayName;
    const text = task.prompt || task.promptPreview || task.payload?.promptContent || task.payload?.prompt || '';
    if (text && !/^Use the \S+ skill\.$/.test(text)) {
        return text.length > 50 ? text.substring(0, 47) + '…' : text;
    }
    return 'Chat';
}

export function taskMatchesFilter(task: any, excludedTypes: Set<string>): boolean {
    if (excludedTypes.size === 0) return true;
    // Session category exclusion
    const cat = getSessionCategory(task);
    if (cat && excludedTypes.has(`cat:${cat}`)) return false;
    // Parent 'chat' exclusion hides all chat tasks (including those with modes)
    if (task.type === 'chat') {
        if (excludedTypes.has('chat')) return false;
        const mode = normalizeChatMode(task.payload?.mode ?? task.mode);
        if (mode) return !excludedTypes.has(mode);
        return true;
    }
    return !excludedTypes.has(task.type);
}

export function taskMatchesSearch(task: any, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    const title = (task.customTitle || task.displayName || task.title || '').toLowerCase();
    const prompt = (task.prompt || task.promptPreview || task.payload?.promptContent || task.payload?.prompt || '').toLowerCase();
    const lastMsg = (task.lastMessagePreview || '').toLowerCase();
    return title.includes(q) || prompt.includes(q) || lastMsg.includes(q);
}

/**
 * Whether an event target sits inside the right conversation panel — the detail
 * pane, marked with `data-pane="detail"`, which wraps both the reading area and
 * the message composer. Ctrl+F uses this to decide, by keyboard focus (never
 * mouse hover), whether to open the list search or yield to the native
 * find-in-page (AC-01). Re-exported from the shared find-shortcut hook so all
 * search-owning panels share one detail-pane test.
 */
export { isWithinDetailPane };

/** Return a type-specific icon for a task, matching the chat mode selector icons. */
export function getTaskTypeIcon(task: any): string {
    const type = task.type as string;
    const payload = task.payload || {};
    const mode = payload.mode ?? task.mode;
    if (payload.scheduleId || task.scheduleId) return '📅';
    if (type === 'chat') {
        if (isRalphTask(task)) return '🔄';
        const normalizedMode = normalizeChatMode(mode);
        if (normalizedMode === 'ask') return '💡';
        if (normalizedMode === 'ralph') return '🔄';
        return '🤖';
    }
    if (type === 'run-workflow') return payload.workItemId ? '📦' : '▶️';
    if (type === 'run-script') return '🛠️';
    return '🤖';
}

/**
 * Resolve the AI execution mode pill label for any task.
 * Mirrors the activity-compact reference: ASK / AUTO / SCRP.
 *
 * Chat tasks expose the mode via `payload.mode` (or `task.mode`).
 * Non-chat tasks fall back to category-based labels:
 *   - run-script → SCRP (scheduled / one-shot script)
 *   - run-workflow / replicate-template / memory-promote / generate / default → AUTO
 */
export function getTaskModeKey(task: any): 'ask' | 'auto' | 'script' | 'ralph' {
    const type = task.type as string;
    if (type === 'run-script') return 'script';
    if (type === 'chat') {
        if (isRalphTask(task)) return 'ralph';
        const mode = (task.payload?.mode ?? task.mode) as string | undefined;
        const normalizedMode = normalizeChatMode(mode);
        if (normalizedMode === 'ralph') return 'ralph';
        if (normalizedMode === 'ask') return 'ask';
        return 'auto';
    }
    return 'auto';
}

export function getTaskModeLabel(task: any): 'A' | 'S' | 'R' {
    const key = getTaskModeKey(task);
    if (key === 'ask') return 'A';
    if (key === 'script') return 'S';
    if (key === 'ralph') return 'R';
    return 'A';
}

export function getTaskPromptPreview(task: any): string {
    const text = task.prompt || task.promptPreview || task.payload?.promptContent || task.payload?.prompt || '';
    if (!text || /^Use the \S+ skill\.$/.test(text)) return '';
    return text.length > 60 ? text.substring(0, 57) + '…' : text;
}

function getForEachGenerationContext(task: any): any | undefined {
    const context = task?.forEach ?? task?.payload?.context?.forEach;
    return context?.kind === 'generation' ? context : undefined;
}

function getForEachGenerationPreview(task: any): string | undefined {
    const context = getForEachGenerationContext(task);
    if (!context) return undefined;
    const status = context.status === 'approved' ? 'approved' : 'draft';
    const itemCount = typeof context.latestItemCount === 'number' && Number.isFinite(context.latestItemCount) && context.latestItemCount > 0
        ? Math.floor(context.latestItemCount)
        : undefined;
    if (itemCount !== undefined) {
        return `${itemCount} proposed item${itemCount === 1 ? '' : 's'} - ${status}`;
    }
    if (context.lastPlanError) {
        return `Plan needs review - ${status}`;
    }
    return `Proposed plan - ${status}`;
}

function getMapReduceGenerationContext(task: any): any | undefined {
    const context = task?.mapReduce ?? task?.payload?.context?.mapReduce;
    return context?.kind === 'generation' ? context : undefined;
}

function getMapReduceGenerationPreview(task: any): string | undefined {
    const context = getMapReduceGenerationContext(task);
    if (!context) return undefined;
    const status = context.status === 'approved' ? 'approved' : 'draft';
    const itemCount = typeof context.latestItemCount === 'number' && Number.isFinite(context.latestItemCount) && context.latestItemCount > 0
        ? Math.floor(context.latestItemCount)
        : undefined;
    const parallel = typeof context.latestPlan?.maxParallel === 'number' && Number.isFinite(context.latestPlan.maxParallel)
        ? `, max ${Math.floor(context.latestPlan.maxParallel)} parallel`
        : '';
    if (itemCount !== undefined) {
        return `${itemCount} proposed map item${itemCount === 1 ? '' : 's'}${parallel} - ${status}`;
    }
    if (context.lastPlanError) {
        return `Map Reduce plan needs review - ${status}`;
    }
    return `Proposed Map Reduce plan - ${status}`;
}

function forEachRunMatchesSearch(run: ForEachRunSummary, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    return run.originalRequest.toLowerCase().includes(q)
        || run.runId.toLowerCase().includes(q)
        || run.status.toLowerCase().includes(q)
        || run.childMode.toLowerCase().includes(q)
        || (run.sharedInstructions?.toLowerCase().includes(q) ?? false);
}

function mapReduceRunMatchesSearch(run: MapReduceRunSummary, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    return run.originalRequest.toLowerCase().includes(q)
        || run.runId.toLowerCase().includes(q)
        || run.status.toLowerCase().includes(q)
        || run.reduceStatus.toLowerCase().includes(q)
        || run.childMode.toLowerCase().includes(q)
        || run.reduceInstructions.toLowerCase().includes(q)
        || (run.sharedInstructions?.toLowerCase().includes(q) ?? false);
}

function taskIdentityMatches(task: any, ids: Set<string>): boolean {
    return ids.has(task.id) || (typeof task.processId === 'string' && ids.has(task.processId));
}

function isRunningForEachRunGroup(group: ForEachRunGroup, runningIds?: Set<string>): boolean {
    return group.run.status === 'running'
        || group.children.some((child: any) => (
            child.status === 'running'
            || (runningIds ? taskIdentityMatches(child, runningIds) : false)
        ));
}

function isRunningMapReduceRunGroup(group: MapReduceRunGroup, runningIds?: Set<string>): boolean {
    return group.run.status === 'running'
        || group.run.status === 'reducing'
        || group.children.some((child: any) => (
            child.status === 'running'
            || (runningIds ? taskIdentityMatches(child, runningIds) : false)
        ));
}

export const RALPH_SESSION_RANGE_ID_PREFIX = 'ralph-session:';
export const FOR_EACH_RUN_RANGE_ID_PREFIX = 'for-each-run:';
export const MAP_REDUCE_RUN_RANGE_ID_PREFIX = 'map-reduce-run:';

export type HistoryRangeRow =
    | { kind: 'task'; id: string; ralphSessionId?: string; ralphSessionSubIds?: string[]; forEachRunId?: string; forEachRunSubIds?: string[]; mapReduceRunId?: string; mapReduceRunSubIds?: string[] }
    | { kind: 'ralph-session'; id: string; sessionId: string; subIds: string[] }
    | { kind: 'for-each-run'; id: string; runId: string; subIds: string[] }
    | { kind: 'map-reduce-run'; id: string; runId: string; subIds: string[] }
    // A collapsed spawned-conversation node (the tree root, or a collapsed inner
    // node): its own row stands in for the whole hidden subtree, so `id` is the
    // node's real chat id and `subIds` are that node + every descendant. Expanded
    // spawned nodes are plain `task` rows instead (see buildHistoryRangeRows).
    | { kind: 'spawned-tree'; id: string; rootProcessId: string; subIds: string[] };

type HistoryRangeInput = HistoryRangeRow | any;

function isRalphSessionEntry(entry: any): entry is RalphSession {
    return entry?.kind === 'ralph-session'
        && typeof entry.sessionId === 'string'
        && Array.isArray(entry.iterations);
}

function isForEachRunEntry(entry: any): entry is ForEachRunGroup {
    return entry?.kind === 'for-each-run'
        && typeof entry.runId === 'string'
        && Array.isArray(entry.children);
}

function isMapReduceRunEntry(entry: any): entry is MapReduceRunGroup {
    return entry?.kind === 'map-reduce-run'
        && typeof entry.runId === 'string'
        && Array.isArray(entry.children);
}

function isHistoryRangeRow(entry: any): entry is HistoryRangeRow {
    return (entry?.kind === 'task' && typeof entry.id === 'string')
        || (entry?.kind === 'ralph-session' && typeof entry.id === 'string' && Array.isArray(entry.subIds))
        || (entry?.kind === 'for-each-run' && typeof entry.id === 'string' && Array.isArray(entry.subIds))
        || (entry?.kind === 'map-reduce-run' && typeof entry.id === 'string' && Array.isArray(entry.subIds))
        // A spawned-tree range ROW carries `id` + `subIds`; a spawned-tree
        // grouping ENTRY (below) carries `root`/`rootProcessId` instead, so the
        // two never collide when a built row is re-normalized.
        || (entry?.kind === 'spawned-tree' && typeof entry.id === 'string' && Array.isArray(entry.subIds));
}

/**
 * A spawned-tree GROUPING entry (from spawned-tree-grouping), as opposed to a
 * built spawned-tree range ROW. The grouping entry always carries a `root`
 * node; the range row never does. buildHistoryRangeRows must distinguish them
 * because both share `kind === 'spawned-tree'`.
 */
function isSpawnedTreeGroupEntry(entry: any): entry is SpawnedTreeEntry {
    return entry?.kind === 'spawned-tree'
        && typeof entry.rootProcessId === 'string'
        && entry.root != null
        && typeof entry.root === 'object';
}

/** Pre-order chat ids for a spawned-tree node's subtree (the node, then its descendants). */
function collectSpawnedNodeSubtreeIds(node: SpawnedTreeNode): string[] {
    const ids: string[] = [];
    const walk = (current: SpawnedTreeNode) => {
        const id = getSpawnedNodeId(current);
        if (id) ids.push(id);
        for (const child of current.children) walk(child);
    };
    walk(node);
    return ids;
}

/**
 * Emit range rows for a spawned-tree node, mirroring exactly what SpawnedTreeRow
 * renders: a node whose children are collapsed becomes a single `spawned-tree`
 * unit row standing in for its whole hidden subtree; an expanded (or leaf) node
 * becomes a plain `task` row and we recurse into any visible children. This keeps
 * the visible-row set === the range-row set at every collapse depth.
 */
function pushSpawnedTreeRangeRows(
    node: SpawnedTreeNode,
    rootProcessId: string,
    collapsedSpawnedIds: ReadonlySet<string>,
    rows: HistoryRangeRow[],
): void {
    const nodeId = getSpawnedNodeId(node);
    if (!nodeId) return;
    const hasChildren = node.children.length > 0;
    if (hasChildren && collapsedSpawnedIds.has(nodeId)) {
        rows.push({ kind: 'spawned-tree', id: nodeId, rootProcessId, subIds: collectSpawnedNodeSubtreeIds(node) });
        return;
    }
    rows.push({ kind: 'task', id: nodeId });
    if (hasChildren) {
        for (const child of node.children) {
            pushSpawnedTreeRangeRows(child, rootProcessId, collapsedSpawnedIds, rows);
        }
    }
}

export function getRalphSessionRangeId(sessionId: string): string {
    return `${RALPH_SESSION_RANGE_ID_PREFIX}${sessionId}`;
}

export function getForEachRunRangeId(runId: string): string {
    return `${FOR_EACH_RUN_RANGE_ID_PREFIX}${runId}`;
}

export function getMapReduceRunRangeId(runId: string): string {
    return `${MAP_REDUCE_RUN_RANGE_ID_PREFIX}${runId}`;
}

export function getRalphSessionSubIds(session: RalphSession): string[] {
    return [session.grillingProcess?.id, ...session.iterations.map((iteration: any) => iteration?.id)]
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export function getForEachRunSubIds(group: ForEachRunGroup): string[] {
    const ids = [group.run.generationProcessId, ...group.children.map((child: any) => child?.id)]
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && id !== group.runId);
    return Array.from(new Set(ids));
}

export function getMapReduceRunSubIds(group: MapReduceRunGroup): string[] {
    const ids = [group.run.generationProcessId, ...group.children.map((child: any) => child?.id)]
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && id !== group.runId);
    return Array.from(new Set(ids));
}

export interface GroupSelectionState {
    /** Every child sub-id is in the active selection. */
    isFullySelected: boolean;
    /** At least one — but not all — child sub-ids are selected. */
    isPartiallySelected: boolean;
}

/**
 * Resolve a group header's selection state from its child sub-ids and the
 * active history selection (AC-06). A group is *fully* selected when every
 * child is in the selection, *partially* selected when some — but not all —
 * are, and neither when the group is empty or has no selected children. The
 * two flags are mutually exclusive so a header can render at most one of the
 * full / partial indicators.
 */
export function resolveGroupSelectionState(
    subIds: string[],
    selectedIds: ReadonlySet<string>,
): GroupSelectionState {
    if (subIds.length === 0) {
        return { isFullySelected: false, isPartiallySelected: false };
    }
    let selectedCount = 0;
    for (const id of subIds) {
        if (selectedIds.has(id)) { selectedCount++; }
    }
    const isFullySelected = selectedCount === subIds.length;
    return {
        isFullySelected,
        isPartiallySelected: selectedCount > 0 && !isFullySelected,
    };
}

export function buildHistoryRangeRows(
    entries: HistoryRangeInput[],
    expandedRalphSessionIds: ReadonlySet<string>,
    expandedForEachRunIds: ReadonlySet<string> = new Set(),
    expandedMapReduceRunIds: ReadonlySet<string> = new Set(),
    // Spawned trees are default-EXPANDED, so this is a set of COLLAPSED node ids
    // (mirroring collapsedSpawnedIds), unlike the expanded-id sets above.
    collapsedSpawnedIds: ReadonlySet<string> = new Set(),
): HistoryRangeRow[] {
    const rows: HistoryRangeRow[] = [];
    for (const entry of entries) {
        if (isRalphSessionEntry(entry)) {
            const subIds = getRalphSessionSubIds(entry);
            if (subIds.length === 0) continue;
            if (expandedRalphSessionIds.has(entry.sessionId)) {
                for (const id of subIds) {
                    rows.push({ kind: 'task', id, ralphSessionId: entry.sessionId, ralphSessionSubIds: subIds });
                }
            } else {
                rows.push({
                    kind: 'ralph-session',
                    id: getRalphSessionRangeId(entry.sessionId),
                    sessionId: entry.sessionId,
                    subIds,
                });
            }
            continue;
        }
        if (isForEachRunEntry(entry)) {
            const subIds = getForEachRunSubIds(entry);
            if (subIds.length === 0) continue;
            if (expandedForEachRunIds.has(entry.runId)) {
                for (const id of subIds) {
                    rows.push({ kind: 'task', id, forEachRunId: entry.runId, forEachRunSubIds: subIds });
                }
            } else {
                rows.push({
                    kind: 'for-each-run',
                    id: getForEachRunRangeId(entry.runId),
                    runId: entry.runId,
                    subIds,
                });
            }
            continue;
        }
        if (isMapReduceRunEntry(entry)) {
            const subIds = getMapReduceRunSubIds(entry);
            if (subIds.length === 0) continue;
            if (expandedMapReduceRunIds.has(entry.runId)) {
                for (const id of subIds) {
                    rows.push({ kind: 'task', id, mapReduceRunId: entry.runId, mapReduceRunSubIds: subIds });
                }
            } else {
                rows.push({
                    kind: 'map-reduce-run',
                    id: getMapReduceRunRangeId(entry.runId),
                    runId: entry.runId,
                    subIds,
                });
            }
            continue;
        }
        if (isSpawnedTreeGroupEntry(entry)) {
            pushSpawnedTreeRangeRows(entry.root, entry.rootProcessId, collapsedSpawnedIds, rows);
            continue;
        }
        if (isHistoryRangeRow(entry)) {
            rows.push(entry);
            continue;
        }
        if (typeof entry?.id === 'string' && entry.id.length > 0) {
            rows.push({ kind: 'task', id: entry.id });
        }
    }
    return rows;
}

function normalizeHistoryRangeRows(entries: HistoryRangeInput[]): HistoryRangeRow[] {
    return buildHistoryRangeRows(entries, new Set());
}

function getHistoryRangeRowSelectionIds(row: HistoryRangeRow): string[] {
    return row.kind === 'task' ? [row.id] : row.subIds;
}

function addHistoryRangeRowSelectionIds(row: HistoryRangeRow, selected: Set<string>): void {
    for (const id of getHistoryRangeRowSelectionIds(row)) selected.add(id);
}

function getHistoryRangeRowGroupRangeId(row: HistoryRangeRow): string | null {
    if (row.kind === 'ralph-session') return row.id;
    if (row.kind === 'for-each-run') return row.id;
    if (row.kind === 'map-reduce-run') return row.id;
    // Spawned-tree unit rows are self-contained endpoints: they carry their own
    // subtree in `subIds` and never snap-expand an anchored sub-range to a whole
    // group (unlike ralph/for-each/map-reduce children), so they expose no group
    // range id. Sub-conversations stay independently range-selectable.
    if (row.kind === 'spawned-tree') return null;
    if (row.ralphSessionId) return getRalphSessionRangeId(row.ralphSessionId);
    if (row.forEachRunId) return getForEachRunRangeId(row.forEachRunId);
    if (row.mapReduceRunId) return getMapReduceRunRangeId(row.mapReduceRunId);
    return null;
}

function getHistoryRangeRowGroupSubIds(row: HistoryRangeRow): string[] {
    if (row.kind === 'ralph-session' || row.kind === 'for-each-run' || row.kind === 'map-reduce-run') return row.subIds;
    if (row.kind === 'spawned-tree') return row.subIds;
    return row.ralphSessionSubIds ?? row.forEachRunSubIds ?? row.mapReduceRunSubIds ?? [];
}

function historyRangeRowMatchesId(row: HistoryRangeRow, id: string): boolean {
    return row.id === id
        || getHistoryRangeRowGroupRangeId(row) === id
        || (row.kind !== 'task' && row.subIds.includes(id));
}

function findHistoryRangeGroupForId(
    rows: HistoryRangeRow[],
    id: string,
    options: { endpointOnly?: boolean } = {},
): { rangeId: string; subIds: string[] } | null {
    for (const row of rows) {
        const rangeId = getHistoryRangeRowGroupRangeId(row);
        if (!rangeId) continue;
        const subIds = getHistoryRangeRowGroupSubIds(row);
        const isEndpoint = row.id === id || rangeId === id;
        if (isEndpoint || (!options.endpointOnly && subIds.includes(id))) {
            return { rangeId, subIds };
        }
    }
    return null;
}

export function resolveHistoryRangeSelection(
    entries: HistoryRangeInput[],
    anchorId: string,
    targetId: string,
): Set<string> | null {
    const rows = normalizeHistoryRangeRows(entries);
    let anchorIndex = rows.findIndex(row => historyRangeRowMatchesId(row, anchorId));
    const targetIndex = rows.findIndex(row => historyRangeRowMatchesId(row, targetId));
    if (anchorIndex === -1 || targetIndex === -1) return null;

    const anchorGroup = findHistoryRangeGroupForId(rows, anchorId);
    const targetEndpointGroup = findHistoryRangeGroupForId(rows, targetId, { endpointOnly: true });
    if (anchorGroup) {
        const boundaryIndex = rows.findIndex(row => getHistoryRangeRowGroupRangeId(row) === anchorGroup.rangeId);
        if (boundaryIndex !== -1) anchorIndex = boundaryIndex;
    }

    const [lo, hi] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    const selected = new Set<string>();
    for (const row of rows.slice(lo, hi + 1)) {
        addHistoryRangeRowSelectionIds(row, selected);
    }
    anchorGroup?.subIds.forEach(id => selected.add(id));
    targetEndpointGroup?.subIds.forEach(id => selected.add(id));
    return selected;
}

function resolveListEntryTimestamp(entry: any): number {
    if (entry.kind === 'for-each-run') return getForEachEntryTimestamp(entry);
    if (entry.kind === 'map-reduce-run') return getMapReduceEntryTimestamp(entry);
    if (entry.kind === 'spawned-tree') return getSpawnedEntryTimestamp(entry);
    if (entry.kind === 'group' || entry.kind === 'ralph-session') return entry.latestTimestamp;
    const ts = entry.lastActivityAt ?? entry.endTime ?? entry.completedAt ?? entry.startTime ?? entry.startedAt ?? entry.createdAt ?? 0;
    return typeof ts === 'number' ? ts : +new Date(ts);
}

function getEntryChildTasks(entry: any): any[] {
    if (entry?.kind === 'ralph-session') {
        return [entry.grillingProcess, ...entry.iterations].filter(Boolean);
    }
    if (entry?.kind === 'for-each-run') {
        return entry.children;
    }
    if (entry?.kind === 'map-reduce-run') {
        return entry.children;
    }
    if (entry?.kind === 'group') {
        return entry.children;
    }
    if (entry?.kind === 'spawned-tree') {
        return collectSpawnedEntryTasks(entry);
    }
    return [entry];
}

function entryHasUnseen(entry: any, unseenProcessIds?: Set<string>): boolean {
    if (!unseenProcessIds) return false;
    if (entry?.kind === 'group') {
        return entry.children.some((child: any) => unseenProcessIds.has(child.id));
    }
    if (entry?.kind === 'ralph-session' || entry?.kind === 'for-each-run' || entry?.kind === 'map-reduce-run' || entry?.kind === 'spawned-tree') {
        return !!entry.hasUnseen;
    }
    return unseenProcessIds.has(entry.id);
}

export interface ChatListPaneProps {
    running: any[];
    queued: any[];
    history: any[];
    isPaused: boolean;
    isPauseResumeLoading: boolean;
    isRefreshing: boolean;
    selectedTaskId: string | null;
    isMobile: boolean;
    now: number;
    workspaceId?: string;
    /** Set of process IDs with unseen activity (bold + dot indicator). */
    unseenProcessIds?: Set<string>;
    /**
     * Set of process / task IDs whose AI is currently awaiting interactive user
     * input (an `ask_user` tool call is pending). When a running row's id or
     * processId is in this set, the row swaps the "Thinking" indicator for a
     * prominent "Needs input" affordance and uses an amber accent so the user
     * can spot it at a glance.
     */
    awaitingInputProcessIds?: Set<string>;
    /** Mark all completed tasks as read (receives the currently-filtered task list). */
    onMarkAllRead?: (tasks: any[]) => void;
    /** Mark a single completed task as read. */
    onMarkRead?: (taskId: string) => void;
    /** Mark a single completed task as unread. */
    onMarkUnread?: (taskId: string) => void;
    onSelectTask: (id: string, task?: any) => void;
    onPauseResume: (options?: QueuePauseOptions) => void;
    /** Epoch milliseconds or ISO timestamp when the queue pause expires. */
    pausedUntil?: number | string;
    /** Whether the autopilot scheduler is currently paused. */
    isAutopilotPaused?: boolean;
    /** Epoch milliseconds or ISO timestamp when the autopilot pause expires. */
    autopilotPausedUntil?: number | string;
    /** True while the pause/resume autopilot request is in-flight. */
    isAutopilotPauseLoading?: boolean;
    /** Toggle autopilot pause/resume. */
    onPauseResumeAutopilot?: (options?: QueuePauseOptions) => void;
    /** Why the ALL queue is currently paused — 'manual' (user) or 'quota' (watcher). */
    pauseSource?: 'manual' | 'quota';
    /** Why the autopilot queue is currently paused — 'manual' (user) or 'quota' (watcher). */
    autopilotPauseSource?: 'manual' | 'quota';
    onRefresh: () => void;
    onOpenDialog: () => void;
    fetchQueue: () => Promise<void>;
    /** Reason for the current pause (present when auto-paused due to task failure). */
    pauseReason?: { taskId: string; displayName: string; failedAt: string };
    /** True when there are more completed tasks to load from the server. */
    hasMore?: boolean;
    /** True while a "Load more" request is in-flight. */
    loadingMore?: boolean;
    /** Callback to load the next page of completed tasks. */
    onLoadMore?: () => void;
    /** Server-side FTS5 search results (null = not searching, [] = no results). */
    searchResults?: any[] | null;
    /** True while server search is in-flight. */
    searchLoading?: boolean;
    /** Total number of server-side search matches. */
    searchTotal?: number;
    /** Whether there are more search results to load. */
    searchHasMore?: boolean;
    /** True while loading more search results. */
    searchLoadingMore?: boolean;
    /** Callback when user types in search — drives server-side search from parent. */
    onSearchQueryChange?: (query: string) => void;
    /** Callback to load more server-side search results. */
    onLoadMoreSearchResults?: () => void;
    /** Active tab mode — 'chats' shows a flat time-sorted chat list; 'tasks' shows queue-style sections. */
    activeTab?: ActivityTabMode;
    /** Deselect the current task so the inline NewChatArea is shown. */
    onNewChat?: () => void;
    /** When set, the matching ralph-session row is highlighted as selected. */
    selectedRalphSessionId?: string | null;
    /** Called when the user clicks a Ralph session row body (right-pane switch). */
    onSelectRalphSession?: (sessionId: string) => void;
    /** Persisted For Each runs to surface as parent groups. */
    forEachRuns?: ForEachRunSummary[];
    /** Persisted Map Reduce runs to surface as parent groups. */
    mapReduceRuns?: MapReduceRunSummary[];
    /** Workspace-scoped parent-row group pins for Ralph sessions, For Each runs, and Map Reduce runs. */
    groupPins?: ProcessGroupPin[];
    /** Toggle a workspace-scoped parent-row group pin without mutating child process pins. */
    onSetGroupPin?: (type: ProcessGroupPinType, groupId: string, pinned: boolean) => void;
    /** When set, the matching For Each run row is highlighted as selected. */
    selectedForEachRunId?: string | null;
    /** Called when the user clicks a For Each run row body (right-pane switch). */
    onSelectForEachRun?: (runId: string) => void;
    /** When set, the matching Map Reduce run row is highlighted as selected. */
    selectedMapReduceRunId?: string | null;
    /** Called when the user clicks a Map Reduce run row body (right-pane switch). */
    onSelectMapReduceRun?: (runId: string) => void;
    /** Keyboard cursor highlight id from useChatPaneNavigation. May differ from selectedTaskId. */
    cursorTaskId?: string | null;
    /**
     * When set (schedules-in-slide flag ON + a `#repos/{ws}/schedules...` route
     * is active), forces the "Scheduled" (`loops`) slide active so a
     * deep-linked or redirected schedule surface lands on the right segment
     * (AC-03 deep-link / AC-04 redirect). Applied once when it changes to a
     * value, leaving the user free to switch segments afterward. Omitted (flag
     * OFF / non-schedule routes) → the persisted scope is used unchanged.
     */
    forceScope?: ActivityScope;
}

function formatMetadataText(task: any): string {
    return buildRows(task).map(r => `${r.label}: ${r.value}`).join('\n');
}

function pauseUntilMs(value: number | string | undefined): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function formatPauseRemaining(value: number | string | undefined, now: number): string | undefined {
    const until = pauseUntilMs(value);
    if (until === undefined) return undefined;
    const remainingMs = Math.max(0, until - now);
    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

/** Renders a float hour count as "Xh Ym" (minutes precision; sub-minute remainders dropped). */
function formatPauseDurationLabel(durationHours: number): string {
    const totalMinutes = Math.max(1, Math.floor(durationHours * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

function formatPauseResumeTime(value: number | string | undefined): string | undefined {
    const until = pauseUntilMs(value);
    if (until === undefined) return undefined;
    return new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function PauseDurationMenu({
    testIdScope,
    onSelect,
    quotaData,
}: {
    testIdScope: string;
    onSelect: (options?: QueuePauseOptions) => void;
    quotaData?: AgentProvidersQuotaResponse | null;
}) {
    const now = Date.now();

    const [customOpen, setCustomOpen] = useState(false);
    const [customValue, setCustomValue] = useState('');
    const [customError, setCustomError] = useState<string | null>(null);

    const submitCustom = () => {
        const parsed = Number(customValue.trim() || NaN);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24) {
            setCustomError('Enter a number of hours greater than 0 and at most 24');
            return;
        }
        setCustomError(null);
        onSelect({ durationHours: parsed });
    };

    const mostConstrained = getMostConstrainedProviderQuota(quotaData);
    const mostConstrainedResetDate = mostConstrained?.quotaType.resetDate;
    const mostConstrainedResetMs = mostConstrainedResetDate ? Date.parse(mostConstrainedResetDate) : undefined;
    const mostConstrainedResetFuture =
        mostConstrainedResetMs !== undefined && Number.isFinite(mostConstrainedResetMs) && mostConstrainedResetMs > now
            ? mostConstrainedResetMs
            : undefined;

    // max(resetDate) across constrained (<50%) providers for "until all recover"
    let allConstrainedResetMs: number | undefined;
    for (const provider of quotaData?.providers ?? []) {
        if (provider.error) continue;
        const tightest = getTightestFiniteQuotaType(provider.quotaTypes);
        if (!tightest) continue;
        if (getQuotaPercent(tightest.remainingPercentage) >= 50) continue;
        if (!tightest.resetDate) continue;
        const ms = Date.parse(tightest.resetDate);
        if (!Number.isFinite(ms) || ms <= now) continue;
        if (allConstrainedResetMs === undefined || ms > allConstrainedResetMs) allConstrainedResetMs = ms;
    }

    return (
        <div
            className="absolute right-0 top-full mt-1 z-30 min-w-52 rounded border border-[#d0d0d0] dark:border-[#3f3f46] bg-white dark:bg-[#252526] shadow-lg p-1 text-xs"
            data-testid={`pause-duration-menu-${testIdScope}`}
            onClick={(e) => e.stopPropagation()}
        >
            {quotaData && quotaData.providers.some(p => !p.error && getTightestFiniteQuotaType(p.quotaTypes)) && (
                <div
                    className="px-2 pt-1 pb-1.5 mb-1 border-b border-[#e8e8e8] dark:border-[#3f3f46]"
                    data-testid={`pause-duration-quota-strip-${testIdScope}`}
                >
                    {quotaData.providers.map(provider => {
                        if (provider.error) return null;
                        const tightest = getTightestFiniteQuotaType(provider.quotaTypes);
                        if (!tightest) return null;
                        const pct = getQuotaPercent(tightest.remainingPercentage);
                        const barColor = pct < 25 ? '#d1242f' : pct < 50 ? '#bf8700' : '#1a7f37';
                        const countdown = formatPauseRemaining(tightest.resetDate, now);
                        return (
                            <div key={provider.id} className="flex items-center gap-1.5 py-0.5" data-testid={`pause-duration-quota-row-${provider.id}`}>
                                <span className="w-12 shrink-0 text-[10px] text-[#6e6e6e] dark:text-[#999] capitalize">{provider.id}</span>
                                <div className="flex-1 h-1 rounded-full bg-[#e8e8e8] dark:bg-[#3f3f46] overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                                </div>
                                <span className="w-8 text-right text-[10px] font-medium" style={{ color: barColor }}>{pct}%</span>
                                {countdown && (
                                    <span className="text-[10px] text-[#6e6e6e] dark:text-[#999] whitespace-nowrap">{countdown}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            <button
                type="button"
                className="block w-full text-left px-2 py-1.5 rounded text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                onClick={() => onSelect()}
                data-testid={`pause-duration-${testIdScope}-indefinite`}
            >
                Until resumed
            </button>
            {PAUSE_HOUR_PRESETS.map(hours => (
                <button
                    key={hours}
                    type="button"
                    className="block w-full text-left px-2 py-1.5 rounded text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    onClick={() => onSelect({ durationHours: hours })}
                    data-testid={`pause-duration-${testIdScope}-${hours}h`}
                >
                    {hours} {hours === 1 ? 'hour' : 'hours'}
                </button>
            ))}
            {!customOpen ? (
                <button
                    type="button"
                    className="block w-full text-left px-2 py-1.5 rounded text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    onClick={() => setCustomOpen(true)}
                    data-testid={`pause-duration-${testIdScope}-custom`}
                >
                    Custom…
                </button>
            ) : (
                <div className="px-2 py-1.5" data-testid={`pause-duration-${testIdScope}-custom-editor`}>
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            min={0}
                            max={24}
                            step="any"
                            autoFocus
                            value={customValue}
                            onChange={(e) => { setCustomValue(e.target.value); setCustomError(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } }}
                            placeholder="Hours"
                            className="w-16 px-1.5 py-0.5 rounded border border-[#d0d0d0] dark:border-[#3f3f46] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                            data-testid={`pause-duration-${testIdScope}-custom-input`}
                        />
                        <span className="text-[#6e6e6e] dark:text-[#999]">hours</span>
                        <button
                            type="button"
                            className="px-1.5 py-0.5 rounded text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                            onClick={submitCustom}
                            title="Apply custom duration"
                            data-testid={`pause-duration-${testIdScope}-custom-submit`}
                        >
                            ✓
                        </button>
                    </div>
                    {customError && (
                        <div
                            className="mt-1 text-[10px] text-[#d1242f] dark:text-[#f85149]"
                            data-testid={`pause-duration-${testIdScope}-custom-error`}
                        >
                            {customError}
                        </div>
                    )}
                </div>
            )}
            {mostConstrained && mostConstrainedResetFuture !== undefined && (
                <>
                    <div className="my-1 border-t border-[#e8e8e8] dark:border-[#3f3f46]" />
                    <button
                        type="button"
                        className="block w-full text-left px-2 py-1.5 rounded text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                        onClick={() => onSelect({ until: mostConstrainedResetFuture })}
                        data-testid={`pause-duration-${testIdScope}-until-provider-resets`}
                    >
                        <span className="block">
                            Until {mostConstrained.provider.id} {formatQuotaTypeLabel(mostConstrained.quotaType.type)} resets
                        </span>
                        <span className="block text-[10px] text-[#6e6e6e] dark:text-[#999]">
                            {formatPauseRemaining(mostConstrainedResetFuture, now)} left
                        </span>
                    </button>
                </>
            )}
            {allConstrainedResetMs !== undefined &&
                (mostConstrainedResetFuture === undefined || allConstrainedResetMs !== mostConstrainedResetFuture) && (
                <button
                    type="button"
                    className="block w-full text-left px-2 py-1.5 rounded text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    onClick={() => onSelect({ until: allConstrainedResetMs })}
                    data-testid={`pause-duration-${testIdScope}-until-all-recover`}
                >
                    <span className="block">Until all quotas recover</span>
                    <span className="block text-[10px] text-[#6e6e6e] dark:text-[#999]">
                        {formatPauseRemaining(allConstrainedResetMs, now)} left
                    </span>
                </button>
            )}
        </div>
    );
}

export function ChatListPane({
    running,
    queued,
    history,
    isPaused,
    isPauseResumeLoading,
    isRefreshing,
    selectedTaskId,
    isMobile,
    now,
    workspaceId,
    unseenProcessIds,
    awaitingInputProcessIds,
    onMarkAllRead,
    onMarkRead,
    onMarkUnread,
    onSelectTask,
    onPauseResume,
    pausedUntil,
    isAutopilotPaused,
    autopilotPausedUntil,
    isAutopilotPauseLoading,
    onPauseResumeAutopilot,
    pauseSource,
    autopilotPauseSource,
    onRefresh,
    onOpenDialog,
    fetchQueue,
    pauseReason,
    hasMore,
    loadingMore,
    onLoadMore,
    searchResults,
    searchLoading,
    searchTotal,
    searchHasMore,
    searchLoadingMore,
    onSearchQueryChange,
    onLoadMoreSearchResults,
    activeTab,
    onNewChat,
    selectedRalphSessionId,
    onSelectRalphSession,
    forEachRuns = [],
    mapReduceRuns = [],
    groupPins = EMPTY_GROUP_PINS,
    onSetGroupPin,
    selectedForEachRunId,
    onSelectForEachRun,
    selectedMapReduceRunId,
    onSelectMapReduceRun,
    cursorTaskId,
    forceScope,
}: ChatListPaneProps) {
    const { state: queueState } = useQueue();
    const isTaskSubmitting = queueState.isTaskSubmitting;

    const { quotaData } = useAgentProvidersQuota();

    // Quota risk for the pause pills — computed once so both pills share the same value.
    const pillMostConstrained = getMostConstrainedProviderQuota(quotaData);
    const pillRemainingPercent = pillMostConstrained?.remainingPercent ?? 100;
    const pillRiskClass = getQuotaRiskClass(pillRemainingPercent);

    // Desktop-only left-panel double-click → pop-out (see onDoubleClick below).
    // The per-row useChatWindowActions hook can't be called inside the render
    // loop, so grab markPoppedOut + addToast once here and call the shared
    // openChatPopOut helper directly.
    const { markPoppedOut } = usePopOut();
    const toastCtx = useContext(ToastContext);

    // Per-clone client (AC-07): list-row queue/history/summarize/rename actions
    // target this clone's server. workspaceId may be undefined (e.g. floating
    // panes) → default origin client, unchanged.
    const cloneClient = useCocClient(workspaceId);

    /** Check if a task is the currently selected one (processId-aware). */
    const isSelected = useCallback((taskId: string): boolean => {
        if (!selectedTaskId) return false;
        if (taskId === selectedTaskId) return true;
        // selectedTaskId is a processId; check if bare taskId matches via prefix
        if (!isQueueProcessId(taskId) && toQueueProcessId(taskId) === selectedTaskId) return true;
        return false;
    }, [selectedTaskId]);

    const { state: appState } = useApp();
    /**
     * The activity tab no longer renders a type-filter dropdown — chats and
     * automations are surfaced through the scope segmented control instead.
     * `excludedTypes` is still read from `AppContext` so any filters persisted
     * server-side via `SET_WELCOME_PREFERENCES` remain applied.
     */
    const excludedTypes = useMemo(() => new Set(appState.myWorkExcludedTypes), [appState.myWorkExcludedTypes]);

    // Fetch all crons server-wide for inline indicators and the "Scheduled" scope tab.
    const { cronStateByProcess, processIdsWithCrons, cronProcessCount } = useAllCrons();
    const cronEnabled = isCronEnabled();

    // Pin / archive state. Read before the folder block below, which needs the
    // archived set to keep an all-archived folder on screen at count 0 (AC-09).
    const { pinnedChatIds, archivedChatIds, pinChat: onPinChat, unpinChat: onUnpinChat, archiveChat: onArchiveChat, unarchiveChat: onUnarchiveChat, archiveChats: onArchiveChats, unarchiveChats: onUnarchiveChats } = useChatPrefs();

    // ── Chat folders (AC-04) ───────────────────────────────────────────────
    // Flag-gated end to end: with `features.chatFolders` off the fetch never
    // runs, the maps stay empty, and every derivation below degrades to the
    // list exactly as it renders today.
    const chatFoldersEnabled = useChatFoldersEnabled();
    const { folders: chatFolders, setFolders: setChatFolders, refresh: refreshChatFolders } = useChatFolders(workspaceId, chatFoldersEnabled);
    /**
     * `processId -> folderId`, fetched workspace-scoped through the clone
     * registry — the queue and history endpoints that feed the list rows do not
     * carry the field, and the global `appState.processes` index only ever holds
     * page-origin processes, so a remote SSH workspace's membership would read
     * as empty from it. It is a field lookup on the summaries, not a join
     * against a folder-members endpoint.
     */
    const {
        folderIdByProcess,
        refresh: refreshFolderMembership,
        applyOverride: applyFolderMembershipOverride,
    } = useChatFolderMembership(workspaceId, chatFoldersEnabled);
    /**
     * `"<type>:<groupId>" -> folderId` for whole chat *groups* — ralph sessions,
     * spawned trees, for-each and map-reduce runs. Kept separate from the
     * per-chat map because a group is filed as a unit against a server-side
     * sidecar keyed on the group, which is what lets a child enqueued after the
     * move inherit the folder with no extra write.
     */
    const {
        groupFolderMap,
        refresh: refreshGroupFolders,
        moveGroupToFolder,
    } = useGroupFolders(workspaceId, chatFoldersEnabled, { onError: message => { toastCtx?.addToast?.(message, 'error'); } });
    const foldersById = useMemo(() => new Map(chatFolders.map(f => [f.id, f])), [chatFolders]);
    const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => loadCollapsedChatFolderIds(workspaceId));
    // Re-seed when the workspace changes; collapse state is per-workspace, like
    // the folder set itself.
    useEffect(() => {
        setCollapsedFolderIds(loadCollapsedChatFolderIds(workspaceId));
    }, [workspaceId]);
    const toggleFolderCollapsed = useCallback((folderId: string) => {
        setCollapsedFolderIds(prev => toggleCollapsedChatFolder(workspaceId, prev, folderId));
    }, [workspaceId]);
    const [showFolders, setShowFolders] = useState(true);

    /**
     * The one seam every optimistic membership change goes through: layer the
     * move onto the membership map so it is visible before the next
     * workspace-scoped summaries fetch reconciles it.
     */
    const handleProcessFoldersChanged = useCallback((processIds: string[], folderId: string | null) => {
        applyFolderMembershipOverride(processIds, folderId);
    }, [applyFolderMembershipOverride]);
    const handleFolderError = useCallback((message: string) => { toastCtx?.addToast?.(message, 'error'); }, [toastCtx]);
    /** Folders and membership reconcile together — a failed write rolls both back against the server. */
    const refreshChatFoldersAndMembership = useCallback(() => {
        refreshChatFolders();
        refreshFolderMembership();
        // Deleting a folder unfiles the groups keyed to it as well, so the
        // group map has to be re-read alongside the per-chat membership.
        refreshGroupFolders();
    }, [refreshChatFolders, refreshFolderMembership, refreshGroupFolders]);

    // ── Folder mutations (AC-05) ───────────────────────────────────────────
    // Create / rename / recolor / delete, with a single-level undo. The
    // inline-editing state lives in the hook so this renderer only wires it up.
    const chatFolderMutations = useChatFolderMutations({
        workspaceId,
        setFolders: setChatFolders,
        refresh: refreshChatFoldersAndMembership,
        folderIdByProcess,
        folders: chatFolders,
        // Undo re-files the remembered members into a brand-new folder id, so
        // the process-summary index has to be patched or the tree would keep
        // pointing every restored row at the folder that no longer exists.
        onProcessFoldersChanged: handleProcessFoldersChanged,
        onError: handleFolderError,
    });

    // ── Folder archive (AC-09) ─────────────────────────────────────────────
    // Archiving is a chat preference, so membership rows are untouched and an
    // unarchived chat comes back to the folder it never left.
    const chatFolderArchive = useChatFolderArchive({
        folderIdByProcess,
        pinnedChatIds,
        archivedChatIds,
        archiveChats: onArchiveChats,
        unarchiveChats: onUnarchiveChats,
    });

    // ── Folder assignment (AC-06) ──────────────────────────────────────────
    const { moveToFolder } = useChatFolderAssignment({
        workspaceId,
        folderIdByProcess,
        onProcessFoldersChanged: handleProcessFoldersChanged,
        onError: handleFolderError,
    });
    /**
     * Rows waiting on "+ New folder…" — the submenu opens the same inline create
     * row AC-05 already owns, and the ids are filed once that row commits. A
     * cancelled create therefore moves nothing.
     */
    const pendingFileIdsRef = useRef<string[]>([]);
    /**
     * The group waiting on "+ New folder…". Kept apart from the id list because
     * a group is filed with one write against its own key (AC-03), never as a
     * batch over its children.
     */
    const pendingFileGroupRef = useRef<GroupFolderTarget | null>(null);
    const startCreateFolderAndFile = useCallback((ids: readonly string[]) => {
        pendingFileIdsRef.current = [...ids];
        pendingFileGroupRef.current = null;
        chatFolderMutations.startCreate();
    }, [chatFolderMutations]);
    const startCreateFolderAndFileGroup = useCallback((target: GroupFolderTarget) => {
        pendingFileIdsRef.current = [];
        pendingFileGroupRef.current = target;
        chatFolderMutations.startCreate();
    }, [chatFolderMutations]);
    const handleCommitFolderCreate = useCallback(async (name: string, color: ChatFolderColor) => {
        const ids = pendingFileIdsRef.current;
        const group = pendingFileGroupRef.current;
        pendingFileIdsRef.current = [];
        pendingFileGroupRef.current = null;
        const folder = await chatFolderMutations.commitCreate(name, color);
        if (!folder) {return;}
        if (group) {
            await moveGroupToFolder(group.type, group.groupId, folder.id);
        } else if (ids.length > 0) {
            await moveToFolder(ids, folder.id);
        }
    }, [chatFolderMutations, moveToFolder, moveGroupToFolder]);
    const handleCancelFolderCreate = useCallback(() => {
        pendingFileIdsRef.current = [];
        pendingFileGroupRef.current = null;
        chatFolderMutations.cancelCreate();
    }, [chatFolderMutations]);
    const isDuplicateFolderName = useCallback(
        (name: string, excludeId?: string) => folderNameExists(chatFolders, name, excludeId),
        [chatFolders],
    );
    const collapseAllFolders = useCallback(() => {
        setCollapsedFolderIds(collapseAllChatFolders(workspaceId, chatFolders.map(f => f.id)));
    }, [workspaceId, chatFolders]);

    /** The folder ⋯ menu. Kept apart from the chat-row menu: different subject, different items. */
    const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
    const openFolderMenu = useCallback((folderId: string, event: React.MouseEvent) => {
        setFolderMenu({ x: event.clientX, y: event.clientY, folderId });
    }, []);
    const closeFolderMenu = useCallback(() => setFolderMenu(null), []);
    const folderMenuItems = useMemo<ContextMenuItem[]>(() => {
        if (!folderMenu) {return [];}
        const folder = chatFolders.find(f => f.id === folderMenu.folderId);
        if (!folder) {return [];}
        return [
            {
                label: 'Rename…',
                icon: '✏️',
                title: 'F2',
                onClick: () => chatFolderMutations.startRename(folder.id),
            },
            {
                label: 'Folder color',
                icon: '🎨',
                onClick: () => { /* submenu parent */ },
                children: CHAT_FOLDER_COLORS.map(color => ({
                    label: color.charAt(0).toUpperCase() + color.slice(1),
                    icon: color === folder.color ? '●' : '○',
                    onClick: () => { void chatFolderMutations.recolorFolder(folder.id, color); },
                })),
            },
            {
                label: 'Collapse all',
                icon: '⇱',
                onClick: collapseAllFolders,
            },
            { label: '', separator: true, onClick: () => {} },
            {
                // Disabled rather than hidden when there is nothing to archive:
                // an empty folder, or one holding only archived or pinned rows.
                label: 'Archive all chats',
                icon: '📥',
                disabled: !canArchiveFolder(chatFolderArchive.resolveTargets(folder.id)),
                title: 'Moves every chat in this folder to Archived; the folder stays',
                onClick: () => chatFolderArchive.requestArchiveAll(folder),
            },
            {
                label: 'Delete folder',
                icon: '🗑️',
                onClick: () => chatFolderMutations.requestDelete(folder.id, chatFolders),
            },
        ];
    }, [folderMenu, chatFolders, chatFolderMutations, chatFolderArchive, collapseAllFolders]);
    /**
     * The "Move to folder ▸" block for the *row* context menu (AC-06). Sits
     * after Pin and before Archive in every branch that renders it, and returns
     * nothing at all when the flag is off.
     */
    const buildMoveToFolderItems = useCallback((ids: readonly string[]): ContextMenuItem[] => {
        if (!chatFoldersEnabled || ids.length === 0) {return [];}
        const children: ContextMenuItem[] = [
            ...chatFolders.map(folder => ({
                label: folder.name,
                icon: '●',
                onClick: () => { void moveToFolder(ids, folder.id); },
            })),
            ...(chatFolders.length > 0 ? [{ label: '', separator: true, onClick: () => {} }] : []),
            {
                label: '+ New folder…',
                // The escape hatch must survive any filter query, or a user who
                // typed a name that matches nothing would have no way to make it.
                keepOnFilter: true,
                onClick: () => startCreateFolderAndFile(ids),
            },
        ];
        return [
            {
                label: buildMoveToFolderLabel(ids.length),
                icon: '🗂️',
                filterable: shouldShowFolderFilter(chatFolders.length),
                filterPlaceholder: 'Filter folders…',
                children,
                onClick: () => { /* submenu parent */ },
            },
            // Mixed selections get the item as soon as ANY row is filed; it is a
            // plain action, not a toggle, so it never has to reflect a mix.
            ...(anySelectionFiled(ids, folderIdByProcess) ? [{
                label: 'Remove from folder',
                icon: '↩',
                onClick: () => { void moveToFolder(ids, null); },
            }] : []),
        ];
    }, [chatFoldersEnabled, chatFolders, folderIdByProcess, moveToFolder, startCreateFolderAndFile]);
    /**
     * The same "Move to folder ▸" block for a whole *group* row (AC-03). Files
     * the group with one PATCH against `"<type>:<groupId>"` instead of a batch
     * over its children, which is what lets a child enqueued later inherit the
     * folder for free (AC-05).
     */
    const buildGroupMoveToFolderItems = useCallback((target: GroupFolderTarget): ContextMenuItem[] => {
        if (!chatFoldersEnabled) {return [];}
        const currentFolderId = groupFolderMap.get(getGroupFolderKey(target.type, target.groupId));
        const children: ContextMenuItem[] = [
            ...chatFolders.map(folder => ({
                label: folder.name,
                icon: '●',
                onClick: () => { void moveGroupToFolder(target.type, target.groupId, folder.id); },
            })),
            ...(chatFolders.length > 0 ? [{ label: '', separator: true, onClick: () => {} }] : []),
            {
                label: '+ New folder…',
                keepOnFilter: true,
                onClick: () => startCreateFolderAndFileGroup(target),
            },
        ];
        return [
            {
                label: buildMoveToFolderLabel(1),
                icon: '🗂️',
                filterable: shouldShowFolderFilter(chatFolders.length),
                filterPlaceholder: 'Filter folders…',
                children,
                onClick: () => { /* submenu parent */ },
            },
            ...(currentFolderId ? [{
                label: 'Remove from folder',
                icon: '↩',
                onClick: () => { void moveGroupToFolder(target.type, target.groupId, null); },
            }] : []),
        ];
    }, [chatFoldersEnabled, chatFolders, groupFolderMap, moveGroupToFolder, startCreateFolderAndFileGroup]);

    const sessionContextDragEnabled = isSessionContextAttachmentsEnabled();

    // AC-01: the desktop "+ New chat" button is a drop target for session-context
    // drags. A drop opens a fresh new-chat composer seeded with the dropped
    // item(s); the composer merges them via the existing attached-context path.
    const [newChatDropActive, setNewChatDropActive] = useState(false);
    const newChatDropDepthRef = useRef(0);

    const resetNewChatDropState = useCallback(() => {
        newChatDropDepthRef.current = 0;
        setNewChatDropActive(false);
    }, []);

    const handleNewChatDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
        if (!sessionContextDragEnabled || !dataTransferHasSessionContext(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        newChatDropDepthRef.current += 1;
        setNewChatDropActive(true);
    }, [sessionContextDragEnabled]);

    const handleNewChatDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
        if (!sessionContextDragEnabled || !dataTransferHasSessionContext(e.dataTransfer)) return;
        // preventDefault on dragover is required for the accepted MIME so the
        // browser fires a `drop` on this button.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setNewChatDropActive(true);
    }, [sessionContextDragEnabled]);

    const handleNewChatDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
        if (!sessionContextDragEnabled || !dataTransferHasSessionContext(e.dataTransfer)) return;
        newChatDropDepthRef.current = Math.max(0, newChatDropDepthRef.current - 1);
        if (newChatDropDepthRef.current === 0) {
            setNewChatDropActive(false);
        }
    }, [sessionContextDragEnabled]);

    const handleNewChatDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
        if (!sessionContextDragEnabled || !dataTransferHasSessionContext(e.dataTransfer)) return;
        e.preventDefault();
        resetNewChatDropState();
        const payloads = readSessionContextDropPayloads(e.dataTransfer);
        if (payloads.length === 0) return;
        // Buffer the items, then open the composer via the normal new-chat flow.
        // The composer drains the buffer and validates each item (workspace
        // alignment, dedupe, cap) before attaching — no auto-send.
        pushNewChatSeedContext(payloads);
        (onNewChat ?? onOpenDialog)?.();
    }, [sessionContextDragEnabled, resetNewChatDropState, onNewChat, onOpenDialog]);

    const [searchQuery, setSearchQueryRaw] = useState('');
    const [searchVisible, setSearchVisible] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const pauseMenuRef = useRef<HTMLDivElement>(null);

    // ── Folder drag and drop (AC-07) ───────────────────────────────────────
    // The list already hosts three drags: queue reorder, queue touch-reorder,
    // and session-context. Folder filing adds no fourth gesture — it rides the
    // chat-row drag with a second MIME, and only the targets are new. Every
    // handler below declines a drag that does not advertise a folder MIME, so
    // the queued section stays a reorder-only target and its handlers, which
    // already require `QUEUE_DRAG_MIME`, never see a folder payload they would
    // act on.
    const chatListAutoScroll = useChatListDragAutoScroll(containerRef, chatFoldersEnabled);
    const folderDnd = useChatFolderDragDrop({
        enabled: chatFoldersEnabled,
        workspaceId,
        folderIdByProcess,
        moveToFolder,
        // A dropped GROUP row files against its key with one write, never a
        // batch over its children (AC-04) — the same call the context menu makes.
        groupFolderByKey: groupFolderMap,
        moveGroupToFolder: (type, groupId, folderId) =>
            moveGroupToFolder(type as ProcessGroupFolderType, groupId, folderId),
        reorderFolders: chatFolderMutations.reorderFolders,
        onDragFinished: chatListAutoScroll.stop,
    });
    /** Spread onto every region a chat can be dragged out of a folder into. */
    const unfiledDropProps = useMemo(() => (chatFoldersEnabled ? {
        onDragOver: folderDnd.handleUnfiledDragOver,
        onDrop: folderDnd.handleUnfiledDrop,
        'data-drop-unfile': folderDnd.unfiledDropActive ? 'true' : undefined,
    } : {}), [chatFoldersEnabled, folderDnd.handleUnfiledDragOver, folderDnd.handleUnfiledDrop, folderDnd.unfiledDropActive]);

    /**
     * Activity-tab scope segmented control: filters by task source.
     *   - 'chat'  → chat tasks that are not scheduled runs
     *   - 'auto'  → automations (run-script / run-workflow) that are not scheduled runs
     *   - 'loops' → "Scheduled" scope: scheduled-job runs ∪ chats with a `/cron`
     *               (id kept as 'loops' for the persisted value + test ids)
     *   - 'all'   → no source filter
     * Persisted in localStorage so the user's choice survives reloads.
     * Default is 'all' to preserve the pre-existing behavior of showing every task.
     */
    const [activeScope, setActiveScopeState] = useState<ActivityScope>(() => {
        // A schedules route is the active surface on mount (deep-link / reload):
        // land on the Scheduled slide instead of the persisted scope.
        if (forceScope) return forceScope;
        if (typeof window === 'undefined') return 'all';
        try {
            const saved = localStorage.getItem('coc-activity-scope');
            if (saved === 'chat' || saved === 'auto' || saved === 'loops' || saved === 'all') return saved;
        } catch { /* ignore localStorage errors (e.g. private mode) */ }
        return 'all';
    });
    const setActiveScope = useCallback((next: ActivityScope) => {
        setActiveScopeState(next);
        try { localStorage.setItem('coc-activity-scope', next); } catch { /* ignore */ }
    }, []);

    // Force the "Scheduled" slide active when a schedules route becomes the
    // active surface (deep-link / redirect). Keyed on `forceScope`, so it fires
    // once when the value transitions (undefined → 'loops') and does NOT refire
    // while staying on the schedules family — the user can still switch segments
    // with a schedule open. No-op when `forceScope` is absent (flag OFF / other
    // routes), preserving the persisted-scope behavior for every other caller.
    useEffect(() => {
        if (forceScope) setActiveScope(forceScope);
    }, [forceScope, setActiveScope]);

    const setSearchQuery = useCallback((q: string) => {
        setSearchQueryRaw(q);
        onSearchQueryChange?.(q);
    }, [onSearchQueryChange]);

    const isServerSearchActive = searchResults != null;
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        taskId: string;
        taskStatus: 'running' | 'queued' | 'completed';
        bulkIds?: string[];
        ralphSession?: RalphSession;
        forEachRun?: ForEachRunGroup;
        mapReduceRun?: MapReduceRunGroup;
        groupPin?: GroupPinMenuTarget;
        /** Present when the row is a filable group; "Move to folder" then files the group (AC-03). */
        groupFolder?: GroupFolderTarget;
    } | null>(null);
    const [insertingPauseAt, setInsertingPauseAt] = useState<number | null>(null);
    const [pauseMarkerMenuIndex, setPauseMarkerMenuIndex] = useState<number | null>(null);
    const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
    const [anchorHistoryId, setAnchorHistoryId] = useState<string | null>(null);
    const [summarizeDialogOpen, setSummarizeDialogOpen] = useState(false);
    const [summarizeDialogIds, setSummarizeDialogIds] = useState<string[]>([]);
    const [renameTarget, setRenameTarget] = useState<{ taskId: string; title: string } | null>(null);
    const [pauseMenuScope, setPauseMenuScope] = useState<PauseMenuScope | null>(null);
    const pauseMarkerMenuRef = useRef<HTMLDivElement | null>(null);
    const queuePauseRemaining = formatPauseRemaining(pausedUntil, now);
    const autopilotPauseRemaining = formatPauseRemaining(autopilotPausedUntil, now);
    const queuePauseResumeTime = formatPauseResumeTime(pausedUntil);


    const selectPauseDuration = useCallback((scope: PauseMenuScope, options?: QueuePauseOptions) => {
        if (scope === 'all') {
            onPauseResume(options);
        } else {
            onPauseResumeAutopilot?.(options);
        }
        setPauseMenuScope(null);
    }, [onPauseResume, onPauseResumeAutopilot]);

    useEffect(() => {
        if (!pauseMenuScope) return;
        function handleOutsideInteraction(e: MouseEvent | TouchEvent) {
            if (pauseMenuRef.current && !pauseMenuRef.current.contains(e.target as Node)) {
                setPauseMenuScope(null);
            }
        }
        document.addEventListener('mousedown', handleOutsideInteraction);
        document.addEventListener('touchstart', handleOutsideInteraction);
        return () => {
            document.removeEventListener('mousedown', handleOutsideInteraction);
            document.removeEventListener('touchstart', handleOutsideInteraction);
        };
    }, [pauseMenuScope]);

    useEffect(() => {
        if (pauseMarkerMenuIndex === null) return;
        function handleOutsideInteraction(e: MouseEvent | TouchEvent) {
            if (pauseMarkerMenuRef.current && !pauseMarkerMenuRef.current.contains(e.target as Node)) {
                setPauseMarkerMenuIndex(null);
                setInsertingPauseAt(null);
            }
        }
        document.addEventListener('mousedown', handleOutsideInteraction);
        document.addEventListener('touchstart', handleOutsideInteraction);
        return () => {
            document.removeEventListener('mousedown', handleOutsideInteraction);
            document.removeEventListener('touchstart', handleOutsideInteraction);
        };
    }, [pauseMarkerMenuIndex]);

    const { taskCardDensity, historyGrouping } = useDisplaySettings();
    const isDense = taskCardDensity === 'dense';
    const groupPinKeys = useMemo(
        () => new Set(groupPins.map(pin => getGroupPinKey(pin.type, pin.groupId))),
        [groupPins],
    );
    const isGroupPinned = useCallback(
        (type: ProcessGroupPinType, groupId: string) => groupPinKeys.has(getGroupPinKey(type, groupId)),
        [groupPinKeys],
    );
    const setGroupPinned = useCallback((type: ProcessGroupPinType, groupId: string, pinned: boolean) => {
        onSetGroupPin?.(type, groupId, pinned);
    }, [onSetGroupPin]);

    useEffect(() => {
        setSearchQueryRaw('');
        onSearchQueryChange?.('');
        setSearchVisible(false);
    }, [workspaceId]);

    useEffect(() => {
        const root = containerRef.current;
        if (!root) return;
        const prev = root.querySelectorAll<HTMLElement>('[data-cursor="true"]');
        prev.forEach(el => {
            el.removeAttribute('data-cursor');
            el.classList.remove('outline', 'outline-1', 'outline-[#0078d4]/60');
        });
        if (!cursorTaskId) return;
        let target: HTMLElement | null = null;
        try {
            target = root.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(cursorTaskId)}"]`);
        } catch {
            target = null;
        }
        if (!target) return;
        target.setAttribute('data-cursor', 'true');
        target.classList.add('outline', 'outline-1', 'outline-[#0078d4]/60');
    }, [cursorTaskId, running, queued, history, searchResults]);

    // AC-01: Ctrl+F opens the list search, routed by keyboard focus through the
    // shared helper (yields to native find in the detail pane, bails when this
    // pane is hidden, and never steals focus from another visible search panel).
    useScopedFindShortcut(containerRef, () => {
        setSearchVisible(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
    });

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Focus tracking for the list shortcuts. `focusInList` is true when
            // the keydown originates from inside the chat-list pane; Ctrl+N gates
            // on `focusElsewhereWithChatOpen`.
            const target = e.target as Node | null;
            const focusInList = !!(target && containerRef.current?.contains(target));
            const focusElsewhereWithChatOpen = !focusInList && !!selectedTaskId;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey && !e.altKey) {
                // ⌘N / Ctrl+N — primary "New chat" shortcut. Only intercept when
                // the activity pane is visible and focus isn't in an open
                // conversation (so users editing a chat aren't disrupted).
                if (!containerRef.current || containerRef.current.offsetParent === null) return;
                if (focusElsewhereWithChatOpen) return;
                e.preventDefault();
                (onNewChat ?? onOpenDialog)?.();
            }
            if (e.key === 'Escape' && searchVisible) {
                setSearchQuery('');
                setSearchVisible(false);
            }
            if (e.key === 'Escape' && selectedHistoryIds.size > 0) {
                setSelectedHistoryIds(new Set());
                setAnchorHistoryId(null);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [searchVisible, onNewChat, onOpenDialog, selectedHistoryIds.size, selectedTaskId]);

    const allTasks = useMemo(
        () => [...running, ...queued.filter((t: any) => t.kind !== 'pause-marker'), ...history],
        [running, queued, history],
    );

    /** The off-screen node handed to `setDragImage`, removed on `dragend`. */
    const chatDragImageRef = useRef<HTMLElement | null>(null);

    // Lookups used to bundle a multi-selection into a single drag payload (AC-02).
    const taskById = useMemo(() => {
        const map = new Map<string, any>();
        for (const t of allTasks) {
            if (t && typeof t.id === 'string') map.set(t.id, t);
        }
        return map;
    }, [allTasks]);
    const runningIdSet = useMemo(() => new Set<string>(running.map((t: any) => t.id)), [running]);
    const queuedIdSet = useMemo(() => new Set<string>(queued.map((t: any) => t.id)), [queued]);

    // Build a chat drag payload for an arbitrary selected task, mirroring the
    // per-row idSource logic (a queued/running row without a processId resolves
    // its queue-task id; everything else uses its process id).
    const buildChatSessionContextPayload = useCallback((task: any): SessionContextDragPayload | null => {
        if (!sessionContextDragEnabled) return null;
        const isRunningTask = runningIdSet.has(task.id);
        const isQueuedTask = queuedIdSet.has(task.id);
        return createSessionContextDragPayload(task, {
            activeWorkspaceId: workspaceId,
            idSource: task.processId || (!isRunningTask && !isQueuedTask) ? 'process' : 'queue-task',
        });
    }, [sessionContextDragEnabled, runningIdSet, queuedIdSet, workspaceId]);

    // Bundle every selected chat when a drag starts inside an active
    // multi-selection (AC-02); an unselected row carries just itself. The
    // dragged item stays first so singular readers see it as the primary.
    const handleChatRowDragStart = useCallback((
        e: React.DragEvent,
        task: any,
        primaryPayload: SessionContextDragPayload | null,
        folderFilable: boolean,
        groupFolder?: GroupFolderTarget,
    ) => {
        const draggedId = task.id as string;
        const inSelection = selectedHistoryIds.size > 1 && selectedHistoryIds.has(draggedId);
        // The dragged row stays first so singular readers see it as the primary.
        const selectionIds = inSelection
            ? [draggedId, ...[...selectedHistoryIds].filter(id => id !== draggedId)]
            : [draggedId];

        if (primaryPayload) {
            if (inSelection) {
                const selectedPayloads: SessionContextDragPayload[] = [];
                for (const id of selectionIds) {
                    if (id === draggedId) continue;
                    const selectedTask = taskById.get(id);
                    if (!selectedTask) continue;
                    const payload = buildChatSessionContextPayload(selectedTask);
                    if (payload) selectedPayloads.push(payload);
                }
                writeSessionContextDragBundle(e.dataTransfer, [primaryPayload, ...selectedPayloads]);
            } else {
                writeSessionContextDragData(e.dataTransfer, primaryPayload);
            }
        }

        // AC-07: the folder-move flavour rides the SAME gesture, written last so
        // its `effectAllowed = 'copyMove'` supersedes the session-context
        // writer's `'copy'`. A folder target then answers 'move' and a composer
        // still answers 'copy', so the cursor tells the truth either way.
        // A row that ROOTS a filable group (today: a spawned tree's root chat)
        // writes the group flavour instead of its own id, so the drop files the
        // whole tree — matching what its context menu already does (AC-03/AC-04).
        const wroteMove = folderFilable && (groupFolder
            ? folderDnd.writeGroupRowMoveData(e.dataTransfer, groupFolder, selectionIds)
            : folderDnd.writeChatRowMoveData(e.dataTransfer, selectionIds));
        if (wroteMove) {
            if (selectionIds.length > 1) {
                chatDragImageRef.current = createMultiSelectDragImage(
                    e.dataTransfer,
                    getChatTitle(task),
                    selectionIds.length,
                );
            }
        }
        // `writeChatRowMoveData` is a stable callback, so this handler's identity
        // tracks the selection only — a folder highlight changing mid-drag must
        // not re-create the row renderer that depends on it.
    }, [selectedHistoryIds, taskById, buildChatSessionContextPayload, folderDnd.writeChatRowMoveData, folderDnd.writeGroupRowMoveData]);

    /**
     * One end for every drag this list starts: drops the off-screen drag image,
     * clears folder highlights, and stops the edge auto-scroll — including a
     * drag cancelled with Esc or released outside the window, both of which
     * still fire `dragend` on the source row.
     */
    const handleChatRowDragEnd = useCallback(() => {
        chatDragImageRef.current?.remove();
        chatDragImageRef.current = null;
        folderDnd.handleDragEnd();
    }, [folderDnd.handleDragEnd]);

    /**
     * Drag props for a whole-group row (a ralph session, a for-each or
     * map-reduce run) so it can be dropped on a folder (AC-04). The payload is
     * tagged with the group, so the drop issues one write against the group key
     * rather than a batch over `memberIds` — the ids ride along only so the
     * "already in this folder" check has something to look at.
     *
     * Empty when folders are off or there is no workspace to file into, which
     * leaves the row exactly as draggable as it was before (Ralph rows still
     * carry their session-context drag; the run rows stay undraggable).
     */
    const buildGroupRowDragProps = useCallback((target: GroupFolderTarget, memberIds: readonly string[]): {
        draggable?: boolean;
        onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
        onDragEnd?: () => void;
    } => {
        if (!chatFoldersEnabled || !workspaceId) {return {};}
        return {
            draggable: true,
            onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
                folderDnd.writeGroupRowMoveData(e.dataTransfer, target, memberIds);
            },
            onDragEnd: handleChatRowDragEnd,
        };
    }, [chatFoldersEnabled, workspaceId, folderDnd.writeGroupRowMoveData, handleChatRowDragEnd]);
    const filteredRunning = useMemo(() => running.filter(t => taskMatchesFilter(t, excludedTypes) && taskMatchesSearch(t, searchQuery)), [running, excludedTypes, searchQuery]);
    const filteredQueued = useMemo(
        () => queued.filter(t => t.kind === 'pause-marker' || (taskMatchesFilter(t, excludedTypes) && taskMatchesSearch(t, searchQuery))),
        [queued, excludedTypes, searchQuery],
    );
    const filteredHistory = useMemo(() => history.filter(t => taskMatchesFilter(t, excludedTypes) && taskMatchesSearch(t, searchQuery)), [history, excludedTypes, searchQuery]);

    // Tab-aware filtered arrays for empty state detection
    const isTaskItem = useCallback((t: any) => !isChat(t), []);

    /** Scope filter applied inside the Activity branch (`!activeTab`). The
     *  Chats and Tasks branches keep their existing per-tab filters intact. */
    const passesScope = useCallback((task: any): boolean => {
        if (activeTab === 'chats' || activeTab === 'tasks') return true;
        const hasCron = processIdsWithCrons.has(task.id) || processIdsWithCrons.has(task.processId);
        return taskInScope(activeScope, task, hasCron);
    }, [activeTab, activeScope, processIdsWithCrons]);

    const tabFilteredRunning = useMemo(() => {
        if (activeTab === 'chats') return filteredRunning.filter(isChat);
        if (activeTab === 'tasks') return filteredRunning.filter(isTaskItem);
        return filteredRunning.filter(passesScope);
    }, [activeTab, filteredRunning, isTaskItem, passesScope]);
    const tabFilteredQueued = useMemo(() => {
        if (activeTab === 'chats') return [];
        if (activeTab === 'tasks') return filteredQueued.filter(isTaskItem);
        return filteredQueued.filter((t: any) => t.kind === 'pause-marker' || passesScope(t));
    }, [activeTab, filteredQueued, isTaskItem, passesScope]);
    const tabFilteredHistory = useMemo(() => {
        if (activeTab === 'chats') return filteredHistory.filter(isChat);
        if (activeTab === 'tasks') return filteredHistory.filter(isTaskItem);
        return filteredHistory.filter(passesScope);
    }, [activeTab, filteredHistory, isTaskItem, passesScope]);

    const forEachFeatureEnabled = isForEachEnabled();
    const mapReduceFeatureEnabled = isMapReduceEnabled();
    const showForEachRunGroups = activeTab === 'chats' || (!activeTab && (activeScope === 'chat' || activeScope === 'all'));
    const showMapReduceRunGroups = showForEachRunGroups;
    const visibleForEachRuns = useMemo(() => {
        if (!forEachFeatureEnabled) return [];
        if (!searchQuery) return forEachRuns;
        const matchingRunIds = new Set<string>();
        for (const task of [...filteredRunning, ...filteredQueued, ...filteredHistory]) {
            const runId = getForEachRunId(task);
            if (runId) matchingRunIds.add(runId);
        }
        return forEachRuns.filter(run => forEachRunMatchesSearch(run, searchQuery) || matchingRunIds.has(run.runId));
    }, [forEachFeatureEnabled, forEachRuns, searchQuery, filteredRunning, filteredQueued, filteredHistory]);
    const visibleMapReduceRuns = useMemo(() => {
        if (!mapReduceFeatureEnabled) return [];
        if (!searchQuery) return mapReduceRuns;
        const matchingRunIds = new Set<string>();
        for (const task of [...filteredRunning, ...filteredQueued, ...filteredHistory]) {
            const runId = getMapReduceRunId(task);
            if (runId) matchingRunIds.add(runId);
        }
        return mapReduceRuns.filter(run => mapReduceRunMatchesSearch(run, searchQuery) || matchingRunIds.has(run.runId));
    }, [mapReduceFeatureEnabled, mapReduceRuns, searchQuery, filteredRunning, filteredQueued, filteredHistory]);

    const forEachGroupedEntries = useMemo<ForEachRunHistoryEntry[]>(() => {
        if (!forEachFeatureEnabled || !showForEachRunGroups || visibleForEachRuns.length === 0 || activeTab === 'tasks') return [];
        const queueTasks = tabFilteredQueued.filter((task: any) => task.kind !== 'pause-marker');
        return groupByForEachRun(
            [...tabFilteredRunning, ...queueTasks, ...tabFilteredHistory],
            visibleForEachRuns,
            unseenProcessIds,
        );
    }, [activeTab, forEachFeatureEnabled, showForEachRunGroups, tabFilteredRunning, tabFilteredQueued, tabFilteredHistory, visibleForEachRuns, unseenProcessIds]);

    const forEachRunGroups = useMemo(
        () => forEachGroupedEntries.filter((entry): entry is ForEachRunGroup => entry.kind === 'for-each-run'),
        [forEachGroupedEntries],
    );
    const mapReduceGroupedEntries = useMemo<MapReduceRunHistoryEntry[]>(() => {
        if (!mapReduceFeatureEnabled || !showMapReduceRunGroups || visibleMapReduceRuns.length === 0 || activeTab === 'tasks') return [];
        const queueTasks = tabFilteredQueued.filter((task: any) => task.kind !== 'pause-marker');
        return groupByMapReduceRun(
            [...tabFilteredRunning, ...queueTasks, ...tabFilteredHistory],
            visibleMapReduceRuns,
            unseenProcessIds,
        );
    }, [activeTab, mapReduceFeatureEnabled, showMapReduceRunGroups, tabFilteredRunning, tabFilteredQueued, tabFilteredHistory, visibleMapReduceRuns, unseenProcessIds]);

    const mapReduceRunGroups = useMemo(
        () => mapReduceGroupedEntries.filter((entry): entry is MapReduceRunGroup => entry.kind === 'map-reduce-run'),
        [mapReduceGroupedEntries],
    );

    const {
        pinnedGroups: pinnedForEachRunGroups,
        unpinnedGroups: unpinnedForEachRunGroups,
    } = useMemo(
        () => partitionPinnedGroups(forEachRunGroups.filter(group => !isRunningForEachRunGroup(group)), groupPins),
        [forEachRunGroups, groupPins],
    );
    const {
        pinnedGroups: pinnedMapReduceRunGroups,
        unpinnedGroups: unpinnedMapReduceRunGroups,
    } = useMemo(
        () => partitionPinnedGroups(mapReduceRunGroups.filter(group => !isRunningMapReduceRunGroup(group)), groupPins),
        [mapReduceRunGroups, groupPins],
    );

    const activityRunningForEachRunGroups = useMemo(
        () => forEachRunGroups.filter(isRunningForEachRunGroup),
        [forEachRunGroups],
    );
    const activityRunningMapReduceRunGroups = useMemo(
        () => mapReduceRunGroups.filter(isRunningMapReduceRunGroup),
        [mapReduceRunGroups],
    );

    const forEachGroupedTaskIds = useMemo(() => {
        const ids = new Set<string>();
        for (const group of forEachRunGroups) {
            for (const child of group.children) {
                if (typeof child.id === 'string') ids.add(child.id);
                if (typeof child.processId === 'string') ids.add(child.processId);
            }
        }
        return ids;
    }, [forEachRunGroups]);
    const workflowGroupedTaskIds = useMemo(() => {
        const ids = new Set(forEachGroupedTaskIds);
        for (const group of mapReduceRunGroups) {
            for (const child of group.children) {
                if (typeof child.id === 'string') ids.add(child.id);
                if (typeof child.processId === 'string') ids.add(child.processId);
            }
        }
        return ids;
    }, [forEachGroupedTaskIds, mapReduceRunGroups]);

    // AC-03: group chats that spawned others (via `send_to_conversation`) into
    // recursive trees by `parentProcessId`, behind a default-ON toggle. Built
    // from the same flat running/queued/history list the for-each grouping uses,
    // skipping chats already owned by a for-each / map-reduce group so existing
    // grouping wins. The root + descendants are hidden from the flat list and
    // re-rendered inside a <SpawnedTreeRow>. When the toggle is off, the view is
    // a no-op and chats render flat. The backend parent link (AC-01) is applied
    // regardless of this toggle.
    const spawnedTreeEnabled = isSpawnedTreeViewEnabled();
    const spawnedTreeView = useMemo(() => {
        const queueTasks = tabFilteredQueued.filter((task: any) => task.kind !== 'pause-marker');
        return buildSpawnedTreeChatView(
            [...tabFilteredRunning, ...queueTasks, ...tabFilteredHistory],
            { enabled: spawnedTreeEnabled, unseenIds: unseenProcessIds, excludeIds: workflowGroupedTaskIds },
        );
    }, [spawnedTreeEnabled, tabFilteredRunning, tabFilteredQueued, tabFilteredHistory, unseenProcessIds, workflowGroupedTaskIds]);
    const spawnedTreeGroups = spawnedTreeView.groups;

    // AC-01/AC-02: when a chat that is a spawned-tree node is archived, its whole
    // subtree must leave COMPLETED and render as a nested tree under ARCHIVED.
    // Split each tree at the shallowest explicitly-archived node (display-only,
    // recomputed from `archivedChatIds` each render — no cascade write): the
    // active remainder stays in COMPLETED, the archived subtree(s) move to
    // ARCHIVED, and a root/leaf pruned to a childless node demotes to a flat row.
    // When the flag is off `spawnedTreeGroups` is empty, so the partition is inert.
    const spawnedArchivePartition = useMemo(
        () => partitionSpawnedTreesByArchived(spawnedTreeGroups, archivedChatIds, unseenProcessIds),
        [spawnedTreeGroups, archivedChatIds, unseenProcessIds],
    );
    const activeSpawnedTreeGroups = spawnedArchivePartition.activeGroups;
    const archivedSpawnedTreeGroups = spawnedArchivePartition.archivedGroups;

    const groupedTaskIds = useMemo(() => {
        if (spawnedTreeView.hiddenIds.size === 0) return workflowGroupedTaskIds;
        const ids = new Set(workflowGroupedTaskIds);
        for (const id of spawnedTreeView.hiddenIds) ids.add(id);
        // Roots/leaves demoted to a childless node by archiving no longer render
        // inside a tree — surface them back into the flat lists so an active
        // demoted root lands in COMPLETED and an archived demoted node lands in
        // ARCHIVED, each keyed on its own per-chat state.
        for (const task of spawnedArchivePartition.activeTasks) {
            ids.delete(task.id);
            if (typeof task.processId === 'string') ids.delete(task.processId);
        }
        for (const task of spawnedArchivePartition.archivedTasks) {
            ids.delete(task.id);
            if (typeof task.processId === 'string') ids.delete(task.processId);
        }
        return ids;
    }, [workflowGroupedTaskIds, spawnedTreeView, spawnedArchivePartition]);

    const visibleTabFilteredRunning = useMemo(
        () => tabFilteredRunning.filter(task => !taskIdentityMatches(task, groupedTaskIds)),
        [tabFilteredRunning, groupedTaskIds],
    );

    const visibleTabFilteredQueued = useMemo(
        () => tabFilteredQueued.filter((task: any) => task.kind === 'pause-marker' || !taskIdentityMatches(task, groupedTaskIds)),
        [tabFilteredQueued, groupedTaskIds],
    );

    /** Source-bucketed counts for the scope segmented control. Counts come
     *  from the unfiltered task lists so the chips stay meaningful regardless
     *  of which scope the user is currently viewing. */
    const scopeCounts = useMemo(() => {
        const liveQueue = queued.filter((t: any) => t.kind !== 'pause-marker');
        const allRaw = [...running, ...liveQueue, ...history];
        const all = allRaw.filter((task: any) => !taskIdentityMatches(task, groupedTaskIds));
        let chat = forEachRunGroups.length + mapReduceRunGroups.length + activeSpawnedTreeGroups.length + archivedSpawnedTreeGroups.length;
        let auto = 0;
        for (const t of all) {
            // Scheduled runs are pulled out of Chats/Automations and shown under
            // the "Scheduled" scope instead, so exclude them from those counts.
            if (isScheduledTask(t)) continue;
            if (isChat(t)) chat++;
            else if (isAutomation(t)) auto++;
        }
        // "Scheduled" scope (internal id `loops`) = scheduled runs ∪ chats with a
        // `/cron`. A task that is BOTH is counted once via the single guard.
        let loops = 0;
        let hasScheduledRuns = false;
        for (const t of allRaw) {
            const scheduled = isScheduledTask(t);
            if (scheduled) hasScheduledRuns = true;
            if (scheduled || processIdsWithCrons.has(t.id) || processIdsWithCrons.has(t.processId)) loops++;
        }
        return { chat, auto, loops, all: all.length + forEachRunGroups.length + mapReduceRunGroups.length + activeSpawnedTreeGroups.length + archivedSpawnedTreeGroups.length, hasScheduledRuns };
    }, [running, queued, history, processIdsWithCrons, groupedTaskIds, forEachRunGroups.length, mapReduceRunGroups.length, activeSpawnedTreeGroups.length, archivedSpawnedTreeGroups.length]);

    // Separate archived from non-archived history (uses tab-filtered history for proper exclusions)
    const { activeHistory, filteredArchived } = useMemo(() => {
        const base = tabFilteredHistory;
        if (!archivedChatIds || archivedChatIds.size === 0) {
            return { activeHistory: base, filteredArchived: [] };
        }
        const active: any[] = [];
        const archived: any[] = [];
        for (const task of base) {
            if (archivedChatIds.has(task.id)) archived.push(task);
            else active.push(task);
        }
        return { activeHistory: active, filteredArchived: archived };
    }, [tabFilteredHistory, archivedChatIds]);

    // Split active history into pinned and non-pinned, preserving pin order
    const { filteredPinned, filteredUnpinned } = useMemo(() => {
        if (!pinnedChatIds || pinnedChatIds.size === 0) {
            return { filteredPinned: [], filteredUnpinned: activeHistory };
        }
        const pinned: any[] = [];
        const unpinned: any[] = [];
        const historyById = new Map(activeHistory.map((t: any) => [t.id, t]));
        // Preserve pin order (newest pinned first)
        for (const id of pinnedChatIds) {
            const task = historyById.get(id);
            if (task) pinned.push(task);
        }
        for (const task of activeHistory) {
            if (!pinnedChatIds.has(task.id)) unpinned.push(task);
        }
        return { filteredPinned: pinned, filteredUnpinned: unpinned };
    }, [activeHistory, pinnedChatIds]);

    const visibleFilteredPinned = useMemo(
        () => filteredPinned.filter(task => !taskIdentityMatches(task, groupedTaskIds)),
        [filteredPinned, groupedTaskIds],
    );

    const visibleFilteredUnpinned = useMemo(
        () => filteredUnpinned.filter(task => !taskIdentityMatches(task, groupedTaskIds)),
        [filteredUnpinned, groupedTaskIds],
    );

    const visibleFilteredArchived = useMemo(
        () => filteredArchived.filter(task => !taskIdentityMatches(task, groupedTaskIds)),
        [filteredArchived, groupedTaskIds],
    );

    // Chats tab: merge running chats + history chats into a single time-sorted list
    const chatAllItems = useMemo(() => {
        if (activeTab !== 'chats') return { pinned: [] as any[], unpinned: [] as any[], archived: [] as any[] };
        const runningChats = filteredRunning.filter(isChat);
        const historyChats = filteredHistory.filter(isChat);
        const all = [...runningChats, ...historyChats];
        // Deduplicate by processId — running tasks take priority
        const seenProcessIds = new Set<string>();
        const deduped = all.filter(t => {
            if (taskIdentityMatches(t, groupedTaskIds)) return false;
            const key = t.processId || t.payload?.processId || t.id;
            if (seenProcessIds.has(key)) return false;
            seenProcessIds.add(key);
            return true;
        });
        deduped.sort((a, b) => {
            const timeA = a.completedAt || a.startedAt || a.createdAt || 0;
            const timeB = b.completedAt || b.startedAt || b.createdAt || 0;
            return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
        const pinned: any[] = [];
        const unpinned: any[] = [];
        const archived: any[] = [];
        const pinnedById = new Map<string, any>();
        for (const t of deduped) {
            if (archivedChatIds?.has(t.id)) { archived.push(t); continue; }
            if (pinnedChatIds?.has(t.id)) { pinnedById.set(t.id, t); continue; }
            unpinned.push(t);
        }
        if (pinnedChatIds) {
            for (const id of pinnedChatIds) {
                const t = pinnedById.get(id);
                if (t) pinned.push(t);
            }
        }
        return { pinned, unpinned, archived };
    }, [activeTab, filteredRunning, filteredHistory, pinnedChatIds, archivedChatIds, groupedTaskIds]);

    const groupedUnpinned = useMemo(
        () => historyGrouping ? groupHistoryByPlanFile(visibleFilteredUnpinned, unseenProcessIds) : null,
        [visibleFilteredUnpinned, unseenProcessIds, historyGrouping],
    );

    /** Resolved list-mode config for the active tab — drives ralph/plan grouping
     *  in the Activity branch. The Chats branch still uses its own `chatGroups`
     *  pipeline below, so this config is currently consumed only by
     *  {@link dateBucketedHistory} and the Activity render branch. */
    const listModeConfig = useMemo(() => getListModeConfig(activeTab), [activeTab]);

    const activityRalphGrouping = useMemo(() => {
        if (!listModeConfig.enableRalphGrouping || !isRalphEnabled()) {
            return {
                pinnedRalphGroups: [] as Array<PinnedGroupEntry<RalphSession>>,
                unpinnedRalphGroups: [] as RalphSession[],
                nonRalphEntries: visibleFilteredUnpinned,
            };
        }
        const ralphEntries = groupByRalphSession(visibleFilteredUnpinned, unseenProcessIds);
        const ralphSessions = ralphEntries.filter((entry: any) => entry.kind === 'ralph-session') as RalphSession[];
        const nonRalphEntries = ralphEntries.filter((entry: any) => entry.kind !== 'ralph-session');
        const { pinnedGroups, unpinnedGroups } = partitionPinnedGroups(ralphSessions, groupPins);
        return {
            pinnedRalphGroups: pinnedGroups,
            unpinnedRalphGroups: unpinnedGroups,
            nonRalphEntries,
        };
    }, [listModeConfig.enableRalphGrouping, visibleFilteredUnpinned, unseenProcessIds, groupPins]);

    const pinnedActivityEntries = useMemo(
        () => mergePinnedEntries(visibleFilteredPinned, [
            ...activityRalphGrouping.pinnedRalphGroups,
            ...pinnedForEachRunGroups,
            ...pinnedMapReduceRunGroups,
        ]),
        [visibleFilteredPinned, activityRalphGrouping.pinnedRalphGroups, pinnedForEachRunGroups, pinnedMapReduceRunGroups],
    );

    const pinnedActivityMarkReadTasks = useMemo(
        () => pinnedActivityEntries.flatMap(getEntryChildTasks),
        [pinnedActivityEntries],
    );

    /**
     * Bucket the completed-history entries (For Each runs + ralph sessions + plan-file groups
     * + standalone tasks) into Today / This week / Older time windows so the
     * activity tab matches the activity-compact reference UI. The bucketing is
     * purely visual — the underlying entries (and their plan-file children) are
     * unchanged.
     *
     * Precedence: when a ralph iteration also has a `planFilePath`, the ralph
     * session wins. We split filteredUnpinned via {@link groupByRalphSession}
     * first, then plan-group only the non-ralph residuals.
     */
    const rawDateBucketedHistory = useMemo(() => {
        // Resolve the sort timestamp for any entry kind. for-each-run,
        // ralph-session, and plan-file group entries carry a precomputed timestamp
        // (already phase-aware for ralph — completed sessions use end-time,
        // not lastActivityAt; see ralph-session-grouping.ts). Standalone
        // tasks fall back to the activity-aware chain.
        let entries: Array<HistoryGroup | RalphSession | ForEachRunGroup | MapReduceRunGroup | (any & { kind?: undefined })>;
        if (listModeConfig.enableRalphGrouping && isRalphEnabled()) {
            const planned = (historyGrouping && listModeConfig.enablePlanGrouping)
                ? groupHistoryByPlanFile(activityRalphGrouping.nonRalphEntries, unseenProcessIds)
                : activityRalphGrouping.nonRalphEntries;
            // Merge ralph sessions and plan-file groups, then sort by their
            // resolved timestamp descending. Without this sort, ralph sessions
            // would always cluster at the top regardless of recency, even
            // after lastActivityAt drift was fixed in ralph-session-grouping.
            entries = [...unpinnedForEachRunGroups, ...unpinnedMapReduceRunGroups, ...activeSpawnedTreeGroups, ...activityRalphGrouping.unpinnedRalphGroups, ...planned].sort((a: any, b: any) => resolveListEntryTimestamp(b) - resolveListEntryTimestamp(a)) as any;
        } else if (groupedUnpinned) {
            entries = [...unpinnedForEachRunGroups, ...unpinnedMapReduceRunGroups, ...activeSpawnedTreeGroups, ...groupedUnpinned].sort((a: any, b: any) => resolveListEntryTimestamp(b) - resolveListEntryTimestamp(a)) as any;
        } else {
            entries = [...unpinnedForEachRunGroups, ...unpinnedMapReduceRunGroups, ...activeSpawnedTreeGroups, ...visibleFilteredUnpinned].sort((a: any, b: any) => resolveListEntryTimestamp(b) - resolveListEntryTimestamp(a)) as any;
        }
        const today: typeof entries = [];
        const week: typeof entries = [];
        const older: typeof entries = [];
        const nowMs = Date.now();
        for (const entry of entries) {
            const time = resolveListEntryTimestamp(entry);
            const ageH = time ? (nowMs - time) / 3600000 : Infinity;
            if (ageH < 24) today.push(entry);
            else if (ageH < 24 * 7) week.push(entry);
            else older.push(entry);
        }
        return { today, week, older };
    }, [groupedUnpinned, visibleFilteredUnpinned, unpinnedForEachRunGroups, unpinnedMapReduceRunGroups, activeSpawnedTreeGroups, listModeConfig, historyGrouping, unseenProcessIds, activityRalphGrouping]);

    /**
     * Which of the currently rendered group rows are filed, and which chats
     * live inside them. Built from the group entries themselves rather than
     * from the bucketed output, so one index serves both the Activity and the
     * Chats pipelines — a group's key is the same whichever pipeline built the
     * row. Groups absent from this render are not indexed, so a stale server
     * assignment cannot inflate a folder's count badge.
     */
    const groupFolderIndex = useMemo(() => buildGroupFolderIndex([
        ...forEachRunGroups,
        ...mapReduceRunGroups,
        ...activeSpawnedTreeGroups,
        ...archivedSpawnedTreeGroups,
        ...activityRalphGrouping.pinnedRalphGroups,
        ...activityRalphGrouping.unpinnedRalphGroups,
    ], groupFolderMap), [
        forEachRunGroups, mapReduceRunGroups, activeSpawnedTreeGroups,
        archivedSpawnedTreeGroups, activityRalphGrouping, groupFolderMap,
    ]);

    // Archived members are excluded so a folder whose chats are all archived
    // reads as "empty everywhere" and stays on screen at count 0, rather than
    // as "has members, none on this tab" — which would hide it (AC-09). A filed
    // group counts as one member, and its children stop counting individually.
    const folderMemberCounts = useMemo(
        () => buildFolderMemberCounts(folderIdByProcess, archivedChatIds, groupFolderIndex),
        [folderIdByProcess, archivedChatIds, groupFolderIndex],
    );

    /** Ids of rows currently running, for the folder row's live-run dot. */
    const runningRowIds = useMemo(() => new Set<string>(running.map((r: any) => r.id)), [running]);

    /** True when a text search is narrowing the list and folders must flatten (AC-08). */
    const folderSearchQuery = chatFoldersEnabled ? searchQuery : '';

    /**
     * Every member of every folder for the current tab, deliberately *not*
     * filtered by the search query.
     *
     * A folder whose name matches the query renders expanded with all of its
     * contents — that is the whole point of matching on folder names — so the
     * search path cannot reuse the query-filtered candidate lists the tree is
     * built from. The type filter, pin/archive precedence and grouped-row
     * exclusions still apply, exactly as they do in the unsearched pipelines.
     */
    const searchFolderMembersByFolder = useMemo(() => {
        if (!folderSearchQuery || chatFolders.length === 0) {return new Map<string, any[]>();}
        const known = new Set(chatFolders.map(f => f.id));
        const candidates = history
            .filter((t: any) => (activeTab === 'chats' ? isChat(t) : true))
            .filter((t: any) => taskMatchesFilter(t, excludedTypes))
            .filter((t: any) => !runningRowIds.has(t.id))
            .filter((t: any) => !(pinnedChatIds?.has(t.id) ?? false))
            .filter((t: any) => !(archivedChatIds?.has(t.id) ?? false))
            .filter((t: any) => !taskIdentityMatches(t, groupedTaskIds))
            .sort((a: any, b: any) => resolveListEntryTimestamp(b) - resolveListEntryTimestamp(a));
        return groupEntriesByFolder(candidates, folderIdByProcess, known, groupFolderIndex);
    }, [folderSearchQuery, chatFolders, history, activeTab, excludedTypes, runningRowIds, pinnedChatIds, archivedChatIds, groupedTaskIds, folderIdByProcess, groupFolderIndex]);

    /**
     * Folder rows for the Activity / Tasks surfaces, derived from the *unfiled*
     * date-bucket candidates. Folder membership is computed first so the date
     * buckets below can drop exactly the rows the folder section adopted —
     * a row is never in both places, and never in neither.
     */
    const activityFolderRows = useMemo<ChatFolderRow[]>(() => {
        if (!chatFoldersEnabled || chatFolders.length === 0) {return [];}
        // While searching, the tree flattens: only name-matched folders survive,
        // and every other folder's matching members fall back into the date
        // buckets, which happens for free because the visible-folder-id set
        // below is derived from these rows (AC-08).
        if (folderSearchQuery) {
            return buildSearchChatFolderRows({
                folders: chatFolders,
                query: folderSearchQuery,
                matches: taskMatchesSearch,
                membersByFolder: searchFolderMembersByFolder,
                folderMemberCounts,
                runningIds: runningRowIds,
            });
        }
        return buildChatFolderRows({
            folders: chatFolders,
            entries: [
                ...rawDateBucketedHistory.today,
                ...rawDateBucketedHistory.week,
                ...rawDateBucketedHistory.older,
            ],
            folderIdByProcess,
            groupIndex: groupFolderIndex,
            folderMemberCounts,
            collapsedIds: collapsedFolderIds,
            runningIds: runningRowIds,
        });
    }, [chatFoldersEnabled, chatFolders, folderSearchQuery, searchFolderMembersByFolder, rawDateBucketedHistory, folderIdByProcess, groupFolderIndex, folderMemberCounts, collapsedFolderIds, runningRowIds]);

    const activityVisibleFolderIds = useMemo(
        () => new Set(activityFolderRows.map(row => row.folder.id)),
        [activityFolderRows],
    );

    const dateBucketedHistory = useMemo(() => {
        if (activityVisibleFolderIds.size === 0) {return rawDateBucketedHistory;}
        return {
            today: partitionFiledEntries(rawDateBucketedHistory.today, folderIdByProcess, activityVisibleFolderIds, groupFolderIndex).unfiled,
            week: partitionFiledEntries(rawDateBucketedHistory.week, folderIdByProcess, activityVisibleFolderIds, groupFolderIndex).unfiled,
            older: partitionFiledEntries(rawDateBucketedHistory.older, folderIdByProcess, activityVisibleFolderIds, groupFolderIndex).unfiled,
        };
    }, [rawDateBucketedHistory, folderIdByProcess, activityVisibleFolderIds, groupFolderIndex]);

    const activityCompletedEntries = useMemo(
        () => [
            ...dateBucketedHistory.today,
            ...dateBucketedHistory.week,
            ...dateBucketedHistory.older,
        ],
        [dateBucketedHistory],
    );

    const activityCompletedMarkReadTasks = useMemo(
        () => activityCompletedEntries.flatMap(getEntryChildTasks),
        [activityCompletedEntries],
    );

    // Only explicit user expansions are tracked; groups otherwise render
    // collapsed immediately, including the first paint after workspace changes.
    const [expandedGroupState, setExpandedGroupState] = useState<{ workspaceId?: string; groups: Set<string> }>({
        workspaceId,
        groups: new Set(),
    });
    const toggleGroup = useCallback((planFilePath: string) => {
        setExpandedGroupState(prev => {
            const groups = new Set(prev.workspaceId === workspaceId ? prev.groups : []);
            groups.has(planFilePath) ? groups.delete(planFilePath) : groups.add(planFilePath);
            return { workspaceId, groups };
        });
    }, [workspaceId]);

    useEffect(() => {
        setExpandedGroupState(prev => {
            if (prev.workspaceId === workspaceId && prev.groups.size === 0) return prev;
            return { workspaceId, groups: new Set() };
        });
    }, [workspaceId]);

    // Count pinned tasks that are still running (not yet in history)
    const pinnedRunningCount = useMemo(() => {
        if (!pinnedChatIds) return 0;
        return visibleTabFilteredRunning.filter(t => pinnedChatIds.has(t.id)).length;
    }, [visibleTabFilteredRunning, pinnedChatIds]);

    const [showRunning, setShowRunning] = useState(true);
    const [showQueued, setShowQueued] = useState(true);
    const [showPinned, setShowPinned] = useState(true);
    const [showHistory, setShowHistory] = useState(true);
    const [showArchived, setShowArchived] = useState(false);

    /**
     * Filter chip selection on the redesigned chats tab.
     * Chip counts are computed against the unfiltered list so badges remain
     * meaningful regardless of the active filter.
     */
    const [chatFilter, setChatFilter] = useState<'all' | 'running' | 'failed'>('all');

    /** Platform-aware modifier key label for the search kbd hint. */
    const kbdLabel = useMemo(() => {
        if (typeof navigator === 'undefined') return '⌘F';
        const isMac = /mac/i.test(navigator.platform);
        return isMac ? '⌘F' : 'Ctrl+F';
    }, []);

    /** Platform-aware modifier key label for the New chat kbd hint. */
    const newChatKbdLabel = useMemo(() => {
        if (typeof navigator === 'undefined') return '⌘N';
        const isMac = /mac/i.test(navigator.platform);
        return isMac ? '⌘N' : 'Ctrl+N';
    }, []);

    // Time-bucketed groups for the redesigned chats tab.
    // Splits the chats list into Running / Pinned / Today / This Week / Older
    // (and a separate Archived bucket). The chatFilter chip is applied to each
    // bucket; chip counts are derived from the unfiltered list.
    const rawChatGroups = useMemo(() => {
        if (activeTab !== 'chats') return null;

        const runningIdSet = new Set(running.map((r: any) => r.id));
        const isRunningTask = (t: any) => runningIdSet.has(t.id);

        const passesFilter = (t: any): boolean => {
            if (chatFilter === 'all') return true;
            if (chatFilter === 'running') return isRunningTask(t);
            if (chatFilter === 'failed') return t.status === 'failed';
            return true;
        };

        const allActive = chatAllItems.pinned.concat(chatAllItems.unpinned);
        const runningChats = allActive.filter(t => isRunningTask(t) && passesFilter(t));
        const pinnedChats = chatAllItems.pinned.filter(t => !isRunningTask(t) && passesFilter(t));
        const recentNonRunning = chatAllItems.unpinned.filter(t => !isRunningTask(t) && passesFilter(t));
        const archivedChats = chatAllItems.archived.filter(passesFilter);
        const passesForEachFilter = (group: ForEachRunGroup): boolean => {
            if (chatFilter === 'all') return true;
            if (chatFilter === 'running') return isRunningForEachRunGroup(group, runningIdSet);
            if (chatFilter === 'failed') return group.run.status === 'failed';
            return true;
        };
        const filteredForEachGroups = forEachRunGroups.filter(passesForEachFilter);
        const runningForEachGroups = filteredForEachGroups.filter(group => isRunningForEachRunGroup(group, runningIdSet));
        const nonRunningForEachGroups = filteredForEachGroups.filter(group => !isRunningForEachRunGroup(group, runningIdSet));
        const {
            pinnedGroups: pinnedNonRunningForEachGroups,
            unpinnedGroups: unpinnedNonRunningForEachGroups,
        } = partitionPinnedGroups(nonRunningForEachGroups, groupPins);
        const passesMapReduceFilter = (group: MapReduceRunGroup): boolean => {
            if (chatFilter === 'all') return true;
            if (chatFilter === 'running') return isRunningMapReduceRunGroup(group, runningIdSet);
            if (chatFilter === 'failed') return group.run.status === 'failed' || group.run.reduceStatus === 'failed';
            return true;
        };
        const filteredMapReduceGroups = mapReduceRunGroups.filter(passesMapReduceFilter);
        const runningMapReduceGroups = filteredMapReduceGroups.filter(group => isRunningMapReduceRunGroup(group, runningIdSet));
        const nonRunningMapReduceGroups = filteredMapReduceGroups.filter(group => !isRunningMapReduceRunGroup(group, runningIdSet));
        const {
            pinnedGroups: pinnedNonRunningMapReduceGroups,
            unpinnedGroups: unpinnedNonRunningMapReduceGroups,
        } = partitionPinnedGroups(nonRunningMapReduceGroups, groupPins);

        const recentRalphEntries = isRalphEnabled()
            ? groupByRalphSession(recentNonRunning, unseenProcessIds)
            : recentNonRunning;
        const recentRalphSessions = recentRalphEntries.filter((entry: any) => entry.kind === 'ralph-session') as RalphSession[];
        const recentNonRalph = recentRalphEntries.filter((entry: any) => entry.kind !== 'ralph-session');
        const {
            pinnedGroups: pinnedRalphGroups,
            unpinnedGroups: unpinnedRalphGroups,
        } = partitionPinnedGroups(recentRalphSessions, groupPins);
        const pinnedChatsAndGroups = mergePinnedEntries(pinnedChats, [
            ...pinnedRalphGroups,
            ...pinnedNonRunningForEachGroups,
            ...pinnedNonRunningMapReduceGroups,
        ]);

        const today: Array<any | RalphSession | ForEachRunGroup | MapReduceRunGroup | SpawnedTreeEntry> = [];
        const week: Array<any | RalphSession | ForEachRunGroup | MapReduceRunGroup | SpawnedTreeEntry> = [];
        const older: Array<any | RalphSession | ForEachRunGroup | MapReduceRunGroup | SpawnedTreeEntry> = [];
        const nowMs = Date.now();
        for (const t of [...recentNonRalph, ...unpinnedRalphGroups, ...unpinnedNonRunningForEachGroups, ...unpinnedNonRunningMapReduceGroups, ...activeSpawnedTreeGroups]) {
            const time = resolveListEntryTimestamp(t);
            const ageH = time ? (nowMs - time) / 3600000 : Infinity;
            if (ageH < 24) today.push(t);
            else if (ageH < 24 * 7) week.push(t);
            else older.push(t);
        }

        const counts = {
            all: allActive.length + forEachRunGroups.length + mapReduceRunGroups.length + activeSpawnedTreeGroups.length,
            running: allActive.filter(isRunningTask).length
                + forEachRunGroups.filter(group => isRunningForEachRunGroup(group, runningIdSet)).length
                + mapReduceRunGroups.filter(group => isRunningMapReduceRunGroup(group, runningIdSet)).length,
            failed: allActive.filter(t => t.status === 'failed').length
                + forEachRunGroups.filter(group => group.run.status === 'failed').length
                + mapReduceRunGroups.filter(group => group.run.status === 'failed' || group.run.reduceStatus === 'failed').length,
        };

        // Flat list across visible sections, used for shift-click range selection
        const flatVisible = [...runningChats, ...runningForEachGroups, ...runningMapReduceGroups, ...pinnedChatsAndGroups, ...today, ...week, ...older];

        return {
            runningChats: [...runningChats, ...runningForEachGroups, ...runningMapReduceGroups],
            pinnedChats: pinnedChatsAndGroups,
            today,
            week,
            older,
            archivedChats,
            archivedSpawnedTrees: archivedSpawnedTreeGroups,
            counts,
            flatVisible,
        };
    }, [activeTab, running, chatAllItems, chatFilter, forEachRunGroups, mapReduceRunGroups, activeSpawnedTreeGroups, archivedSpawnedTreeGroups, groupPins, unseenProcessIds]);

    /**
     * Folder rows for the Chats surface. Same shape as the Activity path — one
     * builder, one set of rules; only the candidate list differs, which is what
     * makes the count badge tab-filtered by construction.
     */
    const chatFolderRows = useMemo<ChatFolderRow[]>(() => {
        if (!chatFoldersEnabled || chatFolders.length === 0 || !rawChatGroups) {return [];}
        if (folderSearchQuery) {
            return buildSearchChatFolderRows({
                folders: chatFolders,
                query: folderSearchQuery,
                matches: taskMatchesSearch,
                membersByFolder: searchFolderMembersByFolder,
                folderMemberCounts,
                runningIds: runningRowIds,
            });
        }
        return buildChatFolderRows({
            folders: chatFolders,
            entries: [...rawChatGroups.today, ...rawChatGroups.week, ...rawChatGroups.older],
            folderIdByProcess,
            groupIndex: groupFolderIndex,
            folderMemberCounts,
            collapsedIds: collapsedFolderIds,
            runningIds: runningRowIds,
        });
    }, [chatFoldersEnabled, chatFolders, folderSearchQuery, searchFolderMembersByFolder, rawChatGroups, folderIdByProcess, groupFolderIndex, folderMemberCounts, collapsedFolderIds, runningRowIds]);

    const chatVisibleFolderIds = useMemo(
        () => new Set(chatFolderRows.map(row => row.folder.id)),
        [chatFolderRows],
    );

    const chatGroups = useMemo(() => {
        if (!rawChatGroups || chatVisibleFolderIds.size === 0) {return rawChatGroups;}
        const today = partitionFiledEntries(rawChatGroups.today, folderIdByProcess, chatVisibleFolderIds, groupFolderIndex).unfiled;
        const week = partitionFiledEntries(rawChatGroups.week, folderIdByProcess, chatVisibleFolderIds, groupFolderIndex).unfiled;
        const older = partitionFiledEntries(rawChatGroups.older, folderIdByProcess, chatVisibleFolderIds, groupFolderIndex).unfiled;
        return {
            ...rawChatGroups,
            today,
            week,
            older,
            // Folder members are still visible rows: they belong in the flat
            // list so shift-click spans them, and so a list whose every chat is
            // filed does not fall through to the "no chat sessions yet" state.
            flatVisible: [
                ...rawChatGroups.runningChats,
                ...rawChatGroups.pinnedChats,
                ...chatFolderRows.filter(row => !row.collapsed).flatMap(row => row.members),
                ...today,
                ...week,
                ...older,
            ],
        };
    }, [rawChatGroups, folderIdByProcess, chatVisibleFolderIds, groupFolderIndex, chatFolderRows]);

    /** Folder members in section order — shift-click spans them like any chat row. */
    const visibleFolderMemberRows = useMemo(
        () => (activeTab === 'chats' ? chatFolderRows : activityFolderRows)
            .filter(row => !row.collapsed)
            .flatMap(row => row.members),
        [activeTab, chatFolderRows, activityFolderRows],
    );

    const applyRalphGrouping = useCallback((items: any[]): Array<RalphHistoryEntry | ForEachRunGroup | MapReduceRunGroup | SpawnedTreeEntry> => {
        const forEachEntries = items.filter((entry): entry is ForEachRunGroup => entry.kind === 'for-each-run');
        const mapReduceEntries = items.filter((entry): entry is MapReduceRunGroup => entry.kind === 'map-reduce-run');
        const spawnedTreeEntries = items.filter(isSpawnedTreeEntry);
        const nonWorkflowGroups = items.filter(entry => entry.kind !== 'for-each-run' && entry.kind !== 'map-reduce-run' && entry.kind !== 'spawned-tree');
        const grouped = isRalphEnabled() ? groupByRalphSession(nonWorkflowGroups, unseenProcessIds) : nonWorkflowGroups;
        return [...grouped, ...forEachEntries, ...mapReduceEntries, ...spawnedTreeEntries].sort((a, b) => resolveListEntryTimestamp(b) - resolveListEntryTimestamp(a));
    }, [unseenProcessIds]);

    const todayGrouped = useMemo(
        () => chatGroups ? applyRalphGrouping(chatGroups.today) : [],
        [chatGroups, applyRalphGrouping],
    );
    const weekGrouped = useMemo(
        () => chatGroups ? applyRalphGrouping(chatGroups.week) : [],
        [chatGroups, applyRalphGrouping],
    );
    const olderGrouped = useMemo(
        () => chatGroups ? applyRalphGrouping(chatGroups.older) : [],
        [chatGroups, applyRalphGrouping],
    );

    // Workspace-scoped expand/collapse for all task-group kinds (Ralph
    // sessions, For Each runs, Map Reduce runs) lives in one keyed state.
    const taskGroupExpansion = useTaskGroupExpansion(workspaceId);
    const expandedRalphSessionIds = taskGroupExpansion.expandedIds('ralph');
    const expandedForEachRunIds = taskGroupExpansion.expandedIds('for-each');
    const expandedMapReduceRunIds = taskGroupExpansion.expandedIds('map-reduce');
    const toggleTaskGroup = taskGroupExpansion.toggle;
    const toggleRalphSession = useCallback((sessionId: string) => toggleTaskGroup('ralph', sessionId), [toggleTaskGroup]);
    const toggleForEachRun = useCallback((runId: string) => toggleTaskGroup('for-each', runId), [toggleTaskGroup]);
    const toggleMapReduceRun = useCallback((runId: string) => toggleTaskGroup('map-reduce', runId), [toggleTaskGroup]);

    // Per-root collapse state for spawned-conversation trees (AC-03). Seeded
    // from localStorage so a collapsed root survives reload; default expanded
    // for roots the user has never touched. Persistence happens inside
    // toggleCollapsedSpawnedRoot. Keyed globally by root process id (unique), so
    // unlike the workflow-group expand state it is not reset per workspace.
    const [collapsedSpawnedIds, setCollapsedSpawnedIds] = useState<Set<string>>(() => loadCollapsedSpawnedRootIds());
    const toggleSpawnedCollapsed = useCallback((nodeId: string) => {
        setCollapsedSpawnedIds(prev => toggleCollapsedSpawnedRoot(prev, nodeId));
    }, []);

    const activityRunningEntries = useMemo<Array<any | ForEachRunGroup | MapReduceRunGroup>>(
        () => [...visibleTabFilteredRunning, ...activityRunningForEachRunGroups, ...activityRunningMapReduceRunGroups],
        [visibleTabFilteredRunning, activityRunningForEachRunGroups, activityRunningMapReduceRunGroups],
    );

    const chatRangeRows = useMemo(
        () => chatGroups
            ? buildHistoryRangeRows(
                [
                    ...chatGroups.runningChats,
                    ...chatGroups.pinnedChats,
                    ...visibleFolderMemberRows,
                    ...todayGrouped,
                    ...weekGrouped,
                    ...olderGrouped,
                ],
                expandedRalphSessionIds,
                expandedForEachRunIds,
                expandedMapReduceRunIds,
                collapsedSpawnedIds,
            )
            : [],
        [chatGroups, visibleFolderMemberRows, todayGrouped, weekGrouped, olderGrouped, expandedRalphSessionIds, expandedForEachRunIds, expandedMapReduceRunIds, collapsedSpawnedIds],
    );

    const activityRangeRows = useMemo(
        () => buildHistoryRangeRows(
            [
                ...activityRunningEntries,
                ...pinnedActivityEntries,
                ...visibleFolderMemberRows,
                ...dateBucketedHistory.today,
                ...dateBucketedHistory.week,
                ...dateBucketedHistory.older,
            ],
            expandedRalphSessionIds,
            expandedForEachRunIds,
            expandedMapReduceRunIds,
            collapsedSpawnedIds,
        ),
        [activityRunningEntries, pinnedActivityEntries, visibleFolderMemberRows, dateBucketedHistory, expandedRalphSessionIds, expandedForEachRunIds, expandedMapReduceRunIds, collapsedSpawnedIds],
    );

    const visibleHistoryRangeRows = activeTab === 'chats' ? chatRangeRows : activityRangeRows;

    const visibleHistorySelectionIds = useMemo(() => {
        const ids = new Set<string>();
        for (const row of visibleHistoryRangeRows) {
            addHistoryRangeRowSelectionIds(row, ids);
        }
        return ids;
    }, [visibleHistoryRangeRows]);

    const handleCancel = async (taskId: string) => {
        await cloneClient.queue.cancel(taskId);
        fetchQueue();
    };

    const deleteChatDirect = async (taskId: string) => {
        if (workspaceId) {
            await cloneClient.workspaces.deleteHistory(workspaceId, taskId);
        } else {
            await cloneClient.queue.deleteHistoryEntry(taskId);
        }
        fetchQueue();
    };

    const handleDeleteChat = async (taskId: string) => {
        if (!confirm('Delete this chat? This cannot be undone.')) return;
        await deleteChatDirect(taskId);
    };

    const handleMoveUp = async (taskId: string) => {
        await cloneClient.queue.moveUp(taskId);
        fetchQueue();
    };

    const handleMoveToTop = async (taskId: string) => {
        await cloneClient.queue.moveToTop(taskId);
        fetchQueue();
    };

    const handleMoveToPosition = async (taskId: string, newIndex: number) => {
        await cloneClient.queue.moveToPosition(taskId, newIndex);
        fetchQueue();
    };

    const handleFreeze = async (taskId: string) => {
        await cloneClient.queue.freeze(taskId);
        fetchQueue();
    };

    const handleUnfreeze = async (taskId: string) => {
        await cloneClient.queue.unfreeze(taskId);
        fetchQueue();
    };

    const [isAdmitting, setIsAdmitting] = useState(false);

    const handleAdmit = async (taskId: string) => {
        setIsAdmitting(true);
        try {
            await cloneClient.queue.admit(taskId);
            await fetchQueue();
        } finally {
            setIsAdmitting(false);
        }
    };

    const handleUnadmit = async (taskId: string) => {
        await cloneClient.queue.unadmit(taskId);
        fetchQueue();
    };

    const handleInsertPauseMarker = async (afterIndex: number, options?: QueuePauseOptions) => {
        setInsertingPauseAt(null);
        setPauseMarkerMenuIndex(null);
        await cloneClient.queue.insertPauseMarker({
            afterIndex,
            ...(workspaceId ? { repoId: workspaceId } : {}),
            ...(options?.durationHours !== undefined ? { durationHours: options.durationHours } : {}),
        });
        fetchQueue();
    };

    const openPauseMarkerMenu = useCallback((afterIndex: number) => {
        setInsertingPauseAt(afterIndex);
        setPauseMarkerMenuIndex(current => current === afterIndex ? null : afterIndex);
    }, []);

    const handleRemovePauseMarker = async (markerId: string) => {
        await cloneClient.queue.removePauseMarker(markerId);
        fetchQueue();
    };

    const {
        draggedTaskId,
        dropTargetIndex,
        dropPosition,
        createDragStartHandler,
        createDragEndHandler,
        createDragOverHandler,
        createDragEnterHandler,
        createDragLeaveHandler,
        createDropHandler,
    } = useQueueDragDrop();

    const touchDrag = useQueueTouchDragDrop();

    // Merge drag state from desktop (HTML5) and mobile (touch) hooks
    const activeDraggedTaskId = draggedTaskId || touchDrag.draggedTaskId;
    const activeDropTargetIndex = dropTargetIndex ?? touchDrag.dropTargetIndex;
    const activeDropPosition = dropPosition || touchDrag.dropPosition;

    // ── History/archived long-press via shared useLongPress hook ──
    const historyLongPressTaskRef = useRef<string>('');

    const historyLongPress = useLongPress(
        (x: number, y: number) => {
            const taskId = historyLongPressTaskRef.current;
            const bulkIds =
                selectedHistoryIds.size >= 2 && selectedHistoryIds.has(taskId)
                    ? Array.from(selectedHistoryIds)
                    : undefined;
            setContextMenu({ x, y, taskId, taskStatus: 'completed', bulkIds });
        },
    );
    const groupLongPressTargetRef = useRef<{
        taskId: string;
        bulkIds?: string[];
        ralphSession?: RalphSession;
        forEachRun?: ForEachRunGroup;
        mapReduceRun?: MapReduceRunGroup;
        groupPin: GroupPinMenuTarget;
        groupFolder?: GroupFolderTarget;
    } | null>(null);
    const groupLongPress = useLongPress(
        (x: number, y: number) => {
            const target = groupLongPressTargetRef.current;
            if (!target) return;
            if (target.bulkIds) setSelectedHistoryIds(new Set(target.bulkIds));
            else setSelectedHistoryIds(new Set());
            setContextMenu({
                x,
                y,
                taskId: target.taskId,
                taskStatus: 'completed',
                bulkIds: target.bulkIds,
                ralphSession: target.ralphSession,
                forEachRun: target.forEachRun,
                mapReduceRun: target.mapReduceRun,
                groupPin: target.groupPin,
                groupFolder: target.groupFolder,
            });
        },
    );

    // Clean up stale selection when the filtered list changes
    useEffect(() => {
        if (selectedHistoryIds.size === 0) return;
        const cleaned = new Set([...selectedHistoryIds].filter(id => visibleHistorySelectionIds.has(id)));
        if (cleaned.size !== selectedHistoryIds.size) {
            setSelectedHistoryIds(cleaned);
        }
    }, [visibleHistorySelectionIds, selectedHistoryIds]);

    const handleHistoryItemClick = useCallback(
        (e: React.MouseEvent, task: any, listForRange: HistoryRangeInput[]) => {
            const id = task.id as string;

            if (e.shiftKey && anchorHistoryId) {
                const selection = resolveHistoryRangeSelection(listForRange, anchorHistoryId, id);
                if (selection) {
                    setSelectedHistoryIds(selection);
                    return;
                }
            }

            if (e.ctrlKey || e.metaKey) {
                setSelectedHistoryIds(prev => {
                    const next = new Set(prev);
                    next.has(id) ? next.delete(id) : next.add(id);
                    return next;
                });
                setAnchorHistoryId(id);
                return;
            }

            // Plain click: clear multi-selection, open detail
            setSelectedHistoryIds(new Set());
            setAnchorHistoryId(id);
            onSelectTask(id, task);
        },
        [anchorHistoryId, onSelectTask],
    );

    const handleHistoryGroupClick = useCallback((
        e: React.MouseEvent,
        groupRangeId: string,
        listForRange: HistoryRangeInput[],
        onPlainClick: () => void,
    ) => {
        if (!isMobile && e.shiftKey && anchorHistoryId) {
            const selection = resolveHistoryRangeSelection(listForRange, anchorHistoryId, groupRangeId);
            if (selection) {
                setSelectedHistoryIds(selection);
                return;
            }
        }

        setSelectedHistoryIds(new Set());
        setAnchorHistoryId(groupRangeId);
        onPlainClick();
    }, [anchorHistoryId, isMobile]);

    const handleTaskContextMenu= useCallback((e: React.MouseEvent, taskId: string, taskStatus: 'running' | 'queued' | 'completed', groupFolder?: GroupFolderTarget) => {
        if (e.shiftKey) return; // Allow native browser context menu on shift+right-click
        e.preventDefault();
        e.stopPropagation();

        const bulkIds =
            taskStatus === 'completed' &&
            selectedHistoryIds.size >= 1 &&
            selectedHistoryIds.has(taskId)
                ? Array.from(selectedHistoryIds)
                : taskStatus === 'completed'
                    ? [taskId]
                    : undefined;

        // A multi-row selection is about those rows, not about the group the
        // right-clicked row happens to root, so the group affordance drops out.
        const groupTarget = bulkIds && bulkIds.length > 1 ? undefined : groupFolder;
        setContextMenu({ x: e.clientX, y: e.clientY, taskId, taskStatus, bulkIds, groupFolder: groupTarget });
    }, [selectedHistoryIds]);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const handleRenameConfirm = useCallback(async (newTitle: string) => {
        if (!renameTarget) return;
        const processId = ensureQueueProcessId(renameTarget.taskId);
        setRenameTarget(null);
        try {
            await cloneClient.processes.update(processId, { customTitle: newTitle });
            fetchQueue();
        } catch { /* WS will sync eventually */ }
    }, [renameTarget, fetchQueue, cloneClient]);

    const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
        if (!contextMenu) return [];
        const { taskId, taskStatus } = contextMenu;
        const groupPinAction = contextMenu.groupPin && onSetGroupPin
            ? {
                label: contextMenu.groupPin.isPinned ? 'Unpin' : 'Pin to top',
                icon: '📌',
                onClick: () => {
                    setGroupPinned(contextMenu.groupPin!.type, contextMenu.groupPin!.groupId, !contextMenu.groupPin!.isPinned);
                    closeContextMenu();
                },
            }
            : null;

        if (contextMenu.groupPin && !contextMenu.bulkIds) {
            return [
                ...(groupPinAction ? [groupPinAction] : []),
                ...(contextMenu.groupFolder ? buildGroupMoveToFolderItems(contextMenu.groupFolder) : []),
                ...(contextMenu.forEachRun ? [{
                    label: 'Copy run info',
                    icon: '📎',
                    onClick: () => {
                        const group = contextMenu.forEachRun!;
                        const lines = [
                            `For Each run ${group.runId}`,
                            `Status: ${group.run.status}`,
                            `Items: ${group.run.itemCount}`,
                            `Updated: ${group.run.updatedAt ?? group.run.completedAt ?? group.run.createdAt}`,
                            'Processes:',
                            ...group.children.map(child => `  - ${child.id}`),
                        ];
                        void copyToClipboard(lines.join('\n'));
                        closeContextMenu();
                    },
                }] : []),
                ...(contextMenu.mapReduceRun ? [{
                    label: 'Copy run info',
                    icon: '📎',
                    onClick: () => {
                        const group = contextMenu.mapReduceRun!;
                        const lines = [
                            `Map Reduce run ${group.runId}`,
                            `Status: ${group.run.status}`,
                            `Map items: ${group.run.itemCount}`,
                            `Reduce: ${group.run.reduceStatus}`,
                            `Updated: ${group.run.updatedAt ?? group.run.completedAt ?? group.run.createdAt}`,
                            'Processes:',
                            ...group.children.map(child => `  - ${child.id}`),
                        ];
                        void copyToClipboard(lines.join('\n'));
                        closeContextMenu();
                    },
                }] : []),
            ];
        }

        // Bulk context menu for multi-selected completed tasks
        if (contextMenu.bulkIds) {
            const ids = contextMenu.bulkIds;
            const anyUnseen   = ids.some(id => unseenProcessIds?.has(id));
            const anySeen     = ids.some(id => !unseenProcessIds?.has(id));
            const anyPinned   = ids.some(id => pinnedChatIds?.has(id));
            const anyUnpinned = ids.some(id => !pinnedChatIds?.has(id));
            const anyArchived   = ids.some(id => archivedChatIds?.has(id));
            const anyUnarchived = ids.some(id => !archivedChatIds?.has(id));
            return [
                { label: `${ids.length} tasks selected`, icon: '', disabled: true, onClick: () => {} },
                { label: '', icon: '', separator: true, onClick: () => {} },
                ...(anyUnseen && onMarkRead    ? [{ label: 'Mark as Read',   icon: '✓', onClick: () => { ids.forEach(id => onMarkRead!(id));   closeContextMenu(); } }] : []),
                ...(anySeen && onMarkUnread    ? [{ label: 'Mark as Unread', icon: '●', onClick: () => { ids.forEach(id => onMarkUnread!(id)); closeContextMenu(); } }] : []),
                ...(groupPinAction ? [groupPinAction] : []),
                ...(!groupPinAction && anyPinned && onUnpinChat   ? [{ label: 'Unpin',          icon: '📌', onClick: () => { ids.forEach(id => onUnpinChat!(id)); closeContextMenu(); } }] : []),
                ...(!groupPinAction && anyUnpinned && onPinChat   ? [{ label: 'Pin to top',     icon: '📌', onClick: () => { ids.forEach(id => onPinChat!(id));   closeContextMenu(); } }] : []),
                ...(contextMenu.groupFolder
                    ? buildGroupMoveToFolderItems(contextMenu.groupFolder)
                    : buildMoveToFolderItems(ids)),
                ...(anyUnarchived && onArchiveChats  ? [{ label: 'Archive',   icon: '📦', onClick: () => { onArchiveChats!(ids);   closeContextMenu(); } }] : []),
                ...(anyArchived  && onUnarchiveChats ? [{ label: 'Unarchive', icon: '📤', onClick: () => { onUnarchiveChats!(ids); closeContextMenu(); } }] : []),
                ...(ids.length <= 20 ? [{
                    label: ids.length === 1 ? 'Summarize chat' : `Summarize ${ids.length} chats`,
                    icon: '📝',
                    onClick: () => {
                        closeContextMenu();
                        setSummarizeDialogIds(ids);
                        setSummarizeDialogOpen(true);
                    },
                }] : []),
                {
                    label: ids.length === 1 ? 'Copy metadata' : `Copy metadata (${ids.length} chats)`,
                    icon: '📋',
                    onClick: () => {
                        const tasks = ids
                            .map(id => history.find((t: any) => t.id === id))
                            .filter(Boolean);
                        const text = tasks.map(t => formatMetadataText(t)).join('\n\n---\n\n');
                        void copyToClipboard(text);
                        closeContextMenu();
                    },
                },
                ...(contextMenu.forEachRun ? [{
                    label: 'Copy run info',
                    icon: '📎',
                    onClick: () => {
                        void copyToClipboard(buildForEachRunCopyInfo(contextMenu.forEachRun!, ids));
                        closeContextMenu();
                    },
                }] : []),
                ...(contextMenu.mapReduceRun ? [{
                    label: 'Copy run info',
                    icon: '📎',
                    onClick: () => {
                        void copyToClipboard(buildMapReduceRunCopyInfo(contextMenu.mapReduceRun!, ids));
                        closeContextMenu();
                    },
                }] : []),
                ...(contextMenu.ralphSession ? [{
                    label: 'Copy session info',
                    icon: '📎',
                    onClick: () => {
                        void copyToClipboard(buildRalphSessionCopyInfo(contextMenu.ralphSession!, ids));
                        closeContextMenu();
                    },
                }] : []),
                // Rename available only for single-item selection
                ...(ids.length === 1 ? [{
                    label: 'Rename', icon: '✏️', onClick: () => {
                        const task = history.find(t => t.id === ids[0]);
                        setRenameTarget({ taskId: ids[0], title: task?.displayName || task?.title || task?.type || '' });
                        closeContextMenu();
                    },
                }] : []),
                { label: '', icon: '', separator: true, onClick: () => {} },
                { label: `Delete ${ids.length} chats…`, icon: '🗑', onClick: () => {
                    if (confirm(`Delete ${ids.length} chats? This cannot be undone.`)) {
                        ids.forEach(id => deleteChatDirect(id));
                        setSelectedHistoryIds(new Set());
                    }
                    closeContextMenu();
                }},
            ];
        }

        if (taskStatus === 'running') {
            const isPinned = pinnedChatIds?.has(taskId) ?? false;
            return [
                ...(isPinned && onUnpinChat ? [{ label: 'Unpin', icon: '📌', onClick: () => onUnpinChat(taskId) }] : []),
                ...(!isPinned && onPinChat ? [{ label: 'Pin to top', icon: '📌', onClick: () => onPinChat(taskId) }] : []),
                ...(contextMenu.groupFolder
                    ? buildGroupMoveToFolderItems(contextMenu.groupFolder)
                    : buildMoveToFolderItems([taskId])),
                { label: 'Copy metadata', icon: '📋', onClick: () => {
                    const task = running.find((t: any) => t.id === taskId);
                    if (task) void copyToClipboard(formatMetadataText(task));
                    closeContextMenu();
                }},
                { label: '', icon: '', separator: true, onClick: () => {} },
                { label: 'Cancel', icon: '✕', onClick: () => handleCancel(taskId) },
            ];
        }
        if (taskStatus === 'completed') {
            const isUnseen = unseenProcessIds?.has(taskId) ?? false;
            const isPinned = pinnedChatIds?.has(taskId) ?? false;
            const isArchived = archivedChatIds?.has(taskId) ?? false;
            const task = history.find(t => t.id === taskId);
            return [
                ...(isPinned && onUnpinChat ? [{ label: 'Unpin', icon: '📌', onClick: () => onUnpinChat(taskId) }] : []),
                ...(!isPinned && onPinChat ? [{ label: 'Pin to top', icon: '📌', onClick: () => onPinChat(taskId) }] : []),
                ...(isUnseen && onMarkRead ? [{ label: 'Mark as Read', icon: '✓', onClick: () => onMarkRead(taskId) }] : []),
                ...(!isUnseen && onMarkUnread ? [{ label: 'Mark as Unread', icon: '●', onClick: () => onMarkUnread(taskId) }] : []),
                { label: 'Rename', icon: '✏️', onClick: () => {
                    setRenameTarget({ taskId, title: (task as any)?.customTitle || '' });
                    closeContextMenu();
                }},
                ...(contextMenu.groupFolder
                    ? buildGroupMoveToFolderItems(contextMenu.groupFolder)
                    : buildMoveToFolderItems([taskId])),
                ...(isArchived && onUnarchiveChat ? [{ label: 'Unarchive', icon: '📤', onClick: () => onUnarchiveChat(taskId) }] : []),
                ...(!isArchived && onArchiveChat ? [{ label: 'Archive', icon: '📦', onClick: () => onArchiveChat(taskId) }] : []),
                { label: '', icon: '', separator: true, onClick: () => {} },
                { label: 'Delete chat', icon: '🗑', onClick: () => handleDeleteChat(taskId) },
            ];
        }
        const queuedIndex = queued.findIndex(t => t.id === taskId);
        const task = queued[queuedIndex];
        const isFrozen = task?.frozen;
        const isHeld = isAutopilotPaused && task?.payload?.mode === 'autopilot' && !task?.admitted;
        const isAdmitted = isAutopilotPaused && task?.payload?.mode === 'autopilot' && !!task?.admitted;
        return [
            ...(queuedIndex > 0 ? [{ label: 'Move Up', icon: '▲', onClick: () => handleMoveUp(taskId) }] : []),
            { label: 'Move to Top', icon: '⏬', onClick: () => handleMoveToTop(taskId) },
            { label: '', icon: '', separator: true, onClick: () => {} },
            ...(isHeld ? [{ label: 'Schedule Immediately', icon: '🚀', onClick: () => handleAdmit(taskId) }] : []),
            ...(isAdmitted ? [{ label: 'Cancel Scheduling', icon: '🚫', onClick: () => handleUnadmit(taskId) }] : []),
            ...((isHeld || isAdmitted) ? [{ label: '', icon: '', separator: true, onClick: () => {} }] : []),
            { label: 'Copy metadata', icon: '📋', onClick: () => {
                if (task) void copyToClipboard(formatMetadataText(task));
                closeContextMenu();
            }},
            isFrozen
                ? { label: 'Unfreeze', icon: '▶', onClick: () => handleUnfreeze(taskId) }
                : { label: 'Freeze', icon: '❄', onClick: () => handleFreeze(taskId) },
            { label: 'Cancel', icon: '✕', onClick: () => handleCancel(taskId) },
        ];
    }, [contextMenu, queued, running, history, unseenProcessIds, pinnedChatIds, archivedChatIds, onMarkRead, onMarkUnread, onPinChat, onUnpinChat, onArchiveChat, onUnarchiveChat, onArchiveChats, onUnarchiveChats, onSetGroupPin, setGroupPinned, closeContextMenu, deleteChatDirect, workspaceId, onSelectTask, fetchQueue, isAutopilotPaused, buildMoveToFolderItems, buildGroupMoveToFolderItems]);

    /** Render a single history card (shared between flat and grouped layouts). */
    /**
     * Render a single compact row, used for ALL task types (chat, workflow, script)
     * across both the chats and activity branches.
     *
     * Layout (CSS grid): [status-dot 10px] [MODE pill 20px] [title 1fr] [right auto]
     * - Mode pill: ASK / AUTO (chat) or AUTO / SCRP (non-chat).
     * - Status dot encodes runtime state independently of the mode pill.
     * - On hover the timestamp swaps to inline pin/archive/more buttons.
     * - Queue states (held / scheduled / frozen) are surfaced via inline indicator badges.
     */
    const renderChatListRow = useCallback((task: any, listForRange: HistoryRangeInput[], options?: {
        dataTestid?: string;
        /** Override status derivation when caller knows the section the row is rendered in. */
        taskStatus?: 'running' | 'queued' | 'completed';
        /** True when the row is rendered as a child under an expanded HistoryGroupHeader.
         *  Enables muted mode-pill variant + a `data-group-child` marker so the row
         *  reads as nested rather than a sibling top-level chat. */
        isGroupChild?: boolean;
        /** Replaces the status dot in the first grid column when provided (e.g. a
         *  spawned-tree expand/collapse chevron) so the mode pill/avatar stays aligned. */
        leadingElement?: React.ReactNode;
        /** Files a whole group instead of this one chat when the row roots a
         *  filable group — today the root of a spawned tree (AC-03). */
        groupFolder?: GroupFolderTarget;
    }) => {
        const isUnseen = unseenProcessIds?.has(task.id) ?? false;
        const hasDraft = !!getDraft(task.id);
        const isInRunning = running.some((r: any) => r.id === task.id);
        const taskStatus: 'running' | 'queued' | 'completed' = options?.taskStatus
            ?? (isInRunning ? 'running' : 'completed');
        const isRunning = taskStatus === 'running';
        const isQueued = taskStatus === 'queued';
        const isFailed = !isRunning && task.status === 'failed';
        const isPinned = pinnedChatIds?.has(task.id) ?? false;
        const isArchived = archivedChatIds?.has(task.id) ?? false;
        const isHistorySelected = selectedHistoryIds.has(task.id);
        const isRowSelected = isSelected(task.id);
        const isFrozen = !!task.frozen;
        const isHeld = isAutopilotPaused === true && isQueued && task.payload?.mode === 'autopilot' && !task.admitted;
        const isAdmitted = isAutopilotPaused === true && isQueued && task.payload?.mode === 'autopilot' && !!task.admitted;
        const askUserCountOnTask = typeof task?.pendingAskUserCount === 'number' ? task.pendingAskUserCount : 0;
        const isAwaitingInput = isRunning && (
            (!!task.processId && (awaitingInputProcessIds?.has(task.processId) ?? false))
            || (awaitingInputProcessIds?.has(task.id) ?? false)
            || askUserCountOnTask > 0
        );
        const taskProvider = getTaskChatProvider(task);
        // A filed row still appears in Running / Queued when it is active — it is
        // never hidden from those sections — so it carries a folder-name chip to
        // say where it lives. Search results carry one for the same reason: the
        // tree flattens while a query is active, so the chip is the only thing
        // left saying where a result lives (AC-08). Rows rendered *inside* a
        // folder need no chip, and an unfiled row gets none rather than one
        // reading "Unfiled".
        const rowFolder = chatFoldersEnabled && !options?.isGroupChild && (isRunning || isQueued || !!folderSearchQuery)
            ? foldersById.get(resolveEntryFolderId(task, folderIdByProcess, groupFolderIndex) ?? '')
            : undefined;
        const forEachGenerationPreview = getForEachGenerationPreview(task);
        const mapReduceGenerationPreview = getMapReduceGenerationPreview(task);

        const modeKey = getTaskModeKey(task);
        const modeLabel = getTaskModeLabel(task);
        const taskModeLabel = task.type === 'chat'
            ? CHAT_MODE_LABELS[normalizeChatMode(task.payload?.mode ?? task.mode) ?? 'autopilot']
            : undefined;
        const modeTitle = task.type === 'chat'
            ? (isRalphTask(task)
                ? 'Ralph'
                : (taskModeLabel || 'Autopilot'))
            : task.type === 'run-script' ? 'Script' : 'Workflow';

        // Display title for the sidebar row.
        // Priority (per rename feature):
        //   1) User-set custom title (rename UI)
        //   2) Latest message preview (denormalized snapshot of newest turn)
        //   3) Prompt-based fallback (truncated)
        //   4) Task type / 'Task'
        const promptText = (task.prompt || task.promptPreview || task.payload?.promptContent || task.payload?.prompt || '') as string;
        const promptFallback = promptText && !/^Use the \S+ skill\.$/.test(promptText)
            ? (promptText.length > 50 ? promptText.substring(0, 47) + '…' : promptText)
            : (task.type === 'chat' ? 'Chat' : (task.type || 'Task'));
        // Display priority: customTitle → AI title → lastMessagePreview → promptFallback
        const titleText = (task.customTitle as string | undefined)
            || (task.title as string | undefined)
            || (task.lastMessagePreview as string | undefined)
            || promptFallback;

        const ts = task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt;
        const timeText = isRunning
            ? statusLabel('running', task.type)
            : (ts ? formatRelativeTime(new Date(ts).toISOString()) : '');

        // Mode badge: tinted border + soft tinted background, font:9.5px/1 mono uppercase.
        // When rendered as a group child, render a muted variant (lower-contrast border/bg,
        // same text color) so the parent's aggregate-mode pill remains the dominant anchor.
        const isGroupChild = !!options?.isGroupChild;
        const modeBadgeClasses = cn(
            'inline-flex items-center justify-center border font-mono font-bold uppercase select-none',
            'text-[9.5px] leading-none tracking-[0.06em] py-[4px] w-full',
            modeKey === 'ask' ? 'rounded-full' : 'rounded-[3px]',
            !isGroupChild && modeKey === 'ask' && 'text-amber-600 dark:text-amber-400 border-amber-400/70 dark:border-amber-500/60 bg-amber-50/60 dark:bg-amber-500/10',
            !isGroupChild && modeKey === 'auto' && 'text-emerald-600 dark:text-emerald-400 border-emerald-500/70 dark:border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-500/10',
            !isGroupChild && modeKey === 'script' && 'text-[#1e1e1e] dark:text-[#dcdcdc] border-[#3c3c3c]/55 dark:border-[#9d9d9d]/45 bg-[#1e1e1e]/[0.06] dark:bg-[#dcdcdc]/[0.06]',
            !isGroupChild && modeKey === 'ralph' && 'text-purple-600 dark:text-purple-400 border-purple-500/70 dark:border-purple-500/60 bg-purple-50/60 dark:bg-purple-500/10',
            isGroupChild && modeKey === 'ask' && 'text-amber-600 dark:text-amber-400 border-amber-400/30 dark:border-amber-500/25 bg-transparent',
            isGroupChild && modeKey === 'auto' && 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 dark:border-emerald-500/25 bg-transparent',
            isGroupChild && modeKey === 'script' && 'text-[#1e1e1e] dark:text-[#dcdcdc] border-[#3c3c3c]/25 dark:border-[#9d9d9d]/20 bg-transparent',
            isGroupChild && modeKey === 'ralph' && 'text-purple-600 dark:text-purple-400 border-purple-500/30 dark:border-purple-500/25 bg-transparent',
        );

        const dotClasses = cn(
            'w-2 h-2 rounded-full justify-self-center transition-shadow',
            isRunning && isAwaitingInput && 'bg-amber-500 dark:bg-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.28)]',
            isRunning && !isAwaitingInput && getProviderDotClasses(taskProvider),
            isRunning && !isAwaitingInput && 'animate-pulse shadow-[0_0_0_3px_rgba(0,120,212,0.22)]',
            !isRunning && isFailed && 'bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.20)]',
            !isRunning && isQueued && !isFailed && 'bg-[#dcdcdc] dark:bg-[#6b6b6b]',
            !isRunning && !isQueued && !isFailed && 'bg-[#bbbbbb] dark:bg-[#5c5c5c]',
        );

        const stopAndCall = (cb: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); cb(); };

        const contextMenuKind: 'running' | 'queued' | 'completed' = taskStatus;
        const defaultTestid = isRunning ? 'running-task-row' : isQueued ? 'queued-task-row' : 'history-task-row';
        const rowTitle = isAwaitingInput ? `${titleText} — waiting for your input` : titleText;
        const sessionContextPayload = sessionContextDragEnabled
            ? createSessionContextDragPayload(task, {
                activeWorkspaceId: workspaceId,
                idSource: task.processId || (!isRunning && !isQueued) ? 'process' : 'queue-task',
            })
            : null;
        /**
         * Whether this row may also carry a folder-move payload (AC-07).
         * Queued rows are excluded on purpose: their gesture belongs to the
         * queue's reorder drag, and AC-06 already left them out of the
         * "Move to folder" menu for the same reason.
         */
        const folderFilable = chatFoldersEnabled && !isQueued && !!workspaceId;
        const rowDraggable = !!sessionContextPayload || folderFilable;

        return (
            <SwipeableHistoryItem
                key={task.id}
                isMobile={isMobile}
                onArchive={() => onArchiveChat(task.id)}
                onUnarchive={() => onUnarchiveChat(task.id)}
            >
                <div
                    className={cn(
                        'chat-row group relative cursor-pointer leading-none transition-colors',
                        'grid items-center gap-2 px-4 py-2 md:px-3 md:py-1',
                        'grid-cols-[10px_20px_minmax(0,1fr)_auto]',
                        'text-[12.5px] min-h-[40px] md:min-h-0 md:h-[26px]',
                        'border-b border-[#e0e0e0]/60 dark:border-[#3c3c3c]/60',
                        'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2b]',
                        isFrozen && 'opacity-70 task-frozen',
                        isArchived && 'opacity-70',
                        isAwaitingInput && 'bg-amber-50/70 dark:bg-amber-500/[0.08] border-l-2 border-l-amber-400 dark:border-l-amber-500',
                        !isAwaitingInput && isPinned && !isQueued && 'border-l-2 border-l-amber-400 dark:border-l-amber-500',
                        isHistorySelected && 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10 outline outline-1 outline-[#0078d4]/40 dark:outline-[#3794ff]/40',
                        !isHistorySelected && isRowSelected && 'bg-[#0078d4]/[0.08] dark:bg-[#3794ff]/[0.10] ring-2 ring-[#0078d4]/40 dark:ring-[#3794ff]/40',
                        !isHistorySelected && isRowSelected && 'before:content-[""] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[#0078d4] dark:before:bg-[#3794ff]',
                        selectedHistoryIds.size > 0 && 'select-none',
                    )}
                    onClick={(e) => {
                        if (historyLongPress.didLongPress()) return;
                        if (isQueued || isMobile) {
                            // Queue rows and mobile taps don't participate in shift-range
                            // selection — go straight to detail on a single tap.
                            onSelectTask(task.id, task);
                            return;
                        }
                        handleHistoryItemClick(e, task, listForRange);
                    }}
                    onContextMenu={(e) => handleTaskContextMenu(e, task.id, contextMenuKind, options?.groupFolder)}
                    draggable={rowDraggable}
                    onDragStart={rowDraggable ? (e) => handleChatRowDragStart(e, task, sessionContextPayload, folderFilable, options?.groupFolder) : undefined}
                    onDragEnd={rowDraggable ? handleChatRowDragEnd : undefined}
                    onTouchStart={(e) => {
                        historyLongPressTaskRef.current = task.id;
                        historyLongPress.onTouchStart(e);
                    }}
                    onTouchEnd={historyLongPress.onTouchEnd}
                    onTouchMove={historyLongPress.onTouchMove}
                    data-task-id={task.id}
                    data-testid={options?.dataTestid ?? defaultTestid}
                    data-unseen={isUnseen || undefined}
                    data-selected={isHistorySelected || undefined}
                    data-pinned={isPinned ? 'true' : undefined}
                    data-archived={isArchived ? 'true' : undefined}
                    data-group-child={isGroupChild ? 'true' : undefined}
                    data-awaiting-input={isAwaitingInput ? 'true' : undefined}
                    data-session-context-source={sessionContextPayload ? 'true' : undefined}
                    data-session-context-status={sessionContextPayload?.status}
                    title={sessionContextPayload ? `${rowTitle} — drag to attach as session context` : rowTitle}
                >
                    {options?.leadingElement ?? (
                        <span className={dotClasses} aria-label={`status: ${isAwaitingInput ? 'awaiting input' : isRunning ? 'running' : isFailed ? 'failed' : isQueued ? 'queued' : 'done'}`} />
                    )}
                    <span className={modeBadgeClasses} title={modeTitle}>{modeLabel}</span>
                    <span className="min-w-0 flex items-center gap-1 overflow-hidden">
                        {isHistorySelected && (
                            <span className="shrink-0 text-[#0078d4] dark:text-[#3794ff] text-[10px]" data-testid="selection-checkbox">☑</span>
                        )}
                        {isUnseen && (
                            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]" data-testid="unseen-dot" />
                        )}
                        {isPinned && !isQueued && (
                            <span className="shrink-0 text-[10px] text-amber-500 dark:text-amber-400" title="Pinned" aria-hidden="true">📌</span>
                        )}
                        {isFrozen && (
                            <span className="shrink-0 text-[10px] text-[#848484]" title="Frozen" aria-hidden="true">❄️</span>
                        )}
                        <span
                            className={cn('chat-title truncate text-[#1e1e1e] dark:text-[#cccccc] cursor-text select-none', isUnseen && 'font-semibold', isFailed && 'text-red-700 dark:text-red-400', isFrozen && 'text-[#848484]')}
                            title={isDesktopShell() ? 'Double-click to open in a new window' : 'Double-click to rename'}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (isDesktopShell()) {
                                    openChatPopOut({ taskId: task.id, workspaceId, markPoppedOut, addToast: toastCtx?.addToast });
                                    return;
                                }
                                setRenameTarget({ taskId: task.id, title: (task as any).customTitle || '' });
                            }}
                        >
                            {titleText}
                        </span>
                        {forEachGenerationPreview && (
                            <>
                                <span
                                    className="shrink-0 rounded-full border border-sky-400/60 dark:border-sky-400/50 bg-sky-50/80 dark:bg-sky-400/10 px-1.5 py-[1px] text-[9.5px] font-semibold leading-none text-sky-700 dark:text-sky-300"
                                    title="For Each generation chat"
                                    data-testid="for-each-generation-badge"
                                >
                                    For Each
                                </span>
                                <span
                                    className="shrink min-w-0 max-w-[150px] truncate text-[10px] font-medium leading-none text-sky-700 dark:text-sky-300"
                                    title={forEachGenerationPreview}
                                    data-testid="for-each-generation-preview"
                                >
                                    {forEachGenerationPreview}
                                </span>
                            </>
                        )}
                        {mapReduceGenerationPreview && (
                            <>
                                <span
                                    className="shrink-0 rounded-full border border-indigo-400/60 dark:border-indigo-400/50 bg-indigo-50/80 dark:bg-indigo-400/10 px-1.5 py-[1px] text-[9.5px] font-semibold leading-none text-indigo-700 dark:text-indigo-300"
                                    title="Map Reduce generation chat"
                                    data-testid="map-reduce-generation-badge"
                                >
                                    Map Reduce
                                </span>
                                <span
                                    className="shrink min-w-0 max-w-[170px] truncate text-[10px] font-medium leading-none text-indigo-700 dark:text-indigo-300"
                                    title={mapReduceGenerationPreview}
                                    data-testid="map-reduce-generation-preview"
                                >
                                    {mapReduceGenerationPreview}
                                </span>
                            </>
                        )}
                        {isHeld && (
                            <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400 font-medium" data-testid="held-badge">[held]</span>
                        )}
                        {isAdmitted && (
                            <span className="shrink-0 text-[10px] text-green-600 dark:text-green-400 font-medium" data-testid="admitted-badge">[scheduled]</span>
                        )}
                        {hasDraft && (
                            <span className="shrink-0 text-[10px] text-[#848484]" title="Unsent draft" data-testid="draft-badge">✏️</span>
                        )}
                        {(() => {
                            const cat = getSessionCategory(task);
                            const m = cat ? SESSION_CATEGORY_LABELS[cat] : undefined;
                            return m ? (
                                <span className={cn('shrink-0 text-[10px] font-medium', m.color)} data-testid="session-category-badge">{m.icon}</span>
                            ) : null;
                        })()}
                        {(() => {
                            if (!cronEnabled) return null;
                            const taskProcessId = task.processId || task.id;
                            const state = cronStateByProcess.get(task.id) ?? cronStateByProcess.get(taskProcessId);
                            if (!state) return null;
                            return (
                                <span
                                    className={cn(
                                        'shrink-0 text-[10px]',
                                        state === 'active'
                                            ? 'text-[#15703a] dark:text-[#4ade80]'
                                            : 'text-[#8a5a00] dark:text-[#fbbf24]',
                                    )}
                                    title={state === 'active' ? 'Has active crons' : 'Has paused crons'}
                                    data-testid="cron-indicator"
                                >
                                    <CronIcon className="w-3.5 h-3.5" />
                                </span>
                            );
                        })()}
                    </span>
                    {rowFolder && <ChatFolderChip name={rowFolder.name} color={rowFolder.color} />}
                    <span className={cn('flex items-center gap-1', isAwaitingInput ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-[#848484] dark:text-[#999]')}>
                        <span className="chat-row-when text-[10.5px] font-mono tabular-nums whitespace-nowrap group-hover:hidden">
                            {isRunning ? (
                                isAwaitingInput ? (
                                    <span className="inline-flex items-center gap-1" data-testid="awaiting-input-indicator">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                                        Needs input
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1" data-testid="thinking-indicator">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff] animate-pulse" />
                                        {statusLabel('running', task.type)}
                                    </span>
                                )
                            ) : timeText}
                        </span>
                        <span className="chat-row-actions hidden group-hover:flex items-center gap-0">
                            {!isQueued && (
                                <button
                                    type="button"
                                    className="h-5 w-5 grid place-items-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#ececec] dark:hover:bg-[#2f2f30]"
                                    title={isPinned ? 'Unpin' : 'Pin'}
                                    aria-label={isPinned ? 'Unpin chat' : 'Pin chat'}
                                    data-testid="chat-row-pin"
                                    onClick={stopAndCall(() => (isPinned ? onUnpinChat?.(task.id) : onPinChat?.(task.id)))}
                                >
                                    <svg width="12" height="12" viewBox="0 0 14 14" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M9 1.5l3.5 3.5-2 1-1.5 4-2-2-3 3-.5-.5 3-3-2-2 4-1.5 1-1z"/>
                                    </svg>
                                </button>
                            )}
                            {!isRunning && !isQueued && (
                                <button
                                    type="button"
                                    className="h-5 w-5 grid place-items-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#ececec] dark:hover:bg-[#2f2f30]"
                                    title={isArchived ? 'Unarchive' : 'Archive'}
                                    aria-label={isArchived ? 'Unarchive chat' : 'Archive chat'}
                                    data-testid="chat-row-archive"
                                    onClick={stopAndCall(() => (isArchived ? onUnarchiveChat?.(task.id) : onArchiveChat?.(task.id)))}
                                >
                                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                                        <rect x="2" y="2.5" width="10" height="2.5" rx=".5"/>
                                        <path d="M3 5v6.5h8V5M5.5 7.5h3"/>
                                    </svg>
                                </button>
                            )}
                            <button
                                type="button"
                                className="h-5 w-5 grid place-items-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#ececec] dark:hover:bg-[#2f2f30]"
                                title="More"
                                aria-label="More actions"
                                data-testid="chat-row-more"
                                onClick={(e) => { e.stopPropagation(); handleTaskContextMenu(e, task.id, contextMenuKind); }}
                            >
                                <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                                    <circle cx="3.5" cy="7" r="1"/>
                                    <circle cx="7" cy="7" r="1"/>
                                    <circle cx="10.5" cy="7" r="1"/>
                                </svg>
                            </button>
                        </span>
                    </span>
                </div>
            </SwipeableHistoryItem>
        );
    }, [
        unseenProcessIds,
        awaitingInputProcessIds,
        running,
        chatFoldersEnabled,
        folderSearchQuery,
        foldersById,
        folderIdByProcess,
        pinnedChatIds,
        archivedChatIds,
        selectedHistoryIds,
        isAutopilotPaused,
        isMobile,
        isSelected,
        handleHistoryItemClick,
        handleTaskContextMenu,
        onArchiveChat,
        onUnarchiveChat,
        onPinChat,
        onUnpinChat,
        cronStateByProcess,
        cronEnabled,
        sessionContextDragEnabled,
        handleChatRowDragStart,
        handleChatRowDragEnd,
        onSelectTask,
        historyLongPress,
        workspaceId,
    ]);

    const getGroupedChildTaskStatus = useCallback((task: any): 'running' | 'queued' | 'completed' => {
        if (tabFilteredRunning.some(candidate => candidate.id === task.id || candidate.processId === task.id || candidate.id === task.processId || candidate.processId === task.processId)) {
            return 'running';
        }
        if (tabFilteredQueued.some((candidate: any) => candidate.id === task.id || candidate.processId === task.id || candidate.id === task.processId || candidate.processId === task.processId)) {
            return 'queued';
        }
        return 'completed';
    }, [tabFilteredRunning, tabFilteredQueued]);

    const renderRalphSessionGroup = useCallback((session: RalphSession, listForRange: HistoryRangeInput[]) => {
        const ralphSubIds = getRalphSessionSubIds(session);
        const { isFullySelected: isRalphRangeSelected, isPartiallySelected: isRalphPartiallySelected } =
            resolveGroupSelectionState(ralphSubIds, selectedHistoryIds);
        const isPinned = isPinnedGroupEntry(session) || isGroupPinned('ralph-session', session.sessionId);
        const groupPin: GroupPinMenuTarget = {
            type: 'ralph-session',
            groupId: session.sessionId,
            isPinned,
            label: 'Ralph session',
        };
        const ralphSessionContextPayload = sessionContextDragEnabled
            ? createRalphSessionContextDragPayload(session, { activeWorkspaceId: workspaceId })
            : null;
        // Rides the SAME gesture as the session-context drag, written second so
        // its wider `effectAllowed` wins — a composer still gets 'copy', a
        // folder row gets 'move' (AC-04).
        const ralphDragProps = buildGroupRowDragProps({ type: 'ralph-session', groupId: session.sessionId }, ralphSubIds);
        const openContextMenu = (x: number, y: number) => {
            const ids = [session.grillingProcess?.id, ...session.iterations.map((i: any) => i.id)].filter(Boolean) as string[];
            setSelectedHistoryIds(new Set(ids));
            setContextMenu({
                x,
                y,
                taskId: ids[0] ?? session.sessionId,
                taskStatus: 'completed',
                bulkIds: ids,
                ralphSession: session,
                groupPin,
                groupFolder: { type: 'ralph-session', groupId: session.sessionId },
            });
        };
        return (
            <RalphSessionRow
                key={`${workspaceId ?? '__all'}:${session.sessionId}`}
                session={session}
                selectedTaskId={selectedTaskId}
                selectedSessionId={selectedRalphSessionId}
                isRangeSelected={isRalphRangeSelected}
                isPartiallySelected={isRalphPartiallySelected}
                expanded={expandedRalphSessionIds.has(session.sessionId)}
                onToggleExpanded={() => toggleRalphSession(session.sessionId)}
                now={now}
                unseenProcessIds={unseenProcessIds}
                onSelectTask={onSelectTask}
                onSelectSession={(_sessionId, e) => handleHistoryGroupClick(
                    e,
                    getRalphSessionRangeId(session.sessionId),
                    listForRange,
                    () => {
                        if (onSelectRalphSession) onSelectRalphSession(session.sessionId);
                        else toggleRalphSession(session.sessionId);
                    },
                )}
                isPinned={isPinned}
                onTogglePin={onSetGroupPin ? () => setGroupPinned('ralph-session', session.sessionId, !isPinned) : undefined}
                onMoreActions={onSetGroupPin ? e => openContextMenu(e.clientX, e.clientY) : undefined}
                sessionContextPayload={ralphSessionContextPayload}
                onFolderMoveDragStart={ralphDragProps.onDragStart}
                onDragEnd={ralphDragProps.onDragEnd}
                onContextMenu={e => {
                    if (e.shiftKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu(e.clientX, e.clientY);
                }}
                onTouchStart={e => {
                    groupLongPressTargetRef.current = {
                        taskId: ralphSubIds[0] ?? session.sessionId,
                        bulkIds: ralphSubIds,
                        ralphSession: session,
                        groupPin,
                        groupFolder: { type: 'ralph-session', groupId: session.sessionId },
                    };
                    groupLongPress.onTouchStart(e);
                }}
                onTouchEnd={groupLongPress.onTouchEnd}
                onTouchMove={groupLongPress.onTouchMove}
                renderTaskCard={(task) => renderChatListRow(task, listForRange, { isGroupChild: true })}
            />
        );
    }, [
        buildGroupRowDragProps,
        expandedRalphSessionIds,
        groupLongPress,
        isGroupPinned,
        now,
        onSetGroupPin,
        onSelectRalphSession,
        onSelectTask,
        renderChatListRow,
        selectedHistoryIds,
        selectedRalphSessionId,
        selectedTaskId,
        sessionContextDragEnabled,
        handleHistoryGroupClick,
        toggleRalphSession,
        unseenProcessIds,
        workspaceId,
        setGroupPinned,
    ]);

    const renderForEachRunGroup = useCallback((group: ForEachRunGroup, listForRange: HistoryRangeInput[]) => {
        const forEachSubIds = getForEachRunSubIds(group);
        const { isFullySelected: isForEachRangeSelected, isPartiallySelected: isForEachPartiallySelected } =
            resolveGroupSelectionState(forEachSubIds, selectedHistoryIds);
        const isPinned = isPinnedGroupEntry(group) || isGroupPinned('for-each-run', group.runId);
        const groupPin: GroupPinMenuTarget = {
            type: 'for-each-run',
            groupId: group.runId,
            isPinned,
            label: 'For Each run',
        };
        const openContextMenu = (x: number, y: number) => {
            setSelectedHistoryIds(new Set(forEachSubIds));
            setContextMenu({
                x,
                y,
                taskId: forEachSubIds[0] ?? group.runId,
                taskStatus: 'completed',
                bulkIds: forEachSubIds.length > 0 ? forEachSubIds : undefined,
                forEachRun: group,
                groupPin,
                groupFolder: { type: 'for-each-run', groupId: group.runId },
            });
        };
        return (
            <ForEachRunRow
                key={`${workspaceId ?? '__all'}:for-each:${group.runId}`}
                group={group}
                selectedRunId={selectedForEachRunId}
                isRangeSelected={isForEachRangeSelected}
                isPartiallySelected={isForEachPartiallySelected}
                expanded={expandedForEachRunIds.has(group.runId)}
                onToggleExpanded={() => toggleForEachRun(group.runId)}
                now={now}
                onSelectRun={(_runId, e) => handleHistoryGroupClick(
                    e,
                    getForEachRunRangeId(group.runId),
                    listForRange,
                    () => {
                        if (onSelectForEachRun) onSelectForEachRun(group.runId);
                        else toggleForEachRun(group.runId);
                    },
                )}
                isPinned={isPinned}
                onTogglePin={onSetGroupPin ? () => setGroupPinned('for-each-run', group.runId, !isPinned) : undefined}
                onMoreActions={onSetGroupPin ? e => openContextMenu(e.clientX, e.clientY) : undefined}
                {...buildGroupRowDragProps({ type: 'for-each-run', groupId: group.runId }, forEachSubIds)}
                onContextMenu={e => {
                    if (e.shiftKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu(e.clientX, e.clientY);
                }}
                onTouchStart={e => {
                    groupLongPressTargetRef.current = {
                        taskId: forEachSubIds[0] ?? group.runId,
                        bulkIds: forEachSubIds.length > 0 ? forEachSubIds : undefined,
                        forEachRun: group,
                        groupPin,
                        groupFolder: { type: 'for-each-run', groupId: group.runId },
                    };
                    groupLongPress.onTouchStart(e);
                }}
                onTouchEnd={groupLongPress.onTouchEnd}
                onTouchMove={groupLongPress.onTouchMove}
                renderTaskCard={(task) => renderChatListRow(task, listForRange, {
                    taskStatus: getGroupedChildTaskStatus(task),
                    isGroupChild: true,
                })}
            />
        );
    }, [
        buildGroupRowDragProps,
        expandedForEachRunIds,
        getGroupedChildTaskStatus,
        groupLongPress,
        handleHistoryGroupClick,
        isGroupPinned,
        now,
        onSelectForEachRun,
        onSetGroupPin,
        renderChatListRow,
        selectedForEachRunId,
        selectedHistoryIds,
        setGroupPinned,
        toggleForEachRun,
        workspaceId,
    ]);

    const renderMapReduceRunGroup = useCallback((group: MapReduceRunGroup, listForRange: HistoryRangeInput[]) => {
        const mapReduceSubIds = getMapReduceRunSubIds(group);
        const { isFullySelected: isMapReduceRangeSelected, isPartiallySelected: isMapReducePartiallySelected } =
            resolveGroupSelectionState(mapReduceSubIds, selectedHistoryIds);
        const isPinned = isPinnedGroupEntry(group) || isGroupPinned('map-reduce-run', group.runId);
        const groupPin: GroupPinMenuTarget = {
            type: 'map-reduce-run',
            groupId: group.runId,
            isPinned,
            label: 'Map Reduce run',
        };
        const openContextMenu = (x: number, y: number) => {
            setSelectedHistoryIds(new Set(mapReduceSubIds));
            setContextMenu({
                x,
                y,
                taskId: mapReduceSubIds[0] ?? group.runId,
                taskStatus: 'completed',
                bulkIds: mapReduceSubIds.length > 0 ? mapReduceSubIds : undefined,
                mapReduceRun: group,
                groupPin,
                groupFolder: { type: 'map-reduce-run', groupId: group.runId },
            });
        };
        return (
            <MapReduceRunRow
                key={`${workspaceId ?? '__all'}:map-reduce:${group.runId}`}
                group={group}
                selectedRunId={selectedMapReduceRunId}
                isRangeSelected={isMapReduceRangeSelected}
                isPartiallySelected={isMapReducePartiallySelected}
                expanded={expandedMapReduceRunIds.has(group.runId)}
                onToggleExpanded={() => toggleMapReduceRun(group.runId)}
                now={now}
                onSelectRun={(_runId, e) => handleHistoryGroupClick(
                    e,
                    getMapReduceRunRangeId(group.runId),
                    listForRange,
                    () => {
                        if (onSelectMapReduceRun) onSelectMapReduceRun(group.runId);
                        else toggleMapReduceRun(group.runId);
                    },
                )}
                isPinned={isPinned}
                onTogglePin={onSetGroupPin ? () => setGroupPinned('map-reduce-run', group.runId, !isPinned) : undefined}
                onMoreActions={onSetGroupPin ? e => openContextMenu(e.clientX, e.clientY) : undefined}
                {...buildGroupRowDragProps({ type: 'map-reduce-run', groupId: group.runId }, mapReduceSubIds)}
                onContextMenu={e => {
                    if (e.shiftKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu(e.clientX, e.clientY);
                }}
                onTouchStart={e => {
                    groupLongPressTargetRef.current = {
                        taskId: mapReduceSubIds[0] ?? group.runId,
                        bulkIds: mapReduceSubIds.length > 0 ? mapReduceSubIds : undefined,
                        mapReduceRun: group,
                        groupPin,
                        groupFolder: { type: 'map-reduce-run', groupId: group.runId },
                    };
                    groupLongPress.onTouchStart(e);
                }}
                onTouchEnd={groupLongPress.onTouchEnd}
                onTouchMove={groupLongPress.onTouchMove}
                renderTaskCard={(task) => renderChatListRow(task, listForRange, {
                    taskStatus: getGroupedChildTaskStatus(task),
                    isGroupChild: true,
                })}
            />
        );
    }, [
        buildGroupRowDragProps,
        expandedMapReduceRunIds,
        getGroupedChildTaskStatus,
        groupLongPress,
        handleHistoryGroupClick,
        isGroupPinned,
        now,
        onSelectMapReduceRun,
        onSetGroupPin,
        renderChatListRow,
        selectedMapReduceRunId,
        selectedHistoryIds,
        setGroupPinned,
        toggleMapReduceRun,
        workspaceId,
    ]);

    const renderSpawnedTreeEntry = useCallback((entry: SpawnedTreeEntry, listForRange: HistoryRangeInput[]) => {
        return (
            <SpawnedTreeRow
                key={`${workspaceId ?? '__all'}:spawned-tree:${entry.rootProcessId}`}
                entry={entry}
                collapsedIds={collapsedSpawnedIds}
                onToggleCollapsed={toggleSpawnedCollapsed}
                renderTaskCard={(task, opts) => renderChatListRow(task, listForRange, {
                    taskStatus: getGroupedChildTaskStatus(task),
                    isGroupChild: opts.isGroupChild,
                    leadingElement: opts.leadingElement,
                    // Only the root row files the tree; a descendant keeps its
                    // own single-chat "Move to folder".
                    groupFolder: opts.isGroupChild
                        ? undefined
                        : { type: 'spawned-tree', groupId: entry.rootProcessId },
                })}
            />
        );
    }, [collapsedSpawnedIds, toggleSpawnedCollapsed, renderChatListRow, getGroupedChildTaskStatus, workspaceId]);

    /**
     * One row inside a folder. A filed *group* — a ralph session, a for-each or
     * map-reduce run, a spawned tree — renders with its own group renderer so
     * it keeps its children nested and its header affordances, exactly as it
     * would in a date bucket; only a plain chat falls through to the flat row.
     */
    const renderFolderMember = useCallback((entry: any, listForRange: HistoryRangeInput[]): React.ReactNode => {
        if (entry?.kind === 'ralph-session') {return renderRalphSessionGroup(entry, listForRange);}
        if (entry?.kind === 'for-each-run') {return renderForEachRunGroup(entry, listForRange);}
        if (entry?.kind === 'map-reduce-run') {return renderMapReduceRunGroup(entry, listForRange);}
        if (entry?.kind === 'spawned-tree') {return renderSpawnedTreeEntry(entry, listForRange);}
        return renderChatListRow(entry, listForRange, { isGroupChild: true });
    }, [renderRalphSessionGroup, renderForEachRunGroup, renderMapReduceRunGroup, renderSpawnedTreeEntry, renderChatListRow]);

    /**
     * The Folders section, rendered from a single place for every list surface.
     * Activity, Chats, Tasks and a repo group's Workspace tab all go through
     * this component — one renderer, not four copies of the JSX.
     */
    const renderFoldersSection = useCallback((
        rows: ChatFolderRow[],
        listForRange: HistoryRangeInput[],
    ): React.ReactNode => {
        if (!chatFoldersEnabled) {return null;}
        return (
            <ChatFolderSection
                rows={rows}
                expanded={showFolders}
                onToggleSection={() => setShowFolders(prev => !prev)}
                onToggleFolder={toggleFolderCollapsed}
                renderMember={entry => renderFolderMember(entry, listForRange)}
                onOpenFolderMenu={openFolderMenu}
                creating={chatFolderMutations.creating}
                onCommitCreate={(name, color) => { void handleCommitFolderCreate(name, color); }}
                onCancelCreate={handleCancelFolderCreate}
                renamingFolderId={chatFolderMutations.renamingFolderId}
                onStartRename={chatFolderMutations.startRename}
                onCommitRename={(folderId, name) => { void chatFolderMutations.commitRename(folderId, name); }}
                onCancelRename={chatFolderMutations.cancelRename}
                isDuplicateName={isDuplicateFolderName}
                dropTarget={folderDnd.dropTarget}
                draggingFolderId={folderDnd.draggingFolderId}
                onFolderDragStart={folderDnd.handleFolderDragStart}
                onFolderDragEnd={folderDnd.handleDragEnd}
                onFolderDragOver={folderDnd.handleFolderDragOver}
                onFolderDragLeave={folderDnd.handleFolderDragLeave}
                onFolderDrop={folderDnd.handleFolderDrop}
                onNewFolder={() => { setShowFolders(true); chatFolderMutations.startCreate(); }}
                onCollapseAll={collapseAllFolders}
                collapseAllDisabled={chatFolders.length === 0}
                showWhenEmpty={!folderSearchQuery}
            />
        );
    }, [chatFoldersEnabled, showFolders, toggleFolderCollapsed, renderFolderMember, openFolderMenu, chatFolderMutations, isDuplicateFolderName, handleCommitFolderCreate, handleCancelFolderCreate, folderDnd, collapseAllFolders, chatFolders.length, folderSearchQuery]);

    const renderPinnedActivityEntry = useCallback((entry: PinnedListEntry) => {
        if (isPinnedGroupEntry(entry) && entry.kind === 'for-each-run') {
            return renderForEachRunGroup(entry, activityRangeRows);
        }
        if (isPinnedGroupEntry(entry) && entry.kind === 'map-reduce-run') {
            return renderMapReduceRunGroup(entry, activityRangeRows);
        }
        if (isPinnedGroupEntry(entry) && entry.kind === 'ralph-session') {
            return renderRalphSessionGroup(entry, activityRangeRows);
        }
        return renderChatListRow(entry, activityRangeRows, { taskStatus: 'completed' });
    }, [activityRangeRows, renderChatListRow, renderForEachRunGroup, renderMapReduceRunGroup, renderRalphSessionGroup]);

    // When a server-side search is active, always render the main body so FTS5 results
    // can be displayed even when the locally-loaded history page is empty.
    if (running.length === 0 && queued.length === 0 && history.length === 0 && forEachRunGroups.length === 0 && mapReduceRunGroups.length === 0 && !isServerSearchActive) {
        return (
            <>
            <div className="p-4 text-center text-sm text-[#848484]" data-testid="queue-empty-state">
                {isRefreshing && (
                    <div className="mb-2 animate-pulse" data-testid="queue-refreshing-indicator">Refreshing…</div>
                )}
                {activeTab === 'chats' ? (
                    <div>No chats yet</div>
                ) : isPaused ? (
                    <>
                        <div className="mb-2">Queue is paused</div>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={isPauseResumeLoading}
                            onClick={onPauseResume}
                            data-testid="repo-pause-resume-btn-empty"
                        >
                            ▶ Resume
                        </Button>
                    </>
                ) : (
                    <>
                        <div className="mb-2">{workspaceId ? 'No tasks in queue for this repository' : 'No tasks in queue'}</div>
                        {/* Activity-tab empty state exposes a desktop-visible "+ New"
                            action so users can start a chat without switching tabs or
                            relying on the mobile-only FAB. Scoped to the Activity tab
                            (`!activeTab`) and repo-scoped (`workspaceId`); reuses the
                            same `onNewChat` flow as the Activity/Chat list new-chat
                            action. Hidden on mobile, where the FAB below handles it. */}
                        {!activeTab && onNewChat && workspaceId && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onNewChat}
                                className={cn(isMobile && 'hidden')}
                                data-testid="activity-empty-new-chat-btn"
                            >
                                + New
                            </Button>
                        )}
                    </>
                )}
            </div>
            {isMobile && onNewChat && (
                <button
                    className="mobile-fab"
                    onClick={onNewChat}
                    data-testid="mobile-new-chat-fab-empty"
                    aria-label="New chat"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                </button>
            )}
            </>
        );
    }

    return (
        <>
            {/* No top padding on this scroll container: the sticky "New chat"
                header (`top-0`) full-bleeds to the container edges, so any top
                padding here would sit ABOVE it as a gap (sticky top-0 clamps to
                the padding edge, so a negative header margin can't cancel it).
                Keep horizontal + bottom padding. */}
            <div
                ref={containerRef}
                className="px-2 pb-2 md:px-4 md:pb-4 flex flex-col gap-2 md:gap-3 overflow-y-auto flex-1"
                data-testid="chat-list-pane"
            >
                {/* ── Chats tab: redesigned status-grouped list ── */}
                {activeTab === 'chats' && chatGroups && (
                    <>
                        <div
                            className="sticky top-0 z-10 -mx-2 md:-mx-4 px-2 md:px-4 py-1.5 md:py-2 flex flex-col gap-2 md:gap-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-white/[0.98] dark:bg-[#1e1e1e]/[0.98] backdrop-blur-md backdrop-saturate-150"
                            data-testid="chat-list-fixed-header"
                        >
                        <div className="flex items-center justify-between gap-2">
                            <Button variant="ghost" size="sm" onClick={onNewChat ?? onOpenDialog} className={cn("self-start", isMobile && "hidden")} data-testid="new-chat-btn">
                                💬 New Chat
                            </Button>
                        </div>

                        {/* Search bar — hidden by default; revealed with Ctrl+F / ⌘F (see the keydown handler). */}
                        {searchVisible && (
                        <div className="relative">
                            <span className="absolute left-[7px] top-1/2 -translate-y-1/2 text-[#848484] dark:text-[#a0a0a0] pointer-events-none" aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                                    <circle cx="7" cy="7" r="4.5" />
                                    <path d="M10.5 10.5l3 3" />
                                </svg>
                            </span>
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search…"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full h-7 rounded-md border border-[#e0e0e0] dark:border-[#474749] bg-[#f7f7f8] dark:bg-[#1e1e1e] pl-[26px] pr-14 text-[12.5px] leading-none text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#848484] outline-none focus:border-[#0078d4] dark:focus:border-[#3794ff] focus:bg-white dark:focus:bg-[#252526] focus:shadow-[0_0_0_3px_rgba(0,120,212,0.22)]"
                                data-testid="queue-search-input"
                                aria-label="Search conversations"
                            />
                            {searchLoading && (
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#848484] animate-pulse" data-testid="search-loading-indicator">⏳</span>
                            )}
                            {!searchQuery && !searchLoading && (
                                <kbd className="absolute right-[6px] top-1/2 -translate-y-1/2 text-[10.5px] font-mono text-[#848484] dark:text-[#a0a0a0] border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#252526] rounded-[3px] px-1 py-px pointer-events-none select-none">
                                    {kbdLabel}
                                </kbd>
                            )}
                            {searchQuery && !searchLoading && (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                                    <span className="text-[#848484] tabular-nums text-[10px]" data-testid="search-match-count">
                                        {isServerSearchActive ? searchTotal ?? 0 : chatAllItems.pinned.length + chatAllItems.unpinned.length + chatAllItems.archived.length}
                                    </span>
                                    <button
                                        className="text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] leading-none text-[12px]"
                                        onClick={() => setSearchQuery('')}
                                        data-testid="chat-search-close"
                                        aria-label="Clear search"
                                    >✕</button>
                                </div>
                            )}
                        </div>
                        )}

                        {/* Filter chips: All / Running / Failed (chips with zero count auto-hide except All) */}
                        {!isServerSearchActive && (
                            <div className="flex flex-wrap gap-[3px]" role="tablist" aria-label="Filter chats">
                                {([
                                    { id: 'all' as const, label: 'All', count: chatGroups.counts.all },
                                    { id: 'running' as const, label: 'Running', count: chatGroups.counts.running, dot: 'running' as const },
                                    { id: 'failed' as const, label: 'Failed', count: chatGroups.counts.failed, dot: 'failed' as const },
                                ]).filter(c => c.id === 'all' || c.count > 0).map(chip => {
                                    const isOn = chatFilter === chip.id;
                                    return (
                                        <button
                                            key={chip.id}
                                            role="tab"
                                            aria-selected={isOn}
                                            data-filter={chip.id}
                                            data-testid={`chat-filter-chip-${chip.id}`}
                                            onClick={() => setChatFilter(chip.id)}
                                            className={cn(
                                                'inline-flex items-center gap-[5px] rounded-[5px] border px-[7px] py-[4px] text-[11.5px] leading-none transition-[background-color,color,border-color] duration-100',
                                                isOn
                                                    ? 'text-[#1e1e1e] dark:text-[#ffffff] bg-[#0078d4]/[0.10] dark:bg-[#3794ff]/[0.16] border-[#0078d4]/35 dark:border-[#3794ff]/40'
                                                    : 'text-[#606060] dark:text-[#9d9d9d] border-transparent hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2b] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                            )}
                                        >
                                            {chip.dot === 'running' && (
                                                <span className="inline-block w-[5px] h-[5px] rounded-full bg-[#0078d4] dark:bg-[#3794ff] animate-pulse" aria-hidden="true" />
                                            )}
                                            {chip.dot === 'failed' && (
                                                <span className="inline-block w-[5px] h-[5px] rounded-full bg-red-500" aria-hidden="true" />
                                            )}
                                            <span>{chip.label}</span>
                                            <span className={cn('font-mono text-[10.5px] tabular-nums', isOn ? 'text-[#0078d4] dark:text-[#3794ff]' : 'text-[#9d9d9d] dark:text-[#7d7d7d]')}>
                                                {chip.count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        </div>

                        {/* FTS5 server-side search results (replaces normal sections when active) */}
                        {isServerSearchActive ? (
                            <div data-testid="chat-search-results">
                                <div className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium mb-1">
                                    🔍 Search Results
                                    <span className="text-[10px]">({searchResults!.length}{searchTotal != null && searchTotal > searchResults!.length ? ` of ${searchTotal}` : ''})</span>
                                </div>
                                {searchQuery.length === 1 && (
                                    <div className="text-[10px] text-[#848484] dark:text-[#bbb] italic" data-testid="chat-search-min-chars-hint">
                                        Type 2+ characters to search all conversations
                                    </div>
                                )}
                                {searchResults!.length === 0 && !searchLoading && (
                                    <div className="text-[10px] text-[#848484] dark:text-[#bbb]" data-testid="chat-search-no-results">
                                        No matching chats found
                                    </div>
                                )}
                                <div className="-mx-2 md:-mx-4 mt-1 flex flex-col">
                                    {searchResults!.map(task => (
                                        <React.Fragment key={task.id}>
                                            {renderChatListRow(task, searchResults!, { dataTestid: 'chat-search-result-item' })}
                                            {task._searchSnippet && (
                                                <div
                                                    className="px-3 pb-1 -mt-px text-[10px] truncate text-[#848484] dark:text-[#bbb] [&_mark]:bg-yellow-200 [&_mark]:dark:bg-yellow-700/50 [&_mark]:text-inherit [&_mark]:rounded-sm [&_mark]:px-px"
                                                    data-testid="chat-search-snippet"
                                                    dangerouslySetInnerHTML={{ __html: task._searchSnippet }}
                                                />
                                            )}
                                        </React.Fragment>
                                    ))}
                                </div>
                                {searchHasMore && onLoadMoreSearchResults && (
                                    <div className="px-4 py-2">
                                        <button
                                            onClick={onLoadMoreSearchResults}
                                            disabled={searchLoadingMore}
                                            className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                                            data-testid="chat-search-load-more-btn"
                                        >
                                            {searchLoadingMore ? 'Loading…' : 'Load more results'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* Status-priority groups: Running → Pinned → Today → This week → Older → Archived */
                            <div className="-mx-2 md:-mx-4 flex flex-col">
                                {(() => {
                                    const sections = [
                                        { id: 'running', label: 'Running', items: chatGroups.runningChats, variant: 'running' as const },
                                        { id: 'pinned', label: 'Pinned', items: chatGroups.pinnedChats, variant: 'pinned' as const },
                                        // Folders sit here — after Running/Pinned, before the date buckets.
                                        { id: 'today', label: 'Today', items: todayGrouped, variant: 'plain' as const },
                                        { id: 'week', label: 'This week', items: weekGrouped, variant: 'plain' as const },
                                        { id: 'older', label: 'Older', items: olderGrouped, variant: 'plain' as const },
                                    ];
                                    const visible = sections.filter(s => s.items.length > 0);
                                    const dateBucketIds = new Set(['today', 'week', 'older']);
                                    const rendered = visible
                                        .map(section => (
                                            <div
                                                key={section.id}
                                                data-section={section.id}
                                                // Dragging a chat back out onto a date bucket unfiles
                                                // it; Running and Pinned are not unfile targets, since
                                                // a filed row legitimately appears in both.
                                                {...(dateBucketIds.has(section.id) ? unfiledDropProps : {})}
                                            >
                                                <div
                                                    className={cn(
                                                        'sticky top-0 z-[2] flex items-center justify-between px-3 py-1 border-b backdrop-blur-md backdrop-saturate-150',
                                                        section.variant === 'running' && 'bg-[#0078d4]/[0.07] dark:bg-[#3794ff]/[0.10] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80',
                                                        section.variant === 'pinned' && 'bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80',
                                                        section.variant === 'plain' && 'bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80',
                                                    )}
                                                >
                                                    <span className={cn(
                                                        'inline-flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em]',
                                                        section.variant === 'running' && 'text-[#0078d4] dark:text-[#3794ff]',
                                                        section.variant === 'pinned' && 'text-[#848484] dark:text-[#a0a0a0]',
                                                        section.variant === 'plain' && 'text-[#848484] dark:text-[#a0a0a0]',
                                                    )}>
                                                        {section.variant === 'running' && (
                                                            <span className="w-[5px] h-[5px] rounded-full bg-[#0078d4] dark:bg-[#3794ff] animate-pulse" aria-hidden="true" />
                                                        )}
                                                        {section.variant === 'pinned' && (
                                                            <span className="w-[5px] h-[5px] rounded-full bg-[#0078d4] dark:bg-[#3794ff]" aria-hidden="true" />
                                                        )}
                                                        {section.label}
                                                    </span>
                                                    <span className={cn(
                                                        'text-[10px] leading-none font-mono tabular-nums',
                                                        section.variant === 'running' ? 'text-[#0078d4] dark:text-[#3794ff] font-semibold' : 'text-[#848484] dark:text-[#a0a0a0]',
                                                    )}>{section.items.length}</span>
                                                 </div>
                                                 {section.items.map((entry: RalphHistoryEntry | ForEachRunGroup | MapReduceRunGroup | SpawnedTreeEntry) => {
                                                       if (entry.kind === 'for-each-run') {
                                                           return renderForEachRunGroup(entry, chatRangeRows);
                                                       }
                                                       if (entry.kind === 'map-reduce-run') {
                                                           return renderMapReduceRunGroup(entry, chatRangeRows);
                                                       }
                                                       if (isSpawnedTreeEntry(entry)) {
                                                           return renderSpawnedTreeEntry(entry, chatRangeRows);
                                                       }
                                                       if (entry.kind === 'ralph-session') {
                                                           return renderRalphSessionGroup(entry as RalphSession, chatRangeRows);
                                                       }
                                                     return renderChatListRow(entry, chatRangeRows);
                                                 })}
                                            </div>
                                        ));
                                    const firstDateBucket = visible.findIndex(s => dateBucketIds.has(s.id));
                                    const cut = firstDateBucket === -1 ? rendered.length : firstDateBucket;
                                    return [
                                        ...rendered.slice(0, cut),
                                        <React.Fragment key="folders">{renderFoldersSection(chatFolderRows, chatRangeRows)}</React.Fragment>,
                                        ...rendered.slice(cut),
                                    ];
                                })()}

                                {chatGroups.flatVisible.length === 0 && !searchQuery && (
                                    <div className="text-center text-xs text-[#848484] py-4 px-3">
                                        {chatFilter === 'all' ? 'No chat sessions yet' : 'No chats match this filter'}
                                    </div>
                                )}
                                {chatGroups.flatVisible.length === 0 && searchQuery && (
                                    <div className="text-center text-xs text-[#848484] py-4 px-3" data-testid="chat-search-empty-state">
                                        No chats matching &ldquo;{searchQuery}&rdquo;
                                    </div>
                                )}

                                {(chatGroups.archivedChats.length > 0 || chatGroups.archivedSpawnedTrees.length > 0) && (
                                    <div data-section="archived">
                                        <button
                                            className="sticky top-0 z-[2] w-full flex items-center justify-between px-3 py-1 border-b bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80 hover:bg-[#f5f5f5] dark:hover:bg-[#252526] transition-colors backdrop-blur-md backdrop-saturate-150"
                                            onClick={() => setShowArchived(!showArchived)}
                                            data-testid="chat-archived-toggle"
                                        >
                                            <span className="inline-flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0]">
                                                <span className="text-[10px]">{showArchived ? '▼' : '▶'}</span>
                                                Archived
                                            </span>
                                            <span className="text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]">{chatGroups.archivedChats.length + chatGroups.archivedSpawnedTrees.length}</span>
                                        </button>
                                        {showArchived && (
                                            <div className="opacity-70">
                                                {chatGroups.archivedSpawnedTrees.map(entry => renderSpawnedTreeEntry(entry, chatRangeRows))}
                                                {chatGroups.archivedChats.map(task => renderChatListRow(task, chatGroups.archivedChats))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* ── Tasks tab: queue-style sections ── */}
                {activeTab !== 'chats' && (
                    <React.Fragment>
                <div
                    className="sticky top-0 z-10 -mx-2 md:-mx-4 px-2 md:px-4 py-1.5 md:py-2 flex flex-col gap-2 md:gap-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-white/[0.98] dark:bg-[#1e1e1e]/[0.98] backdrop-blur-md backdrop-saturate-150"
                    data-testid="chat-list-fixed-header"
                >
                {isPaused && (
                    <div className="rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 px-3 py-1.5 text-xs flex items-center gap-2" data-testid="queue-paused-banner">
                        <span className="flex-1">
                            {pauseReason
                                ? <>⏸ Queue paused — <strong>{pauseReason.displayName}</strong> failed at {new Date(pauseReason.failedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</>
                                : queuePauseRemaining
                                    ? <>⏸ Queue is paused for {queuePauseRemaining}{queuePauseResumeTime ? <> — resumes at {queuePauseResumeTime}.</> : <>.</>}</>
                                    : <>⏸ Queue is paused — new tasks will not start.</>
                            }
                        </span>
                        {pauseReason && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onSelectTask(pauseReason.taskId)}
                                data-testid="queue-banner-view-task-btn"
                            >
                                View Task
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" disabled={isPauseResumeLoading} onClick={onPauseResume} data-testid="queue-banner-resume-btn">
                            ▶ Resume
                        </Button>
                    </div>
                )}


                {/*
                 * Activity toolbar wrapper — the action bar, scope segmented
                 * control, and search input form a tight 3-row block. The
                 * parent container's `gap-2 md:gap-3` is too loose between
                 * these rows, so they get their own sub-container with a
                 * compact `gap-1.5` spacing. Each row's own `mb-*` margins
                 * have been removed to avoid double-spacing.
                 */}
                <div className="flex flex-col gap-1.5">
                {/*
                 * Action bar — primary "New chat", refresh utility, and a split
                 * pause pill that exposes BOTH "Pause All" and "Pause AP" toggles
                 * in the activity-compact reference style. Functionality is
                 * unchanged: each pause toggle drives the same handler that the
                 * legacy "⏸ All / ⏸ AP" buttons used (open duration menu when
                 * running, resume immediately when paused).
                 */}
                <div className={cn('flex items-center gap-1.5')}>
                    <button
                        type="button"
                        onClick={onNewChat ?? onOpenDialog}
                        title={newChatDropActive ? 'Drop to start a new chat' : `New chat (${newChatKbdLabel})`}
                        data-testid="toolbar-new-chat-btn"
                        data-drop-active={newChatDropActive || undefined}
                        onDragEnter={handleNewChatDragEnter}
                        onDragOver={handleNewChatDragOver}
                        onDragLeave={handleNewChatDragLeave}
                        onDragEnd={resetNewChatDropState}
                        onDrop={handleNewChatDrop}
                        className={cn(
                            'flex-1 min-w-0 inline-flex items-center gap-1.5 h-7 pl-2 pr-2 rounded-md text-[12px] leading-none font-medium tracking-tight transition-colors active:translate-y-[0.5px]',
                            newChatDropActive
                                ? 'bg-[#eaf4ff] dark:bg-[#06314f] text-[#005a9e] dark:text-[#9cdcfe] ring-2 ring-[#0078d4]/60 ring-inset'
                                : 'bg-[#f3f3f3] hover:bg-[#e8e8e8] dark:bg-[#1e1e1e] dark:hover:bg-[#2a2a2a] text-[#1e1e1e] dark:text-white',
                        )}
                    >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="flex-shrink-0">
                            <path d="M7 2v10M2 7h10" />
                        </svg>
                        <span className="flex-1 text-left truncate" data-testid={newChatDropActive ? 'new-chat-drop-hint' : undefined}>
                            {newChatDropActive ? 'Drop to start a new chat' : 'New chat'}
                        </span>
                        {!newChatDropActive && (
                            <kbd className="font-mono text-[10px] tracking-wider rounded-[3px] px-1 py-px border border-[#1e1e1e]/30 dark:border-white/30 text-[#1e1e1e]/85 dark:text-white/85 select-none flex-shrink-0">{newChatKbdLabel}</kbd>
                        )}
                    </button>

                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={isRefreshing}
                        loading={isRefreshing}
                        onClick={onRefresh}
                        title="Refresh queue"
                        data-testid="queue-refresh-btn"
                        className="!h-7 !w-7 !p-0 !min-h-0 grid place-items-center bg-white dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#474749] rounded-md !text-[#606060] dark:!text-[#9d9d9d] hover:!bg-[#f5f5f5] dark:hover:!bg-[#252526] hover:!text-[#1e1e1e] dark:hover:!text-[#cccccc]"
                    >
                        {!isRefreshing && (
                            <span className={(isAdmitting || isTaskSubmitting) ? 'inline-block animate-spin' : 'inline-block'}>
                                ↺
                            </span>
                        )}
                    </Button>

                    <div className="relative" ref={pauseMenuRef}>
                        <div
                            className={cn(
                                'inline-flex items-stretch h-7 rounded-md border overflow-hidden transition-colors',
                                (isPaused || isAutopilotPaused)
                                    ? 'bg-amber-50 border-amber-300 dark:bg-amber-900/10 dark:border-amber-700/40'
                                    : 'bg-white dark:bg-[#1e1e1e] border-[#e0e0e0] dark:border-[#474749]',
                            )}
                            data-testid="pause-toggle-group"
                        >
                            <button
                                type="button"
                                disabled={isPauseResumeLoading}
                                onClick={() => isPaused ? onPauseResume() : setPauseMenuScope(pauseMenuScope === 'all' ? null : 'all')}
                                title={isPaused ? 'Resume all tasks' : 'Pause all tasks'}
                                data-testid="repo-pause-resume-btn"
                                className={cn(
                                    'inline-flex items-center gap-1.5 px-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                                    isPaused
                                        ? 'hover:bg-amber-500/10'
                                        : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                )}
                            >
                                <span className={cn(
                                    'w-[7px] h-[7px] rounded-full flex-shrink-0',
                                    isPaused
                                        ? 'bg-amber-500 ring-2 ring-amber-500/25 animate-pulse'
                                        : pillRiskClass === 'risk'
                                            ? 'bg-red-500 ring-2 ring-red-500/25'
                                            : pillRiskClass === 'watch'
                                                ? 'bg-amber-500 ring-2 ring-amber-500/25'
                                                : 'bg-emerald-500 ring-2 ring-emerald-500/25',
                                )} aria-hidden="true" />
                                <span
                                    className={cn(
                                        'font-mono text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap',
                                        isPaused
                                            ? 'text-amber-700 dark:text-amber-400'
                                            : 'text-emerald-700 dark:text-emerald-400',
                                    )}
                                >
                                    ALL
                                </span>
                                {isPaused && (
                                    <>
                                        {pauseSource === 'quota' && (
                                            <span
                                                className="font-mono text-[9px] font-bold tracking-widest px-1 py-px rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 whitespace-nowrap"
                                                data-testid="pause-pill-quota-badge-all"
                                            >
                                                QUOTA
                                            </span>
                                        )}
                                        <span
                                            className="text-[11.5px] font-semibold leading-none whitespace-nowrap text-amber-700 dark:text-amber-400"
                                            aria-label="▶ Resume all tasks"
                                        >
                                            {queuePauseRemaining || 'PAUSED'}
                                        </span>
                                    </>
                                )}
                            </button>
                            {onPauseResumeAutopilot && (
                                <>
                                    <div className={cn(
                                        'w-px self-stretch',
                                        (isPaused || isAutopilotPaused)
                                            ? 'bg-amber-300 dark:bg-amber-700/40'
                                            : 'bg-[#e0e0e0] dark:bg-[#474749]',
                                    )} />
                                    <button
                                        type="button"
                                        disabled={isAutopilotPauseLoading}
                                        onClick={() => isAutopilotPaused ? onPauseResumeAutopilot() : setPauseMenuScope(pauseMenuScope === 'autopilot' ? null : 'autopilot')}
                                        title={isAutopilotPaused ? 'Resume autopilot tasks' : 'Pause autopilot tasks'}
                                        data-testid="autopilot-pause-resume-btn"
                                        className={cn(
                                            'inline-flex items-center gap-1.5 px-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                                            isAutopilotPaused
                                                ? 'hover:bg-amber-500/10'
                                                : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                        )}
                                    >
                                        <span className={cn(
                                            'w-[7px] h-[7px] rounded-full flex-shrink-0',
                                            isAutopilotPaused
                                                ? 'bg-amber-500 ring-2 ring-amber-500/25 animate-pulse'
                                                : pillRiskClass === 'risk'
                                                    ? 'bg-red-500 ring-2 ring-red-500/25'
                                                    : pillRiskClass === 'watch'
                                                        ? 'bg-amber-500 ring-2 ring-amber-500/25'
                                                        : 'bg-emerald-500 ring-2 ring-emerald-500/25',
                                        )} aria-hidden="true" />
                                        <span
                                            className={cn(
                                                'font-mono text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap',
                                                isAutopilotPaused
                                                    ? 'text-amber-700 dark:text-amber-400'
                                                    : 'text-emerald-700 dark:text-emerald-400',
                                            )}
                                        >
                                            AP
                                        </span>
                                        {isAutopilotPaused && (
                                            <>
                                                {autopilotPauseSource === 'quota' && (
                                                    <span
                                                        className="font-mono text-[9px] font-bold tracking-widest px-1 py-px rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 whitespace-nowrap"
                                                        data-testid="pause-pill-quota-badge-ap"
                                                    >
                                                        QUOTA
                                                    </span>
                                                )}
                                                <span
                                                    className="text-[11.5px] font-semibold leading-none whitespace-nowrap text-amber-700 dark:text-amber-400"
                                                    aria-label="▶ Resume autopilot"
                                                >
                                                    {autopilotPauseRemaining || 'PAUSED'}
                                                </span>
                                            </>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                        {pauseMenuScope && (
                            <PauseDurationMenu
                                testIdScope={pauseMenuScope}
                                onSelect={(options) => selectPauseDuration(pauseMenuScope, options)}
                                quotaData={quotaData}
                            />
                        )}
                    </div>
                </div>

                {/* Scope segmented control — Chats / [Scheduled] / Automations / All.
                    Only rendered in the Activity branch (`!activeTab`); Chats and
                    Tasks tabs already have their own narrow scope. The "Scheduled"
                    segment (internal id `loops`) is shown when crons are enabled OR
                    any scheduled-job run exists, so it appears whenever it has
                    content even if the cron feature flag is off. Inner spans use
                    `whitespace-nowrap` and `min-w-0 truncate` on the label so narrow
                    widths show ellipsis on the longest label ("Automations")
                    instead of wrapping the count below. */}
                {!activeTab && (
                    <div
                        className={cn('grid gap-0 p-0.5 bg-[#f5f5f5] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#474749] rounded-md', (cronEnabled || scopeCounts.hasScheduledRuns) ? 'grid-cols-4' : 'grid-cols-3')}
                        role="tablist"
                        aria-label="Activity scope"
                        data-testid="activity-scope-tabs"
                    >
                        {([
                            {
                                id: 'chat' as const,
                                label: 'Chats',
                                count: scopeCounts.chat,
                                icon: (
                                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M2 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6l-3 2.5V10a2 2 0 0 1-1-1.7Z" />
                                    </svg>
                                ),
                                hidden: false,
                            },
                            {
                                // Internal id stays `loops` (localStorage value + test ids
                                // unchanged); only the visible label reads "Scheduled".
                                id: 'loops' as const,
                                label: 'Scheduled',
                                count: scopeCounts.loops,
                                icon: (
                                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="2" y="3" width="10" height="9" rx="1.5" />
                                        <path d="M2 6h10M5 1.5v2.5M9 1.5v2.5" />
                                    </svg>
                                ),
                                hidden: !(cronEnabled || scopeCounts.hasScheduledRuns),
                            },
                            {
                                id: 'auto' as const,
                                label: 'Automations',
                                count: scopeCounts.auto,
                                icon: (
                                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                                        <circle cx="7" cy="7" r="2" />
                                        <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M2.8 11.2l1.4-1.4M9.8 4.2l1.4-1.4" />
                                    </svg>
                                ),
                                hidden: false,
                            },
                            {
                                id: 'all' as const,
                                label: 'All',
                                count: scopeCounts.all,
                                icon: (
                                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="1.5" y="1.5" width="4" height="4" rx="0.5" />
                                        <rect x="8.5" y="1.5" width="4" height="4" rx="0.5" />
                                        <rect x="1.5" y="8.5" width="4" height="4" rx="0.5" />
                                        <rect x="8.5" y="8.5" width="4" height="4" rx="0.5" />
                                    </svg>
                                ),
                                hidden: false,
                            },
                        ]).filter(s => !s.hidden).map(scope => {
                            const on = activeScope === scope.id;
                            return (
                                <button
                                    key={scope.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={on}
                                    aria-label={`${scope.label} (${scope.count})`}
                                    title={scope.label}
                                    onClick={() => setActiveScope(scope.id)}
                                    className={cn(
                                        'h-[26px] min-w-0 px-1 inline-flex items-center justify-center gap-1 text-[11.5px] leading-none font-medium rounded transition-[background-color,color,box-shadow] duration-100',
                                        on
                                            ? 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] shadow-[0_1px_0_rgba(0,0,0,0.04),0_0_0_1px_rgba(224,224,224,0.7)] dark:shadow-[0_1px_0_rgba(0,0,0,0.20),0_0_0_1px_rgba(71,71,73,0.7)]'
                                            : 'text-[#606060] dark:text-[#9d9d9d] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                    )}
                                    data-testid={`activity-scope-tab-${scope.id}`}
                                    data-active={on || undefined}
                                >
                                    <span className="opacity-80 flex-shrink-0">{scope.icon}</span>
                                    <span
                                        className={cn(
                                            'text-[10.5px] font-mono tabular-nums whitespace-nowrap flex-shrink-0',
                                            on ? 'text-[#0078d4] dark:text-[#3794ff]' : 'text-[#9d9d9d] dark:text-[#7d7d7d]',
                                        )}
                                        data-testid={`activity-scope-count-${scope.id}`}
                                    >
                                        {scope.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Scheduled slide: schedule-definitions section (feature-flagged, self-gating).
                    Sits above the scheduled run instances ("Recent runs"), which keep
                    rendering as the Running / Queued / History sections below. */}
                {!activeTab && activeScope === 'loops' && workspaceId && (
                    <ScheduledSlideSchedules workspaceId={workspaceId} />
                )}

                {/* Search bar — hidden by default; revealed with Ctrl+F / ⌘F (see the keydown handler). */}
                {searchVisible && (
                <div className="relative">
                    <span className="absolute left-[7px] top-1/2 -translate-y-1/2 text-[#848484] dark:text-[#a0a0a0] pointer-events-none" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                            <circle cx="7" cy="7" r="4.5" />
                            <path d="M10.5 10.5l3 3" />
                        </svg>
                    </span>
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search all conversations…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full h-7 rounded-md border border-[#e0e0e0] dark:border-[#474749] bg-[#f7f7f8] dark:bg-[#1e1e1e] pl-[26px] pr-14 text-[12.5px] leading-none text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#848484] outline-none focus:border-[#0078d4] dark:focus:border-[#3794ff] focus:bg-white dark:focus:bg-[#252526] focus:shadow-[0_0_0_3px_rgba(0,120,212,0.22)]"
                        data-testid="queue-search-input"
                        aria-label="Search conversations"
                    />
                    {searchLoading ? (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#848484] animate-pulse" data-testid="search-loading-indicator">⏳</span>
                    ) : !searchQuery ? (
                        <kbd className="absolute right-[6px] top-1/2 -translate-y-1/2 text-[10.5px] font-mono text-[#848484] dark:text-[#a0a0a0] border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#252526] rounded-[3px] px-1 py-px pointer-events-none select-none">
                            {kbdLabel}
                        </kbd>
                    ) : (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                            <span className="text-[#848484] tabular-nums text-[10px]">
                                {isServerSearchActive
                                    ? searchTotal ?? 0
                                    : activityRunningEntries.length
                                        + visibleTabFilteredQueued.filter((t: any) => t.kind !== 'pause-marker').length
                                        + pinnedActivityEntries.length
                                        + activityCompletedEntries.length
                                        + visibleFilteredArchived.length
                                        + archivedSpawnedTreeGroups.length
                                }
                            </span>
                            <button
                                className="text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] leading-none text-[12px]"
                                onClick={() => setSearchQuery('')}
                                data-testid="queue-search-close"
                                aria-label="Clear search"
                            >✕</button>
                        </div>
                    )}
                </div>
                )}
                </div>
                </div>

                {activityRunningEntries.length > 0 && (
                    <div data-section="running" className="-mx-2 md:-mx-4">
                        <button
                            type="button"
                            className="sticky top-0 z-[2] w-full flex items-center justify-between px-3 py-1 border-b backdrop-blur-md backdrop-saturate-150 bg-[#0078d4]/[0.07] dark:bg-[#3794ff]/[0.10] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80 hover:brightness-95 transition-[filter]"
                            onClick={() => setShowRunning(!showRunning)}
                            data-testid="running-tasks-section-toggle"
                            aria-expanded={showRunning}
                        >
                            <span className="inline-flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#0078d4] dark:text-[#3794ff]">
                                <span className="text-[10px]">{showRunning ? '▼' : '▶'}</span>
                                <span className="w-[5px] h-[5px] rounded-full bg-[#0078d4] dark:bg-[#3794ff] animate-pulse" aria-hidden="true" />
                                Running Tasks
                            </span>
                            <span className="text-[10px] leading-none font-mono tabular-nums text-[#0078d4] dark:text-[#3794ff] font-semibold">{activityRunningEntries.length}</span>
                        </button>
                        {showRunning && (
                            <div className="flex flex-col">
                                {activityRunningEntries.map(entry => {
                                    if (entry.kind === 'for-each-run') return renderForEachRunGroup(entry, activityRangeRows);
                                    if (entry.kind === 'map-reduce-run') return renderMapReduceRunGroup(entry, activityRangeRows);
                                    if (isSpawnedTreeEntry(entry)) return renderSpawnedTreeEntry(entry, activityRangeRows);
                                    return renderChatListRow(entry, activityRangeRows, { taskStatus: 'running' });
                                })}
                            </div>
                        )}
                    </div>
                )}

                {visibleTabFilteredQueued.length > 0 && (
                    <div data-section="queued" className="-mx-2 md:-mx-4">
                        <button
                            type="button"
                            className="sticky top-0 z-[2] w-full flex items-center justify-between px-3 py-1 border-b backdrop-blur-md backdrop-saturate-150 bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80 hover:bg-[#f5f5f5] dark:hover:bg-[#252526] transition-colors"
                            onClick={() => setShowQueued(!showQueued)}
                            data-testid="queued-tasks-section-toggle"
                            aria-expanded={showQueued}
                        >
                            <span className="inline-flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0]">
                                <span className="text-[10px]">{showQueued ? '▼' : '▶'}</span>
                                Queued Tasks
                            </span>
                            <span className="text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]">{visibleTabFilteredQueued.filter((t: any) => t.kind !== 'pause-marker').length}</span>
                        </button>
                        {showQueued && (
                            <div className="flex flex-col">
                                {!isMobile && (
                                    <PauseInsertZone
                                        index={-1}
                                        active={insertingPauseAt === -1 || pauseMarkerMenuIndex === -1}
                                        menuOpen={pauseMarkerMenuIndex === -1}
                                        menuRef={pauseMarkerMenuIndex === -1 ? pauseMarkerMenuRef : undefined}
                                        onMouseEnter={() => setInsertingPauseAt(-1)}
                                        onMouseLeave={() => setInsertingPauseAt(null)}
                                        onClick={() => openPauseMarkerMenu(-1)}
                                        onSelectDuration={(options) => handleInsertPauseMarker(-1, options)}
                                    />
                                )}
                                {visibleTabFilteredQueued.map((item: any, index: number) => {
                                    const globalIndex = queued.findIndex((q: any) => q.id === item.id);
                                    if (item.kind === 'pause-marker') {
                                        return (
                                            <PauseMarkerRow
                                                key={item.id}
                                                markerId={item.id}
                                                durationHours={item.durationHours}
                                                onRemove={() => handleRemovePauseMarker(item.id)}
                                            />
                                        );
                                    }
                                    return (
                                        <div key={item.id}>
                                            <div
                                                data-queue-index={index}
                                                draggable={!isMobile}
                                                onDragStart={isMobile ? undefined : createDragStartHandler(item.id, index)}
                                                onDragEnd={isMobile ? undefined : createDragEndHandler()}
                                                onDragOver={isMobile ? undefined : createDragOverHandler(index)}
                                                onDragEnter={isMobile ? undefined : createDragEnterHandler(index)}
                                                onDragLeave={isMobile ? undefined : createDragLeaveHandler(index)}
                                                onDrop={isMobile ? undefined : createDropHandler(index, handleMoveToPosition)}
                                                onTouchStart={isMobile ? touchDrag.createTouchStartHandler(item.id, index, handleMoveToPosition) : undefined}
                                                className={cn(
                                                    !isMobile && 'cursor-grab active:cursor-grabbing',
                                                    activeDraggedTaskId === item.id && 'opacity-40',
                                                    activeDropTargetIndex === index && activeDropPosition === 'above' && 'border-t-2 border-[#007fd4]',
                                                    activeDropTargetIndex === index && activeDropPosition === 'below' && 'border-b-2 border-[#007fd4]',
                                                )}
                                            >
                                                {renderChatListRow(item, visibleTabFilteredQueued, { taskStatus: 'queued' })}
                                            </div>
                                            {!isMobile && (
                                                <PauseInsertZone
                                                    index={globalIndex}
                                                    active={insertingPauseAt === globalIndex || pauseMarkerMenuIndex === globalIndex}
                                                    menuOpen={pauseMarkerMenuIndex === globalIndex}
                                                    menuRef={pauseMarkerMenuIndex === globalIndex ? pauseMarkerMenuRef : undefined}
                                                    onMouseEnter={() => setInsertingPauseAt(globalIndex)}
                                                    onMouseLeave={() => setInsertingPauseAt(null)}
                                                    onClick={() => openPauseMarkerMenu(globalIndex)}
                                                    onSelectDuration={(options) => handleInsertPauseMarker(globalIndex, options)}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {isServerSearchActive ? (
                    /* ── Server-side search results ── */
                    <div data-section="search-results" className="-mx-2 md:-mx-4">
                        <div className="sticky top-0 z-[2] flex items-center justify-between px-3 py-1 border-b backdrop-blur-md backdrop-saturate-150 bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80">
                            <span className="inline-flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0]">
                                🔍 Search Results
                            </span>
                            <span className="text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]">
                                {searchResults!.length}{searchTotal != null && searchTotal > searchResults!.length ? ` of ${searchTotal}` : ''}
                            </span>
                        </div>
                        {searchQuery.length === 1 && (
                            <div className="text-[10px] text-[#848484] dark:text-[#bbb] italic px-3 py-1" data-testid="search-min-chars-hint">
                                Type 2+ characters to search all conversations
                            </div>
                        )}
                        {searchResults!.length === 0 && !searchLoading && (
                            <div className="text-[10px] text-[#848484] dark:text-[#bbb] px-3 py-1" data-testid="search-no-results">
                                No matching conversations found
                            </div>
                        )}
                        <div className="flex flex-col">
                            {searchResults!.map(task => (
                                <React.Fragment key={task.id}>
                                    {renderChatListRow(task, searchResults!, { dataTestid: 'search-result-item' })}
                                    {task._searchSnippet && (
                                        <div
                                            className="px-3 pb-1 -mt-px text-[10px] truncate text-[#848484] dark:text-[#bbb] [&_mark]:bg-yellow-200 [&_mark]:dark:bg-yellow-700/50 [&_mark]:text-inherit [&_mark]:rounded-sm [&_mark]:px-px"
                                            data-testid="search-snippet"
                                            dangerouslySetInnerHTML={{ __html: task._searchSnippet }}
                                        />
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                        {searchHasMore && onLoadMoreSearchResults && (
                            <div className="px-4 py-2">
                                <button
                                    onClick={onLoadMoreSearchResults}
                                    disabled={searchLoadingMore}
                                    className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                                    data-testid="search-load-more-btn"
                                >
                                    {searchLoadingMore ? 'Loading…' : 'Load more results'}
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    /* ── Normal history view (pinned + unpinned + archived + load more) ── */
                    <>
                {(pinnedActivityEntries.length > 0 || pinnedRunningCount > 0) && (
                    <div data-section="pinned" className="-mx-2 md:-mx-4">
                        <div className="sticky top-0 z-[2] flex flex-wrap items-center gap-1.5 px-3 py-1 border-b backdrop-blur-md backdrop-saturate-150 bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80">
                            <button
                                type="button"
                                className="flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0] hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                                onClick={() => setShowPinned(!showPinned)}
                                data-testid="pinned-chats-section-toggle"
                                aria-expanded={showPinned}
                            >
                                <span className="text-[10px]">{showPinned ? '▼' : '▶'}</span>
                                <span className="w-[5px] h-[5px] rounded-full bg-[#0078d4] dark:bg-[#3794ff]" aria-hidden="true" />
                                Pinned
                                {unseenProcessIds && (() => {
                                    const count = pinnedActivityEntries.filter(entry => entryHasUnseen(entry, unseenProcessIds)).length;
                                    return count > 0 ? (
                                        <span className="ml-1 text-[9px] bg-[#0078d4] text-white px-1.5 py-px rounded-full" data-testid="unseen-pinned-count-badge">{count}</span>
                                    ) : null;
                                })()}
                            </button>
                            <span className="ml-auto text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]">{pinnedActivityEntries.length + pinnedRunningCount}</span>
                            {onMarkAllRead && unseenProcessIds && pinnedActivityEntries.some(entry => entryHasUnseen(entry, unseenProcessIds)) && (
                                <button
                                    className="text-[10px] text-[#0078d4] dark:text-[#3794ff] hover:underline transition-colors"
                                    onClick={() => onMarkAllRead(pinnedActivityMarkReadTasks)}
                                    data-testid="mark-all-read-pinned-btn"
                                >
                                    Mark all read
                                </button>
                            )}
                        </div>
                        {showPinned && (
                            <div className="flex flex-col">
                                {pinnedActivityEntries.map(renderPinnedActivityEntry)}
                            </div>
                        )}
                    </div>
                )}

                {renderFoldersSection(activityFolderRows, activityRangeRows)}

                {activityCompletedEntries.length > 0 && (
                    <div data-section="completed" className="-mx-2 md:-mx-4" {...unfiledDropProps}>
                        <div className="sticky top-0 z-[2] flex flex-wrap items-center gap-1.5 px-3 py-1 border-b backdrop-blur-md backdrop-saturate-150 bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80">
                            <button
                                type="button"
                                className="flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0] hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                                onClick={() => { setShowHistory(!showHistory); setSelectedHistoryIds(new Set()); setAnchorHistoryId(null); }}
                                aria-expanded={showHistory}
                            >
                                <span className="text-[10px]">{showHistory ? '▼' : '▶'}</span>
                                Completed Tasks
                                {unseenProcessIds && (() => {
                                    const count = activityCompletedEntries.filter(entry => entryHasUnseen(entry, unseenProcessIds)).length;
                                    return count > 0 ? (
                                        <span className="ml-1 text-[9px] bg-[#0078d4] text-white px-1.5 py-px rounded-full" data-testid="unseen-count-badge">{count}</span>
                                    ) : null;
                                })()}
                            </button>
                            <span className="ml-auto text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]">{activityCompletedEntries.length}</span>
                            {onMarkAllRead && unseenProcessIds && activityCompletedEntries.some(entry => entryHasUnseen(entry, unseenProcessIds)) && (
                                <button
                                    className="text-[10px] text-[#0078d4] dark:text-[#3794ff] hover:underline transition-colors"
                                    onClick={() => onMarkAllRead(activityCompletedMarkReadTasks)}
                                    data-testid="mark-all-read-btn"
                                >
                                    Mark all read
                                </button>
                            )}
                            {selectedHistoryIds.size >= 2 && (
                                <span className="inline-flex items-center gap-1 text-[10px] bg-[#0078d4]/15 text-[#0078d4] dark:bg-[#3794ff]/15 dark:text-[#3794ff] px-2 py-0.5 rounded-full" data-testid="selection-count-pill">
                                    {selectedHistoryIds.size} selected
                                    <button className="leading-none hover:text-red-500" onClick={() => { setSelectedHistoryIds(new Set()); setAnchorHistoryId(null); }} data-testid="selection-clear-btn">✕</button>
                                </span>
                            )}
                        </div>
                        {showHistory && (
                            <div className="flex flex-col">
                                {(() => {
                                    const renderEntry = (entry: any) => {
                                        if (entry.kind === 'for-each-run') {
                                            return renderForEachRunGroup(entry, activityRangeRows);
                                        }
                                        if (entry.kind === 'map-reduce-run') {
                                            return renderMapReduceRunGroup(entry, activityRangeRows);
                                        }
                                        if (isSpawnedTreeEntry(entry)) {
                                            return renderSpawnedTreeEntry(entry, activityRangeRows);
                                        }
                                        if (entry.kind === 'ralph-session') {
                                            return renderRalphSessionGroup(entry as RalphSession, activityRangeRows);
                                        }
                                        if (entry.kind === 'group') {
                                            const expanded = expandedGroupState.workspaceId === workspaceId && expandedGroupState.groups.has(entry.planFilePath);
                                            const aggregateMode = computeAggregateMode(entry.children);
                                            const groupHasUnseen = !!unseenProcessIds && entry.children.some((c: any) => unseenProcessIds.has(c.id));
                                            return (
                                                <div
                                                    key={entry.planFilePath}
                                                    data-testid="history-group"
                                                    data-expanded={expanded ? 'true' : 'false'}
                                                    className={cn(expanded && 'bg-[#f7f7f8] dark:bg-[#1f1f20]/80')}
                                                >
                                                    <HistoryGroupHeader
                                                        group={entry}
                                                        isExpanded={expanded}
                                                        isUnseen={groupHasUnseen}
                                                        aggregateMode={aggregateMode}
                                                        onToggle={() => toggleGroup(entry.planFilePath)}
                                                        onContextMenu={e => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            const ids = entry.children.map((c: any) => c.id);
                                                            setSelectedHistoryIds(new Set(ids));
                                                            setContextMenu({ x: e.clientX, y: e.clientY, taskId: ids[0], taskStatus: 'completed', bulkIds: ids });
                                                        }}
                                                        isDense={isDense}
                                                    />
                                                    {expanded && (
                                                        <div
                                                            className="flex flex-col ml-3 pl-2 border-l border-[#e0e0e0] dark:border-[#3c3c3c]"
                                                            data-testid="history-group-children"
                                                        >
                                                            {entry.children.map((task: any) => renderChatListRow(task, entry.children, { taskStatus: 'completed', isGroupChild: true }))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return renderChatListRow(entry, activityRangeRows, { taskStatus: 'completed' });
                                    };
                                    const dateSections = [
                                        { id: 'today' as const, label: 'Today', items: dateBucketedHistory.today },
                                        { id: 'week' as const, label: 'This week', items: dateBucketedHistory.week },
                                        { id: 'older' as const, label: 'Older', items: dateBucketedHistory.older },
                                    ].filter(s => s.items.length > 0);
                                    return dateSections.map(section => (
                                        <div key={section.id} data-section={`completed-${section.id}`}>
                                            <div className="px-3 pt-1 pb-0.5 flex items-center justify-between text-[10px] leading-none font-mono uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0]">
                                                <span>{section.label}</span>
                                                <span className="tabular-nums">{section.items.length}</span>
                                            </div>
                                            {section.items.map(renderEntry)}
                                        </div>
                                    ));
                                })()}
                            </div>
                        )}
                    </div>
                )}
            {(visibleFilteredArchived.length > 0 || archivedSpawnedTreeGroups.length > 0) && (
                <div data-section="archived" className="-mx-2 md:-mx-4">
                    <div className="sticky top-0 z-[2] flex flex-wrap items-center gap-1.5 px-3 py-1 border-b backdrop-blur-md backdrop-saturate-150 bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80">
                        <button
                            type="button"
                            className="flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0] hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                            onClick={() => setShowArchived(!showArchived)}
                            data-testid="archived-chats-section-toggle"
                            aria-expanded={showArchived}
                        >
                            <span className="text-[10px]">{showArchived ? '▼' : '▶'}</span>
                            📦 Archived
                            {unseenProcessIds && (() => {
                                const count = visibleFilteredArchived.filter(t => unseenProcessIds.has(t.id)).length;
                                return count > 0 ? (
                                    <span className="ml-1 text-[9px] bg-[#0078d4] text-white px-1.5 py-px rounded-full" data-testid="unseen-archived-count-badge">{count}</span>
                                ) : null;
                            })()}
                        </button>
                        <span className="ml-auto text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]">{visibleFilteredArchived.length + archivedSpawnedTreeGroups.length}</span>
                        {onMarkAllRead && unseenProcessIds && visibleFilteredArchived.some(t => unseenProcessIds.has(t.id)) && (
                            <button
                                className="text-[10px] text-[#0078d4] dark:text-[#3794ff] hover:underline transition-colors"
                            onClick={() => onMarkAllRead(visibleFilteredArchived)}
                                data-testid="mark-all-read-archived-btn"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>
                        {showArchived && (
                            <div className="flex flex-col">
                                {archivedSpawnedTreeGroups.map(entry => renderSpawnedTreeEntry(entry, activityRangeRows))}
                                {visibleFilteredArchived.map(task => renderChatListRow(task, visibleFilteredArchived, { taskStatus: 'completed' }))}
                            </div>
                        )}
                </div>
            )}
            {hasMore && onLoadMore && (
                <div className="px-4 py-2">
                    <button
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                        data-testid="activity-load-more-btn"
                    >
                        {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
                    </>
                )}
                    </React.Fragment>
                )}
        </div>
        {contextMenu && (
            <ContextMenu
                position={{ x: contextMenu.x, y: contextMenu.y }}
                items={contextMenuItems}
                onClose={closeContextMenu}
            />
        )}
        {folderMenu && folderMenuItems.length > 0 && (
            <ContextMenu
                position={{ x: folderMenu.x, y: folderMenu.y }}
                items={folderMenuItems}
                onClose={closeFolderMenu}
            />
        )}
        <ChatFolderDeleteDialog
            open={!!chatFolderMutations.pendingDelete}
            folderName={chatFolderMutations.pendingDelete?.folder.name ?? ''}
            memberCount={chatFolderMutations.pendingDelete?.memberIds.length ?? 0}
            onCancel={chatFolderMutations.cancelDelete}
            onConfirm={() => { void chatFolderMutations.confirmDelete(); }}
        />
        {chatFolderMutations.undoSnapshot && (
            <ChatFolderUndoToast
                folderName={chatFolderMutations.undoSnapshot.folder.name}
                memberCount={chatFolderMutations.undoSnapshot.memberIds.length}
                onUndo={() => { void chatFolderMutations.undoDelete(); }}
                onDismiss={chatFolderMutations.dismissUndo}
            />
        )}
        <ChatFolderArchiveDialog
            open={!!chatFolderArchive.pendingArchive}
            folderName={chatFolderArchive.pendingArchive?.folder.name ?? ''}
            archiveCount={chatFolderArchive.pendingArchive?.targets.archivableIds.length ?? 0}
            pinnedSkipped={chatFolderArchive.pendingArchive?.targets.pinnedSkippedIds.length ?? 0}
            onCancel={chatFolderArchive.cancelArchive}
            onConfirm={chatFolderArchive.confirmArchive}
        />
        {chatFolderArchive.undoArchive && (
            <ChatFolderUndoToast
                testIdPrefix="chat-folder-archive-undo"
                folderName={chatFolderArchive.undoArchive.folderName}
                memberCount={chatFolderArchive.undoArchive.archivedIds.length}
                message={buildArchiveUndoMessage(
                    chatFolderArchive.undoArchive.folderName,
                    chatFolderArchive.undoArchive.archivedIds.length,
                    chatFolderArchive.undoArchive.pinnedSkipped,
                )}
                onUndo={chatFolderArchive.performUndoArchive}
                onDismiss={chatFolderArchive.dismissUndoArchive}
            />
        )}
        <SummarizeChatDialog
            open={summarizeDialogOpen}
            chatCount={summarizeDialogIds.length}
            onClose={() => setSummarizeDialogOpen(false)}
            onConfirm={async (userPrompt) => {
                const data = await cloneClient.queue.summarize({
                    processIds: summarizeDialogIds,
                    workspaceId,
                    userPrompt: userPrompt || undefined,
                    ...(isCommitChatLensEnabled()
                        ? { lensChat: { inherited: true, source: 'features.commitChatLens' } as const }
                        : {}),
                });
                setSummarizeDialogOpen(false);
                if (data.taskId) {
                    onSelectTask(data.taskId);
                }
                fetchQueue();
            }}
        />
        <RenameDialog
            open={!!renameTarget}
            currentTitle={renameTarget?.title ?? ''}
            onConfirm={handleRenameConfirm}
            onCancel={() => setRenameTarget(null)}
        />
        {isMobile && onNewChat && (
            <button
                className="mobile-fab"
                onClick={onNewChat}
                data-testid="mobile-new-chat-fab"
                aria-label="New chat"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
            </button>
        )}
    </>
    );
}

export function QueueTaskItem({ task, status, now, selected, isPinned, isAutopilotPaused, dense, onClick, onContextMenu, onLongPress, cancelLongPress }: {
    task: any;
    status: 'running' | 'queued';
    now: number;
    selected?: boolean;
    isPinned?: boolean;
    isAutopilotPaused?: boolean;
    dense?: boolean;
    onClick?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onLongPress?: (x: number, y: number) => void;
    cancelLongPress?: boolean;
}){
    const name = task.displayName || task.type || 'Task';
    const icon = getTaskTypeIcon(task);
    const promptPreview = getTaskPromptPreview(task);
    const showProgress = task.type === 'run-workflow' && status === 'running' && !task.payload?.workItemId;
    const progress = useWorkflowProgress(showProgress ? (task.processId || task.id) : null);
    const hasDraft = !!getDraft(task.id);
    const isHeld = isAutopilotPaused === true
        && status === 'queued'
        && task.payload?.mode === 'autopilot'
        && !task.admitted;
    const isAdmitted = isAutopilotPaused === true
        && status === 'queued'
        && task.payload?.mode === 'autopilot'
        && !!task.admitted;
    let elapsed = '';
    if (status === 'running' && task.startedAt) {
        elapsed = formatDuration(now - new Date(task.startedAt).getTime());
    } else if (task.createdAt) {
        elapsed = formatRelativeTime(new Date(task.createdAt).toISOString());
    }

    const longPress = useLongPress(
        onLongPress ?? (() => {}),
        { cancelSignal: cancelLongPress },
    );

    const handleClick = () => {
        if (longPress.didLongPress()) return;
        onClick?.();
    };

    return (
        <Card
            className={cn(dense ? "px-2 py-2.5 md:py-1 cursor-pointer" : "p-2 cursor-pointer", selected && "ring-2 ring-[#0078d4]", task.frozen && "task-frozen", isPinned && "border-l-2 border-l-amber-400 dark:border-l-amber-500", isHeld && !isPinned && "border-l-2 border-l-amber-500 dark:border-l-amber-400 opacity-60", isAdmitted && !isPinned && "border-l-2 border-l-green-500 dark:border-l-green-400")}
            onClick={handleClick}
            onContextMenu={onContextMenu}
            onTouchStart={longPress.onTouchStart}
            onTouchEnd={longPress.onTouchEnd}
            onTouchMove={longPress.onTouchMove}
            data-task-id={task.id}
        >
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] min-w-0">
                    <span className="shrink-0">{task.frozen ? '❄️' : isAdmitted ? '🚀' : isHeld ? '🤖⏸' : icon}</span>
                    <span className="truncate" title={name}>{name}</span>
                    {isPinned && <span className="shrink-0 text-[10px]" data-testid="running-pin-badge">📌</span>}
                    {isHeld && (
                        <span
                            className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400 font-medium"
                            data-testid="held-badge"
                        >
                            [held]
                        </span>
                    )}
                    {isAdmitted && (
                        <span
                            className="shrink-0 text-[10px] text-green-600 dark:text-green-400 font-medium"
                            data-testid="admitted-badge"
                        >
                            [scheduled]
                        </span>
                    )}
                    {hasDraft && <span className="shrink-0 text-[10px] text-[#848484] dark:text-[#bbb]" title="Unsent draft" data-testid="draft-badge">✏️</span>}
                </div>
                {elapsed && (
                    <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                        {elapsed}
                    </span>
                )}
            </div>
            {!dense && promptPreview && (
                <div className="text-[10px] text-[#848484] dark:text-[#bbb] mt-0.5 truncate" title={promptPreview}>{promptPreview}</div>
            )}
            {!dense && showProgress && progress && progress.total > 0 && (
                <div className="mt-1" data-testid="workflow-progress-indicator">
                    <div className="text-[10px] text-[#0078d4] dark:text-[#3794ff]">
                        ▶ Map: {progress.completed}/{progress.total}
                    </div>
                    <div className="mt-0.5 h-[2px] rounded-full bg-[#e0e0e0] dark:bg-[#474749] overflow-hidden">
                        <div
                            className="h-full rounded-full bg-[#0078d4] dark:bg-[#3794ff] transition-[width] duration-300"
                            style={{ width: `${Math.min(100, (progress.completed / progress.total) * 100)}%` }}
                        />
                    </div>
                </div>
            )}
        </Card>
    );
}

function PauseMarkerRow({ markerId, durationHours, onRemove }: {
    markerId: string;
    durationHours?: PauseDurationHours;
    onRemove: () => void;
}) {
    const durationLabel = durationHours === undefined ? undefined : formatPauseDurationLabel(durationHours);
    const label = durationLabel === undefined ? 'Queue pauses here' : `Queue pauses here · ${durationLabel}`;
    return (
        <div
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-dashed border-yellow-400/60 dark:border-yellow-500/50 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400 text-xs"
            data-testid="pause-marker-row"
            title={durationLabel === undefined
                ? 'Queue will pause when it reaches this point'
                : `Queue will pause for ${durationLabel} when it reaches this point`}
        >
            <span className="shrink-0 text-[11px]">⏸</span>
            <span className="flex-1 text-[11px]">{label}</span>
            <button
                className="shrink-0 text-[10px] opacity-50 hover:opacity-100 transition-opacity leading-none"
                onClick={onRemove}
                title="Remove pause point"
                data-testid="pause-marker-remove-btn"
            >
                ✕
            </button>
        </div>
    );
}

function PauseInsertZone({ index, active, menuOpen, menuRef, onMouseEnter, onMouseLeave, onClick, onSelectDuration }: {
    index: number;
    active: boolean;
    menuOpen: boolean;
    menuRef?: React.Ref<HTMLDivElement>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onClick: () => void;
    onSelectDuration: (options?: QueuePauseOptions) => void;
}) {
    return (
        <div
            className={cn(
                'relative flex items-center justify-center overflow-visible transition-all duration-150 ease-in-out cursor-pointer group',
                active ? 'h-7 opacity-100' : 'h-1 opacity-0',
            )}
            ref={menuRef}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            data-testid={`pause-insert-zone-${index}`}
            title="Insert pause here"
        >
            {active && (
                <div className="flex items-center gap-1 text-[10px] text-yellow-600 dark:text-yellow-400 border border-dashed border-yellow-400/60 rounded px-2 py-0.5 w-full justify-center">
                    <span>⏸</span>
                    <span>Insert pause here</span>
                </div>
            )}
            {menuOpen && (
                <PauseDurationMenu
                    testIdScope={`insert-${index}`}
                    onSelect={onSelectDuration}
                />
            )}
        </div>
    );
}
