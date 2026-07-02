/**
 * ChatListPane — shared queue-style left rail for Activity and Queue tabs.
 *
 * Renders running/queued/history sections with filters, drag/drop,
 * pause markers, context menus, and selection highlighting.
 * Shared queue task list used by the Activity tab.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
import { getDraft } from './hooks/useDraftStore';
import { useLongPress } from '../../hooks/ui/useLongPress';
import { useChatPrefs } from '../../contexts/ChatPreferencesContext';
import { useQueue } from '../../contexts/QueueContext';
import { useApp } from '../../contexts/AppContext';
import { useDisplaySettings } from '../../hooks/preferences/useDisplaySettings';
import { SwipeableHistoryItem } from './SwipeableHistoryItem';
import { SummarizeChatDialog } from './SummarizeChatDialog';
import { groupHistoryByPlanFile, type HistoryGroup } from '../git/history-grouping';
import { HistoryGroupHeader, computeAggregateMode } from '../git/commits/HistoryGroupHeader';
import { groupByRalphSession, type RalphHistoryEntry, type RalphSession } from './ralph-session-grouping';
import { RalphSessionRow } from './RalphSessionRow';
import { groupByForEachRun, getForEachEntryTimestamp, getForEachRunId, type ForEachRunGroup, type ForEachRunHistoryEntry } from './for-each-run-grouping';
import { ForEachRunRow } from './ForEachRunRow';
import { groupByMapReduceRun, getMapReduceEntryTimestamp, getMapReduceRunId, type MapReduceRunGroup, type MapReduceRunHistoryEntry } from './map-reduce-run-grouping';
import { MapReduceRunRow } from './MapReduceRunRow';
import { buildSpawnedTreeChatView, collectSpawnedEntryTasks, getSpawnedEntryTimestamp, isSpawnedTreeEntry, partitionSpawnedTreesByArchived, type SpawnedTreeEntry } from './spawned-tree-grouping';
import { SpawnedTreeRow } from './SpawnedTreeRow';
import { isSpawnedTreeViewEnabled, loadCollapsedSpawnedRootIds, toggleCollapsedSpawnedRoot } from './spawned-tree-view-state';
import { getGroupPinKey, isPinnedGroupEntry, mergePinnedEntries, partitionPinnedGroups, type PinnedGroupEntry, type PinnedListEntry } from './group-pinning';
import { isRalphEnabled, isLoopsEnabled, isSessionContextAttachmentsEnabled, isForEachEnabled, isMapReduceEnabled, isCommitChatLensEnabled } from '../../utils/config';
import { getListModeConfig } from './list-mode-config';
import { useAllLoops, type ProcessLoopState } from './hooks/useAllLoops';
import { LoopIcon } from './icons/LoopIcon';
import { isRalphTask } from '../../../../../tasks/task-types';
import { getProviderDotClasses, getTaskChatProvider } from './ProviderBadge';
import { normalizeChatMode } from '../../repos/modeConfig';
import { createRalphSessionContextDragPayload, createSessionContextDragPayload, writeSessionContextDragData } from './sessionContextDrag';
import type { ForEachRunSummary, MapReduceRunSummary, ProcessGroupPin, ProcessGroupPinType } from '@plusplusoneplusplus/coc-client';

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

type QueuePauseOptions = { durationHours?: 1 | 2 | 3 | 4 | 8; until?: number | string };
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

/** Extract session category from a task's payload. */
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
 *  chats that have an attached `/loop`. */
export function isScheduledTask(task: any): boolean {
    return Boolean(task?.payload?.scheduleId || task?.scheduleId);
}

/** Internal scope id for the Activity segmented control. Note the id `'loops'`
 *  is retained for backwards compatibility (localStorage value + test ids) even
 *  though its visible label is now "Scheduled". */
export type ActivityScope = 'chat' | 'auto' | 'loops' | 'all';

