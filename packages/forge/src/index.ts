/**
 * pipeline-core
 *
 * AI pipeline execution engine with map-reduce framework.
 * A pure Node.js package for building and executing AI-powered data processing pipelines.
 */

// ============================================================================
// Logger (standalone file — cannot use export *)
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

export * from './errors';

// ============================================================================
// Runtime (Async Policies + Concurrency Limiter)
// ============================================================================

export * from './runtime';

// ============================================================================
// Utils
// ============================================================================

export * from './utils';

// ============================================================================
// Config (Centralized Defaults)
// ============================================================================

export * from './config';

// ============================================================================
// AI Service
// ============================================================================

export {
    // Types
    AIBackendType,
    AIInvocationResult,
    DEFAULT_PROMPTS,
    InteractiveToolType,
    // Model registry
    AIModel,
    VALID_MODELS,
    DEFAULT_MODEL_ID,
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
    SessionCategory,
    GenericProcessMetadata,
    GenericGroupMetadata,
    TypedProcessOptions,
    ProcessGroupOptions,
    CompleteGroupOptions,
    CodeReviewProcessMetadata,
    DiscoveryProcessMetadata,
    CodeReviewGroupMetadata,
    AIProcess,
    PendingMessage,
    PendingFileAttachmentMeta,
    SerializedAIProcess,
    TrackedProcessFields,
    ConversationTurn,
    SerializedConversationTurn,
    TurnSource,
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
    BackgroundTasksInfo,
    // Model Metadata Store
    modelMetadataStore,
    resolveReasoningEffort,
    resolveReasoningSelection,
    ResolvedReasoningSelection,
    ResolveReasoningEffortOptions,
    ModelInfo,
    // SDK types
    TokenUsage,
    MCPServerConfigBase,
    MCPLocalServerConfig,
    MCPRemoteServerConfig,
    MCPServerConfig,
    MCPControlOptions,
    Attachment,
    SendMessageOptions,
    McpOAuthEvent,
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
    isPermissionApproved,
    READ_ONLY_SYSTEM_MESSAGE,
    ToolEvent,
    Tool,
    ToolHandler,
    ToolInvocation,
    defineTool,
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
    // Trusted Folder Management
    ensureFolderTrusted,
    isFolderTrusted,
    getCopilotConfigPath,
    setTrustedFolderHomeOverride,
    // Timeline Utilities
    mergeConsecutiveContentItems,
    // Token Usage Stats
    TokenUsageStatsEntry,
    TokenUsageStatsResponse,
    aggregateTokenUsageStats,
    COPILOT_MODEL_PRICING,
    COPILOT_PRICING_SOURCE,
    CopilotModelPricing,
    CopilotTokenCostBreakdown,
    estimateCopilotTokenCost,
    getCopilotModelPricing,
    normalizeCopilotModelId,
} from './ai';

// ============================================================================
// Process Store
// ============================================================================

export {
    HookStepEvent,
    ProcessOutputEvent,
    WorkspaceInfo,
    WikiInfo,
    ProcessFilter,
    ProcessChangeCallback,
    ProcessStore,
    StorageStats,
    ConversationSearchResult,
    SearchFilter,
    PromptAutocompleteHistoryItem,
    PromptAutocompleteContext,
} from './process-store';

export {
    FileProcessStore,
    FileProcessStoreOptions,
    StoredProcessEntry,
    ProcessIndexEntry,
    getDefaultDataDir,
    ensureDataDir,
} from './file-process-store';

export { SqliteProcessStore, SqliteProcessStoreOptions } from './sqlite-process-store';
export { SqliteQueueStore, SqliteQueueStoreOptions } from './sqlite-queue-store';
export { Database, initializeDatabase, SCHEMA_VERSION, getSchemaVersion } from './sqlite-schema';

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
    // ConcurrencyLimiter is now exported from ./runtime (via export * from './runtime')
    // Extracted collaborators
    ProgressReporter,
    ProcessTrackerAdapter,
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
    // Jobs
    createTemplateJob,
    createSimpleTemplateJob,
    createJsonTemplateJob,
    createListProcessingJob,
    createPromptMapJob,
    createPromptMapInput,
    // Temp file utilities
    writeTempFile,
    readTempFile,
    cleanupTempFile,
    cleanupAllTempFiles,
    ensureTempDir,
    generateTempFileName,
    isTempFilePath,
    getTempDirPath,
} from './map-reduce';
export type {
    Deduplicatable,
    DeterministicReducerOptions,
    DeterministicReduceOutput,
    AIReducerOptions,
    TextSynthesisOutput,
    TextSynthesisOptions,
    HybridReducerOptions,
    SimplePolishedOutput,
    FileItem,
    FileInput,
    FileWorkItemData,
    FileSplitterOptions,
    BatchedFileWorkItemData,
    ChunkInput,
    ChunkWorkItemData,
    ChunkSplitterOptions,

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
    TempFileResult,
} from './map-reduce';

// ============================================================================
// Pipeline Config Types (from workflow/pipeline-compat)
// ============================================================================

