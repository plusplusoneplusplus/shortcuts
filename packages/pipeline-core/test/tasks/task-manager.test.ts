/**
 * Tests for TaskManager facade.
 * Exercises the full public API against a temporary directory tree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskManager, TaskManagerOptions } from '../../src/tasks/task-manager';
import { TasksViewerSettings } from '../../src/tasks/types';

// ============================================================================
// Helpers
// ============================================================================

let tmpDir: string;

function defaultSettings(overrides: Partial<TasksViewerSettings> = {}): TasksViewerSettings {
    return {
        enabled: true,
        folderPath: '.tasks',
        showArchived: false,
        showFuture: true,
        sortBy: 'name',
        groupRelatedDocuments: true,
        discovery: {
            enabled: false,
            defaultScope: {
                includeSourceFiles: true,
                includeDocs: true,
                includeConfigFiles: true,
                includeGitHistory: false,
                maxCommits: 50,
            },
            showRelatedInTree: false,
            groupByCategory: false,
        },
        ...overrides,
    };
}

function createManager(settingOverrides: Partial<TasksViewerSettings> = {}, onRefresh?: () => void): TaskManager {
    const opts: TaskManagerOptions = {
        workspaceRoot: tmpDir,
        settings: defaultSettings(settingOverrides),
        onRefresh,
    };
    return new TaskManager(opts);
}

/** Write a markdown file with optional frontmatter status. */
function writeTask(relativePath: string, content?: string, status?: string): string {
    const absPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    let body = content ?? `# ${path.basename(relativePath, '.md')}\n`;
    if (status) {
        body = `---\nstatus: ${status}\n---\n\n${body}`;
    }
    fs.writeFileSync(absPath, body, 'utf-8');
    return absPath;
}

beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'task-mgr-test-'));
});

afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Constructor & path helpers
// ============================================================================

describe('Constructor & path helpers', () => {
    it('resolves relative folderPath against workspaceRoot', () => {
        const mgr = createManager({ folderPath: '.tasks' });
        expect(mgr.getTasksFolder()).toBe(path.join(tmpDir, '.tasks'));
    });

    it('uses absolute folderPath as-is', () => {
        const absPath = path.join(tmpDir, 'abs-tasks');
        const mgr = createManager({ folderPath: absPath });
        expect(mgr.getTasksFolder()).toBe(absPath);
    });

    it('defaults folderPath to .vscode/tasks when empty', () => {
        const mgr = createManager({ folderPath: '' });
        expect(mgr.getTasksFolder()).toBe(path.join(tmpDir, '.vscode/tasks'));
    });

    it('returns archive subfolder', () => {
        const mgr = createManager({ folderPath: '.tasks' });
        expect(mgr.getArchiveFolder()).toBe(path.join(tmpDir, '.tasks', 'archive'));
    });

    it('returns workspaceRoot', () => {
        const mgr = createManager();
        expect(mgr.getWorkspaceRoot()).toBe(tmpDir);
    });
});

// ============================================================================
// ensureFoldersExist
// ============================================================================

describe('ensureFoldersExist', () => {
    it('creates tasks and archive directories', () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        expect(fs.existsSync(mgr.getTasksFolder())).toBe(true);
        expect(fs.existsSync(mgr.getArchiveFolder())).toBe(true);
    });
});

// ============================================================================
// getTasks
// ============================================================================

describe('getTasks', () => {
    it('returns tasks from root and nested folders', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        writeTask('.tasks/root.md');
        writeTask('.tasks/feature/nested.md');

        const tasks = await mgr.getTasks();
        const names = tasks.map(t => t.name).sort();
        expect(names).toEqual(['nested', 'root']);
    });

    it('excludes archive when showArchived is false', async () => {
        const mgr = createManager({ showArchived: false });
        mgr.ensureFoldersExist();
        writeTask('.tasks/active.md');
        writeTask('.tasks/archive/old.md');

        const tasks = await mgr.getTasks();
        expect(tasks).toHaveLength(1);
        expect(tasks[0].name).toBe('active');
    });

    it('includes archive when showArchived is true', async () => {
        const mgr = createManager({ showArchived: true });
        mgr.ensureFoldersExist();
        writeTask('.tasks/active.md');
        writeTask('.tasks/archive/old.md');

        const tasks = await mgr.getTasks();
        expect(tasks).toHaveLength(2);
    });
});

// ============================================================================
// getTaskDocuments
// ============================================================================

