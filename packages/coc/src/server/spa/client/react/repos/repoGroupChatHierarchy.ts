import { getRalphSessionId } from '../features/chat/ralph-session-grouping';
import { getForEachRunId } from '../features/chat/for-each-run-grouping';
import { getMapReduceRunId } from '../features/chat/map-reduce-run-grouping';
import { getTaskGroupRef, getTaskTimestamp } from '../features/chat/task-group-grouping';
import { groupBySpawnedTree, isSpawnedTreeEntry, collectSpawnedEntryTasks } from '../features/chat/spawned-tree-grouping';
import type { RepoGroupChatRow } from './repoGroupChatFeed';

export interface RepoGroupChatContainer {
    key: string;
    label: string;
    rows: RepoGroupChatRow[];
}

/** Containers never span owners, even when group ids or folder names coincide. */
export function groupRepoGroupChatRows(rows: RepoGroupChatRow[], searching = false, foldersEnabled = false): RepoGroupChatContainer[] {
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
        const groups = new Map<string, RepoGroupChatContainer>();
        const standalone: RepoGroupChatRow[] = [];
        for (const row of owned) {
            const ref = getTaskGroupRef(row.item);
            const ralph = getRalphSessionId(row.item);
            const each = getForEachRunId(row.item);
            const reduce = getMapReduceRunId(row.item);
            const folder = foldersEnabled && row.section === 'history' && !row.item.pinnedAt
                ? row.item.folderId : undefined;
            const id = ralph ?? each ?? reduce ?? ref?.groupId ?? folder;
            const kind = ralph ? 'Ralph' : each ? 'For Each' : reduce ? 'Map Reduce' : ref?.groupType ?? (folder ? 'Folder' : undefined);
            if (!id) { standalone.push(row); continue; }
            const key = `${owner}|${kind}|${id}`;
            const group = groups.get(key) ?? { key, label: kind === 'Folder' ? `Folder / ${row.item.folderName ?? id}` : `${kind} / ${id}`, rows: [] };
            group.rows.push(row);
            groups.set(key, group);
        }
        result.push(...groups.values());
        const byItem = new Map(standalone.map(row => [row.item, row]));
        const trees = groupBySpawnedTree(standalone.map(row => row.item));
        for (const entry of trees) {
            if (isSpawnedTreeEntry(entry)) result.push({
                key: `${owner}|spawn|${entry.rootProcessId}`, label: 'Conversation tree',
                rows: collectSpawnedEntryTasks(entry).map(item => byItem.get(item)!),
            });
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
