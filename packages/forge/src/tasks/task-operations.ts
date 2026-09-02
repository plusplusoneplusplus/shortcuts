/**
 * Task CRUD operations and composite helpers for task file management.
 * Every function takes explicit path arguments.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ensureDirectoryExists, safeExists, safeReadDir, safeRename, safeStats, safeWriteFile, safeReadDirAsync, safeStatsAsync } from '../utils';
import { toForwardSlashes } from '../utils/path-utils';
import { parseFileName, sanitizeFileName } from './task-parser';
import type {
    Task,
    TaskDocument,
    TaskDocumentGroup,
    TaskFolder,
    TasksViewerSettings,
    DiscoverySettings,
} from './types';
import {
    scanTasksRecursively,
    scanDocumentsRecursively,
    groupTaskDocuments,
    buildTaskFolderHierarchy,
} from './task-scanner';
import { loadRelatedItems } from './related-items-loader';

// Re-export parseFileName and sanitizeFileName for convenience
export { parseFileName, sanitizeFileName } from './task-parser';

// ============================================================================
// Create operations
// ============================================================================

/**
 * @param tasksFolder - Absolute path to the tasks folder
 * @param name - Display name for the task
 */
export async function createTask(tasksFolder: string, name: string): Promise<string> {
    const sanitized = sanitizeFileName(name);
    const filePath = path.join(tasksFolder, `${sanitized}.md`);

    if (safeExists(filePath)) {
        throw new Error(`Task "${name}" already exists`);
    }

    const content = `# ${name}\n\n`;
    safeWriteFile(filePath, content);

    return filePath;
}

/**
 * Creates a placeholder file inside the new folder.
 * @param tasksFolder - Absolute path to the tasks folder
 */
export async function createFeature(tasksFolder: string, name: string): Promise<string> {
    const sanitized = sanitizeFileName(name);
    const folderPath = path.join(tasksFolder, sanitized);

    if (safeExists(folderPath)) {
        throw new Error(`Feature "${name}" already exists`);
    }

    ensureDirectoryExists(folderPath);

    const placeholderFilePath = path.join(folderPath, 'placeholder.md');
    safeWriteFile(placeholderFilePath, '');

    return folderPath;
}

/**
 * @param parentFolderPath - Absolute path to the parent folder
 */
export async function createSubfolder(parentFolderPath: string, name: string): Promise<string> {
    if (!safeExists(parentFolderPath)) {
        throw new Error(`Parent folder not found: ${parentFolderPath}`);
    }

    const sanitized = sanitizeFileName(name);
    const subfolderPath = path.join(parentFolderPath, sanitized);

    if (safeExists(subfolderPath)) {
        throw new Error(`Subfolder "${name}" already exists`);
    }

    ensureDirectoryExists(subfolderPath);

    const placeholderFilePath = path.join(subfolderPath, 'placeholder.md');
    safeWriteFile(placeholderFilePath, '');

    return subfolderPath;
}

// ============================================================================
// Rename operations
// ============================================================================

/**
 * @param oldPath - Absolute path to the existing task file
 * @param newName - New display name for the task
 */
export async function renameTask(oldPath: string, newName: string): Promise<string> {
    if (!safeExists(oldPath)) {
        throw new Error(`Task file not found: ${oldPath}`);
    }

    const sanitized = sanitizeFileName(newName);
    const directory = path.dirname(oldPath);
    const newPath = path.join(directory, `${sanitized}.md`);

    if (oldPath !== newPath && safeExists(newPath)) {
        throw new Error(`Task "${newName}" already exists`);
    }

    safeRename(oldPath, newPath);
    return newPath;
}

/**
 * @param folderPath - Absolute path to the folder
 */
