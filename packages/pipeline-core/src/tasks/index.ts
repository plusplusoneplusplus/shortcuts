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