describe('getTaskDocuments', () => {
    it('returns documents with baseName and docType parsed', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        writeTask('.tasks/task1.plan.md');
        writeTask('.tasks/task1.spec.md');
        writeTask('.tasks/simple.md');

        const docs = await mgr.getTaskDocuments();
        expect(docs).toHaveLength(3);

        const planDoc = docs.find(d => d.fileName === 'task1.plan.md');
        expect(planDoc).toBeDefined();
        expect(planDoc!.baseName).toBe('task1');
        expect(planDoc!.docType).toBe('plan');

        const simpleDoc = docs.find(d => d.fileName === 'simple.md');
        expect(simpleDoc!.docType).toBeUndefined();
    });
});

// ============================================================================
// getTaskDocumentGroups
// ============================================================================

describe('getTaskDocumentGroups', () => {
    it('groups multi-doc tasks and separates singles', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        writeTask('.tasks/task1.plan.md');
        writeTask('.tasks/task1.spec.md');
        writeTask('.tasks/standalone.md');

        const { groups, singles } = await mgr.getTaskDocumentGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].baseName).toBe('task1');
        expect(groups[0].documents).toHaveLength(2);
        expect(singles).toHaveLength(1);
        expect(singles[0].baseName).toBe('standalone');
    });
});

// ============================================================================
// getTaskFolderHierarchy
// ============================================================================

describe('getTaskFolderHierarchy', () => {
    it('builds correct tree with children, groups, and singles', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        writeTask('.tasks/root.md');
        writeTask('.tasks/feature/task1.plan.md');
        writeTask('.tasks/feature/task1.spec.md');
        writeTask('.tasks/feature/solo.md');

        const root = await mgr.getTaskFolderHierarchy();
        expect(root.singleDocuments).toHaveLength(1);
        expect(root.singleDocuments[0].baseName).toBe('root');

        const feature = root.children.find(c => c.name === 'feature');
        expect(feature).toBeDefined();
        expect(feature!.documentGroups).toHaveLength(1);
        expect(feature!.documentGroups[0].baseName).toBe('task1');
        expect(feature!.singleDocuments).toHaveLength(1);
    });

    it('loads related items when discovery is enabled', async () => {
        const mgr = createManager({
            discovery: {
                enabled: true,
                defaultScope: { includeSourceFiles: true, includeDocs: true, includeConfigFiles: true, includeGitHistory: false, maxCommits: 50 },
                showRelatedInTree: true,
                groupByCategory: false,
            },
        });
        mgr.ensureFoldersExist();
        writeTask('.tasks/feat/task.md');
        // Write a related.yaml
        const relatedPath = path.join(tmpDir, '.tasks', 'feat', 'related.yaml');
        fs.writeFileSync(relatedPath, 'description: test feature\nitems:\n  - name: src/a.ts\n    path: src/a.ts\n    type: file\n    category: source\n    relevance: 90\n    reason: main\n', 'utf-8');

        const root = await mgr.getTaskFolderHierarchy();
        const feat = root.children.find(c => c.name === 'feat');
        expect(feat).toBeDefined();
        expect(feat!.relatedItems).toBeDefined();
        expect(feat!.relatedItems!.items).toHaveLength(1);
    });
});

// ============================================================================
// createTask / createFeature / createSubfolder
// ============================================================================

describe('createTask', () => {
    it('creates a markdown file', async () => {
        const mgr = createManager();
        const filePath = await mgr.createTask('My Task');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('# My Task');
    });

    it('throws on duplicate', async () => {
        const mgr = createManager();
        await mgr.createTask('Dup');
        await expect(mgr.createTask('Dup')).rejects.toThrow(/already exists/);
    });
});

describe('createFeature', () => {
    it('creates folder with placeholder', async () => {
        const mgr = createManager();
        const folderPath = await mgr.createFeature('New Feature');
        expect(fs.existsSync(folderPath)).toBe(true);
        expect(fs.existsSync(path.join(folderPath, 'placeholder.md'))).toBe(true);
    });
});

describe('createSubfolder', () => {
    it('creates nested folder with placeholder', async () => {
        const mgr = createManager();
        const featurePath = await mgr.createFeature('Parent');
        const subPath = await mgr.createSubfolder(featurePath, 'Child');
        expect(fs.existsSync(subPath)).toBe(true);
        expect(fs.existsSync(path.join(subPath, 'placeholder.md'))).toBe(true);
    });
});

// ============================================================================
// Rename operations
// ============================================================================

