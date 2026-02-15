/**
 * pipeline-core
 *
 * AI pipeline execution engine with map-reduce framework.
 * A pure Node.js package for building and executing AI-powered data processing pipelines.
 *
 * Key Features:
 * - YAML-based pipeline configuration
 * - Map-reduce execution framework
 * - Copilot SDK integration
 * - Cross-platform compatible (Linux/Mac/Windows)
 *
 * @example
 * ```typescript
 * import { executePipeline, setLogger, consoleLogger } from 'pipeline-core';
 *
 * // Configure logging
 * setLogger(consoleLogger);
 *
 * // Execute a pipeline
 * const result = await executePipeline(config, {
 *     aiInvoker: async (prompt) => {
 *         // Your AI invocation logic
 *         return { success: true, response: '...' };
 *     },
 *     pipelineDirectory: '/path/to/pipeline'
 * });
 * ```
 */

// ============================================================================
// Logger
// ============================================================================

export {
    Logger,
    LogCategory,
    consoleLogger,
    nullLogger,
    setLogger,
    getLogger,
    resetLogger
} from './logger';

// ============================================================================
// Errors
// ============================================================================

export {
    // Error codes
    ErrorCode,
    ErrorCodeType,
    mapSystemErrorCode,
    // Core error class
    PipelineCoreError,
    ErrorMetadata,
    isPipelineCoreError,
    toPipelineCoreError,
    wrapError,
    getErrorCauseMessage,
    logError,
} from './errors';

// ============================================================================
// Runtime (Async Policies)
// ============================================================================

export {
    // Cancellation
    CancellationError,
    IsCancelledFn,
    isCancellationError,
    throwIfCancelled,
    createCancellationToken,
    // Timeout
    TimeoutError,
    TimeoutOptions,
    withTimeout,
    isTimeoutError,
    createTimeoutPromise,
    // Retry
    RetryExhaustedError,
    BackoffStrategy,
    OnAttemptFn,
    RetryOnFn,
    RetryOptions,
    DEFAULT_RETRY_OPTIONS,
    defaultRetryOn,
    retryOnTimeout,
    calculateDelay,
    withRetry,
    isRetryExhaustedError,
    // Policy (unified runner)
    PolicyOptions,
    DEFAULT_POLICY_OPTIONS,
    runWithPolicy,
    createPolicyRunner,
} from './runtime';

// ============================================================================
// Utils
// ============================================================================

export {
    // File utilities
    FileOperationResult,
    ReadFileOptions,
    WriteFileOptions,
    YAMLOptions,
    safeExists,
    safeIsDirectory,
    safeIsFile,
    safeReadFile,
    safeWriteFile,
    ensureDirectoryExists,
    safeReadDir,
    safeStats,
    readYAML,
    writeYAML,
    safeCopyFile,
    safeRename,
    safeRemove,
    getFileErrorMessage,
    // Glob utilities
    glob,
    getFilesWithExtension,
    // Exec utilities
    execAsync,
    // HTTP utilities
    HttpResponse,
    httpGet,
    httpDownload,
    httpGetJson,
    // Text matching utilities
    AnchorMatchConfig,
    DEFAULT_ANCHOR_MATCH_CONFIG,
    BaseMatchAnchor,
    hashText,
    levenshteinDistance,
    calculateSimilarity,
    normalizeText,
    splitIntoLines,
    getCharOffset,
    offsetToLineColumn,
    findAllOccurrences,
    scoreMatch,
    findFuzzyMatch,
    extractContext,
    // AI response parser
    extractJSON,
    parseAIResponse,
    // Terminal types
    TerminalType,
    InteractiveSessionStatus,
    InteractiveSession,
    ExternalTerminalLaunchOptions,
    ExternalTerminalLaunchResult,
    WindowFocusResult,
    // Window focus service
    WindowFocusService,
    getWindowFocusService,
    resetWindowFocusService,
    // External terminal launcher
    ExternalTerminalLauncher,
    getExternalTerminalLauncher,
    resetExternalTerminalLauncher,
    // Process monitor
    Disposable,
    ProcessCheckResult,
    ProcessMonitorOptions,
    ProcessMonitor,
    getProcessMonitor,
    resetProcessMonitor,
    DEFAULT_POLL_INTERVAL_MS,
    // Template engine
    TEMPLATE_VARIABLE_REGEX,
    SPECIAL_VARIABLES,
    SubstituteVariablesOptions,
    TemplateVariableError,
    substituteVariables,
    extractTemplateVariables,
    hasVariables,
    containsVariables,
    validateVariables
} from './utils';

// ============================================================================
// Config (Centralized Defaults)
// ============================================================================

