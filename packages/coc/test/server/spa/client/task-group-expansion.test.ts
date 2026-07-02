import { describe, expect, it } from 'vitest';
import {
    createTaskGroupExpansionState,
    getExpandedTaskGroupIds,
    resetTaskGroupExpansionForWorkspace,
    toggleExpandedTaskGroupId,
} from '../../../../src/server/spa/client/react/features/chat/task-group-expansion';

describe('task-group-expansion', () => {
    it('starts with nothing expanded for any kind', () => {
        const state = createTaskGroupExpansionState('ws-1');
        expect(getExpandedTaskGroupIds(state, 'ws-1', 'ralph').size).toBe(0);
        expect(getExpandedTaskGroupIds(state, 'ws-1', 'for-each').size).toBe(0);
    });

    it('toggles a group id on and off per kind', () => {
        let state = createTaskGroupExpansionState('ws-1');
        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'session-1');
        expect(getExpandedTaskGroupIds(state, 'ws-1', 'ralph').has('session-1')).toBe(true);

        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'session-1');
        expect(getExpandedTaskGroupIds(state, 'ws-1', 'ralph').has('session-1')).toBe(false);
    });

    it('keeps kinds independent', () => {
        let state = createTaskGroupExpansionState('ws-1');
        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'group-1');
        state = toggleExpandedTaskGroupId(state, 'ws-1', 'for-each', 'group-1');

        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'group-1');
        expect(getExpandedTaskGroupIds(state, 'ws-1', 'ralph').has('group-1')).toBe(false);
        expect(getExpandedTaskGroupIds(state, 'ws-1', 'for-each').has('group-1')).toBe(true);
    });

    it('preserves set identity for kinds that were not toggled', () => {
        let state = createTaskGroupExpansionState('ws-1');
        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'session-1');
        const ralphBefore = getExpandedTaskGroupIds(state, 'ws-1', 'ralph');

        state = toggleExpandedTaskGroupId(state, 'ws-1', 'for-each', 'run-1');
        expect(getExpandedTaskGroupIds(state, 'ws-1', 'ralph')).toBe(ralphBefore);
    });

    it('reports nothing expanded when reading a different workspace', () => {
        let state = createTaskGroupExpansionState('ws-1');
        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'session-1');
        expect(getExpandedTaskGroupIds(state, 'ws-2', 'ralph').size).toBe(0);
    });

    it('discards stale state when toggling under a new workspace', () => {
        let state = createTaskGroupExpansionState('ws-1');
        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'session-1');
        state = toggleExpandedTaskGroupId(state, 'ws-2', 'ralph', 'session-2');

        expect(state.workspaceId).toBe('ws-2');
        expect(getExpandedTaskGroupIds(state, 'ws-2', 'ralph').has('session-2')).toBe(true);
        expect(getExpandedTaskGroupIds(state, 'ws-2', 'ralph').has('session-1')).toBe(false);
    });

    it('resets on workspace change and keeps identity when already clean', () => {
        let state = createTaskGroupExpansionState('ws-1');
        const clean = resetTaskGroupExpansionForWorkspace(state, 'ws-1');
        expect(clean).toBe(state);

        state = toggleExpandedTaskGroupId(state, 'ws-1', 'map-reduce', 'run-1');
        const reset = resetTaskGroupExpansionForWorkspace(state, 'ws-2');
        expect(reset.workspaceId).toBe('ws-2');
        expect(getExpandedTaskGroupIds(reset, 'ws-2', 'map-reduce').size).toBe(0);
    });

    it('keeps identity when resetting a clean state with expanded-then-collapsed groups', () => {
        let state = createTaskGroupExpansionState('ws-1');
        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'session-1');
        state = toggleExpandedTaskGroupId(state, 'ws-1', 'ralph', 'session-1');
        const reset = resetTaskGroupExpansionForWorkspace(state, 'ws-1');
        expect(reset).toBe(state);
    });
});
