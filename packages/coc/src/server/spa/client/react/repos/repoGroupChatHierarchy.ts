import type { ForEachRunSummary, MapReduceRunSummary, ProcessGroupPin, TaskGroupSummary } from '@plusplusoneplusplus/coc-client';
import { getRalphSessionId, groupByRalphSession, type RalphSession } from '../features/chat/ralph-session-grouping';
import { getForEachRunId, groupByForEachRun, type ForEachRunGroup } from '../features/chat/for-each-run-grouping';
import { getMapReduceRunId, groupByMapReduceRun, type MapReduceRunGroup } from '../features/chat/map-reduce-run-grouping';
import { getTaskGroupRef, getTaskTimestamp } from '../features/chat/task-group-grouping';
import { groupBySpawnedTree, isSpawnedTreeEntry, collectSpawnedEntryTasks, type SpawnedTreeEntry } from '../features/chat/spawned-tree-grouping';
import { getTaskGroupDescriptor } from '../features/chat/task-group-descriptors';
import { getGroupPinTarget } from '../features/chat/group-pinning';
import type { RepoGroupChatRow } from './repoGroupChatFeed';
import { isUnseenGroupChat } from './repoGroupChatRowLabels';

export interface RepoGroupChatOwnerHierarchy {
    pins: ProcessGroupPin[];
    forEach: ForEachRunSummary[];
    mapReduce: MapReduceRunSummary[];
    taskGroups: TaskGroupSummary[];
}

export type RepoGroupChatNativeEntry = RalphSession | ForEachRunGroup | MapReduceRunGroup | SpawnedTreeEntry;

export interface RepoGroupChatContainer {
    key: string;
    label: string;
    rows: RepoGroupChatRow[];
    entry?: RepoGroupChatNativeEntry;
    groupId?: string;
    groupType?: string;
    groupPinnedAt?: string;
    summary?: TaskGroupSummary;
}

