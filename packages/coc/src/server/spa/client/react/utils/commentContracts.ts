import type { CreateTaskCommentRequest, UpdateTaskCommentRequest } from '@plusplusoneplusplus/coc-client';
import type { CommentAnchor, CommentSelection, TaskComment } from '../../comments/task-comments-types';
import type { DiffComment, DiffCommentContext, DiffCommentSelection } from '../../comments/diff-comment-types';
import type { CommentCategory } from '../../comments/comment-constants';
import type { CreateCommentRequest, UpdateCommentRequest } from '../tasks/hooks/useTaskComments';
import { isRecord } from './typeGuards';

function isCategory(value: unknown): value is CommentCategory {
    return value === 'bug' || value === 'question' || value === 'suggestion'
        || value === 'praise' || value === 'nitpick' || value === 'general';
}

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isAnchor(value: unknown): value is CommentAnchor {
    return isRecord(value) && typeof value.selectedText === 'string'
        && typeof value.contextBefore === 'string' && typeof value.contextAfter === 'string'
        && isNumber(value.originalLine) && typeof value.textHash === 'string';
}

function isSelection(value: unknown): value is CommentSelection {
    return isRecord(value) && isNumber(value.startLine) && isNumber(value.endLine)
        && isNumber(value.startColumn) && isNumber(value.endColumn);
}

function isDiffSelection(value: unknown): value is DiffCommentSelection {
    return isRecord(value) && isNumber(value.diffLineStart) && isNumber(value.diffLineEnd)
        && (value.side === 'added' || value.side === 'removed' || value.side === 'context')
        && isNumber(value.startColumn) && isNumber(value.endColumn)
        && (value.oldLineStart === undefined || isNumber(value.oldLineStart))
        && (value.oldLineEnd === undefined || isNumber(value.oldLineEnd))
        && (value.newLineStart === undefined || isNumber(value.newLineStart))
        && (value.newLineEnd === undefined || isNumber(value.newLineEnd));
}

function isDiffContext(value: unknown): value is DiffCommentContext {
    return isRecord(value) && typeof value.repositoryId === 'string'
        && typeof value.filePath === 'string' && typeof value.oldRef === 'string'
        && typeof value.newRef === 'string'
        && (value.commitHash === undefined || typeof value.commitHash === 'string');
}

type CommentFields = Pick<TaskComment,
    'id' | 'selectedText' | 'comment' | 'createdAt' | 'updatedAt' | 'author' | 'category' | 'anchor' | 'replies' | 'aiResponse'>;

function hasCommentFields(value: unknown): value is CommentFields & Record<string, unknown> {
    return isRecord(value) && typeof value.id === 'string' && typeof value.selectedText === 'string'
        && typeof value.comment === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
        && (value.author === undefined || typeof value.author === 'string')
        && (value.category === undefined || isCategory(value.category))
        && (value.anchor === undefined || isAnchor(value.anchor))
        && (value.aiResponse === undefined || typeof value.aiResponse === 'string')
        && (value.replies === undefined || (Array.isArray(value.replies) && value.replies.every((reply: unknown) =>
            isRecord(reply) && typeof reply.id === 'string' && typeof reply.author === 'string'
            && typeof reply.text === 'string' && typeof reply.createdAt === 'string'
            && (reply.isAI === undefined || typeof reply.isAI === 'boolean'))));
}

function isTaskComment(value: unknown): value is TaskComment {
    return hasCommentFields(value) && isRecord(value) && typeof value.taskId === 'string'
        && isSelection(value.selection) && (value.status === 'open' || value.status === 'resolved');
}

function isDiffComment(value: unknown): value is DiffComment {
    return hasCommentFields(value) && isRecord(value) && isDiffContext(value.context)
        && (value.status === 'open' || value.status === 'resolved' || value.status === 'orphaned')
        && (value.scope === 'file'
            ? value.selection === undefined && value.selectedText === ''
            : value.scope === undefined && isDiffSelection(value.selection));
}

export function readTaskComment(value: unknown): TaskComment {
    if (!isTaskComment(value)) throw new Error('Invalid task comment response');
    return value;
}

export function readDiffComment(value: unknown): DiffComment {
    if (!isDiffComment(value)) throw new Error('Invalid diff comment response');
    return value;
}

export function toTaskCommentCreateRequest(request: CreateCommentRequest): CreateTaskCommentRequest {
    const { category, anchor, ...fields } = request;
    if (category !== undefined && !isCategory(category)) {
        throw new Error('Invalid task comment category');
    }
    if (anchor !== undefined && !isAnchor(anchor)) throw new Error('Invalid task comment anchor');
    return {
        ...fields,
        ...(category === undefined ? {} : { category }),
        ...(anchor === undefined ? {} : { anchor: { ...anchor } }),
    };
}

export function toTaskCommentUpdateRequest(request: UpdateCommentRequest): UpdateTaskCommentRequest {
    const { anchor, ...fields } = request;
    if (anchor !== undefined && !isAnchor(anchor)) throw new Error('Invalid task comment anchor');
    return { ...fields, ...(anchor === undefined ? {} : { anchor: { ...anchor } }) };
}