describe('renameTask', () => {
    it('renames a task file', async () => {
        const mgr = createManager();
        const oldPath = await mgr.createTask('Old Name');
        const newPath = await mgr.renameTask(oldPath, 'New Name');
        expect(fs.existsSync(newPath)).toBe(true);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(path.basename(newPath)).toBe('New-Name.md');
    });

    it('throws on collision', async () => {
        const mgr = createManager();
        const p1 = await mgr.createTask('A');
        await mgr.createTask('B');
        await expect(mgr.renameTask(p1, 'B')).rejects.toThrow(/already exists/);
    });
});

describe('renameFolder', () => {
    it('renames a folder', async () => {
        const mgr = createManager();
        const oldPath = await mgr.createFeature('OldFolder');
        const newPath = await mgr.renameFolder(oldPath, 'NewFolder');
        expect(fs.existsSync(newPath)).toBe(true);
        expect(fs.existsSync(oldPath)).toBe(false);
    });
});

describe('renameDocumentGroup', () => {
    it('renames all documents in a group', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const folder = mgr.getTasksFolder();
        writeTask('.tasks/mygrp.plan.md');
        writeTask('.tasks/mygrp.spec.md');

        const newPaths = await mgr.renameDocumentGroup(folder, 'mygrp', 'renamed');
        expect(newPaths).toHaveLength(2);
        for (const p of newPaths) {
            expect(fs.existsSync(p)).toBe(true);
            expect(path.basename(p)).toMatch(/^renamed\./);
        }
    });
});

describe('renameDocument', () => {
    it('renames a single document preserving docType', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const filePath = writeTask('.tasks/doc.plan.md');

        const newPath = await mgr.renameDocument(filePath, 'newdoc');
        expect(path.basename(newPath)).toBe('newdoc.plan.md');
        expect(fs.existsSync(newPath)).toBe(true);
    });
});

// ============================================================================
// Delete operations
// ============================================================================

describe('deleteTask', () => {
    it('deletes a task file', async () => {
        const mgr = createManager();
        const filePath = await mgr.createTask('Deletable');
        await mgr.deleteTask(filePath);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('throws if not found', async () => {
        const mgr = createManager();
        await expect(mgr.deleteTask('/nonexistent.md')).rejects.toThrow(/not found/);
    });
});

describe('deleteFolder', () => {
    it('deletes a folder recursively', async () => {
        const mgr = createManager();
        const folderPath = await mgr.createFeature('Removable');
        await mgr.deleteFolder(folderPath);
        expect(fs.existsSync(folderPath)).toBe(false);
    });
});

// ============================================================================
// Archive / Unarchive
// ============================================================================

describe('archiveTask / unarchiveTask', () => {
    it('moves file to archive and back', async () => {
        const mgr = createManager();
        const filePath = await mgr.createTask('ToArchive');
        const archived = await mgr.archiveTask(filePath);
        expect(archived).toContain('archive');
        expect(fs.existsSync(archived)).toBe(true);

        const restored = await mgr.unarchiveTask(archived);
        expect(fs.existsSync(restored)).toBe(true);
        expect(restored).not.toContain('archive');
    });

    it('handles collision with timestamp suffix', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const filePath = await mgr.createTask('Dup');
        // Place a file in archive with same name
        writeTask('.tasks/archive/Dup.md');

        const archived = await mgr.archiveTask(filePath);
        expect(fs.existsSync(archived)).toBe(true);
        // Should have a different name due to collision
        expect(path.basename(archived)).not.toBe('Dup.md');
    });

    it('preserveStructure puts file in sub-path', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const filePath = writeTask('.tasks/feature/deep.md');

        const archived = await mgr.archiveTask(filePath, true);
        expect(archived).toContain(path.join('archive', 'feature'));
    });
});

describe('archiveDocument / unarchiveDocument', () => {
    it('delegates to archiveTask / unarchiveTask', async () => {
        const mgr = createManager();
        const filePath = await mgr.createTask('DocArchive');
        const archived = await mgr.archiveDocument(filePath);
        expect(fs.existsSync(archived)).toBe(true);
        const restored = await mgr.unarchiveDocument(archived);
        expect(fs.existsSync(restored)).toBe(true);
    });
});

