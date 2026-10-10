export interface RepoGroupWriterConflict {
  workspaceId: string;
  writerWorkspaceId?: string;
  writerGroupId: string;
  writerGroupName: string;
  writerGroupLink: string;
  reason: 'writer-exists' | 'unresolved-membership';
}

export interface RepoGroupMemberAccess {
  workspaceId: string;
  /** Another saved membership shares this identity (conservative when unresolved). */
  shared: boolean;
  unresolved: boolean;
  /** All matching saved writers, including the group being edited. */
  writers: RepoGroupWriterConflict[];
}

export interface RepoGroupAccessResponse {
  enabled: boolean;
  members: RepoGroupMemberAccess[];
}
