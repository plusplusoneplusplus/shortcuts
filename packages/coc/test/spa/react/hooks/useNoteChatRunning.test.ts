/**
 * useNoteChatRunning — unit tests for the binding↔task-status join (AC-01).
 *
 * These exercise the pure predicate and the running-set extractor directly, so
 * the "binding + running", "binding + finished/unknown", and "no binding" cases
 * are covered without a React render tree.
 */

import { describe, it, expect } from 'vitest';
import {
    isNoteChatRunningFor,
    collectRunningTaskIds,
} from '../../../../src/server/spa/client/react/features/notes/hooks/useNoteChatRunning';
import type { NoteTreeNode } from '../../../../src/server/spa/client/react/features/notes/notesApi';

function page(path: string): NoteTreeNode {
    return { name: path.split('/').pop() ?? path, path, type: 'page' };
}
function folder(path: string): NoteTreeNode {
    return { name: path.split('/').pop() ?? path, path, type: 'notebook' };
}

describe('collectRunningTaskIds', () => {
    it('collects running and cancelling task ids from both queue buckets', () => {
        const ids = collectRunningTaskIds({
            running: [
                { id: 't-run', status: 'running' },
                { id: 't-cancel', status: 'cancelling' },
            ],
            queued: [
                { id: 't-queued', status: 'queued' },
                { id: 't-cancel-q', status: 'cancelling' },
            ],
        });
        expect([...ids].sort()).toEqual(['t-cancel', 't-cancel-q', 't-run']);
    });

    it('ignores terminal statuses and tolerates a missing entry', () => {
        expect([...collectRunningTaskIds(undefined)]).toEqual([]);
        const ids = collectRunningTaskIds({
            running: [{ id: 'done', status: 'completed' }, { id: 'fail', status: 'failed' }],
        });
        expect([...ids]).toEqual([]);
    });
});

describe('isNoteChatRunningFor', () => {
    const running = new Set(['task-1']);

    it('binding + running task → indicator shown', () => {
        const bindings = { 'nb/a.md': 'task-1' };
        expect(isNoteChatRunningFor(page('nb/a.md'), bindings, running)).toBe(true);
    });

    it('binding + finished/unknown task → hidden', () => {
        const bindings = { 'nb/a.md': 'task-finished' };
        expect(isNoteChatRunningFor(page('nb/a.md'), bindings, running)).toBe(false);
    });

    it('no binding → hidden', () => {
        expect(isNoteChatRunningFor(page('nb/a.md'), {}, running)).toBe(false);
    });

    it('folders never show the indicator even if a binding somehow matches', () => {
        const bindings = { 'nb': 'task-1' };
        expect(isNoteChatRunningFor(folder('nb'), bindings, running)).toBe(false);
    });
});
