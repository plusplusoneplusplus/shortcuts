/**
 * Tests for TaskContext reducer — SET_SELECTED_FILES action.
 */

import { describe, it, expect } from 'vitest';
import { taskReducer, type TaskContextState, type TaskAction } from '../../../src/server/spa/client/react/context/TaskContext';

function makeState(overrides: Partial<TaskContextState> = {}): TaskContextState {
    return {
        openFilePath: null,
        openFileTaskRootPath: null,
        selectedFilePaths: new Set(),
        showContextFiles: true,
        lastTasksChangedWsId: null,
        tasksChangedAt: 0,
        selectedFolderPath: null,
        ...overrides,
    };
}

describe('taskReducer — SET_SELECTED_FILES', () => {
    it('sets selectedFilePaths from a new set', () => {
        const state = makeState();
        const paths = new Set(['a.md', 'b.md']);
        const action: TaskAction = { type: 'SET_SELECTED_FILES', paths };
        const next = taskReducer(state, action);
        expect(next.selectedFilePaths).toEqual(new Set(['a.md', 'b.md']));
    });

    it('replaces existing selection', () => {
        const state = makeState({ selectedFilePaths: new Set(['old.md']) });
        const paths = new Set(['new1.md', 'new2.md']);
        const action: TaskAction = { type: 'SET_SELECTED_FILES', paths };
        const next = taskReducer(state, action);
        expect(next.selectedFilePaths).toEqual(new Set(['new1.md', 'new2.md']));
        expect(next.selectedFilePaths.has('old.md')).toBe(false);
    });

    it('creates a new Set (not a reference to the action set)', () => {
        const state = makeState();
        const paths = new Set(['a.md']);
        const action: TaskAction = { type: 'SET_SELECTED_FILES', paths };
        const next = taskReducer(state, action);
        expect(next.selectedFilePaths).not.toBe(paths);
        expect(next.selectedFilePaths).toEqual(paths);
    });

    it('can set an empty selection', () => {
        const state = makeState({ selectedFilePaths: new Set(['a.md']) });
        const action: TaskAction = { type: 'SET_SELECTED_FILES', paths: new Set() };
        const next = taskReducer(state, action);
        expect(next.selectedFilePaths.size).toBe(0);
    });

    it('does not mutate other state fields', () => {
        const state = makeState({ openFilePath: '/file.md', showContextFiles: false });
        const action: TaskAction = { type: 'SET_SELECTED_FILES', paths: new Set(['x.md']) };
        const next = taskReducer(state, action);
        expect(next.openFilePath).toBe('/file.md');
        expect(next.showContextFiles).toBe(false);
    });
});
