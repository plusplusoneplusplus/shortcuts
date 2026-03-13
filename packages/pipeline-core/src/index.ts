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
    resetLogger,
    formatTimestamp
} from './logger';

// ============================================================================
// Pino Logger (structured logging)
// ============================================================================

export {
    PinoLoggerOptions,
    LogStoreName,
    createRootPinoLogger,
    createLogStore,
    createPinoAdapter,
    createPinoNullLogger,
} from './pino-logger';

// ============================================================================
// AI Service Logger (structured Pino logging for AI domain)
// ============================================================================

export {
    initAIServiceLogger,
    getAIServiceLogger,
    createSessionLogger,
} from './ai-logger';

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
    // Path utilities
    toForwardSlashes,
    toNativePath,
    isWithinDirectory,
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
    DEFAULT_AI_IDLE_TIMEOUT_MS,
    // Concurrency
    DEFAULT_PARALLEL_LIMIT,
    DEFAULT_MAX_CONCURRENCY,
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
    getModelContextWindow,
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
    ConversationTurn,
    SerializedConversationTurn,
    TimelineItem,
    SerializedTimelineItem,
    ToolCall,
    ToolCallStatus,
    ToolCallPermissionRequest,
    ToolCallPermissionResult,
    SerializedToolCall,
    serializeProcess,
    deserializeProcess,
    ProcessEventType,
    ProcessEvent,
    ProcessCounts,
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
    Attachment,
    SendMessageOptions,
    SystemMessageConfig,
    SDKInvocationResult,
    SDKAvailabilityResult,
    AgentMode,
    DeliveryMode,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    approveAllPermissions,
    denyAllPermissions,
    READ_ONLY_MARKER,
    READ_ONLY_SYSTEM_MESSAGE,
    ToolEvent,
    Tool,
    ToolHandler,
    ToolInvocation,
    defineTool,
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
    setHomeDirectoryOverride,
    // Timeline Utilities
    mergeConsecutiveContentItems,
} from './ai';

// ============================================================================
// Process Store
// ============================================================================

export {
    ProcessOutputEvent,
    WorkspaceInfo,
    WikiInfo,
    ProcessFilter,
    ProcessChangeCallback,
    ProcessStore,
    StorageStats
} from './process-store';

export {
    FileProcessStore,
    FileProcessStoreOptions,
    StoredProcessEntry,
    ProcessIndexEntry,
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
    CommitReference,
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
    PipelinePhase,
    PipelinePhaseStatus,
    PipelinePhaseEvent,
    PipelineProgressEvent,
    ItemProcessEventData,
    PipelinePhaseInfo,
    PipelineProcessMetadata,
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
    TaskPriority,
    QueueStatus,

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
    DrainEvent,
    DrainCompleteEvent,
    DrainTimeoutEvent,
    QueueExecutorDrainEvents,

    // Executor types
    TaskExecutionResult,
    TaskExecutor,
    QueueExecutorOptions,
    DEFAULT_EXECUTOR_OPTIONS,

    // Queue manager types
    TaskQueueManagerOptions,
    DEFAULT_QUEUE_MANAGER_OPTIONS,
    QueueStats,

    // Registry types
    RegistryStats,

    // Priority helpers
    PRIORITY_VALUES,
    comparePriority,

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

    // Repo Queue Registry
    RepoQueueRegistry,

    // Pause Marker types
    PauseMarker,
    QueueItem,

    // Follow-Prompt utilities
    FollowPromptPayload,
    isFollowPromptPayload,
    buildFollowPromptText,
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
    // Discovery prompt builders
    buildDiscoveryPrompt,
    parseDiscoveryResponse,
    DiscoveryPromptInput,
    DiscoveryScope,
    DiscoveredItem,
} from './tasks';

// ============================================================================
// Discovery
// ============================================================================