export {
    // Timeouts
    DEFAULT_AI_TIMEOUT_MS,
    // Concurrency
    DEFAULT_PARALLEL_LIMIT,
    DEFAULT_MAX_CONCURRENCY,
    // Session Pool
    DEFAULT_MAX_SESSIONS,
    DEFAULT_IDLE_TIMEOUT_MS,
    DEFAULT_MIN_SESSIONS,
    DEFAULT_CLEANUP_INTERVAL_MS,
    DEFAULT_ACQUIRE_TIMEOUT_MS,
    // Chunk Splitter
    DEFAULT_CHUNK_MAX_SIZE,
    DEFAULT_CHUNK_OVERLAP_SIZE,
    DEFAULT_CHUNK_STRATEGY,
    DEFAULT_CHUNK_PRESERVE_BOUNDARIES,
    // CSV Reader
    DEFAULT_CSV_DELIMITER,
    DEFAULT_CSV_QUOTE,
    DEFAULT_CSV_HAS_HEADER,
    DEFAULT_CSV_SKIP_EMPTY_LINES,
    DEFAULT_CSV_TRIM_FIELDS,
    // Queue Executor
    DEFAULT_RETRY_ATTEMPTS,
    DEFAULT_RETRY_DELAY_MS,
    DEFAULT_QUEUE_MAX_CONCURRENT,
    DEFAULT_QUEUE_PROCESS_ON_STARTUP,
    DEFAULT_QUEUE_AUTO_START,
    DEFAULT_QUEUE_AUTO_PERSIST,
    // Skills
    DEFAULT_SKILLS_DIRECTORY,
    // Text Matching
    DEFAULT_FUZZY_MATCH_THRESHOLD,
    DEFAULT_CONTEXT_LINES,
    DEFAULT_CASE_SENSITIVE
} from './config';

// ============================================================================
// AI Service
// ============================================================================

export {
    // Types
    AIBackendType,
    AIModel,
    VALID_MODELS,
    AIInvocationResult,
    DEFAULT_PROMPTS,
    InteractiveToolType,
    DEFAULT_MODEL_ID,
    // Model registry
    ModelDefinition,
    MODEL_REGISTRY,
    getModelLabel,
    getModelDescription,
    getModelDefinition,
    getAllModels,
    getActiveModels,
    isValidModelId,
    getModelCount,
    getModelsByTier,
    // AI Command Types
    AICommand,
    AICommandMode,
    AICommandsConfig,
    DEFAULT_AI_COMMANDS,
    SerializedAICommand,
    SerializedAIMenuConfig,
    serializeCommand,
    serializeCommands,
    // Prompt Builder (Pure)
    PromptContext,
    substitutePromptVariables,
    buildPromptFromContext,
    usesTemplateVariables,
    getAvailableVariables,
    // Program Utilities
    checkProgramExists,
    clearProgramExistsCache,
    parseCopilotOutput,
    // Process Types
    AIToolType,
    AIProcessStatus,
    AIProcessType,
    GenericProcessMetadata,
    GenericGroupMetadata,
    TypedProcessOptions,
    ProcessGroupOptions,
    CompleteGroupOptions,
    CodeReviewProcessMetadata,
    DiscoveryProcessMetadata,
    CodeReviewGroupMetadata,
    AIProcess,
    SerializedAIProcess,
    TrackedProcessFields,
    serializeProcess,
    deserializeProcess,
    ProcessEventType,
    ProcessEvent,
    ProcessCounts,
    // Session Pool
    SessionPool,
    IPoolableSession,
    SessionFactory,
    SessionPoolOptions,
    SessionPoolStats,
    // CLI Utilities
    PROMPT_LENGTH_THRESHOLD,
    PROBLEMATIC_CHARS_PATTERN,
    COPILOT_BASE_FLAGS,
    escapeShellArg,
    shouldUseFileDelivery,
    writePromptToTempFile,
    buildCliCommand,
    BuildCliCommandResult,
    BuildCliCommandOptions,
    // Copilot SDK Service
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    TokenUsage,
    MCPServerConfigBase,
    MCPLocalServerConfig,
    MCPRemoteServerConfig,
    MCPServerConfig,
    MCPControlOptions,
    SendMessageOptions,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    SessionPoolConfig,
    DEFAULT_SESSION_POOL_CONFIG,
    approveAllPermissions,
    denyAllPermissions,
    // DEFAULT_AI_TIMEOUT_MS is exported from ./config
    // MCP Config Loader
    MCPConfigFile,
    MCPConfigLoadResult,
    getHomeDirectory,
    getMcpConfigPath,
    loadDefaultMcpConfig,
    loadDefaultMcpConfigAsync,
    mergeMcpConfigs,
    clearMcpConfigCache,
    mcpConfigExists,
    getCachedMcpConfig,
    setHomeDirectoryOverride
} from './ai';

// ============================================================================
// Process Store
// ============================================================================

