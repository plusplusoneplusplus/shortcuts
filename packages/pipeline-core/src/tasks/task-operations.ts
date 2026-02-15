/**
 * Task CRUD operations - Pure Node.js functions for task file management.
 * No VS Code dependencies. Every function takes explicit path arguments.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ensureDirectoryExists, safeExists, safeReadDir, safeRename, safeStats, safeWriteFile } from '../utils';
import { parseFileName, sanitizeFileName } from './task-parser';

// Re-export parseFileName and sanitizeFileName for convenience
export { parseFileName, sanitizeFileName } from './task-parser';

// ============================================================================
// Create operations
// ============================================================================

/**
 * Create a new task file in the tasks folder.
 * @param tasksFolder - Absolute path to the tasks folder
 * @param name - Display name for the task
 * @returns The path to the created file
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
 * Create a new feature folder with a placeholder file.
 * @param tasksFolder - Absolute path to the tasks folder
 * @param name - Display name for the feature
 * @returns The path to the created folder
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
 * Create a new subfolder inside an existing folder.
 * @param parentFolderPath - Absolute path to the parent folder
 * @param name - Name of the subfolder to create
 * @returns The path to the created subfolder
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
 * Rename a task file.
 * @param oldPath - Absolute path to the existing task file
 * @param newName - New display name for the task
 * @returns The new file path
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
 * Rename a folder.
 * @param folderPath - Absolute path to the folder
 * @param newName - New folder name
 * @returns The new folder path
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
 * Rename a document group (all documents sharing the same base name).
 * @param folderPath - Absolute path to the folder containing the documents
 * @param oldBaseName - Current base name of the document group
 * @param newBaseName - New base name for the documents
 * @returns Array of new file paths
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
 * Rename a single document (preserving doc type suffix).
 * @param oldPath - Absolute path to the document
 * @param newBaseName - New base name for the document
 * @returns The new file path
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
 * Delete a task file.
 * @param filePath - Absolute path to the task file
 */
export async function deleteTask(filePath: string): Promise<void> {
    if (!safeExists(filePath)) {
        throw new Error(`Task file not found: ${filePath}`);
    }

    await fs.promises.unlink(filePath);
}

/**
 * Delete a folder and all its contents recursively.
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
 * Archive a task (move to archive folder).
 * @param filePath - Absolute path to the task file
 * @param tasksFolder - Absolute path to the tasks folder
 * @param archiveFolder - Absolute path to the archive folder
 * @param preserveStructure - If true, preserves the relative folder structure under archive
 * @returns The new file path
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
        const normalizedTasksFolder = tasksFolder.replace(/\\/g, '/');
        const normalizedFileDir = fileDir.replace(/\\/g, '/');

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
 * Unarchive a task (move back to tasks root).
 * @param filePath - Absolute path to the archived task file
 * @param tasksFolder - Absolute path to the tasks folder
 * @returns The new file path
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
 * Archive a document (delegates to archiveTask).
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
 * Unarchive a document (delegates to unarchiveTask).
 */
export async function unarchiveDocument(filePath: string, tasksFolder: string): Promise<string> {
    return unarchiveTask(filePath, tasksFolder);
}

/**
 * Archive a document group (move all documents to archive folder).
 * @param filePaths - Array of file paths in the group
 * @param tasksFolder - Absolute path to the tasks folder
 * @param archiveFolder - Absolute path to the archive folder
 * @param preserveStructure - If true, preserves the relative folder structure under archive
 * @returns Array of new file paths
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
 * Unarchive a document group (move all documents back to tasks root).
 * @param filePaths - Array of file paths in the group
 * @param tasksFolder - Absolute path to the tasks folder
 * @returns Array of new file paths
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
 * Move a task file to a different folder.
 * @param sourcePath - Absolute path to the source file
 * @param targetFolder - Absolute path to the target folder
 * @returns The new file path
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
 * Move an entire folder (and all its contents) into a target folder.
 * Prevents circular moves (moving a folder into its own subtree).
 * @param sourceFolderPath - Absolute path to the folder to move
 * @param targetParentFolder - Absolute path to the destination parent folder
 * @returns The new folder path
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
 * Move multiple task files to a different folder (for document groups).
 * @param sourcePaths - Array of absolute paths to source files
 * @param targetFolder - Absolute path to the target folder
 * @returns Array of new file paths
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
 * Import an external markdown file into the tasks folder (copy semantics).
 * @param sourcePath - Path to the source file
 * @param tasksFolder - Absolute path to the tasks folder
 * @param newName - Optional new name for the task (without .md extension)
 * @returns The path to the imported file
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
    const content = fs.readFileSync(sourcePath, 'utf-8');
    safeWriteFile(targetPath, content);

    return targetPath;
}

/**
 * Move an external markdown file into the tasks folder (move semantics - source is deleted).
 * @param sourcePath - Path to the source file
 * @param tasksFolder - Absolute path to the tasks folder
 * @param targetFolder - Absolute path to the target folder (defaults to tasksFolder)
 * @param newName - Optional new name for the task (without .md extension)
 * @returns The path to the moved file
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
 * Check if a task with the given name exists in a specific folder.
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
 * Check if a task with the given name exists in the tasks folder.
 * @param name - Task name (without .md extension)
 * @param tasksFolder - Absolute path to the tasks folder
 */
export function taskExists(name: string, tasksFolder: string): boolean {
    const sanitized = sanitizeFileName(name);
    const filePath = path.join(tasksFolder, `${sanitized}.md`);
    return safeExists(filePath);
}
