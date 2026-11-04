import { describe, expect, it } from 'vitest';
import {
    readDiffComment,
    readTaskComment,
    toTaskCommentCreateRequest,
    toTaskCommentUpdateRequest,
} from '../../../../src/server/spa/client/react/utils/commentContracts';

const anchor = {
    selectedText: 'text', contextBefore: 'before', contextAfter: 'after', originalLine: 3, textHash: 'hash',
};
const reply = { id: 'reply', author: 'reviewer', text: 'reply text', createdAt: '2026-01-01', isAI: false };
const task = {
    id: 'task-comment', taskId: 'task',
    selection: { startLine: 3, endLine: 3, startColumn: 0, endColumn: 4 },
    selectedText: 'text', comment: 'review', status: 'open',
    createdAt: '2026-01-01', updatedAt: '2026-01-02',
    category: 'suggestion', anchor, replies: [reply], aiResponse: 'explanation',
};
const diff = {
    id: 'diff-comment',
    context: { repositoryId: 'repository', oldRef: 'base', newRef: 'head', filePath: 'file.ts', commitHash: 'head' },
    selection: {
        diffLineStart: 2, diffLineEnd: 3, side: 'removed', startColumn: 0, endColumn: 4,
        oldLineStart: 3, oldLineEnd: 4,
    },
    selectedText: 'text', comment: 'review', status: 'orphaned',
    createdAt: '2026-01-01', updatedAt: '2026-01-02',
    category: 'question', anchor, replies: [reply], aiResponse: 'explanation',
};

describe('comment domain boundaries', () => {
    it('retains task anchors, replies, categories, statuses and object identity', () => {
        expect(readTaskComment(task)).toBe(task);
        const resolved = { ...task, status: 'resolved' };
        expect(readTaskComment(resolved)).toBe(resolved);
    });

    it('retains diff side/ref/anchor fields and orphaned status without resolving', () => {
        expect(readDiffComment(diff)).toBe(diff);
        expect(readDiffComment(diff).status).toBe('orphaned');
        expect(readDiffComment(diff).anchor).toBe(anchor);
    });

    it('accepts null or NaN line numbers for the missing side of a Classic selection', () => {
        const added = {
            ...diff,
            selection: {
                diffLineStart: 7, diffLineEnd: 7, side: 'added', startColumn: 0, endColumn: 4,
                oldLineStart: null, oldLineEnd: null, newLineStart: 2, newLineEnd: 2,
            },
        };
        expect(readDiffComment(added)).toBe(added);
        const unserialized = { ...added, selection: { ...added.selection, oldLineStart: Number.NaN, oldLineEnd: Number.NaN } };
        expect(readDiffComment(unserialized)).toBe(unserialized);
    });

    it('accepts file-level comments only with their distinct no-selection/empty-text shape', () => {
        const { selection, ...fields } = diff;
        const file = { ...fields, scope: 'file', selectedText: '' };
        expect(readDiffComment(file)).toBe(file);
        expect(() => readDiffComment({ ...file, selection })).toThrow('Invalid diff comment response');
        expect(() => readDiffComment({ ...file, selectedText: 'invalid' })).toThrow('Invalid diff comment response');
    });

    it.each([
        { ...task, status: 'orphaned' },
        { ...task, anchor: { selectedText: 'text' } },
        { ...task, anchor: { ...anchor, originalLine: '3' } },
        { ...task, category: 'custom' },
        { ...task, replies: [{ ...reply, isAI: 'yes' }] },
        { ...task, selection: { ...task.selection, startLine: Number.NaN } },
    ])('rejects malformed task payloads without synthesizing anchor fields', value => {
        expect(() => readTaskComment(value)).toThrow('Invalid task comment response');
    });

    it.each([
        { ...diff, status: 'pending' },
        { ...diff, selection: { ...diff.selection, side: 'invalid-side' } },
        { ...diff, selection: { ...diff.selection, oldLineStart: '3' } },
        { ...diff, anchor: { strategy: 'prefix' } },
        { ...diff, context: { ...diff.context, commitHash: 3 } },
        { ...diff, category: 'custom' },
    ])('rejects malformed diff payloads rather than widening the UI domain', value => {
        expect(() => readDiffComment(value)).toThrow('Invalid diff comment response');
    });

    it('serializes every Forge anchor field in create and update requests', () => {
        const create = {
            filePath: 'task.md', selection: task.selection, selectedText: 'text', comment: 'review',
            category: 'suggestion', anchor,
        };
        expect(toTaskCommentCreateRequest(create)).toEqual(create);
        const update = { anchor, comment: 'edited', status: 'resolved' as const };
        expect(toTaskCommentUpdateRequest(update)).toEqual(update);
        expect(toTaskCommentUpdateRequest({ status: 'open' })).toEqual({ status: 'open' });
        expect(toTaskCommentUpdateRequest({ status: 'open' })).not.toHaveProperty('anchor');
    });

    it('rejects invalid outgoing categories and incomplete anchors before dispatch', () => {
        const create = {
            filePath: 'task.md', selection: task.selection, selectedText: 'text', comment: 'review',
        };
        expect(() => toTaskCommentCreateRequest({ ...create, category: 'custom' }))
            .toThrow('Invalid task comment category');
        const incomplete = { ...anchor };
        Reflect.deleteProperty(incomplete, 'contextBefore');
        expect(() => toTaskCommentCreateRequest({ ...create, anchor: incomplete }))
            .toThrow('Invalid task comment anchor');
        expect(() => toTaskCommentUpdateRequest({ anchor: incomplete }))
            .toThrow('Invalid task comment anchor');
    });
});