export {
    // Types
    PromptFileInfo,
    SkillInfo,
    InstructionFileSet,
    // Prompt file discovery
    findPromptFiles,
    // Skill discovery
    findSkills,
    // Instruction file discovery
    findInstructionFiles,
    loadInstructions,
    MAX_INSTRUCTION_SIZE,
    INSTRUCTION_DIR,
} from './discovery';
export type { InstructionMode } from './discovery';

// ============================================================================
// Git
// ============================================================================

export {
    GitChangeStatus,
    GitChangeStage,
    GitChange,
    GitChangeCounts,
    GitCommit,
    CommitLoadOptions,
    CommitLoadResult,
    GitCommitFile,
    GitCommentCounts,
    GitCommitRange,
    GitCommitRangeFile,
    GitRangeConfig,
    BranchStatus,
    GitBranch,
    BranchListOptions,
    PaginatedBranchResult,
    GitOperationResult,
    STATUS_SHORT,
    STAGE_PREFIX,
    STAGE_LABEL,
    ExecGitOptions,
    execGit,
    getRemoteUrl,
    normalizeRemoteUrl,
    computeRemoteHash,
    detectRemoteUrl,
    GitLogService,
    GitRangeService,
    BranchService,
    WorkingTreeService,
    parsePorcelain,
    GitOpsStore,
    GitOpJob,
    GitOpType,
    GitOpStatus,
    GitOpsStoreOptions,
} from './git';

// ============================================================================
// Editor Abstractions
// ============================================================================

export {
    // Domain types
    CommentStatus,
    CommentType,
    CommentSelection,
    CommentAnchor,
    MermaidContext,
    MarkdownComment,
    isUserComment,
    CommentsSettings,
    CommentsConfig,
    DEFAULT_COMMENTS_SETTINGS,
    DEFAULT_COMMENTS_CONFIG,
    // Message protocol
    // (PromptFileInfo is already exported from ./discovery)
    SkillInfo as EditorSkillInfo,
    SerializedPredefinedComment,
    WebviewSettings,
    PendingSelection,
    AIInstructionType,
    AskAIContext,
    RecentPrompt,
    RecentItem,
    AIModelOption,
    FollowPromptDialogOptions,
    LineChange,
    WebviewToBackendMessage,
    BackendToWebviewMessage,
    EditorMessage,
    // Transport
    MessageListener,
    EditorTransport,
    // Host
    EditorHost,
    // State Store
    StateStore,
    FileStateStore,
    // Rendering – comment state
    filterCommentsByStatus,
    sortCommentsByLine,
    sortCommentsByColumnDescending,
    groupCommentsByLine,
    groupCommentsByAllCoveredLines,
    getCommentsForLine,
    blockHasComments,
    countCommentsByStatus,
    findCommentById,
    updateCommentStatus,
    updateCommentText,
    deleteComment,
    resolveAllComments,
    getSelectionCoverageForLine,
    // Rendering – selection utilities
    SelectionPositionWithText,
    calculateColumnIndices,
    getHighlightColumnsForLine,
    createPlainToHtmlMapping,
    applyCommentHighlightToRange,
    // Rendering – markdown renderer
    MarkdownLineResult,
    escapeHtml,
    applySourceModeHighlighting,
    applySourceModeInlineHighlighting,
    applyInlineMarkdown,
    applyMarkdownHighlighting,
    resolveImagePath,
    generateAnchorId,
    // Rendering – heading parser
    HeadingInfo,
    parseHeadings,
    findSectionEndLine,
    buildSectionMap,
    getHeadingLevel,
    getHeadingAnchorId,
    generateHeadingAnchorId,
    // Rendering – cursor management
    CursorPosition,
    MockNode,
    NODE_TYPES,
    TextNodeReference,
    calculateColumnOffset,
    findLineElement,
    getLineNumber,
    findTextNodeAtColumn,
    getCursorPositionFromSelection,
    adjustCursorAfterInsertion,
    adjustCursorAfterDeletion,
    validateCursorPosition,
    compareCursorPositions,
    isCursorInRange,
    restoreCursorAfterContentChange,
    // Rendering – content extraction
    ContentExtractionResult,
    ExtractionContext,
    DEFAULT_SKIP_CLASSES,
    normalizeExtractedLine,
    createExtractionContext,
    shouldSkipElement,
    isBlockElement,
    isLineContentElement,
    isLineRowElement,
    isBlockContentElement,
    isBrElement,
    processTextNode,
    addNewLine,
    extractBlockText,
    extractTableText,
    hasMeaningfulContentAfterBr,
    processNode,
    extractPlainTextContent,
    applyInsertion,
    applyDeletion,
    getTotalCharacterCount,
    positionToOffset,
    offsetToPosition,
    // Parsing – markdown structural parser
    CodeBlock,
    MarkdownHighlightResult,
    MarkdownLineType,
    ParsedTable,
    parseCodeBlocks,
    hasMermaidBlocks,
    parseMermaidBlocks,
    detectHeadingLevel,
    isBlockquote,
    isUnorderedListItem,
    isOrderedListItem,
    isHorizontalRule,
    isTaskListItem,
    isCodeFenceStart,
    isCodeFenceEnd,
    detectLineType,
    detectEmphasis,
    extractLinks,
    extractInlineCode,
    extractImages,
    isExternalImageUrl,
    isDataUrl,
    parseTableRow,
    parseTableAlignments,
    isTableSeparator,
    isTableRow,
    parseTable,
    parseTables,
    getLanguageDisplayName,
    // Parsing – block renderers
    TableRenderOptions,
    CodeBlockRenderOptions,
    renderTable,
    renderCodeBlock,
    renderMermaidContainer,
    // Anchor types
    BaseAnchorData,
    AnchorRelocationStrategy,
    AnchorRelocationResult,
    // Anchor functions
    extractTextFromSelection,
    createAnchorData,
    relocateAnchorPosition,
    needsRelocationCheck,
    batchRelocateAnchors,
    // Diff comment types
    DiffCommentSelection,
    DiffCommentContext,
    DiffCommentReply,
    DiffComment,
} from './editor';