export type {
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
    JobConfig,
} from './workflow/pipeline-compat';
export { isCSVSource, isGenerateConfig } from './workflow/pipeline-compat';

// ============================================================================
// Pipeline Phase/Event Types (from pipeline-types)
// ============================================================================

export type {
    PipelinePhase,
    PipelinePhaseStatus,
    PipelinePhaseEvent,
    PipelineProgressEvent,
    ItemProcessEventData,
    PipelinePhaseInfo,
    PipelineProcessMetadata,
} from './pipeline-types';

// ============================================================================
// CSV Reader (from utils/csv-reader)
// ============================================================================

export {
    parseCSVContent,
    readCSVFile,
    readCSVFileSync,
    resolveCSVPath,
    validateCSVHeaders,
    getCSVPreview,
    CSVParseError,
    DEFAULT_CSV_OPTIONS,
} from './utils/csv-reader';

// ============================================================================
// Template Engine (from utils/pipeline-template)
// ============================================================================

export {
    substituteTemplate,
    validateItemForTemplate,
    buildFullPrompt,
    buildPromptFromTemplate,
    escapeTemplateValue,
    previewTemplate,
    TemplateError,
} from './utils/pipeline-template';
export type { SubstituteTemplateOptions } from './utils/pipeline-template';

// ============================================================================
// Filter Executor (from utils/filter-executor)
// ============================================================================

export {
    executeFilter,
    executeRuleFilter,
    executeAIFilter,
    executeHybridFilter,
} from './utils/filter-executor';
export type { FilterExecuteOptions, FilterProgress } from './utils/filter-executor';

// ============================================================================
// Prompt Resolver (from utils/prompt-resolver)
// ============================================================================

export {
    resolvePromptFile,
    resolvePromptFileSync,
    resolvePromptFileWithDetails,
    resolvePromptPath,
    getSearchPaths,
    extractPromptContent,
    promptFileExists,
    validatePromptFile,
    PromptResolverError,
} from './utils/prompt-resolver';
export type { PromptResolutionResult } from './utils/prompt-resolver';

// ============================================================================
// Skill Resolver (from skills/skill-resolver)
// ============================================================================

export {
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
    SKILL_PROMPT_FILENAME,
} from './skills/skill-resolver';
export type { SkillResolutionResult, SkillMetadata } from './skills/skill-resolver';

// ============================================================================
// Input Generator (from utils/input-generator)
// ============================================================================

export {
    generateInputItems,
    buildGeneratePrompt,
    parseGenerateResponse,
    toGeneratedItems,
    getSelectedItems,
    createEmptyItem,
    validateGenerateConfig,
    InputGenerationError,
} from './utils/input-generator';
export type { GenerateInputResult, GeneratedItem, GenerateState } from './utils/input-generator';

// ============================================================================
// Queue System
// ============================================================================

export * from './queue';

// ============================================================================
// Tasks
// ============================================================================

export * from './tasks';

// ============================================================================
// Discovery
// ============================================================================

export * from './discovery';

// ============================================================================
// Git
// ============================================================================

export * from './git';

// ============================================================================
// Diff (Unified Diff Provider)
// ============================================================================

export * from './diff';

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
    // Message protocol (PromptFileInfo is exported from ./discovery)
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
    // Rendering - comment state
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
    // Rendering - selection utilities
    SelectionPositionWithText,
    calculateColumnIndices,
    getHighlightColumnsForLine,
    createPlainToHtmlMapping,
    applyCommentHighlightToRange,
    // Rendering - markdown renderer
    MarkdownLineResult,
    escapeHtml,
    applySourceModeHighlighting,
    applySourceModeInlineHighlighting,
    applyInlineMarkdown,
    applyMarkdownHighlighting,
    resolveImagePath,
    generateAnchorId,
    // Rendering - heading parser
    HeadingInfo,
    parseHeadings,
    findSectionEndLine,
    buildSectionMap,
    getHeadingLevel,
    getHeadingAnchorId,
    generateHeadingAnchorId,
    // Rendering - cursor management
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
    // Rendering - content extraction
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
    // Parsing - markdown structural parser
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
    // Parsing - block renderers
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
// Review (Unified Diff Review)
// ============================================================================

export * from './review';

// ============================================================================
// Memory
// ============================================================================

export * from './memory';

// ============================================================================
// Skills
// ============================================================================

export * from './skills';

// ============================================================================
// ADO (Azure DevOps)
// ============================================================================

export * from './ado';
export { createAdoPullRequestsAdapter } from './ado/create-ado-adapter';

// ============================================================================
// Templates
// ============================================================================

export * from './templates';

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
    type PullRequestCommit,
    type PullRequest as ProviderPullRequest,
    type PullRequestCommit as ProviderPullRequestCommit,
    type CheckStatus as ProviderCheckStatus,
    type CheckSource as ProviderCheckSource,
    type PullRequestCheck as ProviderPullRequestCheck,
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

// ============================================================================
// GitHub
// ============================================================================

export * from './github';

// ============================================================================
// Path Utilities
// ============================================================================

export { getRepoDataPath } from './paths';
