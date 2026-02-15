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

export {
    // Task CRUD operations
    createTask,
    createFeature,
    createSubfolder,
    renameTask,
    renameFolder,
    renameDocumentGroup,
    renameDocument,
    deleteTask,
    deleteFolder,
    archiveTask,
    unarchiveTask,
    archiveDocument,
    unarchiveDocument,
    archiveDocumentGroup,
    unarchiveDocumentGroup,
    moveTask,
    moveFolder,
    moveTaskGroup,
    importTask,
    moveExternalTask,
    taskExistsInFolder,
    taskExists,
} from './task-operations';

export {
    // TaskManager facade
    TaskManager,
    TaskManagerOptions,
} from './task-manager';

export {
    // Task prompt builders (pure Node.js, no VS Code deps)
    buildCreateTaskPrompt,
    buildCreateTaskPromptWithName,
    buildCreateFromFeaturePrompt,
    buildDeepModePrompt,
    gatherFeatureContext,
    parseCreatedFilePath,
    cleanAIResponse,
    FeatureContextInput,
    SelectedContext,
    TaskGenerationOptions,
} from './task-prompt-builder';

export {
    // Discovery prompt builders
    buildDiscoveryPrompt,
    parseDiscoveryResponse,
    DiscoveryPromptInput,
    DiscoveryScope,
    DiscoveredItem,
} from './discovery-prompt-builder';