describe('archiveDocumentGroup / unarchiveDocumentGroup', () => {
    it('archives and unarchives a group of files', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const p1 = writeTask('.tasks/grp.plan.md');
        const p2 = writeTask('.tasks/grp.spec.md');

        const archivedPaths = await mgr.archiveDocumentGroup([p1, p2]);
        expect(archivedPaths).toHaveLength(2);
        for (const p of archivedPaths) {
            expect(fs.existsSync(p)).toBe(true);
        }

        const restoredPaths = await mgr.unarchiveDocumentGroup(archivedPaths);
        expect(restoredPaths).toHaveLength(2);
        for (const p of restoredPaths) {
            expect(fs.existsSync(p)).toBe(true);
        }
    });
});

// ============================================================================
// Move operations
// ============================================================================

describe('moveTask', () => {
    it('moves a file to a target folder', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const filePath = writeTask('.tasks/moveme.md');
        const targetFolder = path.join(mgr.getTasksFolder(), 'dest');
        fs.mkdirSync(targetFolder, { recursive: true });

        const newPath = await mgr.moveTask(filePath, targetFolder);
        expect(fs.existsSync(newPath)).toBe(true);
        expect(newPath).toContain('dest');
    });
});

describe('moveFolder', () => {
    it('moves folder into target parent', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const srcFolder = path.join(mgr.getTasksFolder(), 'src-folder');
        const destFolder = path.join(mgr.getTasksFolder(), 'dest-folder');
        fs.mkdirSync(srcFolder, { recursive: true });
        fs.mkdirSync(destFolder, { recursive: true });
        writeTask('.tasks/src-folder/file.md');

        const newPath = await mgr.moveFolder(srcFolder, destFolder);
        expect(fs.existsSync(newPath)).toBe(true);
        expect(newPath).toContain('dest-folder');
    });

    it('prevents circular move', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const parentFolder = path.join(mgr.getTasksFolder(), 'parent');
        const childFolder = path.join(parentFolder, 'child');
        fs.mkdirSync(childFolder, { recursive: true });

        await expect(mgr.moveFolder(parentFolder, childFolder)).rejects.toThrow(/Cannot move/);
    });
});

describe('moveTaskGroup', () => {
    it('moves multiple files', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const p1 = writeTask('.tasks/g.plan.md');
        const p2 = writeTask('.tasks/g.spec.md');
        const target = path.join(mgr.getTasksFolder(), 'target');
        fs.mkdirSync(target, { recursive: true });

        const newPaths = await mgr.moveTaskGroup([p1, p2], target);
        expect(newPaths).toHaveLength(2);
        for (const p of newPaths) {
            expect(fs.existsSync(p)).toBe(true);
            expect(p).toContain('target');
        }
    });
});

// ============================================================================
// Import / External
// ============================================================================

describe('importTask', () => {
    it('copies file into tasks folder', async () => {
        const mgr = createManager();
        const externalFile = path.join(tmpDir, 'external.md');
        fs.writeFileSync(externalFile, '# External\n', 'utf-8');

        const imported = await mgr.importTask(externalFile);
        expect(fs.existsSync(imported)).toBe(true);
        // Original still exists (copy semantics)
        expect(fs.existsSync(externalFile)).toBe(true);
    });

    it('uses custom name', async () => {
        const mgr = createManager();
        const externalFile = path.join(tmpDir, 'ext.md');
        fs.writeFileSync(externalFile, '# Ext\n', 'utf-8');

        const imported = await mgr.importTask(externalFile, 'Custom');
        expect(path.basename(imported)).toBe('Custom.md');
    });
});

describe('moveExternalTask', () => {
    it('moves file into tasks folder', async () => {
        const mgr = createManager();
        const externalFile = path.join(tmpDir, 'to-move.md');
        fs.writeFileSync(externalFile, '# Move\n', 'utf-8');

        const moved = await mgr.moveExternalTask(externalFile);
        expect(fs.existsSync(moved)).toBe(true);
        // Original is removed (move semantics)
        expect(fs.existsSync(externalFile)).toBe(false);
    });

    it('rejects non-.md files', async () => {
        const mgr = createManager();
        const txtFile = path.join(tmpDir, 'data.txt');
        fs.writeFileSync(txtFile, 'data', 'utf-8');

        await expect(mgr.moveExternalTask(txtFile)).rejects.toThrow(/markdown/i);
    });
});

// ============================================================================
// Query helpers
// ============================================================================

