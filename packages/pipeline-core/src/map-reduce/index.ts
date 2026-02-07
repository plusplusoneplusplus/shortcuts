/**
 * Map-Reduce AI Framework
 *
 * A reusable framework for AI map-reduce workflows.
 * Provides pluggable splitters, mappers, reducers, and prompt templates
 * with consistent UI/process tracking.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// Core types
export type {
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
    ItemCompleteCallback
} from './types';
export { DEFAULT_MAP_REDUCE_OPTIONS } from './types';

// Executor
export { MapReduceExecutor, createExecutor } from './executor';

// Concurrency limiter
export { ConcurrencyLimiter, CancellationError, DEFAULT_MAX_CONCURRENCY } from './concurrency-limiter';

// Prompt template
export {
    renderTemplate,
    createTemplate,
    extractVariables,
    validateTemplate,
    composeTemplates,
    TemplateHelpers,
    ResponseParsers,
    MissingVariableError,
    TemplateRenderError
} from './prompt-template';

// Reducers
export {
    // Base reducers
    BaseReducer,
    IdentityReducer,
    FlattenReducer,
    AggregatingReducer,
    // Deterministic reducer
    DeterministicReducer,
    createDeterministicReducer,
    StringDeduplicationReducer,
    NumericAggregationReducer,
    // AI reducer
    AIReducer,
    createAIReducer,
    createTextSynthesisReducer,
    // Hybrid reducer
    HybridReducer,
    createHybridReducer,
    createSimpleHybridReducer
} from './reducers';
export type {
    Deduplicatable,
    DeterministicReducerOptions,
    DeterministicReduceOutput,
    AIReducerOptions,
    TextSynthesisOutput,
    TextSynthesisOptions,
    HybridReducerOptions,
    SimplePolishedOutput
} from './reducers';

// Splitters
export {
    // File splitter
    FileSplitter,
    createFileSplitter,
    createExtensionFilteredSplitter,
    BatchedFileSplitter,
    createBatchedFileSplitter,
    // Chunk splitter
    ChunkSplitter,
    createChunkSplitter,
    createLineChunkSplitter,
    createParagraphChunkSplitter,
    // Rule splitter
    RuleSplitter,
    createRuleSplitter,
    createAlphabeticRuleSplitter,
    createPriorityRuleSplitter,
    createPatternFilteredRuleSplitter,
    BatchedRuleSplitter,
    createBatchedRuleSplitter
} from './splitters';
export type {
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
    BatchedRuleWorkItemData
} from './splitters';

// Jobs
export {
    createCodeReviewJob,
    createTemplateJob,
    createSimpleTemplateJob,
    createJsonTemplateJob,
    createListProcessingJob,
    createPromptMapJob,
    createPromptMapInput
} from './jobs';
export type {
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
    OutputFormat
} from './jobs';

// Temp file utilities
export {
    writeTempFile,
    readTempFile,
    cleanupTempFile,
    cleanupAllTempFiles,
    ensureTempDir,
    generateTempFileName,
    isTempFilePath,
    getTempDirPath
} from './temp-file-utils';
export type { TempFileResult } from './temp-file-utils';
