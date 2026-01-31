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
    /** Task workflow status parsed from frontmatter (defaults to 'pending' if not specified) */
    status?: TaskStatus;
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
    /** Task workflow status parsed from frontmatter (defaults to 'pending' if not specified) */
    status?: TaskStatus;
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
 * Task workflow status - represents the lifecycle state of a task
 * - pending: Task is ready to be worked on (default for new tasks)
 * - in-progress: Task is currently being worked on
 * - done: Task is completed
 * - future: Task is captured but not ready to work on (backlog/someday)
 */
export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'future';

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
    /** Whether to show tasks marked as 'future' in the Tasks Viewer */
    showFuture: boolean;
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

/** Task creation mode */
export type TaskCreationMode = 'create' | 'from-feature';

/** AI generation depth for 'from-feature' mode */
export type TaskGenerationDepth = 'simple' | 'deep';

/**
 * Options for creating an AI-generated task via the dialog (create mode)
 */
export interface AITaskCreateOptions {
    /** Task name (used as filename) - optional, AI will generate if empty */
    name?: string;
    /** Target folder path relative to tasks root (empty string = root) */
    location: string;
    /** Brief description for AI to expand */
    description: string;
    /** AI model to use (follows AI Action prompt pattern) */
    model: string;
}

/**
 * Options for creating a task from feature context (from-feature mode)
 */
export interface AITaskFromFeatureOptions {
    /** Task name (used as filename) - optional, AI will generate if empty */
    name?: string;
    /** Target folder path relative to tasks root (must be a feature folder) */
    location: string;
    /** Task focus/description (what specific aspect to focus on) */
    focus: string;
    /** Generation depth: simple (single-pass) or deep (multi-phase) */
    depth: TaskGenerationDepth;
    /** AI model to use */
    model: string;
}

/**
 * Unified options for AI task creation dialog
 */
export interface AITaskCreationOptions {
    /** Creation mode */
    mode: TaskCreationMode;
    /** Options for 'create' mode */
    createOptions?: AITaskCreateOptions;
    /** Options for 'from-feature' mode */
    fromFeatureOptions?: AITaskFromFeatureOptions;
}

/**
 * Result from the AI Task creation dialog
 */
export interface AITaskDialogResult {
    /** The creation options if not cancelled */
    options: AITaskCreationOptions | null;
    /** Whether the dialog was cancelled */
    cancelled: boolean;
}

/**
 * Feature context gathered from a folder for 'from-feature' mode
 */
export interface FeatureContext {
    /** Whether any content was found */
    hasContent: boolean;
    /** Description from related.yaml or folder name */
    description: string;
    /** List of existing task documents in the folder */
    existingTasks: string[];
    /** List of relevant source files */
    sourceFiles: string[];
    /** List of relevant config files */
    configFiles: string[];
    /** Related commits (if available) */
    commits: string[];
}

// ============================================================================
// Review Status Tracking Types
// ============================================================================

/**
 * Review status states for task documents
 */
export type ReviewStatus = 'reviewed' | 'unreviewed' | 'needs-re-review';

/**
 * Record storing review status for a single file
 */
export interface ReviewStatusRecord {
    /** Current review status */
    status: 'reviewed' | 'unreviewed';
    /** ISO timestamp when marked as reviewed */
    reviewedAt: string;
    /** MD5 hash of file content when reviewed (for change detection) */
    fileHashAtReview: string;
    /** Optional user identifier who performed the review */
    reviewedBy?: string;
}

/**
 * Storage structure for all review statuses
 * Key: relative path from tasks root (e.g., "TaskPanel/review-status-tracking.plan.md")
 * Value: ReviewStatusRecord
 */
export interface ReviewStatusStore {
    [relativePath: string]: ReviewStatusRecord;
}