// ============================================================================
// Memory
// ============================================================================

export type {
    RawObservation,
    RawObservationMetadata,
    ConsolidatedMemory,
    MemoryIndex,
    RepoInfo,
    MemoryLevel,
    MemoryConfig,
    MemoryStoreOptions,
    MemoryStats,
    MemoryStore,
} from './memory';

export { FileMemoryStore, computeRepoHash } from './memory';
export { MemoryRetriever } from './memory';
export { createWriteMemoryTool } from './memory';
export type { WriteMemoryToolOptions, WriteMemoryArgs } from './memory';
export { MemoryAggregator } from './memory';
export type { AggregatorOptions } from './memory';
export { withMemory } from './memory';
export type { WithMemoryOptions } from './memory';
export { FileToolCallCacheStore, ToolCallCacheAggregator, resolveToolCallCacheOptions } from './memory';
export { ToolCallCapture } from './memory';
export type { ToolCallCaptureOptions } from './memory';
export { TASK_FILTER, ALL_TOOLS_FILTER, createToolNameFilter } from './memory';
export type {
    ToolCallFilter,
    ToolCallQAEntry,
    ToolCallCacheIndex,
    ConsolidatedToolCallEntry,
    ToolCallCacheConfig,
    ToolCallCacheLevel,
    ToolCallCacheStoreOptions,
    ToolCallCacheStats,
    ToolCallCacheStore,
} from './memory';

// ============================================================================
// Skills
// ============================================================================

export {
    SkillSourceType,
    DEFAULT_SKILLS_SETTINGS,
    detectSource,
    scanForSkills,
    installSkills,
    getBundledSkillsPath,
    getBundledSkills,
    installBundledSkills,
} from './skills';

export type {
    DiscoveredSkill,
    ParsedSource,
    ScanResult,
    InstallResult,
    InstallDetail,
    SkillsSettings,
    BundledSkill,
} from './skills';

