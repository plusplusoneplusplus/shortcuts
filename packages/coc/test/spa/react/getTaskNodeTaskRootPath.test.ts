/**
 * Tests for getTaskNodeTaskRootPath helper in useTaskTree.
 */

import { describe, it, expect } from 'vitest';
import { getTaskNodeTaskRootPath } from '../../../src/server/spa/client/react/hooks/useTaskTree';
import type { TaskDocument, TaskDocumentGroup, TaskFolder } from '../../../src/server/spa/client/react/hooks/useTaskTree';

describe('getTaskNodeTaskRootPath', () => {
    it('returns taskRootPath from a TaskDocument', () => {
        const doc: TaskDocument = {
            baseName: 'my-task',
            fileName: 'my-task.plan.md',
            relativePath: 'coc',
            isArchived: false,
            taskRootPath: 'C:/Users/user/.coc/repos/ws-abc/tasks',
        };
        expect(getTaskNodeTaskRootPath(doc)).toBe('C:/Users/user/.coc/repos/ws-abc/tasks');
    });

    it('returns undefined when TaskDocument has no taskRootPath', () => {
        const doc: TaskDocument = {
            baseName: 'my-task',
            fileName: 'my-task.plan.md',
            isArchived: false,
        };
        expect(getTaskNodeTaskRootPath(doc)).toBeUndefined();
    });

    it('returns taskRootPath from the first document in a TaskDocumentGroup', () => {
        const group: TaskDocumentGroup = {
            baseName: 'feature',
            isArchived: false,
            documents: [
                {
                    baseName: 'feature',
                    fileName: 'feature.plan.md',
                    relativePath: 'coc',
                    isArchived: false,
                    taskRootPath: '/home/user/.coc/repos/ws-xyz/tasks',
                },
                {
                    baseName: 'feature',
                    fileName: 'feature.spec.md',
                    relativePath: 'coc',
                    isArchived: false,
                    taskRootPath: '/home/user/.coc/repos/ws-xyz/tasks',
                },
            ],
        };
        expect(getTaskNodeTaskRootPath(group)).toBe('/home/user/.coc/repos/ws-xyz/tasks');
    });

    it('returns undefined for an empty TaskDocumentGroup', () => {
        const group: TaskDocumentGroup = {
            baseName: 'empty',
            isArchived: false,
            documents: [],
        };
        expect(getTaskNodeTaskRootPath(group)).toBeUndefined();
    });

    it('returns taskRootPath from a TaskFolder', () => {
        const folder: TaskFolder = {
            name: 'coc',
            relativePath: 'coc',
            children: [],
            documentGroups: [],
            singleDocuments: [],
            taskRootPath: 'C:/Users/user/.coc/repos/ws-abc/tasks',
        };
        expect(getTaskNodeTaskRootPath(folder)).toBe('C:/Users/user/.coc/repos/ws-abc/tasks');
    });

    it('returns undefined when TaskFolder has no taskRootPath', () => {
        const folder: TaskFolder = {
            name: 'coc',
            relativePath: 'coc',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };
        expect(getTaskNodeTaskRootPath(folder)).toBeUndefined();
    });
});
