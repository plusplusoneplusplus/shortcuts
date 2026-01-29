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
    DEFAULT_POLL_INTERVAL_MS
} from './utils';

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
    DEFAULT_MAP_REDUCE_OPTIONS,
    // Executor
    MapReduceExecutor,
    createExecutor,
    // Concurrency limiter
    ConcurrencyLimiter,
    CancellationError,
    DEFAULT_MAX_CONCURRENCY,
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
    DEFAULT_PARALLEL_LIMIT,
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
    DEFAULT_SKILLS_DIRECTORY,
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
