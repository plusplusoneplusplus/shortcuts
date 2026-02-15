/**
 * Tests for task-operations.ts - Pure Node.js task CRUD operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    createTask,
    createFeature,
    createSubfolder,
    renameTask,
    renameFolder,
    renameDocumentGroup,
    renameDocument,
    deleteTask,
    deleteFolder,
    archiveTask,
    unarchiveTask,
    archiveDocument,
    unarchiveDocument,
    archiveDocumentGroup,
    unarchiveDocumentGroup,
    moveTask,
    moveFolder,
    moveTaskGroup,
    importTask,
    moveExternalTask,
    taskExistsInFolder,
    taskExists,
    sanitizeFileName,
    parseFileName,
} from '../../src/tasks/task-operations';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'task-ops-test-'));
});

afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// createTask
// ============================================================================

describe('createTask', () => {
    it('creates a markdown file with a header', async () => {
        const result = await createTask(tmpDir, 'My Task');
        expect(fs.existsSync(result)).toBe(true);
        expect(path.basename(result)).toBe('My-Task.md');
        const content = fs.readFileSync(result, 'utf-8');
        expect(content).toBe('# My Task\n\n');
    });

    it('throws on duplicate name', async () => {
        await createTask(tmpDir, 'duplicate');
        await expect(createTask(tmpDir, 'duplicate')).rejects.toThrow('already exists');
    });

    it('sanitizes the file name', async () => {
        const result = await createTask(tmpDir, 'My Task: Part 1');
        expect(path.basename(result)).toBe('My-Task-Part-1.md');
    });
});

// ============================================================================
// createFeature
// ============================================================================

describe('createFeature', () => {
    it('creates a directory with a placeholder file', async () => {
        const result = await createFeature(tmpDir, 'feature-one');
        expect(fs.statSync(result).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(result, 'placeholder.md'))).toBe(true);
    });

    it('throws on duplicate name', async () => {
        await createFeature(tmpDir, 'dup');
        await expect(createFeature(tmpDir, 'dup')).rejects.toThrow('already exists');
    });
});

// ============================================================================
// createSubfolder
// ============================================================================

describe('createSubfolder', () => {
    it('creates a subdirectory with a placeholder', async () => {
        const parent = path.join(tmpDir, 'parent');
        fs.mkdirSync(parent);
        const result = await createSubfolder(parent, 'child');
        expect(fs.statSync(result).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(result, 'placeholder.md'))).toBe(true);
    });

    it('throws if parent missing', async () => {
        await expect(createSubfolder(path.join(tmpDir, 'nope'), 'child')).rejects.toThrow('Parent folder not found');
    });

    it('throws on duplicate', async () => {
        const parent = path.join(tmpDir, 'p');
        fs.mkdirSync(parent);
        await createSubfolder(parent, 'c');
        await expect(createSubfolder(parent, 'c')).rejects.toThrow('already exists');
    });
});

// ============================================================================
// renameTask
// ============================================================================

describe('renameTask', () => {
    it('renames a task file', async () => {
        const original = path.join(tmpDir, 'old.md');
        fs.writeFileSync(original, '# Old');
        const result = await renameTask(original, 'new-name');
        expect(path.basename(result)).toBe('new-name.md');
        expect(fs.existsSync(result)).toBe(true);
        expect(fs.existsSync(original)).toBe(false);
    });

    it('throws on missing source', async () => {
        await expect(renameTask(path.join(tmpDir, 'nope.md'), 'x')).rejects.toThrow('not found');
    });

    it('throws on collision', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.md'), '');
        fs.writeFileSync(path.join(tmpDir, 'b.md'), '');
        await expect(renameTask(path.join(tmpDir, 'a.md'), 'b')).rejects.toThrow('already exists');
    });
});

// ============================================================================
// renameFolder
// ============================================================================

describe('renameFolder', () => {
    it('renames a directory', async () => {
        const folder = path.join(tmpDir, 'old-folder');
        fs.mkdirSync(folder);
        const result = await renameFolder(folder, 'new-folder');
        expect(path.basename(result)).toBe('new-folder');
        expect(fs.statSync(result).isDirectory()).toBe(true);
    });

    it('throws on missing folder', async () => {
        await expect(renameFolder(path.join(tmpDir, 'nope'), 'x')).rejects.toThrow('not found');
    });

    it('throws if path is a file, not directory', async () => {
        const file = path.join(tmpDir, 'file.txt');
        fs.writeFileSync(file, '');
        await expect(renameFolder(file, 'x')).rejects.toThrow('not a directory');
    });

    it('throws on collision', async () => {
        fs.mkdirSync(path.join(tmpDir, 'a'));
        fs.mkdirSync(path.join(tmpDir, 'b'));
        await expect(renameFolder(path.join(tmpDir, 'a'), 'b')).rejects.toThrow('already exists');
    });
});

// ============================================================================
// renameDocumentGroup
// ============================================================================

describe('renameDocumentGroup', () => {
    it('renames all files with matching baseName', async () => {
        fs.writeFileSync(path.join(tmpDir, 'task1.plan.md'), '');
        fs.writeFileSync(path.join(tmpDir, 'task1.spec.md'), '');
        fs.writeFileSync(path.join(tmpDir, 'other.md'), '');

        const result = await renameDocumentGroup(tmpDir, 'task1', 'task2');
        expect(result).toHaveLength(2);
        expect(result.map(p => path.basename(p)).sort()).toEqual(['task2.plan.md', 'task2.spec.md']);
        expect(fs.existsSync(path.join(tmpDir, 'other.md'))).toBe(true);
    });

    it('throws when no matching documents found', async () => {
        fs.writeFileSync(path.join(tmpDir, 'unrelated.md'), '');
        await expect(renameDocumentGroup(tmpDir, 'nonexistent', 'new')).rejects.toThrow('No documents found');
    });

    it('throws on collision', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.plan.md'), '');
        fs.writeFileSync(path.join(tmpDir, 'b.plan.md'), '');
        await expect(renameDocumentGroup(tmpDir, 'a', 'b')).rejects.toThrow('already exists');
    });
});

// ============================================================================
// renameDocument
// ============================================================================

describe('renameDocument', () => {
    it('renames preserving docType suffix', async () => {
        const file = path.join(tmpDir, 'task.plan.md');
        fs.writeFileSync(file, '');
        const result = await renameDocument(file, 'new-task');
        expect(path.basename(result)).toBe('new-task.plan.md');
    });

    it('renames file without docType', async () => {
        const file = path.join(tmpDir, 'task.md');
        fs.writeFileSync(file, '');
        const result = await renameDocument(file, 'renamed');
        expect(path.basename(result)).toBe('renamed.md');
    });

    it('throws on collision', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.plan.md'), '');
        fs.writeFileSync(path.join(tmpDir, 'b.plan.md'), '');
        await expect(renameDocument(path.join(tmpDir, 'a.plan.md'), 'b')).rejects.toThrow('already exists');
    });
});

// ============================================================================
// deleteTask
// ============================================================================

describe('deleteTask', () => {
    it('removes a file', async () => {
        const file = path.join(tmpDir, 'to-delete.md');
        fs.writeFileSync(file, '');
        await deleteTask(file);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('throws on missing file', async () => {
        await expect(deleteTask(path.join(tmpDir, 'nope.md'))).rejects.toThrow('not found');
    });
});

// ============================================================================
// deleteFolder
// ============================================================================

describe('deleteFolder', () => {
    it('removes a directory recursively', async () => {
        const folder = path.join(tmpDir, 'to-delete');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, 'child.md'), '');
        await deleteFolder(folder);
        expect(fs.existsSync(folder)).toBe(false);
    });

    it('throws on missing folder', async () => {
        await expect(deleteFolder(path.join(tmpDir, 'nope'))).rejects.toThrow('not found');
    });

    it('throws if path is not a directory', async () => {
        const file = path.join(tmpDir, 'file.txt');
        fs.writeFileSync(file, '');
        await expect(deleteFolder(file)).rejects.toThrow('not a directory');
    });
});

// ============================================================================
// archiveTask
// ============================================================================

describe('archiveTask', () => {
    let tasksFolder: string;
    let archiveFolder: string;

    beforeEach(() => {
        tasksFolder = path.join(tmpDir, 'tasks');
        archiveFolder = path.join(tasksFolder, 'archive');
        fs.mkdirSync(tasksFolder, { recursive: true });
        fs.mkdirSync(archiveFolder, { recursive: true });
    });

    it('moves file to archive folder', async () => {
        const file = path.join(tasksFolder, 'task.md');
        fs.writeFileSync(file, '# Task');
        const result = await archiveTask(file, tasksFolder, archiveFolder);
        expect(result).toBe(path.join(archiveFolder, 'task.md'));
        expect(fs.existsSync(result)).toBe(true);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('handles collision with timestamp suffix', async () => {
        const file = path.join(tasksFolder, 'task.md');
        fs.writeFileSync(file, '# Task');
        fs.writeFileSync(path.join(archiveFolder, 'task.md'), '# Old');
        const result = await archiveTask(file, tasksFolder, archiveFolder);
        expect(result).not.toBe(path.join(archiveFolder, 'task.md'));
        expect(path.basename(result)).toMatch(/^task-\d+\.md$/);
    });

    it('preserves structure when option is true', async () => {
        const featureDir = path.join(tasksFolder, 'feature1');
        fs.mkdirSync(featureDir);
        const file = path.join(featureDir, 'task.md');
        fs.writeFileSync(file, '# Task');

        const result = await archiveTask(file, tasksFolder, archiveFolder, true);
        expect(result).toBe(path.join(archiveFolder, 'feature1', 'task.md'));
    });

    it('throws on missing file', async () => {
        await expect(archiveTask(path.join(tasksFolder, 'nope.md'), tasksFolder, archiveFolder))
            .rejects.toThrow('not found');
    });
});

// ============================================================================
// unarchiveTask
// ============================================================================

describe('unarchiveTask', () => {
    let tasksFolder: string;
    let archiveFolder: string;

    beforeEach(() => {
        tasksFolder = path.join(tmpDir, 'tasks');
        archiveFolder = path.join(tasksFolder, 'archive');
        fs.mkdirSync(tasksFolder, { recursive: true });
        fs.mkdirSync(archiveFolder, { recursive: true });
    });

    it('moves file back to tasks root', async () => {
        const file = path.join(archiveFolder, 'task.md');
        fs.writeFileSync(file, '# Task');
        const result = await unarchiveTask(file, tasksFolder);
        expect(result).toBe(path.join(tasksFolder, 'task.md'));
        expect(fs.existsSync(result)).toBe(true);
    });

    it('handles collision with timestamp suffix', async () => {
        fs.writeFileSync(path.join(tasksFolder, 'task.md'), '# Existing');
        const file = path.join(archiveFolder, 'task.md');
        fs.writeFileSync(file, '# Archived');
        const result = await unarchiveTask(file, tasksFolder);
        expect(path.basename(result)).toMatch(/^task-\d+\.md$/);
    });

    it('throws on missing file', async () => {
        await expect(unarchiveTask(path.join(archiveFolder, 'nope.md'), tasksFolder))
            .rejects.toThrow('not found');
    });
});

// ============================================================================
// archiveDocument / unarchiveDocument
// ============================================================================

describe('archiveDocument / unarchiveDocument', () => {
    let tasksFolder: string;
    let archiveFolder: string;

    beforeEach(() => {
        tasksFolder = path.join(tmpDir, 'tasks');
        archiveFolder = path.join(tasksFolder, 'archive');
        fs.mkdirSync(tasksFolder, { recursive: true });
        fs.mkdirSync(archiveFolder, { recursive: true });
    });

    it('archiveDocument delegates to archiveTask', async () => {
        const file = path.join(tasksFolder, 'doc.md');
        fs.writeFileSync(file, '');
        const result = await archiveDocument(file, tasksFolder, archiveFolder);
        expect(result).toBe(path.join(archiveFolder, 'doc.md'));
    });

    it('unarchiveDocument delegates to unarchiveTask', async () => {
        const file = path.join(archiveFolder, 'doc.md');
        fs.writeFileSync(file, '');
        const result = await unarchiveDocument(file, tasksFolder);
        expect(result).toBe(path.join(tasksFolder, 'doc.md'));
    });
});

// ============================================================================
// archiveDocumentGroup / unarchiveDocumentGroup
// ============================================================================

describe('archiveDocumentGroup / unarchiveDocumentGroup', () => {
    let tasksFolder: string;
    let archiveFolder: string;

    beforeEach(() => {
        tasksFolder = path.join(tmpDir, 'tasks');
        archiveFolder = path.join(tasksFolder, 'archive');
        fs.mkdirSync(tasksFolder, { recursive: true });
        fs.mkdirSync(archiveFolder, { recursive: true });
    });

    it('archives multiple files', async () => {
        const files = ['a.md', 'b.md'].map(n => {
            const p = path.join(tasksFolder, n);
            fs.writeFileSync(p, '');
            return p;
        });
        const results = await archiveDocumentGroup(files, tasksFolder, archiveFolder);
        expect(results).toHaveLength(2);
        results.forEach(r => expect(fs.existsSync(r)).toBe(true));
    });

    it('unarchives multiple files', async () => {
        const files = ['a.md', 'b.md'].map(n => {
            const p = path.join(archiveFolder, n);
            fs.writeFileSync(p, '');
            return p;
        });
        const results = await unarchiveDocumentGroup(files, tasksFolder);
        expect(results).toHaveLength(2);
        results.forEach(r => expect(fs.existsSync(r)).toBe(true));
    });
});

// ============================================================================
// moveTask
// ============================================================================

describe('moveTask', () => {
    it('moves a file to a different folder', async () => {
        const source = path.join(tmpDir, 'task.md');
        fs.writeFileSync(source, '# Task');
        const target = path.join(tmpDir, 'feature');
        fs.mkdirSync(target);
        const result = await moveTask(source, target);
        expect(result).toBe(path.join(target, 'task.md'));
        expect(fs.existsSync(source)).toBe(false);
    });

    it('handles collision with counter suffix', async () => {
        const target = path.join(tmpDir, 'target');
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'task.md'), '');
        const source = path.join(tmpDir, 'task.md');
        fs.writeFileSync(source, '');
        const result = await moveTask(source, target);
        expect(path.basename(result)).toBe('task-1.md');
    });

    it('returns source path if already in target location', async () => {
        const file = path.join(tmpDir, 'task.md');
        fs.writeFileSync(file, '');
        const result = await moveTask(file, tmpDir);
        expect(result).toBe(file);
    });

    it('throws on missing source', async () => {
        await expect(moveTask(path.join(tmpDir, 'nope.md'), tmpDir)).rejects.toThrow('not found');
    });
});

// ============================================================================
// moveFolder
// ============================================================================

describe('moveFolder', () => {
    it('moves a directory into a target parent', async () => {
        const source = path.join(tmpDir, 'src-folder');
        const target = path.join(tmpDir, 'dst-parent');
        fs.mkdirSync(source);
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(source, 'child.md'), '');
        const result = await moveFolder(source, target);
        expect(result).toBe(path.join(target, 'src-folder'));
        expect(fs.existsSync(path.join(result, 'child.md'))).toBe(true);
    });

    it('prevents circular move', async () => {
        const parent = path.join(tmpDir, 'parent');
        const child = path.join(parent, 'child');
        fs.mkdirSync(parent);
        fs.mkdirSync(child);
        await expect(moveFolder(parent, child)).rejects.toThrow('Cannot move a folder into itself');
    });

    it('handles collision with numeric suffix', async () => {
        const target = path.join(tmpDir, 'target');
        fs.mkdirSync(target);
        fs.mkdirSync(path.join(target, 'folder'));
        const source = path.join(tmpDir, 'folder');
        fs.mkdirSync(source);
        const result = await moveFolder(source, target);
        expect(path.basename(result)).toBe('folder-1');
    });

    it('no-op if already in target', async () => {
        const folder = path.join(tmpDir, 'folder');
        fs.mkdirSync(folder);
        const result = await moveFolder(folder, tmpDir);
        expect(result).toBe(folder);
    });

    it('throws on missing source', async () => {
        await expect(moveFolder(path.join(tmpDir, 'nope'), tmpDir)).rejects.toThrow('not found');
    });

    it('throws if target is not a directory', async () => {
        const source = path.join(tmpDir, 'src');
        fs.mkdirSync(source);
        const file = path.join(tmpDir, 'file.txt');
        fs.writeFileSync(file, '');
        await expect(moveFolder(source, file)).rejects.toThrow('not a directory');
    });
});

// ============================================================================
// moveTaskGroup
// ============================================================================

describe('moveTaskGroup', () => {
    it('moves multiple files', async () => {
        const target = path.join(tmpDir, 'target');
        fs.mkdirSync(target);
        const files = ['a.md', 'b.md'].map(n => {
            const p = path.join(tmpDir, n);
            fs.writeFileSync(p, '');
            return p;
        });
        const results = await moveTaskGroup(files, target);
        expect(results).toHaveLength(2);
        results.forEach(r => expect(fs.existsSync(r)).toBe(true));
    });

    it('handles empty array', async () => {
        const results = await moveTaskGroup([], tmpDir);
        expect(results).toEqual([]);
    });
});

// ============================================================================
// importTask
// ============================================================================

describe('importTask', () => {
    it('copies content to tasks folder', async () => {
        const source = path.join(tmpDir, 'external.md');
        fs.writeFileSync(source, '# External');
        const tasksFolder = path.join(tmpDir, 'tasks');
        fs.mkdirSync(tasksFolder);

        const result = await importTask(source, tasksFolder);
        expect(path.basename(result)).toBe('external.md');
        expect(fs.readFileSync(result, 'utf-8')).toBe('# External');
        // Source should still exist (copy, not move)
        expect(fs.existsSync(source)).toBe(true);
    });

    it('uses custom name when provided', async () => {
        const source = path.join(tmpDir, 'external.md');
        fs.writeFileSync(source, '');
        const tasksFolder = path.join(tmpDir, 'tasks');
        fs.mkdirSync(tasksFolder);

        const result = await importTask(source, tasksFolder, 'custom-name');
        expect(path.basename(result)).toBe('custom-name.md');
    });

    it('throws on collision', async () => {
        const source = path.join(tmpDir, 'external.md');
        fs.writeFileSync(source, '');
        const tasksFolder = path.join(tmpDir, 'tasks');
        fs.mkdirSync(tasksFolder);
        fs.writeFileSync(path.join(tasksFolder, 'external.md'), '');

        await expect(importTask(source, tasksFolder)).rejects.toThrow('already exists');
    });
});

// ============================================================================
// moveExternalTask
// ============================================================================

describe('moveExternalTask', () => {
    it('moves a markdown file to tasks folder', async () => {
        const source = path.join(tmpDir, 'ext.md');
        fs.writeFileSync(source, '# Ext');
        const tasksFolder = path.join(tmpDir, 'tasks');
        fs.mkdirSync(tasksFolder);

        const result = await moveExternalTask(source, tasksFolder);
        expect(path.basename(result)).toBe('ext.md');
        expect(fs.existsSync(source)).toBe(false);
    });

    it('validates .md extension', async () => {
        const source = path.join(tmpDir, 'file.txt');
        fs.writeFileSync(source, '');
        await expect(moveExternalTask(source, tmpDir)).rejects.toThrow('Only markdown');
    });

    it('throws on missing source', async () => {
        await expect(moveExternalTask(path.join(tmpDir, 'nope.md'), tmpDir)).rejects.toThrow('not found');
    });

    it('uses target folder when provided', async () => {
        const source = path.join(tmpDir, 'ext.md');
        fs.writeFileSync(source, '');
        const tasksFolder = path.join(tmpDir, 'tasks');
        const subFolder = path.join(tasksFolder, 'sub');
        fs.mkdirSync(tasksFolder, { recursive: true });
        fs.mkdirSync(subFolder, { recursive: true });

        const result = await moveExternalTask(source, tasksFolder, subFolder);
        expect(result).toBe(path.join(subFolder, 'ext.md'));
    });

    it('uses custom name when provided', async () => {
        const source = path.join(tmpDir, 'ext.md');
        fs.writeFileSync(source, '');
        const tasksFolder = path.join(tmpDir, 'tasks');
        fs.mkdirSync(tasksFolder);

        const result = await moveExternalTask(source, tasksFolder, undefined, 'renamed');
        expect(path.basename(result)).toBe('renamed.md');
    });
});

// ============================================================================
// taskExists / taskExistsInFolder
// ============================================================================

describe('taskExists', () => {
    it('returns true when task exists', async () => {
        fs.writeFileSync(path.join(tmpDir, 'my-task.md'), '');
        expect(taskExists('my-task', tmpDir)).toBe(true);
    });

    it('returns false when task does not exist', () => {
        expect(taskExists('nonexistent', tmpDir)).toBe(false);
    });
});

describe('taskExistsInFolder', () => {
    it('returns true for task in specific folder', () => {
        const sub = path.join(tmpDir, 'sub');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'task.md'), '');
        expect(taskExistsInFolder('task', tmpDir, sub)).toBe(true);
    });

    it('defaults to tasksFolder when no folder specified', () => {
        fs.writeFileSync(path.join(tmpDir, 'task.md'), '');
        expect(taskExistsInFolder('task', tmpDir)).toBe(true);
    });

    it('returns false when task not in folder', () => {
        expect(taskExistsInFolder('nope', tmpDir)).toBe(false);
    });
});

// ============================================================================
// sanitizeFileName
// ============================================================================

describe('sanitizeFileName', () => {
    it('replaces invalid characters with hyphens', () => {
        expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j');
    });

    it('collapses consecutive hyphens', () => {
        expect(sanitizeFileName('a---b')).toBe('a-b');
    });

    it('trims leading and trailing hyphens', () => {
        expect(sanitizeFileName('--name--')).toBe('name');
    });

    it('replaces spaces with hyphens', () => {
        expect(sanitizeFileName('hello world')).toBe('hello-world');
    });
});

// ============================================================================
// parseFileName
// ============================================================================

describe('parseFileName', () => {
    it('extracts baseName without docType', () => {
        expect(parseFileName('task1.md')).toEqual({ baseName: 'task1', docType: undefined });
    });

    it('extracts baseName and docType', () => {
        expect(parseFileName('task1.plan.md')).toEqual({ baseName: 'task1', docType: 'plan' });
    });

    it('handles multi-dot names with docType', () => {
        expect(parseFileName('task1.test.spec.md')).toEqual({ baseName: 'task1.test', docType: 'spec' });
    });

    it('does not treat unknown suffixes as docType', () => {
        expect(parseFileName('task1.xyz.md')).toEqual({ baseName: 'task1.xyz', docType: undefined });
    });
});
