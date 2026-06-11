import type { EnqueueTaskResponse } from './queue';

export type NoteNodeType = 'notebook' | 'section' | 'page';

export interface NoteTreeNode {
  name: string;
  path: string;
  type: NoteNodeType;
  children?: NoteTreeNode[];
  lastModifiedAt?: string;
}

export interface NoteSearchMatch {
  line: number;
  text: string;
}

export interface NoteSearchResult {
  path: string;
  matches: NoteSearchMatch[];
}

export interface NoteSearchResponse {
  results: NoteSearchResult[];
  truncated: boolean;
}

export interface NoteTreeResponse {
  tree: NoteTreeNode[];
  notesRoot: string;
  systemFolders?: string[];
  /** Identifies which root is being served (e.g. 'default' or a relative path). */
  rootId?: string;
}

export interface NotesRootEntry {
  /** 'default' for the managed root, or the relative path for repo-folder roots. */
  rootId: string;
  /** Display label for the root. */
  label: string;
  /** Whether this is the default managed root (always present, cannot be removed). */
  isDefault: boolean;
}

export interface NotesRootsResponse {
  roots: NotesRootEntry[];
  maxAdditionalRoots: number;
}

export interface NoteContentResponse {
  content: string;
  path: string;
  mtime: number;
}

export interface SaveNoteContentResponse {
  path: string;
  updated: boolean;
  mtime: number;
}

export interface CreateNoteNodeResponse {
  path: string;
  type: string;
}

export interface RenameNoteNodeResponse {
  oldPath: string;
  newPath: string;
  /** Number of per-note chat binding rows moved by the cascade. */
  bindingsMoved?: number;
}

export interface NoteChatBinding {
  taskId: string;
  createdAt: string;
}

export interface NoteChatBindingsResponse {
  bindings: Record<string, NoteChatBinding>;
}

export interface NoteChatBindingResponse {
  notePath: string;
  taskId: string;
  createdAt: string;
}

export interface ReorderNotesResponse {
  parentPath: string;
  order: string[];
}

export interface UploadNoteImageResponse {
  path: string;
}

export interface TextAnchor {
  quotedText: string;
  prefix: string;
  suffix: string;
}

export interface Comment {
  id: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
}

export type CommentThreadStatus = 'open' | 'resolved';

export interface CommentThread {
  id: string;
  anchor: TextAnchor;
  status: CommentThreadStatus;
  comments: Comment[];
  createdAt: string;
  resolvedAt?: string;
}

export interface NoteSidecar {
  version?: 1;
  noteId?: string;
  threads: Record<string, CommentThread>;
}

export interface BatchResolveNoteCommentsResponse {
  taskId: string;
}

export interface NotesGitStatus {
  initialized: boolean;
  branch: string;
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  totalChanges: number;
}

export interface NotesGitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  filesChanged: number;
}

export interface NotesGitLogResponse {
  entries: NotesGitLogEntry[];
  limit: number;
  offset: number;
}

export interface NotesGitDiffFile {
  path: string;
  status: string;
  diff: string;
}

export interface NotesGitDiff {
  files: NotesGitDiffFile[];
}

export interface NotesGitCommitResponse {
  hash?: string;
  message?: string;
  committed?: boolean;
  clean?: boolean;
  [key: string]: unknown;
}

export interface NotesGitAutoCommitStatus {
  enabled: boolean;
  intervalMs?: number;
  lastCommittedAt?: string | null;
  lastError?: string | null;
  warning?: string;
}

export interface NoteFileVersion {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  isNamedCheckpoint: boolean;
}

export interface NoteFileLogResponse {
  entries: NoteFileVersion[];
  path: string;
  limit: number;
}

export interface NoteFileContentAtRevisionResponse {
  content: string;
  hash: string;
  path: string;
}

export interface SaveNoteCheckpointResponse {
  hash: string;
  message: string;
}

export interface RestoreNoteVersionResponse {
  mtime: number;
}

export interface NoteFilePreviewResponse {
  content: string;
  exists: boolean;
  type: 'note' | 'file';
}

export interface CreateNoteWithAIResponse {
  taskId: string;
}

export interface InheritedLensChatMode {
  inherited: true;
  source: 'features.commitChatLens';
}

export type NoteChatMode = 'ask' | 'autopilot';

export interface NoteChatAttachmentPayload {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface CreateNoteChatRequest {
  prompt: string;
  notePath?: string | null;
  noteTitle?: string;
  mode?: NoteChatMode;
  model?: string | null;
  skills?: string[];
  attachments?: NoteChatAttachmentPayload[];
  lensChat?: InheritedLensChatMode;
}

export type CreateNoteChatResponse = EnqueueTaskResponse;

export interface SendNoteCommentResolutionMessageRequest {
  content: string;
  mode?: 'ask' | 'autopilot';
  noteContent: string;
  documentUri: string;
  commentIds: string[];
  documentContent: string;
  workspaceId: string;
}

export interface NoteEditSnapshot {
  editId: string;
  notePath: string;
  preEditContent: string;
  postEditContent?: string;
  timestamp: string;
  turnIndex: number;
  tooLarge?: boolean;
}
