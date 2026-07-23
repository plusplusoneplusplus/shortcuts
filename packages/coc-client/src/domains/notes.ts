import type {
  BatchResolveNoteCommentsResponse,
  Comment,
  CommentThread,
  CommentThreadStatus,
  CreateNoteChatRequest,
  CreateNoteChatResponse,
  CreateNoteNodeResponse,
  CreateNoteWithAIResponse,
  NoteChatBindingResponse,
  NoteChatBindingsResponse,
  NoteContentResponse,
  NoteEditSnapshot,
  NoteFileContentAtRevisionResponse,
  NoteFileLogResponse,
  NoteFilePreviewResponse,
  NoteSearchResponse,
  NoteSidecar,
  NotesGitAutoCommitStatus,
  NotesGitCommitResponse,
  NotesGitDiff,
  NotesGitLogResponse,
  NotesGitStatus,
  NotesRootEntry,
  NotesRootsResponse,
  NoteTreeResponse,
  NoteNodeType,
  RenameNoteNodeResponse,
  ReorderNotesResponse,
  RestoreNoteVersionResponse,
  SaveNoteCheckpointResponse,
  SaveNoteContentResponse,
  SendNoteCommentResolutionMessageRequest,
  UploadNoteImageResponse,
} from '../contracts';
import type { CocRequestOptions, QueryPrimitive, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

const DEFAULT_AUTO_COMMIT_INTERVAL_MS = 1_800_000;

function workspaceNotesPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/notes${suffix}`;
}

function notesGitPath(workspaceId: string, suffix = ''): string {
  return workspaceNotesPath(workspaceId, `/git${suffix}`);
}

function processNoteEditsPath(processId: string, suffix = ''): string {
  return `/processes/${encodePathSegment(processId)}/note-edits${suffix}`;
}

function compactQuery(query: Record<string, QueryPrimitive | undefined>): CocRequestOptions['query'] {
  return query;
}

export interface NotesGitLogQuery {
  limit?: number;
  offset?: number;
}

export class NotesClient {
  constructor(private readonly transport: RequestAdapter) {}

  getTree(workspaceId: string, root?: string): Promise<NoteTreeResponse> {
    return this.transport.request<NoteTreeResponse>(workspaceNotesPath(workspaceId, '/tree'), {
      query: compactQuery({ root }),
    });
  }

  listRoots(workspaceId: string): Promise<NotesRootsResponse> {
    return this.transport.request<NotesRootsResponse>(workspaceNotesPath(workspaceId, '/roots'));
  }

  addRoot(workspaceId: string, rootPath: string): Promise<NotesRootEntry> {
    return this.transport.request<NotesRootEntry>(workspaceNotesPath(workspaceId, '/roots'), {
      method: 'POST',
      body: { rootPath },
    });
  }

  removeRoot(workspaceId: string, rootPath: string): Promise<{ removed: string }> {
    return this.transport.request<{ removed: string }>(workspaceNotesPath(workspaceId, '/roots'), {
      method: 'DELETE',
      body: { rootPath },
    });
  }

  getContent(workspaceId: string, notePath: string, root?: string): Promise<NoteContentResponse> {
    return this.transport.request<NoteContentResponse>(workspaceNotesPath(workspaceId, '/content'), {
      query: compactQuery({ path: notePath, root }),
    });
  }

  saveContent(workspaceId: string, notePath: string, content: string, expectedMtime?: number, root?: string): Promise<SaveNoteContentResponse> {
    return this.transport.request<SaveNoteContentResponse>(workspaceNotesPath(workspaceId, '/content'), {
      method: 'PUT',
      body: {
        path: notePath,
        content,
        ...(expectedMtime !== undefined ? { expectedMtime } : {}),
        ...(root ? { root } : {}),
      },
    });
  }

  createNode(workspaceId: string, nodePath: string, type: NoteNodeType, root?: string): Promise<CreateNoteNodeResponse> {
    return this.transport.request<CreateNoteNodeResponse>(workspaceNotesPath(workspaceId, '/page'), {
      method: 'POST',
      body: { path: nodePath, type, ...(root ? { root } : {}) },
    });
  }

  renameNode(workspaceId: string, oldPath: string, newPath: string, root?: string): Promise<RenameNoteNodeResponse> {
    return this.transport.request<RenameNoteNodeResponse>(workspaceNotesPath(workspaceId, '/path'), {
      method: 'PATCH',
      body: { oldPath, newPath, ...(root ? { root } : {}) },
    });
  }

  deleteNode(workspaceId: string, nodePath: string, root?: string): Promise<void> {
    return this.transport.request<void>(workspaceNotesPath(workspaceId, '/path'), {
      method: 'DELETE',
      query: compactQuery({ path: nodePath, root }),
    });
  }

  reorder(workspaceId: string, parentPath: string, order: string[], root?: string): Promise<ReorderNotesResponse> {
    return this.transport.request<ReorderNotesResponse>(workspaceNotesPath(workspaceId, '/order'), {
      method: 'PUT',
      body: { parentPath, order: [...order], ...(root ? { root } : {}) },
    });
  }

  search(workspaceId: string, query: string, root?: string): Promise<NoteSearchResponse> {
    return this.transport.request<NoteSearchResponse>(workspaceNotesPath(workspaceId, '/search'), {
      query: compactQuery({ q: query, root }),
    });
  }

  uploadImage(workspaceId: string, fileName: string, data: string, root?: string): Promise<UploadNoteImageResponse> {
    return this.transport.request<UploadNoteImageResponse>(workspaceNotesPath(workspaceId, '/image'), {
      method: 'POST',
      body: { fileName, data, ...(root ? { root } : {}) },
    });
  }

  previewFile(workspaceId: string, filePath: string): Promise<NoteFilePreviewResponse> {
    return this.transport.request<NoteFilePreviewResponse>(workspaceNotesPath(workspaceId, '/file-preview'), {
      query: { path: filePath },
    });
  }

  getComments(workspaceId: string, notePath: string, root?: string): Promise<NoteSidecar> {
    return this.transport.request<NoteSidecar>(workspaceNotesPath(workspaceId, '/comments'), {
      query: compactQuery({ path: notePath, root }),
    });
  }

  saveComments(workspaceId: string, notePath: string, threads: Record<string, CommentThread>, root?: string): Promise<void> {
    return this.transport.request<void>(workspaceNotesPath(workspaceId, '/comments'), {
      method: 'PUT',
      body: { path: notePath, threads: { ...threads }, ...(root ? { root } : {}) },
    });
  }

  createThread(workspaceId: string, notePath: string, thread: CommentThread, root?: string): Promise<{ thread: CommentThread }> {
    return this.transport.request<{ thread: CommentThread }>(workspaceNotesPath(workspaceId, '/comments/thread'), {
      method: 'POST',
      body: { path: notePath, thread, ...(root ? { root } : {}) },
    });
  }

  updateThread(workspaceId: string, notePath: string, threadId: string, status: CommentThreadStatus, root?: string): Promise<{ thread: CommentThread }> {
    return this.transport.request<{ thread: CommentThread }>(
      workspaceNotesPath(workspaceId, `/comments/thread/${encodePathSegment(threadId)}`),
      {
        method: 'PATCH',
        body: { path: notePath, status, ...(root ? { root } : {}) },
      },
    );
  }

  deleteThread(workspaceId: string, notePath: string, threadId: string, root?: string): Promise<void> {
    return this.transport.request<void>(
      workspaceNotesPath(workspaceId, `/comments/thread/${encodePathSegment(threadId)}`),
      {
        method: 'DELETE',
        query: compactQuery({ path: notePath, root }),
      },
    );
  }

  addComment(workspaceId: string, notePath: string, threadId: string, content: string, root?: string): Promise<{ comment: Comment }> {
    return this.transport.request<{ comment: Comment }>(
      workspaceNotesPath(workspaceId, `/comments/thread/${encodePathSegment(threadId)}/comment`),
      {
        method: 'POST',
        body: { path: notePath, content, ...(root ? { root } : {}) },
      },
    );
  }

  editComment(workspaceId: string, notePath: string, threadId: string, commentId: string, content: string, root?: string): Promise<{ comment: Comment }> {
    return this.transport.request<{ comment: Comment }>(
      workspaceNotesPath(workspaceId, `/comments/thread/${encodePathSegment(threadId)}/comment/${encodePathSegment(commentId)}`),
      {
        method: 'PATCH',
        body: { path: notePath, content, ...(root ? { root } : {}) },
      },
    );
  }

  deleteComment(workspaceId: string, notePath: string, threadId: string, commentId: string, root?: string): Promise<void> {
    return this.transport.request<void>(
      workspaceNotesPath(workspaceId, `/comments/thread/${encodePathSegment(threadId)}/comment/${encodePathSegment(commentId)}`),
      {
        method: 'DELETE',
        query: compactQuery({ path: notePath, root }),
      },
    );
  }

  batchResolve(workspaceId: string, notePath: string, documentContent: string, userContext?: string, root?: string): Promise<BatchResolveNoteCommentsResponse> {
    return this.transport.request<BatchResolveNoteCommentsResponse>(workspaceNotesPath(workspaceId, '/batch-resolve'), {
      method: 'POST',
      query: compactQuery({ path: notePath, root }),
      body: { documentContent, ...(userContext ? { userContext } : {}) },
    });
  }

  createChat(workspaceId: string, request: CreateNoteChatRequest): Promise<CreateNoteChatResponse> {
    const noteChat = request.notePath ? { notePath: request.notePath, noteTitle: request.noteTitle } : undefined;
    // Lay the generic composer context down first, then overlay the Notes-owned
    // reserved keys so an overlapping caller context can never override or drop the
    // note binding, Lens metadata, or extracted skills (AC-07 reserved-key merge).
    const context: Record<string, unknown> = {
      ...(request.context ?? {}),
      ...(request.autoProviderRouting ? { autoProviderRouting: { requested: true } } : {}),
      ...(noteChat ? { noteChat } : {}),
      ...(request.lensChat ? { lensChat: request.lensChat } : {}),
      ...(request.skills && request.skills.length > 0 ? { skills: [...request.skills] } : {}),
    };
    return this.transport.request<CreateNoteChatResponse>('/queue', {
      method: 'POST',
      body: {
        type: 'chat',
        priority: 'normal',
        payload: {
          kind: 'chat',
          mode: request.mode ?? 'ask',
          prompt: request.prompt,
          workspaceId,
          ...(request.workingDirectory ? { workingDirectory: request.workingDirectory } : {}),
          ...(request.model ? { model: request.model } : {}),
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
          ...(request.provider ? { provider: request.provider } : {}),
          ...(request.attachments && request.attachments.length > 0 ? { attachments: [...request.attachments] } : {}),
          context,
        },
        // Effort tier rides the top-level task config (like the shared composer),
        // so enqueue resolves it into the seeded model + reasoning effort.
        ...(request.effortTier ? { config: { effortTier: request.effortTier } } : {}),
      },
    });
  }

  sendCommentResolutionMessage(processId: string, request: SendNoteCommentResolutionMessageRequest): Promise<unknown> {
    return this.transport.request(`/processes/${encodePathSegment(processId)}/message`, {
      method: 'POST',
      body: {
        content: request.content,
        ...(request.mode ? { mode: request.mode } : {}),
        context: {
          noteContent: request.noteContent,
          resolveComments: {
            documentUri: request.documentUri,
            commentIds: [...request.commentIds],
            documentContent: request.documentContent,
            wsId: request.workspaceId,
          },
        },
      },
    });
  }

  createWithAI(
    workspaceId: string,
    prompt: string,
    chatTaskId?: string,
    lensChat?: { inherited: true; source: 'features.commitChatLens' },
  ): Promise<CreateNoteWithAIResponse> {
    return this.transport.request<CreateNoteWithAIResponse>(workspaceNotesPath(workspaceId, '/ai-create'), {
      method: 'POST',
      body: {
        prompt,
        ...(chatTaskId ? { chatTaskId } : {}),
        ...(lensChat ? { lensChat } : {}),
      },
    });
  }

  listNoteEdits(processId: string): Promise<NoteEditSnapshot[]> {
    return this.transport.request<NoteEditSnapshot[]>(processNoteEditsPath(processId));
  }

  undoNoteEdit(processId: string, editId: string, options?: { force?: boolean }): Promise<{ success: boolean }> {
    return this.transport.request<{ success: boolean }>(
      processNoteEditsPath(processId, `/${encodePathSegment(editId)}/undo`),
      {
        method: 'POST',
        query: compactQuery({ force: options?.force }),
      },
    );
  }

  initializeGit(workspaceId: string): Promise<{ initialized: boolean }> {
    return this.transport.request<{ initialized: boolean }>(notesGitPath(workspaceId, '/init'), { method: 'POST' });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Per-note chat bindings
  // ──────────────────────────────────────────────────────────────────────

  listChatBindings(workspaceId: string): Promise<NoteChatBindingsResponse> {
    return this.transport.request<NoteChatBindingsResponse>(
      workspaceNotesPath(workspaceId, '/chat-bindings'),
    );
  }

  getChatBindingByPath(workspaceId: string, notePath: string): Promise<NoteChatBindingResponse> {
    return this.transport.request<NoteChatBindingResponse>(
      workspaceNotesPath(workspaceId, '/chat-bindings/by-path'),
      { query: { path: notePath } },
    );
  }

  deleteChatBindingByPath(workspaceId: string, notePath: string): Promise<void> {
    return this.transport.request<void>(
      workspaceNotesPath(workspaceId, '/chat-bindings/by-path'),
      { method: 'DELETE', query: { path: notePath } },
    );
  }

  deinitializeGit(workspaceId: string): Promise<{ deinitialized: boolean }> {
    return this.transport.request<{ deinitialized: boolean }>(notesGitPath(workspaceId), { method: 'DELETE' });
  }

  getGitStatus(workspaceId: string): Promise<NotesGitStatus> {
    return this.transport.request<NotesGitStatus>(notesGitPath(workspaceId, '/status'));
  }

  getGitLog(workspaceId: string, query?: NotesGitLogQuery): Promise<NotesGitLogResponse> {
    return this.transport.request<NotesGitLogResponse>(notesGitPath(workspaceId, '/log'), {
      query: compactQuery({ limit: query?.limit, offset: query?.offset }),
    });
  }

  getGitDiff(workspaceId: string, hash?: string): Promise<NotesGitDiff> {
    const suffix = hash ? `/diff/${encodePathSegment(hash)}` : '/diff';
    return this.transport.request<NotesGitDiff>(notesGitPath(workspaceId, suffix));
  }

  commitGit(workspaceId: string, message?: string): Promise<NotesGitCommitResponse> {
    return this.transport.request<NotesGitCommitResponse>(notesGitPath(workspaceId, '/commit'), {
      method: 'POST',
      body: message ? { message } : undefined,
    });
  }

  getAutoCommitStatus(workspaceId: string): Promise<NotesGitAutoCommitStatus> {
    return this.transport.request<NotesGitAutoCommitStatus>(notesGitPath(workspaceId, '/auto-commit/status'));
  }

  enableAutoCommit(workspaceId: string, intervalMs = DEFAULT_AUTO_COMMIT_INTERVAL_MS): Promise<{ enabled: boolean; intervalMs: number }> {
    return this.transport.request<{ enabled: boolean; intervalMs: number }>(notesGitPath(workspaceId, '/auto-commit'), {
      method: 'POST',
      body: { intervalMs },
    });
  }

  disableAutoCommit(workspaceId: string): Promise<{ deleted: boolean }> {
    return this.transport.request<{ deleted: boolean }>(notesGitPath(workspaceId, '/auto-commit'), {
      method: 'DELETE',
    });
  }

  updateAutoCommitInterval(workspaceId: string, intervalMs: number): Promise<{ enabled: boolean; intervalMs: number }> {
    return this.enableAutoCommit(workspaceId, intervalMs);
  }

  getFileLog(workspaceId: string, notePath: string, limit = 50): Promise<NoteFileLogResponse> {
    return this.transport.request<NoteFileLogResponse>(notesGitPath(workspaceId, '/file-log'), {
      query: { path: notePath, limit },
    });
  }

  getFileContentAtRevision(workspaceId: string, hash: string, notePath: string): Promise<NoteFileContentAtRevisionResponse> {
    return this.transport.request<NoteFileContentAtRevisionResponse>(notesGitPath(workspaceId, '/file-content'), {
      query: { hash, path: notePath },
    });
  }

  saveCheckpoint(workspaceId: string, notePath: string, name: string): Promise<SaveNoteCheckpointResponse> {
    return this.transport.request<SaveNoteCheckpointResponse>(notesGitPath(workspaceId, '/save-checkpoint'), {
      method: 'POST',
      body: { path: notePath, name },
    });
  }

  restoreVersion(workspaceId: string, notePath: string, hash: string): Promise<RestoreNoteVersionResponse> {
    return this.transport.request<RestoreNoteVersionResponse>(notesGitPath(workspaceId, '/restore-version'), {
      method: 'POST',
      body: { path: notePath, hash },
    });
  }
}
