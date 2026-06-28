/**
 * Tasks module - types and parsing utilities for task management in CLI tools
 * and CoC server flows.
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
    ARCHIVE_UNDO_FILE,
    scanTasksRecursively,
    scanDocumentsRecursively,
    scanFoldersRecursively,
    scanContextDocumentsInFolder,
    groupTaskDocuments,
    buildTaskFolderHierarchy,
    isContextFile,
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
    // Composite helpers (replacements for TaskManager facade)
    resolveTaskPaths,
    ensureTaskFolders,
    getAllTasks,
    getAllDocuments,
    getAllDocumentGroups,
    getFullTaskHierarchy,
    getFeatureFolders,
} from './task-operations';

export {
    // Task prompt builders (pure Node.js)
    AUTO_FOLDER_SENTINEL,
    AutoFolderContext,
    buildAutoFolderLocationBlock,
    buildCreateTaskPrompt,
    buildCreateTaskPromptWithName,
    buildCreateFromFeaturePrompt,
    applyDeepModePrefix,
    buildDeepModePrompt,
    buildPlanGenerationSystemPrompt,
    PlanSystemPromptOptions,
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

export {
    // TaskManager facade (deprecated — use standalone functions above)
    TaskManager,
    TaskManagerOptions,
} from './task-manager';
