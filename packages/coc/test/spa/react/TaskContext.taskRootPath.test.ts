/**
 * Tests for TaskContext reducer — taskRootPath alongside SET_OPEN_FILE_PATH.
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

describe('taskReducer — SET_OPEN_FILE_PATH with taskRootPath', () => {
    it('sets both openFilePath and openFileTaskRootPath', () => {
        const state = makeState();
        const action: TaskAction = {
            type: 'SET_OPEN_FILE_PATH',
            path: 'coc/my-task.plan.md',
            taskRootPath: 'C:/Users/user/.coc/repos/ws-abc/tasks',
        };
        const next = taskReducer(state, action);
        expect(next.openFilePath).toBe('coc/my-task.plan.md');
        expect(next.openFileTaskRootPath).toBe('C:/Users/user/.coc/repos/ws-abc/tasks');
    });

    it('clears taskRootPath when path is null', () => {
        const state = makeState({
            openFilePath: 'coc/my-task.plan.md',
            openFileTaskRootPath: 'C:/Users/user/.coc/repos/ws-abc/tasks',
        });
        const action: TaskAction = { type: 'SET_OPEN_FILE_PATH', path: null };
        const next = taskReducer(state, action);
        expect(next.openFilePath).toBeNull();
        expect(next.openFileTaskRootPath).toBeNull();
    });

    it('defaults taskRootPath to null when not provided', () => {
        const state = makeState();
        const action: TaskAction = { type: 'SET_OPEN_FILE_PATH', path: 'file.md' };
        const next = taskReducer(state, action);
        expect(next.openFilePath).toBe('file.md');
        expect(next.openFileTaskRootPath).toBeNull();
    });

    it('replaces previous taskRootPath with new one', () => {
        const state = makeState({
            openFilePath: 'old.md',
            openFileTaskRootPath: '/old/root',
        });
        const action: TaskAction = {
            type: 'SET_OPEN_FILE_PATH',
            path: 'new.md',
            taskRootPath: '/new/root',
        };
        const next = taskReducer(state, action);
        expect(next.openFilePath).toBe('new.md');
        expect(next.openFileTaskRootPath).toBe('/new/root');
    });

    it('does not affect other state fields', () => {
        const state = makeState({
            selectedFilePaths: new Set(['a.md']),
            showContextFiles: false,
            selectedFolderPath: 'coc',
        });
        const action: TaskAction = {
            type: 'SET_OPEN_FILE_PATH',
            path: 'b.md',
            taskRootPath: '/root',
        };
        const next = taskReducer(state, action);
        expect(next.selectedFilePaths).toEqual(new Set(['a.md']));
        expect(next.showContextFiles).toBe(false);
        expect(next.selectedFolderPath).toBe('coc');
    });

    it('initial state has openFileTaskRootPath as null', () => {
        const state = makeState();
        expect(state.openFileTaskRootPath).toBeNull();
    });
});
