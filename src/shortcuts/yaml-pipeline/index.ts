/**
 * YAML Pipeline Framework
 *
 * A YAML-based configuration layer on top of the map-reduce framework.
 * Provides easy configuration for AI MapReduce workflows via YAML files.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 *
 * NOTE: Core pipeline functionality is now provided by the pipeline-core package.
 * This module re-exports from pipeline-core and adds VS Code-specific UI components.
 */

// ============================================================================
// Re-export from pipeline-core package (core pipeline functionality)
// ============================================================================
export {
    // Configuration types (YAML schema)
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
    SKILL_METADATA_FILENAME,
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
} from '@anthropic-ai/pipeline-core';

// Re-export execution types from pipeline-core (canonical source)
export type {
    AIInvoker,
    AIInvokerOptions,
    AIInvokerResult,
    ProcessTracker,
    SessionMetadata,
    ExecutorOptions,
    JobProgress,
    MapReduceResult,
    MapResult,
    ExecutionStats,
    ReduceStats,
    PromptItem,
    PromptMapResult,
    PromptMapInput,
    PromptMapOutput,
    PromptMapSummary,
    PromptMapJobOptions,
    OutputFormat
} from '@anthropic-ai/pipeline-core';

// Re-export ConcurrencyLimiter from pipeline-core
export { ConcurrencyLimiter } from '@anthropic-ai/pipeline-core';

// Re-export extractVariables and parseAIResponse/extractJSON from pipeline-core
export { extractVariables, parseAIResponse, extractJSON } from '@anthropic-ai/pipeline-core';

// Re-export job creation from pipeline-core for advanced usage
export { createPromptMapJob, createPromptMapInput } from '@anthropic-ai/pipeline-core';

// UI Components for Pipelines Viewer
export {
    PipelineManager,
    PipelinesTreeDataProvider,
    PipelineItem,
    ResourceItem,
    PipelineCommands,
    registerPipelineResultsProvider,
    PIPELINE_RESULTS_SCHEME,
    registerPipelinePreview,
    PipelinePreviewEditorProvider
} from './ui';

export type {
    PipelineTreeItem
} from './ui';

export { PipelineCategoryItem } from './ui';

export type {
    PipelineInfo,
    ResourceFileInfo,
    ValidationResult,
    PipelinesViewerSettings,
    PipelineSortBy,
    TreeItemType,
    PipelineTemplateType,
    PipelineTemplate,
    BundledPipelineManifest
} from './ui';

export { PIPELINE_TEMPLATES, PipelineSource } from './ui';

// Bundled Pipelines
export {
    BUNDLED_PIPELINES,
    getBundledPipelinesPath,
    getBundledPipelineManifest,
    getAllBundledPipelineManifests,
    isValidBundledPipelineId,
    getBundledPipelineDirectory,
    getBundledPipelineEntryPoint,
    // Read-only provider for bundled pipelines
    BUNDLED_PIPELINE_SCHEME,
    BundledPipelineContentProvider,
    createBundledPipelineUri,
    registerBundledPipelineProvider
} from './ui';

// Result Viewer (enhanced pipeline result display)
export {
    PipelineResultViewerProvider,
    registerPipelineResultViewer,
    PIPELINE_RESULTS_EXPORT_SCHEME,
    getResultViewerContent,
    getItemDetailContent,
    mapResultToNode,
    getItemPreview,
    formatDuration as formatResultDuration,
    getStatusIcon,
    getStatusClass
} from './ui';

export type {
    PipelineResultViewData,
    PipelineItemResultNode,
    ResultViewerMessage,
    ResultViewerMessageType,
    ResultViewerFilterState,
    ResultNodeType
} from './ui';