/** Pure membership test for the Activity scope segmented control. `hasLoop`
 *  indicates the task's process has an active/paused `/loop` attached.
 *  - `chat` → chat tasks that are NOT scheduled runs
 *  - `auto` → automations that are NOT scheduled runs
 *  - `loops` (labelled "Scheduled") → scheduled runs OR chats with a `/loop`
 *  - `all` → everything (true superset, still includes scheduled runs)
 *  Extracted as a pure helper so scope membership is unit-testable without
 *  rendering the component. */
export function taskInScope(scope: ActivityScope, task: any, hasLoop: boolean): boolean {
    if (scope === 'all') return true;
    if (scope === 'chat') return isChatTask(task) && !isScheduledTask(task);
    if (scope === 'auto') return isAutomationTask(task) && !isScheduledTask(task);
    if (scope === 'loops') return isScheduledTask(task) || hasLoop;
    return true;
}

/** Get a display title for a chat task, falling back to a truncated prompt preview. */
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

/** Extract a short preview of the user prompt from the task payload. */
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
    | { kind: 'map-reduce-run'; id: string; runId: string; subIds: string[] };

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
        || (entry?.kind === 'map-reduce-run' && typeof entry.id === 'string' && Array.isArray(entry.subIds));
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

export function buildHistoryRangeRows(
    entries: HistoryRangeInput[],
    expandedRalphSessionIds: ReadonlySet<string>,
    expandedForEachRunIds: ReadonlySet<string> = new Set(),
    expandedMapReduceRunIds: ReadonlySet<string> = new Set(),
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
    if (row.ralphSessionId) return getRalphSessionRangeId(row.ralphSessionId);
    if (row.forEachRunId) return getForEachRunRangeId(row.forEachRunId);
    if (row.mapReduceRunId) return getMapReduceRunRangeId(row.mapReduceRunId);
    return null;
}

