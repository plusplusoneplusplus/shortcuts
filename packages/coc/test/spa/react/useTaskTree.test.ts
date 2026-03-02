/**
 * Tests for useTaskTree hook: types, type guards, folderToNodes, and rebuildColumnsFromKeys.
 * Hook behavior (fetch, WS refresh) is tested via TasksPanel integration.
 */

import { describe, it, expect } from 'vitest';
import {
    isTaskFolder,
    isTaskDocumentGroup,
    isTaskDocument,
    isContextFile,
    folderToNodes,
    isGitMetadataFolder,
    filterGitMetadataFolders,
    filterTaskItems,
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

describe('filterGitMetadataFolders', () => {
    it('removes .git folders recursively and preserves non-git hidden folders', () => {
        const tree: TaskFolder = {
            name: 'tasks',
            relativePath: '',
            children: [
                {
                    name: '.git',
                    relativePath: '.git',
                    children: [
                        {
                            name: 'hooks',
                            relativePath: '.git/hooks',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        },
                    ],
                    documentGroups: [],
                    singleDocuments: [],
                },
                {
                    name: '.github',
                    relativePath: '.github',
                    children: [],
                    documentGroups: [],
                    singleDocuments: [],
                },
                {
                    name: 'feature',
                    relativePath: 'feature',
                    children: [
                        {
                            name: '.git',
                            relativePath: 'feature/.git',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        },
                        {
                            name: 'docs',
                            relativePath: 'feature/docs',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        },
                    ],
                    documentGroups: [],
                    singleDocuments: [],
                },
            ],
            documentGroups: [],
            singleDocuments: [],
        };

        const filtered = filterGitMetadataFolders(tree);

        expect(filtered.children.map((child) => child.name)).toEqual(['.github', 'feature']);
        expect(filtered.children[1].children.map((child) => child.name)).toEqual(['docs']);
    });

    it('detects .git folders from Windows-style relative paths', () => {
        const windowsGitFolder: TaskFolder = {
            name: 'hooks',
            relativePath: 'feature\\.git\\hooks',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };

        expect(isGitMetadataFolder(windowsGitFolder)).toBe(true);
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

// ── folderToNodes with contextDocuments ─────────────────────────────────

describe('folderToNodes with contextDocuments', () => {
    const contextDoc: TaskDocument = {
        baseName: 'CONTEXT',
        fileName: 'CONTEXT.md',
        isArchived: false,
    };

    const readmeDoc: TaskDocument = {
        baseName: 'README',
        fileName: 'README.md',
        isArchived: false,
    };

    it('includes contextDocuments in the output', () => {
        const folder: TaskFolder = {
            name: 'feature',
            relativePath: 'feature',
            children: [],
            documentGroups: [],
            singleDocuments: [mockDoc],
        };
        (folder as any).contextDocuments = [contextDoc];

        const nodes = folderToNodes(folder);
        expect(nodes).toHaveLength(2);
        expect(nodes).toContain(mockDoc);
        expect(nodes).toContain(contextDoc);
    });

    it('places contextDocuments after singleDocuments', () => {
        const folder: TaskFolder = {
            name: 'feature',
            relativePath: 'feature',
            children: [],
            documentGroups: [],
            singleDocuments: [mockDoc],
        };
        (folder as any).contextDocuments = [contextDoc];

        const nodes = folderToNodes(folder);
        const taskIndex = nodes.indexOf(mockDoc);
        const contextIndex = nodes.indexOf(contextDoc);
        expect(contextIndex).toBeGreaterThan(taskIndex);
    });

    it('handles folder without contextDocuments (undefined)', () => {
        const folder: TaskFolder = {
            name: 'feature',
            relativePath: 'feature',
            children: [],
            documentGroups: [],
            singleDocuments: [mockDoc],
        };

        const nodes = folderToNodes(folder);
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toBe(mockDoc);
    });

    it('handles folder with empty contextDocuments array', () => {
        const folder: TaskFolder = {
            name: 'feature',
            relativePath: 'feature',
            children: [],
            documentGroups: [],
            singleDocuments: [mockDoc],
        };
        (folder as any).contextDocuments = [];

        const nodes = folderToNodes(folder);
        expect(nodes).toHaveLength(1);
    });

    it('includes multiple context documents', () => {
        const folder: TaskFolder = {
            name: 'feature',
            relativePath: 'feature',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };
        (folder as any).contextDocuments = [contextDoc, readmeDoc];

        const nodes = folderToNodes(folder);
        expect(nodes).toHaveLength(2);
        expect(nodes).toContain(contextDoc);
        expect(nodes).toContain(readmeDoc);
    });

    it('context documents are identified by isContextFile', () => {
        expect(isContextFile('CONTEXT.md')).toBe(true);
        expect(isContextFile('README.md')).toBe(true);
        expect(isContextFile('task.md')).toBe(false);
    });

    it('full ordering: children, documentGroups, singleDocuments, contextDocuments', () => {
        const childFolder: TaskFolder = {
            name: 'sub',
            relativePath: 'feature/sub',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };
        const folder: TaskFolder = {
            name: 'feature',
            relativePath: 'feature',
            children: [childFolder],
            documentGroups: [mockGroup],
            singleDocuments: [mockDoc],
        };
        (folder as any).contextDocuments = [contextDoc];

        const nodes = folderToNodes(folder);
        expect(nodes).toHaveLength(4);
        expect(nodes[0]).toBe(childFolder);
        expect(nodes[1]).toBe(mockGroup);
        expect(nodes[2]).toBe(mockDoc);
        expect(nodes[3]).toBe(contextDoc);
    });
});

// ── filterTaskItems ──────────────────────────────────────────────────────

describe('filterTaskItems — archive sorting', () => {
    const nonArchiveDoc: TaskDocument = {
        baseName: 'my-feature',
        fileName: 'my-feature.plan.md',
        relativePath: 'coc/my-feature.plan.md',
        isArchived: false,
    };

    const archiveDoc: TaskDocument = {
        baseName: 'old-feature',
        fileName: 'old-feature.plan.md',
        relativePath: 'archive/coc/old-feature.plan.md',
        isArchived: true,
    };

    const nonArchiveGroup: TaskDocumentGroup = {
        baseName: 'alpha-task',
        documents: [{ ...nonArchiveDoc, baseName: 'alpha-task', fileName: 'alpha-task.plan.md' }],
        isArchived: false,
    };

    const archiveGroup: TaskDocumentGroup = {
        baseName: 'beta-task',
        documents: [{ ...archiveDoc, baseName: 'beta-task', fileName: 'beta-task.plan.md' }],
        isArchived: true,
    };

    it('places non-archived items before archived items in search results', () => {
        const results = filterTaskItems([archiveDoc, nonArchiveDoc], 'feature');
        expect(results[0]).toBe(nonArchiveDoc);
        expect(results[1]).toBe(archiveDoc);
    });

    it('sorts alphabetically within each archive group', () => {
        const docA: TaskDocument = { baseName: 'aaa', fileName: 'aaa.md', isArchived: false };
        const docZ: TaskDocument = { baseName: 'zzz', fileName: 'zzz.md', isArchived: false };
        const archA: TaskDocument = { baseName: 'aaa-arch', fileName: 'aaa-arch.md', isArchived: true };
        const archZ: TaskDocument = { baseName: 'zzz-arch', fileName: 'zzz-arch.md', isArchived: true };

        const results = filterTaskItems([archZ, docZ, archA, docA], 'a');
        expect(results.map((r) => r.baseName)).toEqual(['aaa', 'aaa-arch', 'zzz-arch']);
    });

    it('works with TaskDocumentGroup items', () => {
        const results = filterTaskItems([archiveGroup, nonArchiveGroup], 'task');
        expect(results[0]).toBe(nonArchiveGroup);
        expect(results[1]).toBe(archiveGroup);
    });

    it('returns only non-archived items when none match archive pattern', () => {
        const results = filterTaskItems([nonArchiveDoc, nonArchiveGroup], 'task');
        expect(results.every((r) => !r.isArchived)).toBe(true);
    });

    it('returns empty array when query matches nothing', () => {
        const results = filterTaskItems([archiveDoc, nonArchiveDoc], 'zzznomatch');
        expect(results).toHaveLength(0);
    });
});
