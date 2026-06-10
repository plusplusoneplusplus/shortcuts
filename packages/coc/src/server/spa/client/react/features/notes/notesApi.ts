/**
 * notesApi - compatibility wrappers over the typed CoC notes client.
 */

import {
    CocApiError,
    type Comment,
    type CommentThread,
    type CommentThreadStatus,
    type CreateNoteNodeResponse,
    type CreateNoteWithAIResponse,
    type NoteContentResponse,
    type NoteFileContentAtRevisionResponse,
    type NoteFileLogResponse,
    type NoteFilePreviewResponse,
    type NoteNodeType,
    type NoteSearchResponse,
    type NoteSidecar,
    type NoteTreeNode,
    type NoteTreeResponse,
    type NotesGitAutoCommitStatus,
    type NotesRootEntry,
    type NotesRootsResponse,
    type NotesGitCommitResponse,
    type NotesGitDiff,
    type NotesGitLogResponse,
    type NotesGitStatus,
    type RenameNoteNodeResponse,
    type ReorderNotesResponse,
    type RestoreNoteVersionResponse,
    type SaveNoteCheckpointResponse,
    type SaveNoteContentResponse,
    type TextAnchor,
    type UploadNoteImageResponse,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, translateSpaCocClientError } from '../../api/cocClient';
import { isCommitChatLensEnabled } from '../../utils/config';

const INHERITED_LENS_CHAT_MODE = {
    inherited: true,
    source: 'features.commitChatLens',
} as const;

export type {
    Comment,
    CommentThread,
    NoteSearchMatch,
    NoteSearchResponse,
    NoteSearchResult,
    NoteSidecar,
    NotesRootEntry,
    NotesRootsResponse,
    NoteTreeNode,
    NoteTreeResponse,
    TextAnchor,
} from '@plusplusoneplusplus/coc-client';

async function withSpaErrors<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        translateSpaCocClientError(error);
    }
}

async function withConflictError<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        if (error instanceof CocApiError && error.status === 409) {
            const body = error.body && typeof error.body === 'object'
                ? error.body as Record<string, unknown>
                : {};
            throw Object.assign(new Error('conflict'), { status: 409, ...body });
        }
        translateSpaCocClientError(error);
    }
}

const notesClient = () => getSpaCocClient().notes;

