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
    /** Related items from related.yaml (if exists) */
    relatedItems?: RelatedItemsConfig;
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
    /** Discovery settings for feature folders */
    discovery: DiscoverySettings;
}

/** Settings for AI Discovery in Tasks Viewer */
export interface DiscoverySettings {
    /** Enable AI Discovery for feature folders */
    enabled: boolean;
    /** Default search scope for feature discovery */
    defaultScope: DiscoveryDefaultScope;
    /** Show 'Related Items' section in the tree view for features with related.yaml */
    showRelatedInTree: boolean;
    /** Group related items by category (source, test, commit) in tree view */
    groupByCategory: boolean;
}

/** Default scope configuration for discovery */
export interface DiscoveryDefaultScope {
    /** Include source code files */
    includeSourceFiles: boolean;
    /** Include documentation files */
    includeDocs: boolean;
    /** Include config files */
    includeConfigFiles: boolean;
    /** Include git history */
    includeGitHistory: boolean;
    /** Maximum number of commits to search */
    maxCommits: number;
}

/** Category of a related item */
export type RelatedItemCategory = 'source' | 'test' | 'doc' | 'config' | 'commit';

/** Type of a related item */
export type RelatedItemType = 'file' | 'commit';

/**
 * Represents a related item stored in related.yaml
 */
export interface RelatedItem {
    /** Display name */
    name: string;
    /** File path relative to workspace (for file type) */
    path?: string;
    /** Item type */
    type: RelatedItemType;
    /** Category for grouping */
    category: RelatedItemCategory;
    /** Relevance score (0-100) */
    relevance: number;
    /** Human-readable reason for relevance */
    reason: string;
    /** Commit hash (for commit type) */
    hash?: string;
}

/**
 * Configuration stored in related.yaml
 */
export interface RelatedItemsConfig {
    /** Feature description used for discovery */
    description: string;
    /** Related items */
    items: RelatedItem[];
    /** Timestamp of last update (ISO string) */
    lastUpdated?: string;
}
