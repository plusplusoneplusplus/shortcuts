/**
 * Task scanning and grouping utilities extracted from the VS Code extension's TaskManager.
 * Pure Node.js functions with no VS Code dependencies.
 */

import * as path from 'path';
import { safeReadDir, safeStats, safeExists } from '../utils/file-utils';
import { parseTaskStatus, parseFileName } from './task-parser';
import { Task, TaskDocument, TaskDocumentGroup, TaskFolder } from './types';

const archiveFolderName = 'archive';

/**
 * Recursively walk a directory and return flat Task[] for each .md file found.
 * Skips the 'archive' folder when isArchived is false.
 */
export function scanTasksRecursively(dirPath: string, relativePath: string, isArchived: boolean): Task[] {
    const tasks: Task[] = [];

    const readResult = safeReadDir(dirPath);
    if (!readResult.success || !readResult.data) {
        return tasks;
    }

    for (const item of readResult.data) {
        const itemPath = path.join(dirPath, item);
        const statsResult = safeStats(itemPath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            if (!isArchived && item === archiveFolderName) {
                continue;
            }
            const subRelativePath = relativePath ? path.join(relativePath, item) : item;
            const subTasks = scanTasksRecursively(itemPath, subRelativePath, isArchived);
            tasks.push(...subTasks);
        } else if (statsResult.data.isFile() && item.endsWith('.md')) {
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
export function scanDocumentsRecursively(dirPath: string, relativePath: string, isArchived: boolean): TaskDocument[] {
    const documents: TaskDocument[] = [];

    const readResult = safeReadDir(dirPath);
    if (!readResult.success || !readResult.data) {
        return documents;
    }

    for (const item of readResult.data) {
        const itemPath = path.join(dirPath, item);
        const statsResult = safeStats(itemPath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            if (!isArchived && item === archiveFolderName) {
                continue;
            }
            const subRelativePath = relativePath ? path.join(relativePath, item) : item;
            const subDocuments = scanDocumentsRecursively(itemPath, subRelativePath, isArchived);
            documents.push(...subDocuments);
        } else if (statsResult.data.isFile() && item.endsWith('.md')) {
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
export function scanFoldersRecursively(
    dirPath: string,
    relativePath: string,
    isArchived: boolean,
    folderMap: Map<string, TaskFolder>,
    parentFolder: TaskFolder
): void {
    const readResult = safeReadDir(dirPath);
    if (!readResult.success || !readResult.data) {
        return;
    }

    for (const item of readResult.data) {
        const itemPath = path.join(dirPath, item);
        const statsResult = safeStats(itemPath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            if (!isArchived && item === archiveFolderName) {
                continue;
            }

            const folderRelativePath = relativePath ? path.join(relativePath, item) : item;

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

                scanFoldersRecursively(itemPath, folderRelativePath, isArchived, folderMap, newFolder);
            } else {
                const existingFolder = folderMap.get(folderRelativePath)!;
                scanFoldersRecursively(itemPath, folderRelativePath, isArchived, folderMap, existingFolder);
            }
        }
    }
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

/**
 * Build a hierarchical TaskFolder tree from documents.
 * Scans directories for folder structure, creates intermediate folders for document paths,
 * and assigns groups and singles to their respective folders.
 *
 * @returns The root TaskFolder and folderMap (for post-processing such as loading related items).
 */
export function buildTaskFolderHierarchy(
    rootPath: string,
    documents: TaskDocument[],
    scanArchive: boolean,
    archivePath?: string
): { root: TaskFolder; folderMap: Map<string, TaskFolder> } {
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
    scanFoldersRecursively(rootPath, '', false, folderMap, rootFolder);

    // Scan archive directory tree if requested
    if (scanArchive && archivePath && safeExists(archivePath)) {
        scanFoldersRecursively(archivePath, '', true, folderMap, rootFolder);
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

        const pathParts = doc.relativePath.split(path.sep);
        let currentPath = '';

        for (const part of pathParts) {
            const parentPath = currentPath;
            currentPath = currentPath ? path.join(currentPath, part) : part;

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

    return { root: rootFolder, folderMap };
}
