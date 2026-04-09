/**
 * Tests for useFileContextMenu — Run Skill path resolution using taskRootPath.
 *
 * Verifies that ctxItem.taskRootPath is preferred over tasksFolder
 * when constructing the absolute file path for the Run Skill action.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFileContextMenu } from '../../../src/server/spa/client/react/hooks/useFileContextMenu';
import type { FileCtxMenu, FileCtxInfo } from '../../../src/server/spa/client/react/hooks/useFileDialogHandlers';

function makeMockCtxItem(overrides: Partial<FileCtxInfo> = {}): FileCtxInfo {
    return {
        item: { baseName: 'my-task', fileName: 'my-task.plan.md', isArchived: false } as any,
        paths: ['coc/my-task.plan.md'],
        renamePath: 'coc/my-task.plan.md',
        displayName: 'my-task',
        isArchived: false,
        ...overrides,
    };
}

function makeOptions(ctxItem: FileCtxInfo, overrides: Record<string, any> = {}) {
    const queueDispatch = vi.fn();
    return {
        opts: {
            fileCtxMenu: { ctxItem, x: 0, y: 0 } as FileCtxMenu,
            setFileCtxMenu: vi.fn(),
            tasksFolder: '.vscode/tasks',
            fileActions: {} as any,
            refresh: vi.fn(),
            addToast: vi.fn(),
            siblingRepos: [],
            onSearchClear: vi.fn(),
            setNavigateToFilePath: vi.fn(),
            setFileDialog: vi.fn(),
            setFileMoveCtxItem: vi.fn(),
            setFileMoveDialogOpen: vi.fn(),
            setAiDialogTarget: vi.fn(),
            setAiDialogType: vi.fn(),
            queueDispatch,
            wsId: 'ws1',
            workspaceRootPath: 'D:/projects/shortcuts',
            ...overrides,
        },
        queueDispatch,
    };
}

describe('useFileContextMenu — Run Skill path', () => {
    it('uses taskRootPath when available on ctxItem', () => {
        const ctxItem = makeMockCtxItem({
            taskRootPath: 'C:/Users/user/.coc/repos/ws-abc/tasks',
        });
        const { opts, queueDispatch } = makeOptions(ctxItem);
        const { result } = renderHook(() => useFileContextMenu(opts));

        const runSkillItem = result.current.fileMenuItems.find(i => i.label === '✨ Run Skill');
        expect(runSkillItem).toBeTruthy();
        runSkillItem!.onClick();

        expect(queueDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'OPEN_DIALOG',
                contextFiles: ['C:/Users/user/.coc/repos/ws-abc/tasks/coc/my-task.plan.md'],
            }),
        );
    });

    it('falls back to tasksFolder when taskRootPath is not set', () => {
        const ctxItem = makeMockCtxItem(); // no taskRootPath
        const { opts, queueDispatch } = makeOptions(ctxItem);
        const { result } = renderHook(() => useFileContextMenu(opts));

        const runSkillItem = result.current.fileMenuItems.find(i => i.label === '✨ Run Skill');
        runSkillItem!.onClick();

        expect(queueDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                contextFiles: ['D:/projects/shortcuts/.vscode/tasks/coc/my-task.plan.md'],
            }),
        );
    });

    it('uses absolute tasksFolder directly when it starts with a drive letter', () => {
        const ctxItem = makeMockCtxItem(); // no taskRootPath
        const { opts, queueDispatch } = makeOptions(ctxItem, {
            tasksFolder: 'C:/Users/user/.coc/repos/ws-abc/tasks',
        });
        const { result } = renderHook(() => useFileContextMenu(opts));

        const runSkillItem = result.current.fileMenuItems.find(i => i.label === '✨ Run Skill');
        runSkillItem!.onClick();

        expect(queueDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                contextFiles: ['C:/Users/user/.coc/repos/ws-abc/tasks/coc/my-task.plan.md'],
            }),
        );
    });

    it('normalizes backslashes in taskRootPath', () => {
        const ctxItem = makeMockCtxItem({
            taskRootPath: 'C:\\Users\\user\\.coc\\repos\\ws-abc\\tasks',
        });
        const { opts, queueDispatch } = makeOptions(ctxItem);
        const { result } = renderHook(() => useFileContextMenu(opts));

        const runSkillItem = result.current.fileMenuItems.find(i => i.label === '✨ Run Skill');
        runSkillItem!.onClick();

        const contextFiles = queueDispatch.mock.calls[0][0].contextFiles;
        expect(contextFiles[0]).not.toContain('\\');
        expect(contextFiles[0]).toContain('C:/Users/user/.coc/repos/ws-abc/tasks/coc/my-task.plan.md');
    });

    it('prefers taskRootPath over tasksFolder even when tasksFolder is absolute', () => {
        const ctxItem = makeMockCtxItem({
            taskRootPath: '/correct/task/root',
        });
        const { opts, queueDispatch } = makeOptions(ctxItem, {
            tasksFolder: '/wrong/tasks/folder',
        });
        const { result } = renderHook(() => useFileContextMenu(opts));

        const runSkillItem = result.current.fileMenuItems.find(i => i.label === '✨ Run Skill');
        runSkillItem!.onClick();

        expect(queueDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                contextFiles: ['/correct/task/root/coc/my-task.plan.md'],
            }),
        );
    });
});