export {
    ProcessOutputEvent,
    WorkspaceInfo,
    ProcessFilter,
    ProcessChangeCallback,
    ProcessStore
} from './process-store';

export {
    FileProcessStore,
    FileProcessStoreOptions,
    StoredProcessEntry,
    getDefaultDataDir,
    ensureDataDir
} from './file-process-store';

// ============================================================================
// Map-Reduce Framework
// ============================================================================

export {
    // Core types
    WorkItem,
    MapContext,
    MapResult,
    ReduceContext,
    ReduceResult,
    ReduceStats,
    ReduceMode,
    MapReduceOptions,
    Splitter,
    Mapper,
    Reducer,
    MapReduceJob,
    ProgressCallback,
    JobProgress,
    MapReduceResult,
    ExecutionStats,
    PromptTemplate,
    PromptRenderOptions,
    AIInvoker,
    AIInvokerOptions,
    AIInvokerResult,
    ProcessTracker,
    ExecutorOptions,
    SessionMetadata,
    ItemCompleteCallback,
    DEFAULT_MAP_REDUCE_OPTIONS,
    // Executor
    MapReduceExecutor,
    createExecutor,
    // Concurrency limiter
    ConcurrencyLimiter,
    // CancellationError is now exported from ./runtime
    // DEFAULT_MAX_CONCURRENCY is exported from ./config
    // Prompt template
    renderTemplate,
    createTemplate,
    extractVariables,
    validateTemplate,
    composeTemplates,
    TemplateHelpers,
    ResponseParsers,
    MissingVariableError,
    TemplateRenderError,
    // Reducers
    BaseReducer,
    IdentityReducer,
    FlattenReducer,
    AggregatingReducer,
    DeterministicReducer,
    createDeterministicReducer,
    StringDeduplicationReducer,
    NumericAggregationReducer,
    AIReducer,
    createAIReducer,
    createTextSynthesisReducer,
    HybridReducer,
    createHybridReducer,
    createSimpleHybridReducer,
    Deduplicatable,
    DeterministicReducerOptions,
    DeterministicReduceOutput,
    AIReducerOptions,
    TextSynthesisOutput,
    TextSynthesisOptions,
    HybridReducerOptions,
    SimplePolishedOutput,
    // Splitters
    FileSplitter,
    createFileSplitter,
    createExtensionFilteredSplitter,
    BatchedFileSplitter,
    createBatchedFileSplitter,
    ChunkSplitter,
    createChunkSplitter,
    createLineChunkSplitter,
    createParagraphChunkSplitter,
    RuleSplitter,
    createRuleSplitter,
    createAlphabeticRuleSplitter,
    createPriorityRuleSplitter,
    createPatternFilteredRuleSplitter,
    BatchedRuleSplitter,
    createBatchedRuleSplitter,
    FileItem,
    FileInput,
    FileWorkItemData,
    FileSplitterOptions,
    BatchedFileWorkItemData,
    ChunkInput,
    ChunkWorkItemData,
    ChunkSplitterOptions,
    Rule,
    RuleInput,
    RuleWorkItemData,
    RuleSplitterOptions,
    BatchedRuleWorkItemData,
    // Jobs
    createCodeReviewJob,
    createTemplateJob,
    createSimpleTemplateJob,
    createJsonTemplateJob,
    createListProcessingJob,
    createPromptMapJob,
    createPromptMapInput,
    ReviewSeverity,
    ReviewFinding,
    RuleReviewResult,
    ReviewSummary,
    CodeReviewOutput,
    CodeReviewInput,
    CodeReviewJobOptions,
    TemplateItem,
    TemplateJobInput,
    TemplateWorkItemData,
    TemplateItemResult,
    TemplateJobOptions,
    PromptItem,
    PromptMapInput,
    PromptWorkItemData,
    PromptMapResult,
    PromptMapOutput,
    PromptMapSummary,
    PromptMapJobOptions,
    OutputFormat,
    // Temp file utilities
    writeTempFile,
    readTempFile,
    cleanupTempFile,
    cleanupAllTempFiles,
    ensureTempDir,
    generateTempFileName,
    isTempFilePath,
    getTempDirPath,
    TempFileResult
} from './map-reduce';

// ============================================================================
// Pipeline Framework
// ============================================================================

