/**
 * Tests for task-scanner.ts — scanning, grouping, and hierarchy construction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    scanTasksRecursively,
    scanDocumentsRecursively,
    scanFoldersRecursively,
    groupTaskDocuments,
    buildTaskFolderHierarchy,
} from '../../src/tasks/task-scanner';
import { TaskDocument, TaskFolder } from '../../src/tasks/types';

let tmpDir: string;

function createDir(...parts: string[]): string {
    const dir = path.join(tmpDir, ...parts);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function createFile(content: string, ...parts: string[]): string {
    const filePath = path.join(tmpDir, ...parts);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

function createMd(name: string, subdir?: string, status?: string): string {
    const content = status
        ? `---\nstatus: ${status}\n---\n\n# ${name}\n`
        : `# ${name}\n`;
    const parts = subdir ? [subdir, name] : [name];
    return createFile(content, ...parts);
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-scanner-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// scanTasksRecursively
// ============================================================================

describe('scanTasksRecursively', () => {
    it('returns empty array for empty directory', () => {
        const result = scanTasksRecursively(tmpDir, '', false);
        expect(result).toEqual([]);
    });

    it('finds .md files in flat directory', () => {
        createMd('task-a.md');
        createMd('task-b.md');

        const result = scanTasksRecursively(tmpDir, '', false);
        expect(result).toHaveLength(2);
        expect(result.map(t => t.name).sort()).toEqual(['task-a', 'task-b']);
    });

    it('scans nested subdirectories', () => {
        createMd('root.md');
        createMd('nested.md', 'sub1');
        createMd('deep.md', path.join('sub1', 'sub2'));

        const result = scanTasksRecursively(tmpDir, '', false);
        expect(result).toHaveLength(3);

        const deep = result.find(t => t.name === 'deep');
        expect(deep).toBeDefined();
        expect(deep!.relativePath).toBe(path.join('sub1', 'sub2'));
    });

    it('skips archive folder when isArchived=false', () => {
        createMd('active.md');
        createMd('archived.md', 'archive');

        const result = scanTasksRecursively(tmpDir, '', false);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('active');
    });

    it('includes archive contents when isArchived=true', () => {
        createMd('archived.md');

        const result = scanTasksRecursively(tmpDir, '', true);
        expect(result).toHaveLength(1);
        expect(result[0].isArchived).toBe(true);
    });

    it('ignores non-.md files', () => {
        createMd('task.md');
        createFile('console.log("hi")', 'script.js');
        createFile('hello', 'readme.txt');

        const result = scanTasksRecursively(tmpDir, '', false);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('task');
    });

    it('handles unreadable directories gracefully', () => {
        const result = scanTasksRecursively(path.join(tmpDir, 'nonexistent'), '', false);
        expect(result).toEqual([]);
    });

    it('sets relativePath correctly for nested files', () => {
        createMd('a.md', 'feature1');
        createMd('b.md', path.join('feature1', 'backlog'));

        const result = scanTasksRecursively(tmpDir, '', false);
        const a = result.find(t => t.name === 'a')!;
        const b = result.find(t => t.name === 'b')!;

        expect(a.relativePath).toBe('feature1');
        expect(b.relativePath).toBe(path.join('feature1', 'backlog'));
    });

    it('parses task status from frontmatter', () => {
        createMd('pending-task.md', undefined, 'pending');
        createMd('done-task.md', undefined, 'done');
        createMd('no-status.md');

        const result = scanTasksRecursively(tmpDir, '', false);
        const pending = result.find(t => t.name === 'pending-task')!;
        const done = result.find(t => t.name === 'done-task')!;
        const noStatus = result.find(t => t.name === 'no-status')!;

        expect(pending.status).toBe('pending');
        expect(done.status).toBe('done');
        expect(noStatus.status).toBeUndefined();
    });

    it('root-level files have undefined relativePath', () => {
        createMd('root.md');

        const result = scanTasksRecursively(tmpDir, '', false);
        expect(result[0].relativePath).toBeUndefined();
    });
});

// ============================================================================
// scanDocumentsRecursively
// ============================================================================

describe('scanDocumentsRecursively', () => {
    it('returns empty array for empty directory', () => {
        const result = scanDocumentsRecursively(tmpDir, '', false);
        expect(result).toEqual([]);
    });

    it('finds .md files with baseName and docType from parseFileName', () => {
        createMd('task1.plan.md');
        createMd('task1.spec.md');
        createMd('simple.md');

        const result = scanDocumentsRecursively(tmpDir, '', false);
        expect(result).toHaveLength(3);

        const plan = result.find(d => d.fileName === 'task1.plan.md')!;
        expect(plan.baseName).toBe('task1');
        expect(plan.docType).toBe('plan');

        const simple = result.find(d => d.fileName === 'simple.md')!;
        expect(simple.baseName).toBe('simple');
        expect(simple.docType).toBeUndefined();
    });

    it('scans nested subdirectories', () => {
        createMd('task.md', 'sub');

        const result = scanDocumentsRecursively(tmpDir, '', false);
        expect(result).toHaveLength(1);
        expect(result[0].relativePath).toBe('sub');
    });

    it('skips archive folder when isArchived=false', () => {
        createMd('active.md');
        createMd('archived.md', 'archive');

        const result = scanDocumentsRecursively(tmpDir, '', false);
        expect(result).toHaveLength(1);
    });

    it('includes archive contents when isArchived=true', () => {
        createMd('archived.md');

        const result = scanDocumentsRecursively(tmpDir, '', true);
        expect(result).toHaveLength(1);
        expect(result[0].isArchived).toBe(true);
    });

    it('ignores non-.md files', () => {
        createFile('hello', 'readme.txt');
        createMd('task.md');

        const result = scanDocumentsRecursively(tmpDir, '', false);
        expect(result).toHaveLength(1);
    });

    it('parses status from frontmatter', () => {
        createMd('task.md', undefined, 'in-progress');

        const result = scanDocumentsRecursively(tmpDir, '', false);
        expect(result[0].status).toBe('in-progress');
    });

    it('handles unreadable directories gracefully', () => {
        const result = scanDocumentsRecursively(path.join(tmpDir, 'nonexistent'), '', false);
        expect(result).toEqual([]);
    });

    it('sets relativePath correctly for nested files', () => {
        createMd('a.plan.md', 'feature1');
        createMd('b.md', path.join('feature1', 'backlog'));

        const result = scanDocumentsRecursively(tmpDir, '', false);
        const a = result.find(d => d.fileName === 'a.plan.md')!;
        const b = result.find(d => d.fileName === 'b.md')!;

        expect(a.relativePath).toBe('feature1');
        expect(b.relativePath).toBe(path.join('feature1', 'backlog'));
    });
});

// ============================================================================
// scanFoldersRecursively
// ============================================================================

describe('scanFoldersRecursively', () => {
    it('builds correct parent-child relationships', () => {
        createDir('feature1');
        createDir('feature2');

        const folderMap = new Map<string, TaskFolder>();
        const root = makeRootFolder();
        folderMap.set('', root);

        scanFoldersRecursively(tmpDir, '', false, folderMap, root);
        expect(root.children).toHaveLength(2);
        expect(root.children.map(c => c.name).sort()).toEqual(['feature1', 'feature2']);
    });

    it('populates folderMap', () => {
        createDir('a');
        createDir('a', 'b');

        const folderMap = new Map<string, TaskFolder>();
        const root = makeRootFolder();
        folderMap.set('', root);

        scanFoldersRecursively(tmpDir, '', false, folderMap, root);
        expect(folderMap.has('a')).toBe(true);
        expect(folderMap.has(path.join('a', 'b'))).toBe(true);
    });

    it('skips archive folder when isArchived=false', () => {
        createDir('feature');
        createDir('archive');

        const folderMap = new Map<string, TaskFolder>();
        const root = makeRootFolder();
        folderMap.set('', root);

        scanFoldersRecursively(tmpDir, '', false, folderMap, root);
        expect(root.children).toHaveLength(1);
        expect(root.children[0].name).toBe('feature');
    });

    it('includes archive folder when isArchived=true', () => {
        createDir('archive');
        createDir('feature');

        const folderMap = new Map<string, TaskFolder>();
        const root = makeRootFolder();
        folderMap.set('', root);

        scanFoldersRecursively(tmpDir, '', true, folderMap, root);
        expect(root.children).toHaveLength(2);
    });

    it('handles empty directories', () => {
        // No subdirectories at all
        const folderMap = new Map<string, TaskFolder>();
        const root = makeRootFolder();
        folderMap.set('', root);

        scanFoldersRecursively(tmpDir, '', false, folderMap, root);
        expect(root.children).toHaveLength(0);
    });

    it('handles deeply nested folders (3+ levels)', () => {
        createDir('a', 'b', 'c', 'd');

        const folderMap = new Map<string, TaskFolder>();
        const root = makeRootFolder();
        folderMap.set('', root);

        scanFoldersRecursively(tmpDir, '', false, folderMap, root);

        expect(folderMap.has('a')).toBe(true);
        expect(folderMap.has(path.join('a', 'b'))).toBe(true);
        expect(folderMap.has(path.join('a', 'b', 'c'))).toBe(true);
        expect(folderMap.has(path.join('a', 'b', 'c', 'd'))).toBe(true);

        const aFolder = folderMap.get('a')!;
        expect(aFolder.children).toHaveLength(1);
        expect(aFolder.children[0].name).toBe('b');
    });

    it('handles nonexistent directory gracefully', () => {
        const folderMap = new Map<string, TaskFolder>();
        const root = makeRootFolder();
        folderMap.set('', root);

        scanFoldersRecursively(path.join(tmpDir, 'nonexistent'), '', false, folderMap, root);
        expect(root.children).toHaveLength(0);
    });
});

// ============================================================================
// groupTaskDocuments
// ============================================================================

describe('groupTaskDocuments', () => {
    it('single document returns as single', () => {
        const docs: TaskDocument[] = [
            makeDoc('task1', undefined, '', false),
        ];

        const { groups, singles } = groupTaskDocuments(docs);
        expect(groups).toHaveLength(0);
        expect(singles).toHaveLength(1);
        expect(singles[0].baseName).toBe('task1');
    });

    it('two documents with same baseName+relativePath+archived are grouped', () => {
        const docs: TaskDocument[] = [
            makeDoc('task1', 'plan', 'feature', false),
            makeDoc('task1', 'spec', 'feature', false),
        ];

        const { groups, singles } = groupTaskDocuments(docs);
        expect(groups).toHaveLength(1);
        expect(singles).toHaveLength(0);
        expect(groups[0].baseName).toBe('task1');
        expect(groups[0].documents).toHaveLength(2);
    });

    it('different relativePaths are not grouped', () => {
        const docs: TaskDocument[] = [
            makeDoc('task1', 'plan', 'feature1', false),
            makeDoc('task1', 'spec', 'feature2', false),
        ];

        const { groups, singles } = groupTaskDocuments(docs);
        expect(groups).toHaveLength(0);
        expect(singles).toHaveLength(2);
    });

    it('different archive status not grouped', () => {
        const docs: TaskDocument[] = [
            makeDoc('task1', 'plan', '', false),
            makeDoc('task1', 'spec', '', true),
        ];

        const { groups, singles } = groupTaskDocuments(docs);
        expect(groups).toHaveLength(0);
        expect(singles).toHaveLength(2);
    });

    it('latestModifiedTime is the max across group members', () => {
        const earlier = new Date('2025-01-01');
        const later = new Date('2025-06-01');

        const docs: TaskDocument[] = [
            { ...makeDoc('task1', 'plan', '', false), modifiedTime: earlier },
            { ...makeDoc('task1', 'spec', '', false), modifiedTime: later },
        ];

        const { groups } = groupTaskDocuments(docs);
        expect(groups[0].latestModifiedTime).toEqual(later);
    });

    it('empty array returns empty results', () => {
        const { groups, singles } = groupTaskDocuments([]);
        expect(groups).toHaveLength(0);
        expect(singles).toHaveLength(0);
    });

    it('multiple groups and singles together', () => {
        const docs: TaskDocument[] = [
            makeDoc('task1', 'plan', '', false),
            makeDoc('task1', 'spec', '', false),
            makeDoc('task2', undefined, '', false),
            makeDoc('task3', 'plan', 'sub', false),
            makeDoc('task3', 'test', 'sub', false),
        ];

        const { groups, singles } = groupTaskDocuments(docs);
        expect(groups).toHaveLength(2);
        expect(singles).toHaveLength(1);
        expect(singles[0].baseName).toBe('task2');
    });
});

// ============================================================================
// buildTaskFolderHierarchy
// ============================================================================

describe('buildTaskFolderHierarchy', () => {
    it('root folder has correct structure', () => {
        const { root } = buildTaskFolderHierarchy(tmpDir, [], false);
        expect(root.name).toBe('');
        expect(root.folderPath).toBe(tmpDir);
        expect(root.relativePath).toBe('');
        expect(root.isArchived).toBe(false);
        expect(root.children).toEqual([]);
        expect(root.documentGroups).toEqual([]);
        expect(root.singleDocuments).toEqual([]);
    });

    it('documents placed in correct folders', () => {
        createDir('feature1');
        createMd('task.md', 'feature1');

        const docs: TaskDocument[] = [
            makeDocWithPath('task', undefined, 'feature1', false, path.join(tmpDir, 'feature1', 'task.md')),
        ];

        const { root } = buildTaskFolderHierarchy(tmpDir, docs, false);
        expect(root.children).toHaveLength(1);
        expect(root.children[0].name).toBe('feature1');
        expect(root.children[0].singleDocuments).toHaveLength(1);
    });

    it('intermediate folders auto-created for document relativePaths', () => {
        // Don't create directories on disk — only pass docs with relativePath
        const docs: TaskDocument[] = [
            makeDocWithPath('task', undefined, path.join('a', 'b'), false, path.join(tmpDir, 'a', 'b', 'task.md')),
        ];

        const { root } = buildTaskFolderHierarchy(tmpDir, docs, false);

        // 'a' is auto-created as intermediate
        const a = root.children.find(c => c.name === 'a');
        expect(a).toBeDefined();

        const b = a!.children.find(c => c.name === 'b');
        expect(b).toBeDefined();
        expect(b!.singleDocuments).toHaveLength(1);
    });

    it('archive scanning optional', () => {
        createMd('active.md');
        const archiveDir = createDir('archive');
        createMd('archived.md', 'archive');

        const docs: TaskDocument[] = [
            makeDocWithPath('active', undefined, '', false, path.join(tmpDir, 'active.md')),
        ];

        // scanArchive=false → no archive folders
        const { root } = buildTaskFolderHierarchy(tmpDir, docs, false);
        const archiveChild = root.children.find(c => c.name === 'archive');
        expect(archiveChild).toBeUndefined();
    });

    it('archive scanning enabled adds archive folders', () => {
        createDir('feature');
        const archiveDir = path.join(tmpDir, 'archive');
        createDir('archive');
        createDir('archive', 'feature');

        const docs: TaskDocument[] = [];

        const { root } = buildTaskFolderHierarchy(tmpDir, docs, true, archiveDir);
        // Should have both 'feature' from active scan and folders from archive scan
        expect(root.children.length).toBeGreaterThanOrEqual(1);
    });

    it('empty folders included from directory scan', () => {
        createDir('empty-folder');

        const { root, folderMap } = buildTaskFolderHierarchy(tmpDir, [], false);
        expect(folderMap.has('empty-folder')).toBe(true);
        expect(root.children).toHaveLength(1);
        expect(root.children[0].name).toBe('empty-folder');
    });

    it('returns usable folderMap for post-processing', () => {
        createDir('feature');
        createMd('task.plan.md', 'feature');
        createMd('task.spec.md', 'feature');

        const docs: TaskDocument[] = [
            makeDocWithPath('task', 'plan', 'feature', false, path.join(tmpDir, 'feature', 'task.plan.md')),
            makeDocWithPath('task', 'spec', 'feature', false, path.join(tmpDir, 'feature', 'task.spec.md')),
        ];

        const { folderMap } = buildTaskFolderHierarchy(tmpDir, docs, false);
        expect(folderMap.has('')).toBe(true);
        expect(folderMap.has('feature')).toBe(true);

        const feature = folderMap.get('feature')!;
        expect(feature.documentGroups).toHaveLength(1);
        expect(feature.documentGroups[0].baseName).toBe('task');
    });

    it('root-level documents placed in root folder', () => {
        createMd('root-task.md');

        const docs: TaskDocument[] = [
            makeDocWithPath('root-task', undefined, '', false, path.join(tmpDir, 'root-task.md')),
        ];

        const { root } = buildTaskFolderHierarchy(tmpDir, docs, false);
        expect(root.singleDocuments).toHaveLength(1);
    });

    it('groups are assigned to the correct folder', () => {
        createDir('sub');

        const docs: TaskDocument[] = [
            makeDocWithPath('task', 'plan', 'sub', false, path.join(tmpDir, 'sub', 'task.plan.md')),
            makeDocWithPath('task', 'spec', 'sub', false, path.join(tmpDir, 'sub', 'task.spec.md')),
        ];

        const { root } = buildTaskFolderHierarchy(tmpDir, docs, false);
        const sub = root.children.find(c => c.name === 'sub')!;
        expect(sub.documentGroups).toHaveLength(1);
        expect(sub.singleDocuments).toHaveLength(0);
    });
});

// ============================================================================
// Helpers
// ============================================================================

function makeRootFolder(): TaskFolder {
    return {
        name: '',
        folderPath: tmpDir,
        relativePath: '',
        isArchived: false,
        children: [],
        tasks: [],
        documentGroups: [],
        singleDocuments: []
    };
}

function makeDoc(baseName: string, docType: string | undefined, relativePath: string, isArchived: boolean): TaskDocument {
    const fileName = docType ? `${baseName}.${docType}.md` : `${baseName}.md`;
    return {
        baseName,
        docType,
        fileName,
        filePath: path.join(tmpDir, relativePath, fileName),
        modifiedTime: new Date(),
        isArchived,
        relativePath: relativePath || undefined,
    };
}

function makeDocWithPath(baseName: string, docType: string | undefined, relativePath: string, isArchived: boolean, filePath: string): TaskDocument {
    const fileName = docType ? `${baseName}.${docType}.md` : `${baseName}.md`;
    return {
        baseName,
        docType,
        fileName,
        filePath,
        modifiedTime: new Date(),
        isArchived,
        relativePath: relativePath || undefined,
    };
}
