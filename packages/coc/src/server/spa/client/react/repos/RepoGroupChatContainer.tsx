import type { ReactNode } from 'react';
import { ForEachRunRow } from '../features/chat/ForEachRunRow';
import { MapReduceRunRow } from '../features/chat/MapReduceRunRow';
import { RalphSessionRow } from '../features/chat/RalphSessionRow';
import { SpawnedTreeRow } from '../features/chat/SpawnedTreeRow';
import { isSpawnedTreeEntry } from '../features/chat/spawned-tree-grouping';
import { TaskGroupRunRow } from '../features/chat/TaskGroupRunRow';
import { getTaskGroupDescriptor } from '../features/chat/task-group-descriptors';
import { getTaskTimestamp } from '../features/chat/task-group-grouping';
import { isUnseenGroupChat } from './repoGroupChatRowLabels';
import type { RepoGroupChatRow } from './repoGroupChatFeed';
import type { RepoGroupChatContainer as Container } from './repoGroupChatHierarchy';

export interface RepoGroupChatRowOptions {
    isGroupChild?: boolean;
    leadingElement?: ReactNode;
}

export function RepoGroupChatContainer({ container, prefix, ownerDetails, renderRow, onTogglePin, onOpenOwner,
    selectedKeys, selecting, onSelectGroup, expanded, onToggleExpanded, collapsedNodes, onToggleCollapsed }: {
    container: Container;
    prefix?: string;
    ownerDetails: string;
    renderRow: (row: RepoGroupChatRow, options?: RepoGroupChatRowOptions) => ReactNode;
    onTogglePin?: () => void;
    onOpenOwner?: () => void;
    selectedKeys: Set<string>;
    selecting: boolean;
    onSelectGroup: () => void;
    expanded: boolean;
    onToggleExpanded: () => void;
    collapsedNodes: Set<string>;
    onToggleCollapsed: (id: string) => void;
}) {
    const renderTask = (task: any, options: RepoGroupChatRowOptions = { isGroupChild: true }) => {
        const row = container.rows.find(row => row.item === task);
        return row ? renderRow(row, options) : null;
    };
    const entry = container.entry;
    const behavior = {
        now: Date.now(),
        expanded,
        onToggleExpanded,
        isPinned: !!container.groupPinnedAt,
        onTogglePin,
        onMoreActions: onOpenOwner ? () => onOpenOwner() : undefined,
        isRangeSelected: selecting && container.rows.every(row => selectedKeys.has(row.key)),
        isPartiallySelected: selecting && container.rows.some(row => selectedKeys.has(row.key)),
        onSelectRun: selecting ? () => onSelectGroup() : undefined,
        renderTaskCard: renderTask,
    };
    const ownerTitle = (title: string) => prefix ? `${prefix} / ${title}` : title;
    let content: ReactNode;
    if (entry && isSpawnedTreeEntry(entry)) {
        content = <SpawnedTreeRow entry={entry} collapsedIds={collapsedNodes}
            onToggleCollapsed={onToggleCollapsed} renderTaskCard={renderTask} />;
    } else if (entry?.kind === 'ralph-session') {
        content = <RalphSessionRow session={{ ...entry, title: ownerTitle(entry.title) }}
            selectedTaskId={null} onSelectTask={() => {}} {...behavior}
            onSelectSession={selecting ? () => onSelectGroup() : undefined} />;
    } else if (entry?.kind === 'for-each-run') {
        content = <ForEachRunRow group={{ ...entry, run: { ...entry.run, originalRequest: ownerTitle(entry.run.originalRequest) } }} {...behavior} />;
    } else if (entry?.kind === 'map-reduce-run') {
        content = <MapReduceRunRow group={{ ...entry, run: { ...entry.run, originalRequest: ownerTitle(entry.run.originalRequest) } }} {...behavior} />;
    } else if (container.label) {
        const descriptor = container.groupType ? getTaskGroupDescriptor(container.groupType) : undefined;
        const status = container.summary?.status ?? (container.rows.some(row => row.section === 'running') ? 'running'
            : container.rows.some(row => row.item.status === 'failed') ? 'failed' : 'completed');
        content = <TaskGroupRunRow group={{
            runId: container.groupId ?? container.key, children: container.rows.map(row => row.item),
            latestTimestamp: Math.max(...container.rows.map(row => getTaskTimestamp(row.item))),
            hasUnseen: container.rows.some(isUnseenGroupChat),
        }} display={{
            testIdPrefix: descriptor?.entryKind ?? 'task-group-run',
            label: ownerTitle(descriptor?.label ?? container.label),
            badge: descriptor?.badge ?? (container.groupType ? 'TG' : 'F'),
            groupNoun: descriptor ? `${descriptor.label} run` : container.groupType ? 'Task group' : 'Folder',
            badgeClassName: 'text-purple-600 dark:text-purple-400 border-purple-500/70 bg-purple-50/60 dark:bg-purple-500/10',
            selectedRingClassName: 'ring-[#0078d4]/40',
            statusDotClassName: status === 'running' ? 'bg-[#0078d4] animate-pulse'
                : status === 'failed' ? 'bg-red-500' : 'bg-[#bbbbbb] dark:bg-[#5c5c5c]',
            statusLabel: status, status,
            title: container.summary?.title ?? container.groupId ?? '',
        }} bodyTitle={ownerDetails} {...behavior} />;
    } else {
        content = container.rows.map(row => renderRow(row));
    }
    return <div data-testid="repo-group-chat-container" data-container-key={container.key}
        data-owner={container.rows[0].ownerWorkspaceId} title={ownerDetails}>{content}</div>;
}
