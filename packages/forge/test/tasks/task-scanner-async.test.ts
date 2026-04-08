/**
 * Tests for async task scanner functions.
 * Verifies that async variants produce identical results to sync counterparts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    scanTasksRecursively,
    scanDocumentsRecursively,
    scanFoldersRecursively,
    scanContextDocumentsInFolder,
    buildTaskFolderHierarchy,
    groupTaskDocuments,
    scanTasksRecursivelyAsync,
    scanDocumentsRecursivelyAsync,
    scanFoldersRecursivelyAsync,
    scanContextDocumentsInFolderAsync,
    buildTaskFolderHierarchyAsync,
} from '../../src/tasks/task-scanner';
import type { TaskFolder } from '../../src/tasks/types';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'task-scanner-async-'));
});

afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function createFile(relPath: string, content = ''): void {
    const fullPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content || `# ${path.basename(relPath, '.md')}\n`);
}

function stripAbsolutePaths(obj: unknown): unknown {
    return JSON.parse(
        JSON.stringify(obj, (key, value) => {
            if ((key === 'filePath' || key === 'folderPath') && typeof value === 'string') {
                return value.split(path.basename(tmpDir)).pop();
            }
            return value;
        })
    );
}

// ============================================================================
// scanTasksRecursivelyAsync
// ============================================================================

describe('scanTasksRecursivelyAsync', () => {
    it('returns same results as sync version for flat directory', async () => {
        createFile('task-a.md');
        createFile('task-b.md');

        const sync = scanTasksRecursively(tmpDir, '', false);
        const async_ = await scanTasksRecursivelyAsync(tmpDir, '', false);

        expect(stripAbsolutePaths(async_)).toEqual(stripAbsolutePaths(sync));
    });

    it('returns same results as sync version for nested directory', async () => {
        createFile('task-a.md');
        createFile('sub/task-b.md');
        createFile('sub/deep/task-c.md');

        const sync = scanTasksRecursively(tmpDir, '', false);
        const async_ = await scanTasksRecursivelyAsync(tmpDir, '', false);

        expect(stripAbsolutePaths(async_)).toEqual(stripAbsolutePaths(sync));
    });

    it('skips archive folder when isArchived is false', async () => {
        createFile('task.md');
        createFile('archive/archived.md');

        const tasks = await scanTasksRecursivelyAsync(tmpDir, '', false);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].name).toBe('task');
    });

    it('includes archive folder when isArchived is true', async () => {
        createFile('task.md');

        const archiveDir = path.join(tmpDir, 'archive');
        createFile('archive/archived.md');

        const tasks = await scanTasksRecursivelyAsync(archiveDir, '', true);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].isArchived).toBe(true);
    });

    it('returns empty array for nonexistent directory', async () => {
        const tasks = await scanTasksRecursivelyAsync(path.join(tmpDir, 'nope'), '', false);
        expect(tasks).toEqual([]);
    });

    it('excludes context files', async () => {
        createFile('task.md');
        createFile('README.md');
        createFile('CONTEXT.md');

        const tasks = await scanTasksRecursivelyAsync(tmpDir, '', false);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].name).toBe('task');
    });
});

// ============================================================================
// scanDocumentsRecursivelyAsync
// ============================================================================

describe('scanDocumentsRecursivelyAsync', () => {
    it('returns same results as sync version', async () => {
        createFile('feature.md');
        createFile('feature-plan.md');
        createFile('sub/task.md');

        const sync = scanDocumentsRecursively(tmpDir, '', false);
        const async_ = await scanDocumentsRecursivelyAsync(tmpDir, '', false);

        expect(stripAbsolutePaths(async_)).toEqual(stripAbsolutePaths(sync));
    });

    it('parses baseName and docType correctly', async () => {
        createFile('my-feature.plan.md');

        const docs = await scanDocumentsRecursivelyAsync(tmpDir, '', false);
        expect(docs).toHaveLength(1);
        expect(docs[0].baseName).toBe('my-feature');
        expect(docs[0].docType).toBe('plan');
    });

    it('returns empty for nonexistent directory', async () => {
        const docs = await scanDocumentsRecursivelyAsync(path.join(tmpDir, 'x'), '', false);
        expect(docs).toEqual([]);
    });
});

// ============================================================================
// scanFoldersRecursivelyAsync
// ============================================================================

describe('scanFoldersRecursivelyAsync', () => {
    it('returns same folder structure as sync version', async () => {
        createFile('task.md');
        createFile('sub/task.md');
        createFile('sub/deep/task.md');

        const syncRoot: TaskFolder = { name: '', folderPath: tmpDir, relativePath: '', isArchived: false, children: [], tasks: [], documentGroups: [], singleDocuments: [] };
        const syncMap = new Map<string, TaskFolder>();
        syncMap.set('', syncRoot);
        scanFoldersRecursively(tmpDir, '', false, syncMap, syncRoot);

        const asyncRoot: TaskFolder = { name: '', folderPath: tmpDir, relativePath: '', isArchived: false, children: [], tasks: [], documentGroups: [], singleDocuments: [] };
        const asyncMap = new Map<string, TaskFolder>();
        asyncMap.set('', asyncRoot);
        await scanFoldersRecursivelyAsync(tmpDir, '', false, asyncMap, asyncRoot);

        expect([...asyncMap.keys()].sort()).toEqual([...syncMap.keys()].sort());
    });

    it('skips archive folder when not archived', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'archive'), { recursive: true });

        const root: TaskFolder = { name: '', folderPath: tmpDir, relativePath: '', isArchived: false, children: [], tasks: [], documentGroups: [], singleDocuments: [] };
        const map = new Map<string, TaskFolder>();
        map.set('', root);
        await scanFoldersRecursivelyAsync(tmpDir, '', false, map, root);

        expect(map.has('sub')).toBe(true);
        expect(map.has('archive')).toBe(false);
    });

    it('handles nonexistent directory gracefully', async () => {
        const root: TaskFolder = { name: '', folderPath: tmpDir, relativePath: '', isArchived: false, children: [], tasks: [], documentGroups: [], singleDocuments: [] };
        const map = new Map<string, TaskFolder>();
        await scanFoldersRecursivelyAsync(path.join(tmpDir, 'nope'), '', false, map, root);
        expect(map.size).toBe(0);
    });
});

// ============================================================================
// scanContextDocumentsInFolderAsync
// ============================================================================

describe('scanContextDocumentsInFolderAsync', () => {
    it('returns same results as sync version', async () => {
        createFile('README.md', '# README');
        createFile('CONTEXT.md', '# Context');
        createFile('task.md');

        const sync = scanContextDocumentsInFolder(tmpDir, '', false);
        const async_ = await scanContextDocumentsInFolderAsync(tmpDir, '', false);

        expect(stripAbsolutePaths(async_)).toEqual(stripAbsolutePaths(sync));
    });

    it('finds context files but not task files', async () => {
        createFile('README.md', '# README');
        createFile('task.md');

        const docs = await scanContextDocumentsInFolderAsync(tmpDir, '', false);
        expect(docs).toHaveLength(1);
        expect(docs[0].fileName).toBe('README.md');
    });

    it('returns empty for nonexistent directory', async () => {
        const docs = await scanContextDocumentsInFolderAsync(path.join(tmpDir, 'x'), '', false);
        expect(docs).toEqual([]);
    });
});

// ============================================================================
// buildTaskFolderHierarchyAsync
// ============================================================================

describe('buildTaskFolderHierarchyAsync', () => {
    it('produces same hierarchy as sync version', async () => {
        createFile('task-a.md');
        createFile('task-a-plan.md');
        createFile('sub/task-b.md');
        createFile('README.md', '# README');

        const docs = scanDocumentsRecursively(tmpDir, '', false);
        const sync = buildTaskFolderHierarchy(tmpDir, docs, false);
        const async_ = await buildTaskFolderHierarchyAsync(tmpDir, docs, false);

        expect(stripAbsolutePaths(async_.root)).toEqual(stripAbsolutePaths(sync.root));
        expect([...async_.folderMap.keys()].sort()).toEqual([...sync.folderMap.keys()].sort());
    });

    it('includes archive when scanArchive is true', async () => {
        createFile('task.md');
        createFile('archive/old.md');

        const archivePath = path.join(tmpDir, 'archive');
        const activeDocs = scanDocumentsRecursively(tmpDir, '', false);
        const archivedDocs = scanDocumentsRecursively(archivePath, '', true);
        const allDocs = [...activeDocs, ...archivedDocs];

        const result = await buildTaskFolderHierarchyAsync(tmpDir, allDocs, true, archivePath);
        expect(result.folderMap.has('')).toBe(true);
    });

    it('handles empty directory', async () => {
        const result = await buildTaskFolderHierarchyAsync(tmpDir, [], false);
        expect(result.root.children).toEqual([]);
        expect(result.root.documentGroups).toEqual([]);
        expect(result.root.singleDocuments).toEqual([]);
    });
});
