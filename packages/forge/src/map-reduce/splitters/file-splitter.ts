/**
 * File Splitter
 *
 * Splits input by files for file-based processing.
 * Handles both arrays of files and file-containing objects.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { Splitter, WorkItem } from '../types';

/**
 * A file item with path and optional content
 */
export interface FileItem {
    /** File path (relative or absolute) */
    path: string;
    /** File content (optional, may be loaded separately) */
    content?: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Input for file splitter
 */
export interface FileInput {
    /** Array of files to process */
    files: FileItem[];
    /** Common context to include with each work item */
    context?: Record<string, unknown>;
}

/**
 * Work item data for file processing
 */
export interface FileWorkItemData {
    /** The file being processed */
    file: FileItem;
    /** Common context from input */
    context?: Record<string, unknown>;
}

/**
 * Options for file splitter
 */
export interface FileSplitterOptions {
    /**
     * Function to generate work item ID from file
     * Default: uses file path
     */
    generateId?: (file: FileItem, index: number) => string;

    /**
     * Filter function to exclude certain files
     */
    filter?: (file: FileItem) => boolean;

    /**
     * Maximum number of files per work item (for batching)
     * Default: 1 (one file per work item)
     */
    batchSize?: number;
}

/**
 * Splitter that creates a work item for each file
 */
export class FileSplitter implements Splitter<FileInput, FileWorkItemData> {
    constructor(private options: FileSplitterOptions = {}) {}

    split(input: FileInput): WorkItem<FileWorkItemData>[] {
        const { files, context } = input;
        const { generateId, filter, batchSize = 1 } = this.options;

        // Apply filter if provided
        const filteredFiles = filter
            ? files.filter(filter)
            : files;

        // Generate work items
        const workItems: WorkItem<FileWorkItemData>[] = [];

        if (batchSize === 1) {
            // One file per work item
            for (let i = 0; i < filteredFiles.length; i++) {
                const file = filteredFiles[i];
                const id = generateId
                    ? generateId(file, i)
                    : `file-${i}-${this.normalizePathForId(file.path)}`;

                workItems.push({
                    id,
                    data: {
                        file,
                        context
                    },
                    metadata: {
                        index: i,
                        totalFiles: filteredFiles.length
                    }
                });
            }
        } else {
            // Batch files
            for (let i = 0; i < filteredFiles.length; i += batchSize) {
                const batch = filteredFiles.slice(i, i + batchSize);
                // For batched files, create a work item for each file in batch
                // (This maintains compatibility but allows for future batch processing)
                for (let j = 0; j < batch.length; j++) {
                    const file = batch[j];
                    const globalIndex = i + j;
                    const id = generateId
                        ? generateId(file, globalIndex)
                        : `file-${globalIndex}-${this.normalizePathForId(file.path)}`;

                    workItems.push({
                        id,
                        data: {
                            file,
                            context
                        },
                        metadata: {
                            index: globalIndex,
                            batchIndex: Math.floor(i / batchSize),
                            totalFiles: filteredFiles.length
                        }
                    });
                }
            }
        }

        return workItems;
    }

    /**
     * Normalize a file path for use in ID
     * Makes it safe and consistent across platforms
     */
    private normalizePathForId(path: string): string {
        // Replace path separators and special characters
        return path
            .replace(/[/\\]/g, '-')
            .replace(/[^a-zA-Z0-9-_.]/g, '')
            .toLowerCase()
            .slice(0, 50); // Limit length
    }
}

/**
 * Factory function to create a file splitter
 */
export function createFileSplitter(options?: FileSplitterOptions): FileSplitter {
    return new FileSplitter(options);
}

/**
 * Create a file splitter with extension filter
 */
export function createExtensionFilteredSplitter(
    extensions: string[],
    options?: Omit<FileSplitterOptions, 'filter'>
): FileSplitter {
    const normalizedExtensions = extensions.map(ext =>
        ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    );

    return new FileSplitter({
        ...options,
        filter: (file) => {
            const ext = getFileExtension(file.path).toLowerCase();
            return normalizedExtensions.includes(ext);
        }
    });
}

/**
 * Get the file extension from a path
 */
function getFileExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1 || lastDot === path.length - 1) {
        return '';
    }
    return path.slice(lastDot);
}

/**
 * Batched file splitter that groups multiple files into single work items
 */
export interface BatchedFileWorkItemData {
    /** Array of files in this batch */
    files: FileItem[];
    /** Common context from input */
    context?: Record<string, unknown>;
    /** Batch index */
    batchIndex: number;
}

/**
 * Splitter that creates work items with batches of files
 */
export class BatchedFileSplitter implements Splitter<FileInput, BatchedFileWorkItemData> {
    constructor(
        private batchSize: number = 5,
        private options: Omit<FileSplitterOptions, 'batchSize'> = {}
    ) {}

    split(input: FileInput): WorkItem<BatchedFileWorkItemData>[] {
        const { files, context } = input;
        const { filter } = this.options;

        // Apply filter if provided
        const filteredFiles = filter
            ? files.filter(filter)
            : files;

        const workItems: WorkItem<BatchedFileWorkItemData>[] = [];
        const totalBatches = Math.ceil(filteredFiles.length / this.batchSize);

        for (let i = 0; i < filteredFiles.length; i += this.batchSize) {
            const batch = filteredFiles.slice(i, i + this.batchSize);
            const batchIndex = Math.floor(i / this.batchSize);

            workItems.push({
                id: `batch-${batchIndex}`,
                data: {
                    files: batch,
                    context,
                    batchIndex
                },
                metadata: {
                    batchIndex,
                    totalBatches,
                    filesInBatch: batch.length,
                    totalFiles: filteredFiles.length
                }
            });
        }

        return workItems;
    }
}

/**
 * Factory function to create a batched file splitter
 */
export function createBatchedFileSplitter(
    batchSize: number,
    options?: Omit<FileSplitterOptions, 'batchSize'>
): BatchedFileSplitter {
    return new BatchedFileSplitter(batchSize, options);
}
