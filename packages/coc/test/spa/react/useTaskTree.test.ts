/**
 * Tests for useTaskTree hook: types, type guards, folderToNodes, and rebuildColumnsFromKeys.
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
import { rebuildColumnsFromKeys } from '../../../src/server/spa/client/react/tasks/TaskTree';

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

// ── rebuildColumnsFromKeys ──────────────────────────────────────────────

function makeFolder(name: string, relativePath: string, children: TaskFolder[] = []): TaskFolder {
    return {
        name,
        relativePath,
        children,
        documentGroups: [],
        singleDocuments: [{ baseName: 'doc', fileName: 'doc.md', isArchived: false }],
    };
}

describe('rebuildColumnsFromKeys', () => {
    const sub = makeFolder('sub', 'feature/sub');
    const feature = makeFolder('feature', 'feature', [sub]);
    const other = makeFolder('other', 'other');
    const root: TaskFolder = {
        name: 'tasks',
        relativePath: '',
        children: [feature, other],
        documentGroups: [],
        singleDocuments: [],
    };

    it('returns only root column when keys is empty', () => {
        const cols = rebuildColumnsFromKeys(root, []);
        expect(cols).toHaveLength(1);
        expect(cols[0]).toEqual(folderToNodes(root));
    });

    it('rebuilds one level deep from a single key', () => {
        const cols = rebuildColumnsFromKeys(root, ['feature']);
        expect(cols).toHaveLength(2);
        expect(cols[0]).toEqual(folderToNodes(root));
        expect(cols[1]).toEqual(folderToNodes(feature));
    });

    it('rebuilds two levels deep from nested keys', () => {
        const cols = rebuildColumnsFromKeys(root, ['feature', 'feature/sub']);
        expect(cols).toHaveLength(3);
        expect(cols[0]).toEqual(folderToNodes(root));
        expect(cols[1]).toEqual(folderToNodes(feature));
        expect(cols[2]).toEqual(folderToNodes(sub));
    });

    it('stops at first missing key', () => {
        const cols = rebuildColumnsFromKeys(root, ['nonexistent', 'feature/sub']);
        expect(cols).toHaveLength(1);
    });

    it('stops at null key', () => {
        const cols = rebuildColumnsFromKeys(root, ['feature', null, 'feature/sub']);
        expect(cols).toHaveLength(2);
    });

    it('handles key for folder that was removed (e.g. archived)', () => {
        const treeAfterArchive: TaskFolder = {
            name: 'tasks',
            relativePath: '',
            children: [other],
            documentGroups: [],
            singleDocuments: [],
        };
        const cols = rebuildColumnsFromKeys(treeAfterArchive, ['feature', 'feature/sub']);
        expect(cols).toHaveLength(1);
        expect(cols[0]).toEqual(folderToNodes(treeAfterArchive));
    });

    it('preserves navigation when tree content changes but structure is same', () => {
        const updatedSub = makeFolder('sub', 'feature/sub');
        const updatedFeature = makeFolder('feature', 'feature', [updatedSub]);
        const updatedRoot: TaskFolder = {
            name: 'tasks',
            relativePath: '',
            children: [updatedFeature, other],
            documentGroups: [],
            singleDocuments: [],
        };
        const cols = rebuildColumnsFromKeys(updatedRoot, ['feature', 'feature/sub']);
        expect(cols).toHaveLength(3);
        expect(cols[1]).toEqual(folderToNodes(updatedFeature));
        expect(cols[2]).toEqual(folderToNodes(updatedSub));
    });

    it('handles root folder with name-based key (empty relativePath)', () => {
        const namedChild = makeFolder('misc', '');
        const rootWithNameChild: TaskFolder = {
            name: 'tasks',
            relativePath: '',
            children: [{ ...namedChild, relativePath: '' }],
            documentGroups: [],
            singleDocuments: [],
        };
        const cols = rebuildColumnsFromKeys(rootWithNameChild, ['misc']);
        expect(cols).toHaveLength(2);
    });
});