export { SourceDetectionErrors } from './skills';

// ============================================================================
// ADO (Azure DevOps)
// ============================================================================

export {
    AdoConnectionConfig,
    AdoConnectionResult,
    AdoClientOptions,
    AdoConnectionFactory,
    getAdoConnectionFactory,
    resetAdoConnectionFactory,
} from './ado';

// ============================================================================
// Templates
// ============================================================================

export {
    Template,
    CommitTemplate,
    ReplicateOptions,
    FileChange,
    ReplicateResult,
    buildReplicatePrompt,
    parseReplicateResponse,
    replicateCommit,
    ReplicateProgressCallback,
} from './templates';

// ============================================================================
// Workflow Engine
// ============================================================================

export {
    // Item types
    type Item as WorkflowItem,
    type Items as WorkflowItems,

    // Load source
    type LoadSource,

    // Filter rule types
    type WorkflowFilterOp,
    type WorkflowFilterRule,

    // Transform operations
    type TransformOp,

    // Reduce strategy
    type ReduceStrategy,

    // Base node
    type BaseNode,

    // Concrete node configs
    type LoadNodeConfig,
    type ScriptNodeConfig,
    type FilterNodeConfig,
    type MapNodeConfig,
    type ReduceNodeConfig,
    type MergeNodeConfig,
    type TransformNodeConfig,
    type AINodeConfig,

    // Node config union
    type NodeConfig,

    // Workflow configuration
    type WorkflowSettings,
    type WorkflowConfig,

    // Execution results
    type NodeStats,
    type NodeResult,
    type WorkflowResult,

    // DAG graph types
    type DAGGraph,
    type ExecutionTier,

    // Execution options
    type WorkflowExecutionOptions,

    // Progress events
    type WorkflowNodePhase,
    type WorkflowProgressEvent,
    type WorkflowItemProcessEvent,

    // Type guards
    isLoadNode,
    isScriptNode,
    isFilterNode,
    isMapNode,
    isReduceNode,
    isMergeNode,
    isTransformNode,
    isAINode,
    isNodeConfig,

    // Graph utilities
    buildGraph,
    detectCycle,

    // Validator
    validate as validateWorkflow,
    WorkflowValidationError,

    // Scheduler
    schedule as scheduleWorkflow,
    getExecutionOrder,

    // Executor
    executeWorkflow,

    // Compiler
    compileToWorkflow,
    compileToWorkflowFromObject,
    detectFormat,
    CompilerError,
    type DetectedFormat,

    // Result adapter
    flattenWorkflowResult,
    type ExecutionStats as WorkflowExecutionStats,
    type ItemResult as WorkflowItemResult,
    type FlatWorkflowResult,
} from './workflow';

// ============================================================================
// Provider Abstractions (pull requests + work items)
// ============================================================================

export {
    ProviderType,
    type Identity as ProviderIdentity,
    type Comment as ProviderComment,
    type CommentThread as ProviderCommentThread,
    type PullRequestStatus as ProviderPullRequestStatus,
    type ReviewVote,
    type Reviewer,
    type PullRequest as ProviderPullRequest,
    type WorkItem as ProviderWorkItem,
    type SearchCriteria as ProviderSearchCriteria,
    type CreatePullRequestInput,
    type UpdatePullRequestInput,
    type CreateWorkItemInput,
    type UpdateWorkItemInput,
} from './providers';

export type {
    IProviderConfig,
    AdoProviderConfig,
    GitHubProviderConfig,
    IPullRequestsService,
    IWorkItemsService,
} from './providers';

export { AdoPullRequestsAdapter } from './ado/ado-pull-requests-adapter';
export { AdoWorkItemsAdapter } from './ado/ado-work-items-adapter';
export { createAdoPullRequestsAdapter } from './ado/create-ado-adapter';

export { GitHubPullRequestsAdapter, GitHubIssuesAdapter, createGitHubPullRequestsAdapter } from './github';
