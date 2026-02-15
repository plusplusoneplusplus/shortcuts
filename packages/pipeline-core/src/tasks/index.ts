/**
 * Tasks module - Types and parsing utilities for task management.
 * Extracted from the VS Code extension's tasks-viewer for use in CLI tools.
 */

export {
    // Types
    Task,
    TaskDocument,
    TaskDocumentGroup,
    TaskSortBy,
    TaskStatus,
    TaskFolder,
    TasksViewerSettings,
    DiscoverySettings,
    DiscoveryDefaultScope,
    RelatedItemCategory,
    RelatedItemType,
    RelatedItem,
    RelatedItemsConfig,
    TaskCreationMode,
    TaskGenerationDepth,
    AITaskCreateOptions,
    AITaskFromFeatureOptions,
    AITaskCreationOptions,
    AITaskDialogResult,
    FeatureContext,
    ReviewStatus,
    ReviewStatusRecord,
    ReviewStatusStore,
} from './types';

export {
    // Parser utilities
    VALID_TASK_STATUSES,
    COMMON_DOC_TYPES,
    parseTaskStatus,
    updateTaskStatus,
    parseFileName,
    sanitizeFileName,
} from './task-parser';

export {
    // Related-items-loader
    RELATED_ITEMS_FILENAME,
    loadRelatedItems,
    saveRelatedItems,
    hasRelatedItems,
    deleteRelatedItems,
    removeRelatedItem,
    mergeRelatedItems,
    getRelatedItemsPath,
    categorizeItem,
} from './related-items-loader';

export {
    // Task scanning and grouping
    scanTasksRecursively,
    scanDocumentsRecursively,
    scanFoldersRecursively,
    groupTaskDocuments,
    buildTaskFolderHierarchy,
} from './task-scanner';
