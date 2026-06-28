/**
 * Task scanning and grouping utilities for task management.
 * Pure Node.js functions with no editor dependencies.
 * All scanning functions use async I/O via fs.promises.
 */

import * as path from 'path';
import { safeReadDirAsync, safeStatsAsync, safeExistsAsync } from '../utils/file-utils';
import { toForwardSlashes } from '../utils/path-utils';
import { parseTaskStatus, parseFileName } from './task-parser';
import { Task, TaskDocument, TaskDocumentGroup, TaskFolder } from './types';

const archiveFolderName = 'archive';

/** Name of the undo-stack file written alongside the tasks root. */
export const ARCHIVE_UNDO_FILE = '.archive-undo.json';

/**
 * Set of common context/documentation files to exclude from task scanning.
 * These are not actual task files and should not be counted or queued.
 */
const CONTEXT_FILES = new Set([
    'readme', 'readme.md', 'claude.md', 'license', 'license.md',
    'changelog.md', 'contributing.md', 'code_of_conduct.md', 'security.md',
    'index', 'index.md', 'context', 'context.md',
    '.gitignore', '.gitattributes'
]);


/**
 * Check if a filename is a context/documentation file that should be excluded from task scanning.
 */
export function isContextFile(fileName: string): boolean {
    return CONTEXT_FILES.has(fileName.toLowerCase());
}

/**
 * Group documents by composite key: baseName|archived/active|relativePath.
 * Documents sharing a key with count > 1 become a TaskDocumentGroup; singletons go to singles.
 */
export function groupTaskDocuments(documents: TaskDocument[]): { groups: TaskDocumentGroup[]; singles: TaskDocument[] } {
    const groupMap = new Map<string, TaskDocument[]>();

    for (const doc of documents) {
        const relPath = doc.relativePath || '';
        const key = `${doc.baseName}|${doc.isArchived ? 'archived' : 'active'}|${relPath}`;
        const existing = groupMap.get(key) || [];
        existing.push(doc);
        groupMap.set(key, existing);
    }

    const groups: TaskDocumentGroup[] = [];
    const singles: TaskDocument[] = [];

    for (const [, docs] of groupMap) {
        if (docs.length > 1) {
            const latestModifiedTime = docs.reduce(
                (latest, doc) => doc.modifiedTime > latest ? doc.modifiedTime : latest,
                docs[0].modifiedTime
            );
            groups.push({
                baseName: docs[0].baseName,
                documents: docs,
                isArchived: docs[0].isArchived,
                latestModifiedTime
            });
        } else {
            singles.push(docs[0]);
        }
    }

    return { groups, singles };
}

// ============================================================================
// Async scanning functions
// ============================================================================

/**
 * Recursively walk a directory and return flat Task[] for each .md file found.
 * Skips the 'archive' folder when isArchived is false.
 */
export async function scanTasksRecursively(dirPath: string, relativePath: string, isArchived: boolean): Promise<Task[]> {
    const tasks: Task[] = [];

    const readResult = await safeReadDirAsync(dirPath);
    if (!readResult.success || !readResult.data) {
        return tasks;
    }

    for (const item of readResult.data) {
        const itemPath = path.join(dirPath, item);
        const statsResult = await safeStatsAsync(itemPath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            if (!isArchived && item === archiveFolderName) {
                continue;
            }
            const subRelativePath = toForwardSlashes(relativePath ? path.join(relativePath, item) : item);
            const subTasks = await scanTasksRecursively(itemPath, subRelativePath, isArchived);
            tasks.push(...subTasks);
        } else if (statsResult.data.isFile() && item.endsWith('.md') && !isContextFile(item)) {
            const status = parseTaskStatus(itemPath);
            tasks.push({
                name: path.basename(item, '.md'),
                filePath: itemPath,
                modifiedTime: statsResult.data.mtime,
                isArchived,
                relativePath: relativePath || undefined,
                status
            });
        }
    }

    return tasks;
}

/**
 * Recursively walk a directory and return flat TaskDocument[] for each .md file found.
 * Additionally parses baseName and docType via parseFileName.
 * Skips the 'archive' folder when isArchived is false.
 */
export async function scanDocumentsRecursively(dirPath: string, relativePath: string, isArchived: boolean): Promise<TaskDocument[]> {
    const documents: TaskDocument[] = [];

    const readResult = await safeReadDirAsync(dirPath);
    if (!readResult.success || !readResult.data) {
        return documents;
    }

    for (const item of readResult.data) {
        const itemPath = path.join(dirPath, item);
        const statsResult = await safeStatsAsync(itemPath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            if (!isArchived && item === archiveFolderName) {
                continue;
            }
            const subRelativePath = toForwardSlashes(relativePath ? path.join(relativePath, item) : item);
            const subDocuments = await scanDocumentsRecursively(itemPath, subRelativePath, isArchived);
            documents.push(...subDocuments);
        } else if (statsResult.data.isFile() && item.endsWith('.md') && !isContextFile(item)) {
            const { baseName, docType } = parseFileName(item);
            const status = parseTaskStatus(itemPath);
            documents.push({
                baseName,
                docType,
                fileName: item,
                filePath: itemPath,
                modifiedTime: statsResult.data.mtime,
                isArchived,
                relativePath: relativePath || undefined,
                status
            });
        }
    }

    return documents;
}

/**
 * Recursively scan directories to build folder structure (including empty folders).
 * Populates folderMap and parentFolder.children.
 * Skips the 'archive' folder when isArchived is false.
 */