export {
    // Types
    PipelineConfig,
    InputConfig,
    MapConfig,
    ReduceConfig,
    FilterConfig,
    CSVSource,
    CSVParseOptions,
    CSVParseResult,
    PipelineParameter,
    GenerateInputConfig,
    FilterOperator,
    FilterRule,
    RuleFilterConfig,
    AIFilterConfig,
    FilterStats,
    FilterResult,
    isCSVSource,
    isGenerateConfig,
    // Executor
    executePipeline,
    executePipelineWithItems,
    parsePipelineYAML,
    parsePipelineYAMLSync,
    PipelineExecutionError,
    // DEFAULT_PARALLEL_LIMIT is exported from ./config
    ExecutePipelineOptions,
    PipelineExecutionResult,
    // CSV Reader
    parseCSVContent,
    readCSVFile,
    readCSVFileSync,
    resolveCSVPath,
    validateCSVHeaders,
    getCSVPreview,
    CSVParseError,
    DEFAULT_CSV_OPTIONS,
    // Template Engine
    substituteTemplate,
    validateItemForTemplate,
    buildFullPrompt,
    buildPromptFromTemplate,
    escapeTemplateValue,
    previewTemplate,
    TemplateError,
    SubstituteTemplateOptions,
    // Filter Executor
    executeFilter,
    executeRuleFilter,
    executeAIFilter,
    executeHybridFilter,
    FilterExecuteOptions,
    FilterProgress,
    // Prompt Resolver
    resolvePromptFile,
    resolvePromptFileSync,
    resolvePromptFileWithDetails,
    resolvePromptPath,
    getSearchPaths,
    extractPromptContent,
    promptFileExists,
    validatePromptFile,
    PromptResolverError,
    PromptResolutionResult,
    // Skill Resolver
    resolveSkill,
    resolveSkillSync,
    resolveSkillWithDetails,
    resolveSkillWithDetailsSync,
    getSkillsDirectory,
    getSkillDirectory,
    getSkillPromptPath,
    skillExists,
    listSkills,
    validateSkill,
    SkillResolverError,
    // DEFAULT_SKILLS_DIRECTORY is exported from ./config
    SKILL_PROMPT_FILENAME,
    SkillResolutionResult,
    SkillMetadata,
    // Input Generator
    generateInputItems,
    buildGeneratePrompt,
    parseGenerateResponse,
    toGeneratedItems,
    getSelectedItems,
    createEmptyItem,
    validateGenerateConfig,
    InputGenerationError,
    GenerateInputResult,
    GeneratedItem,
    GenerateState
} from './pipeline';

// ============================================================================
// Queue System
// ============================================================================

export {
    // Core types
    TaskType,
    TaskPriority,
    QueueStatus,

    // Payload types
    FollowPromptPayload,
    ResolveCommentsPayload,
    CodeReviewPayload,
    AIClarificationPayload,
    CustomTaskPayload,
    TaskPayload,

    // Task configuration
    TaskExecutionConfig,
    DEFAULT_TASK_CONFIG,

    // Queued task
    QueuedTask,
    CreateTaskInput,
    TaskUpdate,

    // Events
    QueueChangeType,
    QueueChangeEvent,
    QueueEvents,

    // Executor types
    TaskExecutionResult,
    TaskExecutor,
    QueueExecutorOptions,
    DEFAULT_EXECUTOR_OPTIONS,

    // Queue manager types
    TaskQueueManagerOptions,
    DEFAULT_QUEUE_MANAGER_OPTIONS,
    QueueStats,

    // Priority helpers
    PRIORITY_VALUES,
    comparePriority,

    // Type guards
    isFollowPromptPayload,
    isResolveCommentsPayload,
    isCodeReviewPayload,
    isAIClarificationPayload,
    isCustomTaskPayload,

    // Utilities
    generateTaskId,

    // Task Queue Manager
    TaskQueueManager,
    createTaskQueueManager,

    // Queue Executor
    QueueExecutor,
    createQueueExecutor,
    SimpleTaskExecutor,
    createSimpleTaskExecutor,
} from './queue';

// ============================================================================
// Tasks
// ============================================================================

export {
    // Types
    Task, TaskDocument, TaskDocumentGroup, TaskSortBy, TaskStatus,
    TaskFolder, TasksViewerSettings, DiscoverySettings, DiscoveryDefaultScope,
    RelatedItemCategory, RelatedItemType, RelatedItem, RelatedItemsConfig,
    TaskCreationMode, TaskGenerationDepth,
    AITaskCreateOptions, AITaskFromFeatureOptions, AITaskCreationOptions,
    AITaskDialogResult, FeatureContext,
    ReviewStatus, ReviewStatusRecord, ReviewStatusStore,
    // Parser utilities
    VALID_TASK_STATUSES, COMMON_DOC_TYPES,
    parseTaskStatus, updateTaskStatus, parseFileName, sanitizeFileName,
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
    // Task scanning and grouping
    scanTasksRecursively,
    scanDocumentsRecursively,
    scanFoldersRecursively,
    groupTaskDocuments,
    buildTaskFolderHierarchy,
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
    // TaskManager facade
    TaskManager,
    TaskManagerOptions,
    // Task prompt builders
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
    // Discovery prompt builders
    buildDiscoveryPrompt,
    parseDiscoveryResponse,
    DiscoveryPromptInput,
    DiscoveryScope,
    DiscoveredItem,
} from './tasks';