export const notesApi = {
    getTree(wsId: string, root?: string): Promise<NoteTreeResponse> {
        return withSpaErrors(notesClient().getTree(wsId, root));
    },

    listRoots(wsId: string): Promise<NotesRootsResponse> {
        return withSpaErrors(notesClient().listRoots(wsId));
    },

    addRoot(wsId: string, rootPath: string): Promise<NotesRootEntry> {
        return withSpaErrors(notesClient().addRoot(wsId, rootPath));
    },

    removeRoot(wsId: string, rootPath: string): Promise<{ removed: string }> {
        return withSpaErrors(notesClient().removeRoot(wsId, rootPath));
    },

    getContent(wsId: string, notePath: string, root?: string): Promise<NoteContentResponse> {
        return withSpaErrors(notesClient().getContent(wsId, notePath, root));
    },

    saveContent(wsId: string, notePath: string, content: string, expectedMtime?: number, root?: string): Promise<SaveNoteContentResponse> {
        return withConflictError(notesClient().saveContent(wsId, notePath, content, expectedMtime, root));
    },

    createNode(wsId: string, nodePath: string, type: NoteNodeType, root?: string): Promise<CreateNoteNodeResponse> {
        return withSpaErrors(notesClient().createNode(wsId, nodePath, type, root));
    },

    renameNode(wsId: string, oldPath: string, newPath: string, root?: string): Promise<RenameNoteNodeResponse> {
        return withSpaErrors(notesClient().renameNode(wsId, oldPath, newPath, root));
    },

    deleteNode(wsId: string, nodePath: string, root?: string): Promise<void> {
        return withSpaErrors(notesClient().deleteNode(wsId, nodePath, root));
    },

    reorder(wsId: string, parentPath: string, order: string[], root?: string): Promise<ReorderNotesResponse> {
        return withSpaErrors(notesClient().reorder(wsId, parentPath, order, root));
    },

    search(wsId: string, query: string, root?: string): Promise<NoteSearchResponse> {
        return withSpaErrors(notesClient().search(wsId, query, root));
    },

    uploadImage(wsId: string, fileName: string, data: string, root?: string): Promise<UploadNoteImageResponse> {
        return withSpaErrors(notesClient().uploadImage(wsId, fileName, data, root));
    },

    getFilePreview(wsId: string, filePath: string): Promise<NoteFilePreviewResponse> {
        return withSpaErrors(notesClient().previewFile(wsId, filePath));
    },

    getComments(wsId: string, notePath: string, root?: string): Promise<NoteSidecar> {
        return withSpaErrors(notesClient().getComments(wsId, notePath, root));
    },

    saveComments(wsId: string, notePath: string, threads: Record<string, CommentThread>, root?: string): Promise<void> {
        return withSpaErrors(notesClient().saveComments(wsId, notePath, threads, root));
    },

    createThread(wsId: string, notePath: string, thread: CommentThread, root?: string): Promise<{ thread: CommentThread }> {
        return withSpaErrors(notesClient().createThread(wsId, notePath, thread, root));
    },

    updateThread(wsId: string, notePath: string, threadId: string, status: CommentThreadStatus, root?: string): Promise<{ thread: CommentThread }> {
        return withSpaErrors(notesClient().updateThread(wsId, notePath, threadId, status, root));
    },

    deleteThread(wsId: string, notePath: string, threadId: string, root?: string): Promise<void> {
        return withSpaErrors(notesClient().deleteThread(wsId, notePath, threadId, root));
    },

    addComment(wsId: string, notePath: string, threadId: string, content: string, root?: string): Promise<{ comment: Comment }> {
        return withSpaErrors(notesClient().addComment(wsId, notePath, threadId, content, root));
    },

    editComment(wsId: string, notePath: string, threadId: string, commentId: string, content: string, root?: string): Promise<{ comment: Comment }> {
        return withSpaErrors(notesClient().editComment(wsId, notePath, threadId, commentId, content, root));
    },

    deleteComment(wsId: string, notePath: string, threadId: string, commentId: string, root?: string): Promise<void> {
        return withSpaErrors(notesClient().deleteComment(wsId, notePath, threadId, commentId, root));
    },

    batchResolve(wsId: string, notePath: string, documentContent: string, userContext?: string, root?: string): Promise<{ taskId: string }> {
        return withSpaErrors(notesClient().batchResolve(wsId, notePath, documentContent, userContext, root));
    },

    createWithAI(wsId: string, prompt: string, chatTaskId?: string): Promise<CreateNoteWithAIResponse> {
        return withSpaErrors(notesClient().createWithAI(
            wsId,
            prompt,
            chatTaskId,
            isCommitChatLensEnabled() ? INHERITED_LENS_CHAT_MODE : undefined,
        ));
    },

    initializeGit(wsId: string): Promise<{ initialized: boolean }> {
        return withSpaErrors(notesClient().initializeGit(wsId));
    },

    deinitGit(wsId: string): Promise<{ deinitialized: boolean }> {
        return withSpaErrors(notesClient().deinitializeGit(wsId));
    },

    getGitStatus(wsId: string): Promise<NotesGitStatus> {
        return withSpaErrors(notesClient().getGitStatus(wsId));
    },

    getGitLog(wsId: string, limit?: number, offset?: number): Promise<NotesGitLogResponse> {
        return withSpaErrors(notesClient().getGitLog(wsId, { limit, offset }));
    },

    getGitDiff(wsId: string, hash?: string): Promise<NotesGitDiff> {
        return withSpaErrors(notesClient().getGitDiff(wsId, hash));
    },

    commitGit(wsId: string, message?: string): Promise<NotesGitCommitResponse> {
        return withSpaErrors(notesClient().commitGit(wsId, message));
    },

    getAutoCommitStatus(wsId: string): Promise<NotesGitAutoCommitStatus> {
        return withSpaErrors(notesClient().getAutoCommitStatus(wsId));
    },

    enableAutoCommit(wsId: string, intervalMs?: number): Promise<{ enabled: boolean; intervalMs: number }> {
        return withSpaErrors(notesClient().enableAutoCommit(wsId, intervalMs));
    },

    disableAutoCommit(wsId: string): Promise<{ deleted: boolean }> {
        return withSpaErrors(notesClient().disableAutoCommit(wsId));
    },

    updateAutoCommitInterval(wsId: string, intervalMs: number): Promise<{ enabled: boolean; intervalMs: number }> {
        return withSpaErrors(notesClient().updateAutoCommitInterval(wsId, intervalMs));
    },

    getFileLog(wsId: string, notePath: string, limit = 50): Promise<NoteFileLogResponse> {
        return withSpaErrors(notesClient().getFileLog(wsId, notePath, limit));
    },

    getFileContentAtRevision(wsId: string, hash: string, notePath: string): Promise<NoteFileContentAtRevisionResponse> {
        return withSpaErrors(notesClient().getFileContentAtRevision(wsId, hash, notePath));
    },

    saveCheckpoint(wsId: string, notePath: string, name: string): Promise<SaveNoteCheckpointResponse> {
        return withSpaErrors(notesClient().saveCheckpoint(wsId, notePath, name));
    },

    restoreVersion(wsId: string, notePath: string, hash: string): Promise<RestoreNoteVersionResponse> {
        return withSpaErrors(notesClient().restoreVersion(wsId, notePath, hash));
    },
};