export async function renameFolder(folderPath: string, newName: string): Promise<string> {
    if (!safeExists(folderPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    const statsResult = safeStats(folderPath);
    if (!statsResult.success || !statsResult.data?.isDirectory()) {
        throw new Error(`Path is not a directory: ${folderPath}`);
    }

    const sanitized = sanitizeFileName(newName);
    const parentDir = path.dirname(folderPath);
    const newPath = path.join(parentDir, sanitized);

    if (folderPath !== newPath && safeExists(newPath)) {
        throw new Error(`Folder "${newName}" already exists`);
    }

    safeRename(folderPath, newPath);
    return newPath;
}

/**
 * Renames all documents sharing the same base name.
 * @param folderPath - Absolute path to the folder containing the documents
 */
export async function renameDocumentGroup(folderPath: string, oldBaseName: string, newBaseName: string): Promise<string[]> {
    if (!safeExists(folderPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    const sanitizedNewBaseName = sanitizeFileName(newBaseName);
    const renamedPaths: string[] = [];
    const failedRenames: string[] = [];

    const readResult = safeReadDir(folderPath);
    if (!readResult.success || !readResult.data) {
        throw new Error(`Failed to read folder: ${folderPath}`);
    }

    const filesToRename: Array<{ oldPath: string; newPath: string }> = [];

    for (const fileName of readResult.data) {
        if (!fileName.endsWith('.md')) {
            continue;
        }

        const { baseName, docType } = parseFileName(fileName);
        if (baseName !== oldBaseName) {
            continue;
        }

        const oldFilePath = path.join(folderPath, fileName);
        const newFileName = docType
            ? `${sanitizedNewBaseName}.${docType}.md`
            : `${sanitizedNewBaseName}.md`;
        const newFilePath = path.join(folderPath, newFileName);

        if (oldFilePath !== newFilePath && safeExists(newFilePath)) {
            throw new Error(`File "${newFileName}" already exists`);
        }

        filesToRename.push({ oldPath: oldFilePath, newPath: newFilePath });
    }

    if (filesToRename.length === 0) {
        throw new Error(`No documents found with base name "${oldBaseName}"`);
    }

    for (const { oldPath, newPath } of filesToRename) {
        try {
            safeRename(oldPath, newPath);
            renamedPaths.push(newPath);
        } catch (error) {
            failedRenames.push(path.basename(oldPath));
        }
    }

    if (failedRenames.length > 0) {
        throw new Error(`Failed to rename: ${failedRenames.join(', ')}`);
    }

    return renamedPaths;
}

/**
 * Preserves the doc type suffix.
 * @param oldPath - Absolute path to the document
 */
export async function renameDocument(oldPath: string, newBaseName: string): Promise<string> {
    if (!safeExists(oldPath)) {
        throw new Error(`Document not found: ${oldPath}`);
    }

    const fileName = path.basename(oldPath);
    const { docType } = parseFileName(fileName);
    const sanitizedNewBaseName = sanitizeFileName(newBaseName);

    const directory = path.dirname(oldPath);
    const newFileName = docType
        ? `${sanitizedNewBaseName}.${docType}.md`
        : `${sanitizedNewBaseName}.md`;
    const newPath = path.join(directory, newFileName);

    if (oldPath !== newPath && safeExists(newPath)) {
        throw new Error(`Document "${newFileName}" already exists`);
    }

    safeRename(oldPath, newPath);
    return newPath;
}

// ============================================================================
// Delete operations
// ============================================================================

/**
 * @param filePath - Absolute path to the task file
 */
export async function deleteTask(filePath: string): Promise<void> {
    if (!safeExists(filePath)) {
        throw new Error(`Task file not found: ${filePath}`);
    }

    await fs.promises.unlink(filePath);
}

/**
 * Recursive.
 * @param folderPath - Absolute path to the folder to delete
 */
export async function deleteFolder(folderPath: string): Promise<void> {
    if (!safeExists(folderPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    const statsResult = safeStats(folderPath);
    if (!statsResult.success || !statsResult.data?.isDirectory()) {
        throw new Error(`Path is not a directory: ${folderPath}`);
    }

    await fs.promises.rm(folderPath, { recursive: true, force: true });
}

// ============================================================================
// Archive / unarchive operations
// ============================================================================

/**
 * Moves the task into the archive folder.
 * @param filePath - Absolute path to the task file
 * @param tasksFolder - Absolute path to the tasks folder
 * @param archiveFolder - Absolute path to the archive folder
 * @param preserveStructure - If true, preserves the relative folder structure under archive
 */
export async function archiveTask(
    filePath: string,
    tasksFolder: string,
    archiveFolder: string,
    preserveStructure: boolean = false
): Promise<string> {
    if (!safeExists(filePath)) {
        throw new Error(`Task file not found: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    let targetFolder = archiveFolder;

    if (preserveStructure) {
        const fileDir = path.dirname(filePath);
        const normalizedTasksFolder = toForwardSlashes(tasksFolder);
        const normalizedFileDir = toForwardSlashes(fileDir);

        if (normalizedFileDir.startsWith(normalizedTasksFolder)) {
            const relativePath = normalizedFileDir.substring(normalizedTasksFolder.length).replace(/^[/\\]/, '');
            if (relativePath && relativePath !== 'archive' && !relativePath.startsWith('archive/') && !relativePath.startsWith('archive\\')) {
                targetFolder = path.join(archiveFolder, relativePath);
                ensureDirectoryExists(targetFolder);
            }
        }
    }

    const newPath = path.join(targetFolder, fileName);

    let finalPath = newPath;
    if (safeExists(newPath)) {
        const baseName = path.basename(fileName, '.md');
        const timestamp = Date.now();
        finalPath = path.join(targetFolder, `${baseName}-${timestamp}.md`);
    }

    safeRename(filePath, finalPath);
    return finalPath;
}

/**
 * Moves the task back to the tasks root.
 * @param filePath - Absolute path to the archived task file
 * @param tasksFolder - Absolute path to the tasks folder
 */
export async function unarchiveTask(filePath: string, tasksFolder: string): Promise<string> {
    if (!safeExists(filePath)) {
        throw new Error(`Task file not found: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const newPath = path.join(tasksFolder, fileName);

    let finalPath = newPath;
    if (safeExists(newPath)) {
        const baseName = path.basename(fileName, '.md');
        const timestamp = Date.now();
        finalPath = path.join(tasksFolder, `${baseName}-${timestamp}.md`);
    }

    safeRename(filePath, finalPath);
    return finalPath;
}

/**
 * Delegates to archiveTask.
 */
export async function archiveDocument(
    filePath: string,
    tasksFolder: string,
    archiveFolder: string,
    preserveStructure: boolean = false
): Promise<string> {
    return archiveTask(filePath, tasksFolder, archiveFolder, preserveStructure);
}

/**
 * Delegates to unarchiveTask.
 */
export async function unarchiveDocument(filePath: string, tasksFolder: string): Promise<string> {
    return unarchiveTask(filePath, tasksFolder);
}

/**
 * Moves every document in the group to the archive folder.
 * @param tasksFolder - Absolute path to the tasks folder
 * @param archiveFolder - Absolute path to the archive folder
 * @param preserveStructure - If true, preserves the relative folder structure under archive
 */
export async function archiveDocumentGroup(
    filePaths: string[],
    tasksFolder: string,
    archiveFolder: string,
    preserveStructure: boolean = false
): Promise<string[]> {
    const newPaths: string[] = [];
    for (const filePath of filePaths) {
        const newPath = await archiveTask(filePath, tasksFolder, archiveFolder, preserveStructure);
        newPaths.push(newPath);
    }
    return newPaths;
}

/**
 * Moves every document in the group back to the tasks root.
 * @param tasksFolder - Absolute path to the tasks folder
 */
export async function unarchiveDocumentGroup(filePaths: string[], tasksFolder: string): Promise<string[]> {
    const newPaths: string[] = [];
    for (const filePath of filePaths) {
        const newPath = await unarchiveTask(filePath, tasksFolder);
        newPaths.push(newPath);
    }
    return newPaths;
}

// ============================================================================
// Move / import operations
// ============================================================================

/**
 * @param sourcePath - Absolute path to the source file
 * @param targetFolder - Absolute path to the target folder
 */
export async function moveTask(sourcePath: string, targetFolder: string): Promise<string> {
    if (!safeExists(sourcePath)) {
        throw new Error(`Task file not found: ${sourcePath}`);
    }

    ensureDirectoryExists(targetFolder);

    const fileName = path.basename(sourcePath);
    let newPath = path.join(targetFolder, fileName);

    if (sourcePath !== newPath && safeExists(newPath)) {
        const baseName = path.basename(fileName, '.md');
        let counter = 1;
        while (safeExists(newPath)) {
            newPath = path.join(targetFolder, `${baseName}-${counter}.md`);
            counter++;
        }
    }

    if (sourcePath === newPath) {
        return sourcePath;
    }

    safeRename(sourcePath, newPath);
    return newPath;
}

/**
 * Prevents circular moves (moving a folder into its own subtree).
 * @param sourceFolderPath - Absolute path to the folder to move
 * @param targetParentFolder - Absolute path to the destination parent folder
 */
export async function moveFolder(sourceFolderPath: string, targetParentFolder: string): Promise<string> {
    if (!safeExists(sourceFolderPath)) {
        throw new Error(`Folder not found: ${sourceFolderPath}`);
    }

    const statsResult = safeStats(sourceFolderPath);
    if (!statsResult.success || !statsResult.data?.isDirectory()) {
        throw new Error(`Path is not a directory: ${sourceFolderPath}`);
    }

    if (!safeExists(targetParentFolder)) {
        throw new Error(`Target folder not found: ${targetParentFolder}`);
    }

    const targetStats = safeStats(targetParentFolder);
    if (!targetStats.success || !targetStats.data?.isDirectory()) {
        throw new Error(`Target path is not a directory: ${targetParentFolder}`);
    }

    // Prevent circular move
    const normalizedSource = sourceFolderPath.replace(/\\/g, '/').toLowerCase();
    const normalizedTarget = targetParentFolder.replace(/\\/g, '/').toLowerCase();
    if (normalizedTarget.startsWith(normalizedSource + '/') || normalizedTarget === normalizedSource) {
        throw new Error('Cannot move a folder into itself or its own subtree');
    }

    const folderName = path.basename(sourceFolderPath);
    let newPath = path.join(targetParentFolder, folderName);

    if (sourceFolderPath !== newPath && safeExists(newPath)) {
        let counter = 1;
        while (safeExists(newPath)) {
            newPath = path.join(targetParentFolder, `${folderName}-${counter}`);
            counter++;
        }
    }

    if (sourceFolderPath === newPath) {
        return sourceFolderPath;
    }

    safeRename(sourceFolderPath, newPath);
    return newPath;
}

/**
 * @param sourcePaths - Array of absolute paths to source files
 * @param targetFolder - Absolute path to the target folder
 */
export async function moveTaskGroup(sourcePaths: string[], targetFolder: string): Promise<string[]> {
    const newPaths: string[] = [];
    for (const sourcePath of sourcePaths) {
        const newPath = await moveTask(sourcePath, targetFolder);
        newPaths.push(newPath);
    }
    return newPaths;
}

/**
 * Copy semantics — the source file is left in place.
 * @param tasksFolder - Absolute path to the tasks folder
 * @param newName - Optional new name for the task (without .md extension)
 */
export async function importTask(sourcePath: string, tasksFolder: string, newName?: string): Promise<string> {
    const sourceFileName = path.basename(sourcePath);
    const targetName = newName
        ? sanitizeFileName(newName)
        : path.basename(sourceFileName, '.md');

    const targetPath = path.join(tasksFolder, `${targetName}.md`);

    if (safeExists(targetPath)) {
        throw new Error(`Task "${targetName}" already exists`);
    }

    // Copy file content (not move, to preserve original)
    const content = await fs.promises.readFile(sourcePath, 'utf-8');
    safeWriteFile(targetPath, content);

    return targetPath;
}

/**
 * Move semantics — the source file is deleted.
 * @param tasksFolder - Absolute path to the tasks folder
 * @param targetFolder - Absolute path to the target folder (defaults to tasksFolder)
 * @param newName - Optional new name for the task (without .md extension)
 */
export async function moveExternalTask(
    sourcePath: string,
    tasksFolder: string,
    targetFolder?: string,
    newName?: string
): Promise<string> {
    if (!safeExists(sourcePath)) {
        throw new Error(`Source file not found: ${sourcePath}`);
    }

    if (!sourcePath.toLowerCase().endsWith('.md')) {
        throw new Error('Only markdown (.md) files can be moved to tasks');
    }

    const resolvedTargetFolder = targetFolder || tasksFolder;
    ensureDirectoryExists(resolvedTargetFolder);

    const sourceFileName = path.basename(sourcePath);
    const targetName = newName
        ? sanitizeFileName(newName)
        : path.basename(sourceFileName, '.md');

    const targetPath = path.join(resolvedTargetFolder, `${targetName}.md`);

    if (safeExists(targetPath)) {
        throw new Error(`Task "${targetName}" already exists`);
    }

    safeRename(sourcePath, targetPath);

    return targetPath;
}

// ============================================================================
// Helper / query functions
// ============================================================================

/**
 * @param name - Task name (without .md extension)
 * @param tasksFolder - Absolute path to the tasks folder
 * @param folder - Optional specific folder path (defaults to tasksFolder)
 */
export function taskExistsInFolder(name: string, tasksFolder: string, folder?: string): boolean {
    const sanitized = sanitizeFileName(name);
    const targetFolder = folder || tasksFolder;
    const filePath = path.join(targetFolder, `${sanitized}.md`);
    return safeExists(filePath);
}

/**
 * @param name - Task name (without .md extension)
 * @param tasksFolder - Absolute path to the tasks folder
 */
export function taskExists(name: string, tasksFolder: string): boolean {
    const sanitized = sanitizeFileName(name);
    const filePath = path.join(tasksFolder, `${sanitized}.md`);
    return safeExists(filePath);
}

// ============================================================================
// Path resolution helpers
// ============================================================================

/**
 * Resolve the absolute tasks-folder and archive-folder paths from workspace root and settings.
 */
export function resolveTaskPaths(
    workspaceRoot: string,
    settings: Pick<TasksViewerSettings, 'folderPath'>
): { tasksFolder: string; archiveFolder: string } {
    const folderPath = settings.folderPath || '.vscode/tasks';
    const tasksFolder = path.isAbsolute(folderPath)
        ? folderPath
        : path.join(workspaceRoot, folderPath);
    return {
        tasksFolder,
        archiveFolder: path.join(tasksFolder, 'archive'),
    };
}

export function ensureTaskFolders(tasksFolder: string): void {
    ensureDirectoryExists(tasksFolder);
    ensureDirectoryExists(path.join(tasksFolder, 'archive'));
}

// ============================================================================
// Composite scanning helpers
// ============================================================================

/**
 * Scan and return all tasks, optionally including archived tasks.
 */
export async function getAllTasks(
    tasksFolder: string,
    showArchived: boolean = false
): Promise<Task[]> {
    const tasks: Task[] = await scanTasksRecursively(tasksFolder, '', false);
    if (showArchived) {
        const archiveFolder = path.join(tasksFolder, 'archive');
        tasks.push(...await scanTasksRecursively(archiveFolder, '', true));
    }
    return tasks;
}

/**
 * Scan and return all task documents, optionally including archived documents.
 */
export async function getAllDocuments(
    tasksFolder: string,
    showArchived: boolean = false
): Promise<TaskDocument[]> {
    const documents: TaskDocument[] = await scanDocumentsRecursively(tasksFolder, '', false);
    if (showArchived) {
        const archiveFolder = path.join(tasksFolder, 'archive');
        documents.push(...await scanDocumentsRecursively(archiveFolder, '', true));
    }
    return documents;
}

/**
 * Scan documents and group them by base name.
 */
export async function getAllDocumentGroups(
    tasksFolder: string,
    showArchived: boolean = false
): Promise<{ groups: TaskDocumentGroup[]; singles: TaskDocument[] }> {
    const documents = await getAllDocuments(tasksFolder, showArchived);
    return groupTaskDocuments(documents);
}

/**
 * Build the full task folder hierarchy, optionally loading related items.
 */
export async function getFullTaskHierarchy(
    tasksFolder: string,
    options?: {
        showArchived?: boolean;
        discovery?: Pick<DiscoverySettings, 'enabled' | 'showRelatedInTree'>;
    }
): Promise<TaskFolder> {
    const showArchived = options?.showArchived ?? false;
    const documents = await getAllDocuments(tasksFolder, showArchived);
    const archiveFolder = path.join(tasksFolder, 'archive');

    const { root, folderMap } = await buildTaskFolderHierarchy(
        tasksFolder,
        documents,
        showArchived,
        showArchived ? archiveFolder : undefined
    );

    if (options?.discovery?.enabled && options?.discovery?.showRelatedInTree) {
        for (const [, folder] of folderMap) {
            if (!folder.relativePath) continue;
            const relatedItems = await loadRelatedItems(folder.folderPath);
            if (relatedItems) {
                folder.relatedItems = relatedItems;
            }
        }
    }

    return root;
}

/**
 * Recursive; excludes `archive/`.
 */
export async function getFeatureFolders(
    tasksFolder: string
): Promise<Array<{ path: string; displayName: string; relativePath: string }>> {
    const folders: Array<{ path: string; displayName: string; relativePath: string }> = [];
    await collectFeatureFoldersRecursively(tasksFolder, '', folders);
    return folders;
}

async function collectFeatureFoldersRecursively(
    dirPath: string,
    relativePath: string,
    folders: Array<{ path: string; displayName: string; relativePath: string }>
): Promise<void> {
    const archiveFolderName = 'archive';
    const readResult = await safeReadDirAsync(dirPath);

    if (!readResult.success || !readResult.data) {
        return;
    }

    for (const item of readResult.data) {
        if (item === archiveFolderName) {
            continue;
        }

        const itemPath = path.join(dirPath, item);
        const statsResult = await safeStatsAsync(itemPath);

        if (!statsResult.success || !statsResult.data || !statsResult.data.isDirectory()) {
            continue;
        }

        const itemRelativePath = toForwardSlashes(relativePath ? path.join(relativePath, item) : item);
        const displayName = relativePath ? `${relativePath}/${item}` : item;

        folders.push({
            path: itemPath,
            displayName,
            relativePath: itemRelativePath,
        });

        await collectFeatureFoldersRecursively(itemPath, itemRelativePath, folders);
    }
}
