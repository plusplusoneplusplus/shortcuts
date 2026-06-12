/**
 * Task Groups — generic parent/child task relationship registry.
 *
 * One summary shape covers every hierarchical feature (For Each runs,
 * Map Reduce runs, Ralph sessions, Dream runs, and future group types).
 * Feature-specific summary fields ride in `extra`.
 */

/** Normalized group lifecycle. Feature-specific states ride in `extra.detailStatus`. */
export type TaskGroupStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Known group types. The registry is open — future types are plain strings. */
export type TaskGroupType = 'for-each' | 'map-reduce' | 'ralph' | 'dream' | (string & {});

export interface TaskGroupChildLink {
  /** Child role within the group ('generation' | 'item' | 'reduce' | 'iteration' | 'grilling' | 'analyzer' | 'critic' | ...). */
  role: string;
  taskId?: string;
  processId?: string;
  /** Stable per-item key (For Each/Map Reduce item ID, Ralph iteration index, ...). */
  itemKey?: string;
  /** Ordering hint within the group (e.g. iteration number). */
  memberIndex?: number;
  linkedAt: string;
}

export interface TaskGroupSummary {
  groupId: string;
  workspaceId: string;
  type: TaskGroupType;
  title?: string;
  status: TaskGroupStatus;
  /** Hidden groups are linkage-only (e.g. Dream internals) — not rendered as chat-list groups. */
  hidden?: boolean;
  /** Process ID of the visible origin chat (generation chat, grilling chat). */
  originProcessId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  childCount: number;
  children: TaskGroupChildLink[];
  /** Feature summary extras (itemCount, reduceStatus, detailStatus, loopCount, ...). */
  extra?: Record<string, unknown>;
}

export interface ListTaskGroupsQuery {
  type?: string;
  includeHidden?: boolean;
}

export interface ListTaskGroupsResponse {
  groups: TaskGroupSummary[];
}

export interface TaskGroupResponse {
  group: TaskGroupSummary;
}

/**
 * The `payload.context.taskGroup` tag carried by every child task of a group.
 * Mirrored into `AIProcess.metadata.taskGroup` when the process is created.
 */
export interface TaskGroupRef {
  groupId: string;
  groupType: TaskGroupType;
  /** Child role within the group. */
  role: string;
  itemKey?: string;
  workspaceId: string;
}
