import type {
  AddTaskCommentReplyRequest,
  AddTaskCommentReplyResponse,
  ArchiveTaskRequest,
  ArchiveTaskResponse,
  AskTaskCommentAIRequest,
  AskTaskCommentAIResponse,
  BatchResolveTaskCommentsRequest,
  BatchResolveTaskCommentsResponse,
  CreateTaskCommentRequest,
  CreateTaskRequest,
  CreateTaskResponse,
  DeleteTaskRequest,
  FilePreviewResponse,
  ListTaskCommentsResponse,
  MoveTaskRequest,
  MoveTaskResponse,
  OpenTaskFileRequest,
  TaskComment,
  TaskCommentCountsResponse,
  TaskCommentResponse,
  TaskContentResponse,
  TaskFolder,
  TaskSettings,
  TaskSettingsUpdate,
  TaskTreeOptions,
  UndoArchiveResponse,
  UndoArchiveStatusResponse,
  UpdateTaskCommentRequest,
  UpdateTaskRequest,
  UpdateTaskResponse,
  WriteTaskContentRequest,
  WriteTaskContentResponse,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function workspacePath(workspaceId: string, suffix: string): string {
  return `/workspaces/${encodePathSegment(workspaceId)}${suffix}`;
}

function tasksPath(workspaceId: string, suffix = ''): string {
  return workspacePath(workspaceId, `/tasks${suffix}`);
}

function commentsPath(workspaceId: string, taskPath: string, suffix = ''): string {
  return `/comments/${encodePathSegment(workspaceId)}/${encodePathSegment(taskPath)}${suffix}`;
}

function serializeTaskTreeOptions(options?: TaskTreeOptions): CocRequestOptions['query'] {
  return { showArchived: options?.showArchived };
}

function unwrapCommentCounts(response: TaskCommentCountsResponse | Record<string, number>): Record<string, number> {
  const counts = (response as Partial<TaskCommentCountsResponse>).counts;
  return counts && typeof counts === 'object' ? counts : response as Record<string, number>;
}

export class TasksClient {
  constructor(private readonly transport: RequestAdapter) {}

  async getTree(workspaceId: string, options?: TaskTreeOptions): Promise<TaskFolder | null> {
    const summary = await this.transport.request<{ tasks?: TaskFolder | null } | null>(workspacePath(workspaceId, '/summary'), {
      query: serializeTaskTreeOptions(options),
    });
    return summary?.tasks ?? null;
  }

  getCommentCounts(workspaceId: string): Promise<Record<string, number>> {
    return this.transport
      .request<TaskCommentCountsResponse | Record<string, number>>(tasksPath(workspaceId, '/comment-counts'))
      .then(response => unwrapCommentCounts(response));
  }

  getSettings(workspaceId: string): Promise<TaskSettings> {
    return this.transport.request<TaskSettings>(tasksPath(workspaceId, '/settings'));
  }

  updateSettings(workspaceId: string, settings: TaskSettingsUpdate): Promise<TaskSettings> {
    return this.transport.request<TaskSettings>(tasksPath(workspaceId, '/settings'), {
      method: 'PATCH',
      body: { folderPaths: [...settings.folderPaths] },
    });
  }

  create(workspaceId: string, request: CreateTaskRequest): Promise<CreateTaskResponse> {
    return this.transport.request<CreateTaskResponse>(tasksPath(workspaceId), {
      method: 'POST',
      body: { ...request },
    });
  }

  update(workspaceId: string, request: UpdateTaskRequest): Promise<UpdateTaskResponse> {
    return this.transport.request<UpdateTaskResponse>(tasksPath(workspaceId), {
      method: 'PATCH',
      body: { ...request },
    });
  }

  rename(workspaceId: string, path: string, newName: string): Promise<UpdateTaskResponse> {
    return this.update(workspaceId, { path, newName });
  }

  updateStatus(workspaceId: string, path: string, status: string): Promise<UpdateTaskResponse> {
    return this.update(workspaceId, { path, status });
  }

  delete(workspaceId: string, request: DeleteTaskRequest): Promise<void> {
    return this.transport.request<void>(tasksPath(workspaceId), {
      method: 'DELETE',
      body: { ...request },
    });
  }

  move(workspaceId: string, request: MoveTaskRequest): Promise<MoveTaskResponse> {
    return this.transport.request<MoveTaskResponse>(tasksPath(workspaceId, '/move'), {
      method: 'POST',
      body: { ...request },
    });
  }

  archive(workspaceId: string, request: ArchiveTaskRequest): Promise<ArchiveTaskResponse> {
    return this.transport.request<ArchiveTaskResponse>(tasksPath(workspaceId, '/archive'), {
      method: 'POST',
      body: { ...request },
    });
  }

  getUndoArchiveStatus(workspaceId: string): Promise<UndoArchiveStatusResponse> {
    return this.transport.request<UndoArchiveStatusResponse>(tasksPath(workspaceId, '/undo-archive'));
  }

  undoArchive(workspaceId: string): Promise<UndoArchiveResponse> {
    return this.transport.request<UndoArchiveResponse>(tasksPath(workspaceId, '/undo-archive'), { method: 'POST' });
  }

  getContent(workspaceId: string, path: string, options?: { folder?: string }): Promise<TaskContentResponse> {
    return this.transport.request<TaskContentResponse>(tasksPath(workspaceId, '/content'), {
      query: { path, folder: options?.folder },
    });
  }

  writeContent(workspaceId: string, request: WriteTaskContentRequest): Promise<WriteTaskContentResponse> {
    return this.transport.request<WriteTaskContentResponse>(tasksPath(workspaceId, '/content'), {
      method: 'PATCH',
      body: { ...request },
    });
  }

  previewWorkspaceFile(workspaceId: string, path: string, options?: { lines?: number }): Promise<FilePreviewResponse> {
    return this.transport.request<FilePreviewResponse>(workspacePath(workspaceId, '/files/preview'), {
      query: { path, lines: options?.lines },
    });
  }

  openFile(workspaceId: string, request: OpenTaskFileRequest): Promise<void> {
    return this.transport.request<void>(workspacePath(workspaceId, '/open-file'), {
      method: 'POST',
      body: { ...request },
    });
  }

  async listComments(workspaceId: string, taskPath: string): Promise<TaskComment[]> {
    const response = await this.transport.request<ListTaskCommentsResponse>(commentsPath(workspaceId, taskPath));
    return response.comments ?? [];
  }

  async getComment(workspaceId: string, taskPath: string, commentId: string): Promise<TaskComment> {
    const response = await this.transport.request<TaskCommentResponse>(
      commentsPath(workspaceId, taskPath, `/${encodePathSegment(commentId)}`),
    );
    return response.comment;
  }

  async createComment(workspaceId: string, taskPath: string, request: CreateTaskCommentRequest): Promise<TaskComment> {
    const response = await this.transport.request<TaskCommentResponse>(commentsPath(workspaceId, taskPath), {
      method: 'POST',
      body: { ...request },
    });
    return response.comment;
  }

  async updateComment(workspaceId: string, taskPath: string, commentId: string, request: UpdateTaskCommentRequest): Promise<TaskComment> {
    const response = await this.transport.request<TaskCommentResponse>(
      commentsPath(workspaceId, taskPath, `/${encodePathSegment(commentId)}`),
      { method: 'PATCH', body: { ...request } },
    );
    return response.comment;
  }

  deleteComment(workspaceId: string, taskPath: string, commentId: string): Promise<void> {
    return this.transport.request<void>(
      commentsPath(workspaceId, taskPath, `/${encodePathSegment(commentId)}`),
      { method: 'DELETE' },
    );
  }

  addCommentReply(workspaceId: string, taskPath: string, commentId: string, request: AddTaskCommentReplyRequest): Promise<AddTaskCommentReplyResponse> {
    return this.transport.request<AddTaskCommentReplyResponse>(
      commentsPath(workspaceId, taskPath, `/${encodePathSegment(commentId)}/replies`),
      { method: 'POST', body: { ...request } },
    );
  }

  askCommentAI(workspaceId: string, taskPath: string, commentId: string, request: AskTaskCommentAIRequest = {}): Promise<AskTaskCommentAIResponse> {
    return this.transport.request<AskTaskCommentAIResponse>(
      commentsPath(workspaceId, taskPath, `/${encodePathSegment(commentId)}/ask-ai`),
      { method: 'POST', body: { ...request } },
    );
  }

  batchResolveComments(workspaceId: string, taskPath: string, request: BatchResolveTaskCommentsRequest): Promise<BatchResolveTaskCommentsResponse> {
    return this.transport.request<BatchResolveTaskCommentsResponse>(
      commentsPath(workspaceId, taskPath, '/batch-resolve'),
      { method: 'POST', body: { ...request } },
    );
  }
}
