/**
 * Tests for RepoQueueTab re-click refresh behavior.
 *
 * Validates:
 * - selectTask dispatches REFRESH_SELECTED_QUEUE_TASK when clicking the already-selected task
 * - selectTask still dispatches SELECT_QUEUE_TASK for a different task
 * - selectedTaskId is included in the useCallback dependency array
 * - Chat and pipeline early returns are unaffected by the guard
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_QUEUE_TAB_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoQueueTab.tsx'),
    'utf-8',
);

function getSelectTaskBody(): string {
    const start = REPO_QUEUE_TAB_SOURCE.indexOf('const selectTask = useCallback');
    const end = REPO_QUEUE_TAB_SOURCE.indexOf(
        '}, [queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId])',
        start,
    );
    return REPO_QUEUE_TAB_SOURCE.substring(start, end);
}

describe('RepoQueueTab: re-click refresh', () => {
    it('checks selectedTaskId === id before dispatching', () => {
        const body = getSelectTaskBody();
        expect(body).toContain('if (selectedTaskId === id)');
    });

    it('dispatches REFRESH_SELECTED_QUEUE_TASK when re-clicking the same task', () => {
        const body = getSelectTaskBody();
        expect(body).toContain("queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' })");
    });

    it('returns early after dispatching refresh (does not also dispatch SELECT_QUEUE_TASK)', () => {
        const body = getSelectTaskBody();
        // The refresh block should contain a return statement
        const refreshBlock = body.substring(
            body.indexOf('if (selectedTaskId === id)'),
            body.indexOf("queueDispatch({ type: 'SELECT_QUEUE_TASK'"),
        );
        expect(refreshBlock).toContain('return;');
    });

    it('still dispatches SELECT_QUEUE_TASK for a different task', () => {
        const body = getSelectTaskBody();
        expect(body).toContain("queueDispatch({ type: 'SELECT_QUEUE_TASK', id })");
    });

    it('includes selectedTaskId in the useCallback dependency array', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain(
            '[queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId]',
        );
    });

    it('refresh guard appears after chat and pipeline early returns', () => {
        const body = getSelectTaskBody();
        const chatIndex = body.indexOf("task?.type === 'chat'");
        const pipelineIndex = body.indexOf("task?.type === 'run-pipeline'");
        const refreshIndex = body.indexOf('if (selectedTaskId === id)');
        expect(chatIndex).toBeLessThan(refreshIndex);
        expect(pipelineIndex).toBeLessThan(refreshIndex);
    });
});
