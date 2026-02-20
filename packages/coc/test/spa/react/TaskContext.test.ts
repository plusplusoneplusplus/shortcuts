/**
 * Tests for TaskContext reducer — SET_SELECTED_FOLDER_PATH action.
 */

import { describe, it, expect } from 'vitest';
import { taskReducer, type TaskContextState, type TaskAction } from '../../../src/server/spa/client/react/context/TaskContext';

function makeState(overrides: Partial<TaskContextState> = {}): TaskContextState {
    return {
        openFilePath: null,
        selectedFilePaths: new Set(),
        showContextFiles: true,
        lastTasksChangedWsId: null,
        tasksChangedAt: 0,
        selectedFolderPath: null,
        ...overrides,
    };
}

describe('taskReducer — SET_SELECTED_FOLDER_PATH', () => {
    it('sets selectedFolderPath to a string value', () => {
        const state = makeState();
        const action: TaskAction = { type: 'SET_SELECTED_FOLDER_PATH', path: 'feature/sub' };
        const next = taskReducer(state, action);
        expect(next.selectedFolderPath).toBe('feature/sub');
    });

    it('resets selectedFolderPath to null', () => {
        const state = makeState({ selectedFolderPath: 'old/path' });
        const action: TaskAction = { type: 'SET_SELECTED_FOLDER_PATH', path: null };
        const next = taskReducer(state, action);
        expect(next.selectedFolderPath).toBeNull();
    });

    it('does not mutate other state fields', () => {
        const state = makeState({ openFilePath: '/some/file.md', showContextFiles: false });
        const action: TaskAction = { type: 'SET_SELECTED_FOLDER_PATH', path: 'new/folder' };
        const next = taskReducer(state, action);
        expect(next.openFilePath).toBe('/some/file.md');
        expect(next.showContextFiles).toBe(false);
        expect(next.selectedFolderPath).toBe('new/folder');
    });

    it('initial state has selectedFolderPath as null', () => {
        const state = makeState();
        expect(state.selectedFolderPath).toBeNull();
    });
});