function getHistoryRangeRowGroupSubIds(row: HistoryRangeRow): string[] {
    if (row.kind === 'ralph-session' || row.kind === 'for-each-run' || row.kind === 'map-reduce-run') return row.subIds;
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

function formatPauseResumeTime(value: number | string | undefined): string | undefined {
    const until = pauseUntilMs(value);
    if (until === undefined) return undefined;
    return new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function PauseDurationMenu({
    testIdScope,
    onSelect,
}: {
    testIdScope: string;
    onSelect: (options?: QueuePauseOptions) => void;
}) {
    return (
        <div
            className="absolute right-0 top-full mt-1 z-30 min-w-44 rounded border border-[#d0d0d0] dark:border-[#3f3f46] bg-white dark:bg-[#252526] shadow-lg p-1 text-xs"
            data-testid={`pause-duration-menu-${testIdScope}`}
            onClick={(e) => e.stopPropagation()}
        >
            <button
                type="button"
                className="block w-full text-left px-2 py-1.5 rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                onClick={() => onSelect()}
                data-testid={`pause-duration-${testIdScope}-indefinite`}
            >
                Until resumed
            </button>
            {PAUSE_HOUR_PRESETS.map(hours => (
                <button
                    key={hours}
                    type="button"
                    className="block w-full text-left px-2 py-1.5 rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    onClick={() => onSelect({ durationHours: hours })}
                    data-testid={`pause-duration-${testIdScope}-${hours}h`}
                >
                    {hours} {hours === 1 ? 'hour' : 'hours'}
                </button>
            ))}
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
}: ChatListPaneProps) {
    const { state: queueState } = useQueue();
    const isTaskSubmitting = queueState.isTaskSubmitting;

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

    // Fetch all loops server-wide for inline indicators and the "Loops" scope tab.
    const { loopStateByProcess, processIdsWithLoops, loopProcessCount } = useAllLoops();
    const loopsEnabled = isLoopsEnabled();
    const sessionContextDragEnabled = isSessionContextAttachmentsEnabled();

    const [searchQuery, setSearchQueryRaw] = useState('');
    const [searchVisible, setSearchVisible] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const pauseMenuRef = useRef<HTMLDivElement>(null);

    /**
     * Activity-tab scope segmented control: filters by task source.
     *   - 'chat'  → chat tasks that are not scheduled runs
     *   - 'auto'  → automations (run-script / run-workflow) that are not scheduled runs
     *   - 'loops' → "Scheduled" scope: scheduled-job runs ∪ chats with a `/loop`
     *               (id kept as 'loops' for the persisted value + test ids)
     *   - 'all'   → no source filter
     * Persisted in localStorage so the user's choice survives reloads.
     * Default is 'all' to preserve the pre-existing behavior of showing every task.
     */
    const [activeScope, setActiveScopeState] = useState<ActivityScope>(() => {
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

    const { pinnedChatIds, archivedChatIds, pinChat: onPinChat, unpinChat: onUnpinChat, archiveChat: onArchiveChat, unarchiveChat: onUnarchiveChat, archiveChats: onArchiveChats, unarchiveChats: onUnarchiveChats } = useChatPrefs();
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

    const detailPaneFocusedRef = useRef(false);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const detailPane = document.querySelector('[data-pane="detail"]');
            detailPaneFocusedRef.current = !!detailPane?.contains(e.target as Node);
        };
        document.addEventListener('mousedown', handler, true);
        return () => document.removeEventListener('mousedown', handler, true);
    }, []);

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

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                // Skip interception when this pane is hidden (display:none via parent).
                if (!containerRef.current || containerRef.current.offsetParent === null) return;
                if (detailPaneFocusedRef.current) return;
                e.preventDefault();
                setSearchVisible(true);
                setTimeout(() => searchInputRef.current?.focus(), 0);
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey && !e.altKey) {
                // ⌘N / Ctrl+N — primary "New chat" shortcut. Only intercept when
                // the activity pane is visible and the detail pane isn't focused
                // (so users editing a chat aren't disrupted).
                if (!containerRef.current || containerRef.current.offsetParent === null) return;
                if (detailPaneFocusedRef.current) return;
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
    }, [searchVisible, onNewChat, onOpenDialog, selectedHistoryIds.size]);

    const allTasks = useMemo(
        () => [...running, ...queued.filter((t: any) => t.kind !== 'pause-marker'), ...history],
        [running, queued, history],
    );
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
        const hasLoop = processIdsWithLoops.has(task.id) || processIdsWithLoops.has(task.processId);
        return taskInScope(activeScope, task, hasLoop);
    }, [activeTab, activeScope, processIdsWithLoops]);

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
        // `/loop`. A task that is BOTH is counted once via the single guard.
        let loops = 0;
        let hasScheduledRuns = false;
        for (const t of allRaw) {
            const scheduled = isScheduledTask(t);
            if (scheduled) hasScheduledRuns = true;
            if (scheduled || processIdsWithLoops.has(t.id) || processIdsWithLoops.has(t.processId)) loops++;
        }
        return { chat, auto, loops, all: all.length + forEachRunGroups.length + mapReduceRunGroups.length + activeSpawnedTreeGroups.length + archivedSpawnedTreeGroups.length, hasScheduledRuns };
    }, [running, queued, history, processIdsWithLoops, groupedTaskIds, forEachRunGroups.length, mapReduceRunGroups.length, activeSpawnedTreeGroups.length, archivedSpawnedTreeGroups.length]);

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

    // Group unpinned history by plan file (when grouping is enabled)
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
    const dateBucketedHistory = useMemo(() => {
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
    const chatGroups = useMemo(() => {
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

    const [expandedRalphSessionState, setExpandedRalphSessionState] = useState<{ workspaceId?: string; sessions: Set<string> }>({
        workspaceId,
        sessions: new Set(),
    });
    const [expandedForEachRunState, setExpandedForEachRunState] = useState<{ workspaceId?: string; runs: Set<string> }>({
        workspaceId,
        runs: new Set(),
    });
    const [expandedMapReduceRunState, setExpandedMapReduceRunState] = useState<{ workspaceId?: string; runs: Set<string> }>({
        workspaceId,
        runs: new Set(),
    });
    const expandedRalphSessionIds = useMemo(
        () => expandedRalphSessionState.workspaceId === workspaceId ? expandedRalphSessionState.sessions : new Set<string>(),
        [expandedRalphSessionState, workspaceId],
    );
    const expandedForEachRunIds = useMemo(
        () => expandedForEachRunState.workspaceId === workspaceId ? expandedForEachRunState.runs : new Set<string>(),
        [expandedForEachRunState, workspaceId],
    );
    const expandedMapReduceRunIds = useMemo(
        () => expandedMapReduceRunState.workspaceId === workspaceId ? expandedMapReduceRunState.runs : new Set<string>(),
        [expandedMapReduceRunState, workspaceId],
    );
    const toggleRalphSession = useCallback((sessionId: string) => {
        setExpandedRalphSessionState(prev => {
            const sessions = new Set(prev.workspaceId === workspaceId ? prev.sessions : []);
            sessions.has(sessionId) ? sessions.delete(sessionId) : sessions.add(sessionId);
            return { workspaceId, sessions };
        });
    }, [workspaceId]);
    const toggleForEachRun = useCallback((runId: string) => {
        setExpandedForEachRunState(prev => {
            const runs = new Set(prev.workspaceId === workspaceId ? prev.runs : []);
            runs.has(runId) ? runs.delete(runId) : runs.add(runId);
            return { workspaceId, runs };
        });
    }, [workspaceId]);
    const toggleMapReduceRun = useCallback((runId: string) => {
        setExpandedMapReduceRunState(prev => {
            const runs = new Set(prev.workspaceId === workspaceId ? prev.runs : []);
            runs.has(runId) ? runs.delete(runId) : runs.add(runId);
            return { workspaceId, runs };
        });
    }, [workspaceId]);

    useEffect(() => {
        setExpandedRalphSessionState(prev => {
            if (prev.workspaceId === workspaceId && prev.sessions.size === 0) return prev;
            return { workspaceId, sessions: new Set() };
        });
        setExpandedForEachRunState(prev => {
            if (prev.workspaceId === workspaceId && prev.runs.size === 0) return prev;
            return { workspaceId, runs: new Set() };
        });
        setExpandedMapReduceRunState(prev => {
            if (prev.workspaceId === workspaceId && prev.runs.size === 0) return prev;
            return { workspaceId, runs: new Set() };
        });
    }, [workspaceId]);

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
                    ...todayGrouped,
                    ...weekGrouped,
                    ...olderGrouped,
                ],
                expandedRalphSessionIds,
                expandedForEachRunIds,
                expandedMapReduceRunIds,
            )
            : [],
        [chatGroups, todayGrouped, weekGrouped, olderGrouped, expandedRalphSessionIds, expandedForEachRunIds, expandedMapReduceRunIds],
    );

    const activityRangeRows = useMemo(
        () => buildHistoryRangeRows(
            [
                ...activityRunningEntries,
                ...pinnedActivityEntries,
                ...dateBucketedHistory.today,
                ...dateBucketedHistory.week,
                ...dateBucketedHistory.older,
            ],
            expandedRalphSessionIds,
            expandedForEachRunIds,
            expandedMapReduceRunIds,
        ),
        [activityRunningEntries, pinnedActivityEntries, dateBucketedHistory, expandedRalphSessionIds, expandedForEachRunIds, expandedMapReduceRunIds],
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

    const handleTaskContextMenu= useCallback((e: React.MouseEvent, taskId: string, taskStatus: 'running' | 'queued' | 'completed') => {
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

        setContextMenu({ x: e.clientX, y: e.clientY, taskId, taskStatus, bulkIds });
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
                        const group = contextMenu.forEachRun!;
                        const lines = [
                            `For Each run ${group.runId}`,
                            `Status: ${group.run.status}`,
                            `Items: ${group.run.itemCount}`,
                            `Updated: ${group.run.updatedAt ?? group.run.completedAt ?? group.run.createdAt}`,
                            'Processes:',
                            ...ids.map(id => `  - ${id}`),
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
                            ...ids.map(id => `  - ${id}`),
                        ];
                        void copyToClipboard(lines.join('\n'));
                        closeContextMenu();
                    },
                }] : []),
                ...(contextMenu.ralphSession ? [{
                    label: 'Copy session info',
                    icon: '📎',
                    onClick: () => {
                        const rs = contextMenu.ralphSession!;
                        const lines = [
                            `Ralph session ${rs.sessionId}`,
                            `Phase: ${rs.phase}`,
                            `Iterations: ${rs.iterations.length}`,
                            `Updated: ${rs.latestTimestamp ? new Date(rs.latestTimestamp).toISOString() : 'unknown'}`,
                            'Processes:',
                            ...ids.map(id => `  - ${id}`),
                        ];
                        void copyToClipboard(lines.join('\n'));
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
    }, [contextMenu, queued, running, history, unseenProcessIds, pinnedChatIds, archivedChatIds, onMarkRead, onMarkUnread, onPinChat, onUnpinChat, onArchiveChat, onUnarchiveChat, onArchiveChats, onUnarchiveChats, onSetGroupPin, setGroupPinned, closeContextMenu, deleteChatDirect, workspaceId, onSelectTask, fetchQueue, isAutopilotPaused]);

    /** Render a single history card (shared between flat and grouped layouts). */
    /**
     * Render a single compact row, used for ALL task types (chat, workflow, script)
     * across both the chats and activity branches.
     *
     * Layout (CSS grid): [status-dot 10px] [MODE pill 30px] [title 1fr] [right auto]
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
                        'grid-cols-[10px_30px_minmax(0,1fr)_auto]',
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
                    onContextMenu={(e) => handleTaskContextMenu(e, task.id, contextMenuKind)}
                    draggable={!!sessionContextPayload}
                    onDragStart={sessionContextPayload ? (e) => writeSessionContextDragData(e.dataTransfer, sessionContextPayload) : undefined}
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
                    <span className={dotClasses} aria-label={`status: ${isAwaitingInput ? 'awaiting input' : isRunning ? 'running' : isFailed ? 'failed' : isQueued ? 'queued' : 'done'}`} />
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
                            title="Double-click to rename"
                            onDoubleClick={(e) => {
                                e.stopPropagation();
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
                            if (!loopsEnabled) return null;
                            const taskProcessId = task.processId || task.id;
                            const state = loopStateByProcess.get(task.id) ?? loopStateByProcess.get(taskProcessId);
                            if (!state) return null;
                            return (
                                <span
                                    className={cn(
                                        'shrink-0 text-[10px]',
                                        state === 'active'
                                            ? 'text-[#15703a] dark:text-[#4ade80]'
                                            : 'text-[#8a5a00] dark:text-[#fbbf24]',
                                    )}
                                    title={state === 'active' ? 'Has active loops' : 'Has paused loops'}
                                    data-testid="loop-indicator"
                                >
                                    <LoopIcon className="w-3.5 h-3.5" />
                                </span>
                            );
                        })()}
                    </span>
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
        loopStateByProcess,
        loopsEnabled,
        sessionContextDragEnabled,
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
        const isRalphRangeSelected = ralphSubIds.length > 0 && ralphSubIds.every(id => selectedHistoryIds.has(id));
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
            });
        };
        return (
            <RalphSessionRow
                key={`${workspaceId ?? '__all'}:${session.sessionId}`}
                session={session}
                selectedTaskId={selectedTaskId}
                selectedSessionId={selectedRalphSessionId}
                isRangeSelected={isRalphRangeSelected}
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
                    };
                    groupLongPress.onTouchStart(e);
                }}
                onTouchEnd={groupLongPress.onTouchEnd}
                onTouchMove={groupLongPress.onTouchMove}
                renderTaskCard={(task) => renderChatListRow(task, listForRange, { isGroupChild: true })}
            />
        );
    }, [
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
        const isForEachRangeSelected = forEachSubIds.length > 0 && forEachSubIds.every(id => selectedHistoryIds.has(id));
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
            });
        };
        return (
            <ForEachRunRow
                key={`${workspaceId ?? '__all'}:for-each:${group.runId}`}
                group={group}
                selectedRunId={selectedForEachRunId}
                isRangeSelected={isForEachRangeSelected}
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
        const isMapReduceRangeSelected = mapReduceSubIds.length > 0 && mapReduceSubIds.every(id => selectedHistoryIds.has(id));
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
            });
        };
        return (
            <MapReduceRunRow
                key={`${workspaceId ?? '__all'}:map-reduce:${group.runId}`}
                group={group}
                selectedRunId={selectedMapReduceRunId}
                isRangeSelected={isMapReduceRangeSelected}
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
                })}
            />
        );
    }, [collapsedSpawnedIds, toggleSpawnedCollapsed, renderChatListRow, getGroupedChildTaskStatus, workspaceId]);

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
            <div ref={containerRef} className="p-2 md:p-4 flex flex-col gap-2 md:gap-3 overflow-y-auto flex-1">
                {/* ── Chats tab: redesigned status-grouped list ── */}
                {activeTab === 'chats' && chatGroups && (
                    <>
                        <Button variant="ghost" size="sm" onClick={onNewChat ?? onOpenDialog} className={cn("self-start", isMobile && "hidden")} data-testid="new-chat-btn">
                            💬 New Chat
                        </Button>

                        {/* Search bar — magnifying glass + ⌘F kbd hint */}
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
                                        { id: 'today', label: 'Today', items: todayGrouped, variant: 'plain' as const },
                                        { id: 'week', label: 'This week', items: weekGrouped, variant: 'plain' as const },
                                        { id: 'older', label: 'Older', items: olderGrouped, variant: 'plain' as const },
                                    ];
                                    return sections
                                        .filter(s => s.items.length > 0)
                                        .map(section => (
                                            <div key={section.id} data-section={section.id}>
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
                {activeTab !== 'chats' && (<>
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
                        title={`New chat (${newChatKbdLabel})`}
                        data-testid="toolbar-new-chat-btn"
                        className="flex-1 min-w-0 inline-flex items-center gap-1.5 h-7 pl-2 pr-2 bg-[#f3f3f3] hover:bg-[#e8e8e8] dark:bg-[#1e1e1e] dark:hover:bg-[#2a2a2a] text-[#1e1e1e] dark:text-white rounded-md text-[12px] leading-none font-medium tracking-tight transition-colors active:translate-y-[0.5px]"
                    >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="flex-shrink-0">
                            <path d="M7 2v10M2 7h10" />
                        </svg>
                        <span className="flex-1 text-left truncate">New chat</span>
                        <kbd className="font-mono text-[10px] tracking-wider rounded-[3px] px-1 py-px border border-[#1e1e1e]/30 dark:border-white/30 text-[#1e1e1e]/85 dark:text-white/85 select-none flex-shrink-0">{newChatKbdLabel}</kbd>
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
                                        : 'bg-emerald-500 ring-2 ring-emerald-500/25',
                                )} aria-hidden="true" />
                                <span
                                    className={cn(
                                        'font-mono text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap',
                                        isPaused
                                            ? 'text-amber-700 dark:text-amber-400'
                                            : 'text-[#606060] dark:text-[#9d9d9d]',
                                    )}
                                >
                                    ALL
                                </span>
                                {isPaused && (
                                    <span
                                        className="text-[11.5px] font-semibold leading-none whitespace-nowrap text-amber-700 dark:text-amber-400"
                                        aria-label="▶ Resume all tasks"
                                    >
                                        {queuePauseRemaining || 'PAUSED'}
                                    </span>
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
                                                : 'bg-emerald-500 ring-2 ring-emerald-500/25',
                                        )} aria-hidden="true" />
                                        <span
                                            className={cn(
                                                'font-mono text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap',
                                                isAutopilotPaused
                                                    ? 'text-amber-700 dark:text-amber-400'
                                                    : 'text-[#606060] dark:text-[#9d9d9d]',
                                            )}
                                        >
                                            AP
                                        </span>
                                        {isAutopilotPaused && (
                                            <span
                                                className="text-[11.5px] font-semibold leading-none whitespace-nowrap text-amber-700 dark:text-amber-400"
                                                aria-label="▶ Resume autopilot"
                                            >
                                                {autopilotPauseRemaining || 'PAUSED'}
                                            </span>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                        {pauseMenuScope && (
                            <PauseDurationMenu
                                testIdScope={pauseMenuScope}
                                onSelect={(options) => selectPauseDuration(pauseMenuScope, options)}
                            />
                        )}
                    </div>
                </div>

                {/* Scope segmented control — Chats / [Scheduled] / Automations / All.
                    Only rendered in the Activity branch (`!activeTab`); Chats and
                    Tasks tabs already have their own narrow scope. The "Scheduled"
                    segment (internal id `loops`) is shown when loops are enabled OR
                    any scheduled-job run exists, so it appears whenever it has
                    content even if the loops feature flag is off. Inner spans use
                    `whitespace-nowrap` and `min-w-0 truncate` on the label so narrow
                    widths show ellipsis on the longest label ("Automations")
                    instead of wrapping the count below. */}
                {!activeTab && (
                    <div
                        className={cn('grid gap-0 p-0.5 bg-[#f5f5f5] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#474749] rounded-md', (loopsEnabled || scopeCounts.hasScheduledRuns) ? 'grid-cols-4' : 'grid-cols-3')}
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
                                hidden: !(loopsEnabled || scopeCounts.hasScheduledRuns),
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
                            { id: 'all' as const, label: 'All', count: scopeCounts.all, icon: null, hidden: false },
                        ]).filter(s => !s.hidden).map(scope => {
                            const on = activeScope === scope.id;
                            return (
                                <button
                                    key={scope.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={on}
                                    onClick={() => setActiveScope(scope.id)}
                                    className={cn(
                                        'h-[26px] min-w-0 px-1.5 inline-flex items-center justify-center gap-1 text-[11.5px] leading-none font-medium rounded transition-[background-color,color,box-shadow] duration-100',
                                        on
                                            ? 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] shadow-[0_1px_0_rgba(0,0,0,0.04),0_0_0_1px_rgba(224,224,224,0.7)] dark:shadow-[0_1px_0_rgba(0,0,0,0.20),0_0_0_1px_rgba(71,71,73,0.7)]'
                                            : 'text-[#606060] dark:text-[#9d9d9d] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                    )}
                                    data-testid={`activity-scope-tab-${scope.id}`}
                                    data-active={on || undefined}
                                >
                                    {scope.icon && <span className="opacity-80 flex-shrink-0">{scope.icon}</span>}
                                    <span className="min-w-0 truncate whitespace-nowrap">{scope.label}</span>
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

                {/* Search bar — always visible on every tab to match the activity-compact reference. */}
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

                {activityCompletedEntries.length > 0 && (
                    <div data-section="completed" className="-mx-2 md:-mx-4">
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
                </>)}
        </div>
        {contextMenu && (
            <ContextMenu
                position={{ x: contextMenu.x, y: contextMenu.y }}
                items={contextMenuItems}
                onClose={closeContextMenu}
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
    const label = durationHours === undefined ? 'Queue pauses here' : `Queue pauses here · ${durationHours}h`;
    return (
        <div
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-dashed border-yellow-400/60 dark:border-yellow-500/50 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400 text-xs"
            data-testid="pause-marker-row"
            title={durationHours === undefined
                ? 'Queue will pause when it reaches this point'
                : `Queue will pause for ${durationHours} ${durationHours === 1 ? 'hour' : 'hours'} when it reaches this point`}
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
