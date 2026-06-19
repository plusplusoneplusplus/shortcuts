export interface TaskFolder {
  name: string;
  relativePath: string;
  folderPath?: string;
  children: TaskFolder[];
  documentGroups: TaskDocumentGroup[];
  singleDocuments: TaskDocument[];
  contextDocuments?: TaskDocument[];
  taskRootPath?: string;
  [key: string]: unknown;
}

export interface TaskDocumentGroup {
  baseName: string;
  documents: TaskDocument[];
  isArchived: boolean;
  [key: string]: unknown;
}

export interface TaskDocument {
  baseName: string;
  docType?: string;
  fileName: string;
  relativePath?: string;
  status?: string;
  isArchived: boolean;
  taskRootPath?: string;
  [key: string]: unknown;
}

export interface TaskTreeOptions {
  showArchived?: boolean;
}

export interface TaskCommentCountsResponse {
  counts: Record<string, number>;
}

export interface CreateTaskRequest {
  name: string;
  type?: 'folder' | 'file';
  folder?: string;
  parent?: string;
  docType?: string;
}

export interface CreateTaskResponse {
  path: string;
  name: string;
  type: 'folder' | 'file';
}

export interface RenameTaskRequest {
  path: string;
  newName: string;
}

export interface UpdateTaskStatusRequest {
  path: string;
  status: string;
}

export type UpdateTaskRequest = RenameTaskRequest | UpdateTaskStatusRequest;

export interface UpdateTaskResponse {
  path: string;
  name?: string;
  status?: string;
}

export interface DeleteTaskRequest {
  path: string;
  folderPath?: string;
}

export interface MoveTaskRequest {
  sourcePath: string;
  destinationFolder: string;
  destinationWorkspaceId?: string;
}

export interface MoveTaskResponse {
  path: string;
  name: string;
}

export interface ArchiveTaskRequest {
  path: string;
  action: 'archive' | 'unarchive';
  folderPath?: string;
}

export interface ArchiveTaskResponse {
  path: string;
}

export interface UndoArchiveStatusResponse {
  available: boolean;
  record?: {
    type?: 'file' | 'folder';
    originalPath?: string;
    timestamp?: string;
  };
}

export interface UndoArchiveResponse {
  success: boolean;
  restoredPath: string;
}

export interface TaskContentResponse {
  content: string;
  path: string;
  mtime: number;
}

export interface WriteTaskContentRequest {
  path: string;
  content: string;
  expectedMtime?: number;
  folderPath?: string;
}

export interface WriteTaskContentResponse {
  path: string;
  updated: boolean;
  mtime: number;
}

export interface FilePreviewResponse {
  type?: 'file' | 'directory' | 'image' | 'image-too-large' | string;
  path?: string;
  dirName?: string;
  fileName?: string;
  entries?: Array<{ name: string; isDirectory: boolean }>;
  lines?: string[];
  content?: string;
  totalLines?: number;
  totalEntries?: number;
  truncated?: boolean;
  language?: string;
  mimeType?: string;
  size?: number;
  /** File modification time in milliseconds (only present for file responses). */
  mtime?: number;
  [key: string]: unknown;
}

export interface OpenTaskFileRequest {
  path: string;
}

export interface CommentSelection {
  text?: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  boundingRect?: { top: number; left: number; width: number; height: number };
}

export interface CommentAnchor {
  strategy?: string;
  selectedText?: string;
  prefix?: string;
  suffix?: string;
  startLine?: number;
  endLine?: number;
  [key: string]: unknown;
}

export interface TaskCommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  isAI?: boolean;
  [key: string]: unknown;
}

export type TaskCommentStatus = 'open' | 'resolved';
export type TaskCommentCategory = 'bug' | 'question' | 'suggestion' | 'praise' | 'nitpick' | 'general';

export interface TaskComment {
  id: string;
  taskId: string;
  filePath?: string;
  selection: CommentSelection;
  selectedText: string;
  comment: string;
  status: TaskCommentStatus;
  author?: string;
  anchor?: CommentAnchor;
  category?: TaskCommentCategory;
  aiResponse?: string;
  replies?: TaskCommentReply[];
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ListTaskCommentsResponse {
  comments: TaskComment[];
}

export interface TaskCommentResponse {
  comment: TaskComment;
}

export interface CreateTaskCommentRequest {
  filePath: string;
  selection: CommentSelection;
  selectedText: string;
  comment: string;
  status?: TaskCommentStatus;
  author?: string;
  anchor?: CommentAnchor;
  category?: TaskCommentCategory;
}

export interface UpdateTaskCommentRequest {
  comment?: string;
  status?: TaskCommentStatus;
  author?: string;
  anchor?: CommentAnchor;
  aiResponse?: string;
  [key: string]: unknown;
}

export interface AddTaskCommentReplyRequest {
  text: string;
  author?: string;
  isAI?: boolean;
}

export interface AddTaskCommentReplyResponse {
  reply: TaskCommentReply;
}

export interface DocumentContext {
  surroundingLines?: string;
  nearestHeading?: string;
  allHeadings?: string[];
  filePath?: string;
}

export interface AskTaskCommentAIRequest {
  commandId?: string;
  customQuestion?: string;
  question?: string;
  documentContext?: DocumentContext;
  documentContent?: string;
  userContext?: string;
  skills?: string[];
}

export interface AskTaskCommentAIResponse {
  aiResponse?: string;
  reply?: TaskCommentReply;
  taskId?: string;
}

export interface BatchResolveTaskCommentsRequest {
  documentContent: string;
  userContext?: string;
  skills?: string[];
}

export interface BatchResolveTaskCommentsResponse {
  taskId: string;
}
