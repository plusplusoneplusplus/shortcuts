/**
 * Represents a task markdown file
 */
export interface Task {
    /** Filename without .md extension */
    name: string;
    /** Absolute path to the .md file */
    filePath: string;
    /** Last modified time for sorting */
    modifiedTime: Date;
    /** Whether task is in archive folder */
    isArchived: boolean;
    /** Relative path from tasks root folder (undefined for root-level files) */
    relativePath?: string;
}

/**
 * Represents a single document within a task document group
 * (e.g., task1.plan.md has baseName="task1", docType="plan")
 */
export interface TaskDocument {
    /** Base name without doc type suffix and .md extension (e.g., "task1" from "task1.plan.md") */
    baseName: string;
    /** Document type suffix (e.g., "plan" from "task1.plan.md", undefined for "task1.md") */
    docType?: string;
    /** Full filename (e.g., "task1.plan.md") */
    fileName: string;
    /** Absolute path to the .md file */
    filePath: string;
    /** Last modified time for sorting */
    modifiedTime: Date;
    /** Whether document is in archive folder */
    isArchived: boolean;
    /** Relative path from tasks root folder (undefined for root-level files) */
    relativePath?: string;
}

/**
 * Represents a group of related task documents with the same base name
 * (e.g., task1.plan.md, task1.test.md, task1.spec.md grouped under "task1")
 */
export interface TaskDocumentGroup {
    /** Base name shared by all documents in the group */
    baseName: string;
    /** All documents in this group */
    documents: TaskDocument[];
    /** Whether this group is archived */
    isArchived: boolean;
    /** Most recent modified time among all documents */
    latestModifiedTime: Date;
}

/** Sort options for tasks */
export type TaskSortBy = 'name' | 'modifiedDate';

/**
 * Represents a folder containing task files
 */
export interface TaskFolder {
    /** Folder name */
    name: string;
    /** Absolute path to the folder */
    folderPath: string;
    /** Relative path from tasks root folder */
    relativePath: string;
    /** Whether folder is in archive */
    isArchived: boolean;
    /** Child folders */
    children: TaskFolder[];
    /** Task files directly in this folder */
    tasks: Task[];
    /** Task document groups in this folder */
    documentGroups: TaskDocumentGroup[];
    /** Single task documents in this folder (not grouped) */
    singleDocuments: TaskDocument[];
}

/** Settings for the Tasks Viewer feature */
export interface TasksViewerSettings {
    enabled: boolean;
    /** Path to tasks folder relative to workspace root */
    folderPath: string;
    showArchived: boolean;
    sortBy: TaskSortBy;
    /** Whether to group related documents (e.g., task1.plan.md, task1.test.md) under a single parent */
    groupRelatedDocuments: boolean;
}