/** Containers never span owners, even when group ids or folder names coincide. */
export function groupRepoGroupChatRows(rows: RepoGroupChatRow[], searching = false, foldersEnabled = false,
    metadata: Record<string, RepoGroupChatOwnerHierarchy> = {}): RepoGroupChatContainer[] {
    if (searching) return rows.map(row => ({ key: row.key, label: '', rows: [row] }));
    const owners = new Map<string, RepoGroupChatRow[]>();
    for (const row of rows) {
        const owner = `${row.serverKey}|${row.ownerWorkspaceId}`;
        const list = owners.get(owner) ?? [];
        list.push(row);
        owners.set(owner, list);
    }
    const result: RepoGroupChatContainer[] = [];
    for (const [owner, owned] of owners) {
        const ownerMetadata = metadata[owned[0].ownerWorkspaceId];
        const available = owned.filter(row => !row.item.pinnedAt || row.item.archived);
        const byItem = new Map(owned.map(row => [row.item, row]));
        const unseen = new Set(available.filter(isUnseenGroupChat).flatMap(row => [row.item.id, row.item.processId].filter(Boolean)));
        let remaining = available.map(row => row.item);
        const addNativeGroups = (entries: any[], kind: string) => {
            remaining = [];
            for (const entry of entries) {
                if (entry.kind !== kind) { remaining.push(entry); continue; }
                const children = kind === 'ralph-session'
                    ? [...(entry.grillingProcess ? [entry.grillingProcess] : []), ...entry.iterations] : entry.children;
                // Feed filtering/pagination remains authoritative; unrelated run summaries never add rows.
                if (!children.length) continue;
                const target = getGroupPinTarget(entry);
                const pin = ownerMetadata?.pins.find(pin => pin.type === target.type && pin.groupId === target.groupId);
                result.push({
                    key: `${owner}|${kind}|${target.groupId}`, label: kind, entry,
                    groupId: target.groupId, groupType: target.type, groupPinnedAt: pin?.pinnedAt,
                    rows: children.map((item: any) => byItem.get(item)!),
                });
            }
        };
        addNativeGroups(groupByRalphSession(remaining, unseen), 'ralph-session');
        addNativeGroups(groupByForEachRun(remaining, ownerMetadata?.forEach ?? [], unseen), 'for-each-run');
        addNativeGroups(groupByMapReduceRun(remaining, ownerMetadata?.mapReduce ?? [], unseen), 'map-reduce-run');
        const remainingItems = new Set(remaining);
        const groups = new Map<string, RepoGroupChatContainer>();
        const standalone: RepoGroupChatRow[] = [];
        for (const row of owned) {
            if (row.item.pinnedAt && !row.item.archived) {
                result.push({ key: row.key, label: '', rows: [row] });
                continue;
            }
            if (!remainingItems.has(row.item)) continue;
            const ref = getTaskGroupRef(row.item);
            const ralph = getRalphSessionId(row.item);
            const each = getForEachRunId(row.item);
            const reduce = getMapReduceRunId(row.item);
            const folder = foldersEnabled && row.section === 'history' && !row.item.pinnedAt
                ? row.item.folderId : undefined;
            const summary = ownerMetadata?.taskGroups.find(group => !group.hidden &&
                (group.groupId === ref?.groupId || group.originProcessId === row.canonicalId ||
                    group.children.some(child => child.processId === row.canonicalId)));
            const groupType = ralph ? 'ralph' : each ? 'for-each' : reduce ? 'map-reduce' : ref?.groupType ?? summary?.type;
            const descriptor = groupType ? getTaskGroupDescriptor(groupType) : undefined;
            const id = descriptor?.groupable === false ? folder : ralph ?? each ?? reduce ?? ref?.groupId ?? summary?.groupId ?? folder;
            const kind = id === folder && folder ? 'Folder' : descriptor?.label ?? groupType;
            if (!id) { standalone.push(row); continue; }
            const key = `${owner}|${kind === 'Folder' ? kind : descriptor?.entryKind ?? groupType}|${id}`;
            const group: RepoGroupChatContainer = groups.get(key) ?? { key, label: kind === 'Folder' ? `Folder / ${row.item.folderName ?? id}` : `${kind} / ${id}`,
                groupId: id, groupType: kind === 'Folder' ? undefined : groupType, summary, rows: [] };
            const pinType = descriptor?.pinType ?? group.groupType;
            group.groupPinnedAt = ownerMetadata?.pins.find(pin => pin.type === pinType && pin.groupId === id)?.pinnedAt;
            group.rows.push(row);
            groups.set(key, group);
        }
        result.push(...groups.values());
        // A delegated parent on another owner must not resolve to a colliding local id.
        const treeItems = standalone.map(row => {
            if (!row.item.parentOwnerWorkspaceId || row.item.parentOwnerWorkspaceId === row.ownerWorkspaceId) return row.item;
            const item = { ...row.item, parentProcessId: undefined };
            byItem.set(item, row);
            return item;
        });
        const trees = groupBySpawnedTree(treeItems);
        const restoreTasks = (node: SpawnedTreeEntry['root']) => {
            node.task = byItem.get(node.task)!.item;
            for (const child of node.children) restoreTasks(child);
        };
        for (const entry of trees) {
            if (isSpawnedTreeEntry(entry)) {
                restoreTasks(entry.root);
                result.push({
                    key: `${owner}|spawn|${entry.rootProcessId}`, label: 'Conversation tree',
                    entry, rows: collectSpawnedEntryTasks(entry).map(item => byItem.get(item)!),
                });
            }
            else {
                const row = byItem.get(entry)!;
                result.push({ key: row.key, label: '', rows: [row] });
            }
        }
    }
    const rank = new Map(rows.map((row, index) => [row.key, index]));
    for (const group of result) if (group.label && group.label !== 'Conversation tree') group.rows.sort((a, b) =>
        getTaskTimestamp(a.item) - getTaskTimestamp(b.item) || a.key.localeCompare(b.key));
    result.sort((a, b) => Math.min(...a.rows.map(row => rank.get(row.key)!))
        - Math.min(...b.rows.map(row => rank.get(row.key)!)));
    return result;
}