describe('taskExists / taskExistsInFolder', () => {
    it('returns true for existing task', async () => {
        const mgr = createManager();
        await mgr.createTask('Present');
        expect(mgr.taskExists('Present')).toBe(true);
        expect(mgr.taskExists('Missing')).toBe(false);
    });

    it('checks specific folder', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const featurePath = await mgr.createFeature('feat');
        writeTask('.tasks/feat/InFeat.md');

        expect(mgr.taskExistsInFolder('InFeat', featurePath)).toBe(true);
        expect(mgr.taskExistsInFolder('InFeat')).toBe(false);
    });
});

// ============================================================================
// Filename utilities
// ============================================================================

describe('sanitizeFileName', () => {
    it('replaces invalid characters', () => {
        const mgr = createManager();
        expect(mgr.sanitizeFileName('my:file/name')).toBe('my-file-name');
    });

    it('collapses whitespace to hyphens', () => {
        const mgr = createManager();
        expect(mgr.sanitizeFileName('a   b')).toBe('a-b');
    });
});

describe('parseFileName', () => {
    it('splits task.plan.md correctly', () => {
        const mgr = createManager();
        expect(mgr.parseFileName('task.plan.md')).toEqual({ baseName: 'task', docType: 'plan' });
    });

    it('handles simple filename', () => {
        const mgr = createManager();
        expect(mgr.parseFileName('simple.md')).toEqual({ baseName: 'simple', docType: undefined });
    });
});

// ============================================================================
// updateTaskStatus
// ============================================================================

describe('updateTaskStatus', () => {
    it('creates frontmatter if missing', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const filePath = writeTask('.tasks/nostatus.md', '# No Status\n');

        await mgr.updateTaskStatus(filePath, 'in-progress');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('status: in-progress');
    });

    it('updates existing frontmatter', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const filePath = writeTask('.tasks/withstatus.md', '# Body\n', 'pending');

        await mgr.updateTaskStatus(filePath, 'done');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('status: done');
        expect(content).not.toContain('status: pending');
    });
});

// ============================================================================
// addRelatedItems
// ============================================================================

describe('addRelatedItems', () => {
    it('merges items and deduplicates', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        const featureFolder = path.join(mgr.getTasksFolder(), 'myfeat');
        fs.mkdirSync(featureFolder, { recursive: true });

        await mgr.addRelatedItems(featureFolder, [
            { name: 'a.ts', path: 'src/a.ts', type: 'file', category: 'source', relevance: 80, reason: 'test' },
        ], 'My feature');

        // Add same item again — should not duplicate
        await mgr.addRelatedItems(featureFolder, [
            { name: 'a.ts', path: 'src/a.ts', type: 'file', category: 'source', relevance: 80, reason: 'test' },
            { name: 'b.ts', path: 'src/b.ts', type: 'file', category: 'source', relevance: 70, reason: 'helper' },
        ]);

        const content = fs.readFileSync(path.join(featureFolder, 'related.yaml'), 'utf-8');
        // Should have 2 items total (a.ts deduped, b.ts added)
        expect((content.match(/- name:/g) || []).length).toBe(2);
    });
});

// ============================================================================
// getFeatureFolders
// ============================================================================

describe('getFeatureFolders', () => {
    it('returns flat list excluding archive', async () => {
        const mgr = createManager();
        mgr.ensureFoldersExist();
        fs.mkdirSync(path.join(mgr.getTasksFolder(), 'feature-a'), { recursive: true });
        fs.mkdirSync(path.join(mgr.getTasksFolder(), 'feature-b', 'nested'), { recursive: true });

        const folders = await mgr.getFeatureFolders();
        const names = folders.map(f => f.displayName).sort();

        expect(names).toContain('feature-a');
        expect(names).toContain('feature-b');
        expect(names).toContain('feature-b/nested');
        // Archive should be excluded
        expect(names).not.toContain('archive');
    });
});

// ============================================================================
// dispose
// ============================================================================

describe('dispose', () => {
    it('does not throw', () => {
        const mgr = createManager();
        expect(() => mgr.dispose()).not.toThrow();
    });

    it('can be called multiple times', () => {
        const mgr = createManager();
        mgr.dispose();
        expect(() => mgr.dispose()).not.toThrow();
    });
});

// ============================================================================
// Cross-platform path handling
// ============================================================================

describe('Cross-platform', () => {
    it('handles forward-slash folderPath on all platforms', () => {
        const mgr = createManager({ folderPath: '.vscode/tasks' });
        const result = mgr.getTasksFolder();
        // path.join normalizes for the OS
        expect(result).toBe(path.join(tmpDir, '.vscode', 'tasks'));
    });
});