export async function scanFoldersRecursively(
    dirPath: string,
    relativePath: string,
    isArchived: boolean,
    folderMap: Map<string, TaskFolder>,
    parentFolder: TaskFolder
): Promise<void> {
    const readResult = await safeReadDirAsync(dirPath);
    if (!readResult.success || !readResult.data) {
        return;
    }

    for (const item of readResult.data) {
        const itemPath = path.join(dirPath, item);
        const statsResult = await safeStatsAsync(itemPath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            if (!isArchived && item === archiveFolderName) {
                continue;
            }

            const folderRelativePath = toForwardSlashes(relativePath ? path.join(relativePath, item) : item);

            if (!folderMap.has(folderRelativePath)) {
                const newFolder: TaskFolder = {
                    name: item,
                    folderPath: itemPath,
                    relativePath: folderRelativePath,
                    isArchived,
                    children: [],
                    tasks: [],
                    documentGroups: [],
                    singleDocuments: []
                };

                folderMap.set(folderRelativePath, newFolder);
                parentFolder.children.push(newFolder);

                await scanFoldersRecursively(itemPath, folderRelativePath, isArchived, folderMap, newFolder);
            } else {
                const existingFolder = folderMap.get(folderRelativePath)!;
                await scanFoldersRecursively(itemPath, folderRelativePath, isArchived, folderMap, existingFolder);
            }
        }
    }
}

/**
 * Scan a single directory for context/documentation .md files (non-recursive).
 * Returns TaskDocument[] for files that match isContextFile().
 */
export async function scanContextDocumentsInFolder(dirPath: string, relativePath: string, isArchived: boolean): Promise<TaskDocument[]> {
    const documents: TaskDocument[] = [];

    const readResult = await safeReadDirAsync(dirPath);
    if (!readResult.success || !readResult.data) {
        return documents;
    }

    for (const item of readResult.data) {
        if (!item.endsWith('.md') || !isContextFile(item)) {
            continue;
        }

        const itemPath = path.join(dirPath, item);
        const statsResult = await safeStatsAsync(itemPath);

        if (!statsResult.success || !statsResult.data || !statsResult.data.isFile()) {
            continue;
        }

        const { baseName, docType } = parseFileName(item);
        documents.push({
            baseName,
            docType,
            fileName: item,
            filePath: itemPath,
            modifiedTime: statsResult.data.mtime,
            isArchived,
            relativePath: relativePath || undefined,
        });
    }

    return documents;
}

/**
 * Build a hierarchical TaskFolder tree from documents.
 * Scans directories for folder structure, creates intermediate folders for document paths,
 * and assigns groups and singles to their respective folders.
 *
 * @returns The root TaskFolder and folderMap (for post-processing such as loading related items).
 */
export async function buildTaskFolderHierarchy(
    rootPath: string,
    documents: TaskDocument[],
    scanArchive: boolean,
    archivePath?: string
): Promise<{ root: TaskFolder; folderMap: Map<string, TaskFolder> }> {
    const { groups, singles } = groupTaskDocuments(documents);

    const rootFolder: TaskFolder = {
        name: '',
        folderPath: rootPath,
        relativePath: '',
        isArchived: false,
        children: [],
        tasks: [],
        documentGroups: [],
        singleDocuments: []
    };

    const folderMap = new Map<string, TaskFolder>();
    folderMap.set('', rootFolder);

    // Scan active directory tree
    await scanFoldersRecursively(rootPath, '', false, folderMap, rootFolder);

    // Scan archive directory tree if requested
    if (scanArchive && archivePath && await safeExistsAsync(archivePath)) {
        await scanFoldersRecursively(archivePath, '', true, folderMap, rootFolder);
    }

    // Ensure intermediate folder nodes exist for every document's relativePath
    const allDocuments = [
        ...groups.flatMap(g => g.documents),
        ...singles
    ];

    for (const doc of allDocuments) {
        if (!doc.relativePath) {
            continue;
        }

        const pathParts = doc.relativePath.split('/');
        let currentPath = '';

        for (const part of pathParts) {
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!folderMap.has(currentPath)) {
                const newFolder: TaskFolder = {
                    name: part,
                    folderPath: path.join(rootPath, currentPath),
                    relativePath: currentPath,
                    isArchived: doc.isArchived,
                    children: [],
                    tasks: [],
                    documentGroups: [],
                    singleDocuments: []
                };

                folderMap.set(currentPath, newFolder);

                const parent = folderMap.get(parentPath);
                if (parent) {
                    parent.children.push(newFolder);
                }
            }
        }
    }

    // Assign groups and singles to their folders
    for (const group of groups) {
        const folderPath = group.documents[0].relativePath || '';
        const folder = folderMap.get(folderPath);
        if (folder) {
            folder.documentGroups.push(group);
        }
    }

    for (const doc of singles) {
        const folderPath = doc.relativePath || '';
        const folder = folderMap.get(folderPath);
        if (folder) {
            folder.singleDocuments.push(doc);
        }
    }

    // Scan context documents for each folder
    for (const [relPath, folder] of folderMap) {
        const contextDocs = await scanContextDocumentsInFolder(folder.folderPath, relPath, folder.isArchived);
        if (contextDocs.length > 0) {
            folder.contextDocuments = contextDocs;
        }
    }

    return { root: rootFolder, folderMap };
}
