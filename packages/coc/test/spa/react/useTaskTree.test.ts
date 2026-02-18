/**
 * Tests for useTaskTree hook: types, type guards, and folderToNodes.
 * Hook behavior (fetch, WS refresh) is tested via TasksPanel integration.
 */

import { describe, it, expect } from 'vitest';
import {
    isTaskFolder,
    isTaskDocumentGroup,
    isTaskDocument,
    folderToNodes,
    type TaskFolder,
    type TaskDocumentGroup,
    type TaskDocument,
} from '../../../src/server/spa/client/react/hooks/useTaskTree';

const mockDoc: TaskDocument = {
    baseName: 'task1',
    docType: 'plan',
    fileName: 'task1.plan.md',
    relativePath: 'feature',
    status: 'pending',
    isArchived: false,
};

const mockGroup: TaskDocumentGroup = {
    baseName: 'task1',
    documents: [mockDoc],
    isArchived: false,
};

const mockFolder: TaskFolder = {
    name: 'feature',
    relativePath: 'feature',
    children: [],
    documentGroups: [mockGroup],
    singleDocuments: [mockDoc],
};

describe('isTaskFolder', () => {
    it('returns true for TaskFolder objects', () => {
        expect(isTaskFolder(mockFolder)).toBe(true);
    });

    it('returns false for TaskDocumentGroup', () => {
        expect(isTaskFolder(mockGroup)).toBe(false);
    });

    it('returns false for TaskDocument', () => {
        expect(isTaskFolder(mockDoc)).toBe(false);
    });
});

describe('isTaskDocumentGroup', () => {
    it('returns true for TaskDocumentGroup objects', () => {
        expect(isTaskDocumentGroup(mockGroup)).toBe(true);
    });

    it('returns false for TaskFolder', () => {
        expect(isTaskDocumentGroup(mockFolder)).toBe(false);
    });

    it('returns false for TaskDocument', () => {
        expect(isTaskDocumentGroup(mockDoc)).toBe(false);
    });
});

describe('isTaskDocument', () => {
    it('returns true for TaskDocument objects', () => {
        expect(isTaskDocument(mockDoc)).toBe(true);
    });

    it('returns false for TaskFolder', () => {
        expect(isTaskDocument(mockFolder)).toBe(false);
    });

    it('returns false for TaskDocumentGroup', () => {
        expect(isTaskDocument(mockGroup)).toBe(false);
    });
});

describe('folderToNodes', () => {
    it('returns children, documentGroups, and singleDocuments in order', () => {
        const nodes = folderToNodes(mockFolder);
        expect(nodes).toHaveLength(2); // 0 children + 1 group + 1 doc
        expect(nodes[0]).toBe(mockGroup);
        expect(nodes[1]).toBe(mockDoc);
    });

    it('includes child folders first', () => {
        const childFolder: TaskFolder = {
            name: 'sub',
            relativePath: 'feature/sub',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };
        const parent: TaskFolder = {
            ...mockFolder,
            children: [childFolder],
        };
        const nodes = folderToNodes(parent);
        expect(nodes[0]).toBe(childFolder);
    });

    it('returns empty array for empty folder', () => {
        const emptyFolder: TaskFolder = {
            name: 'empty',
            relativePath: 'empty',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };
        expect(folderToNodes(emptyFolder)).toHaveLength(0);
    });
});
