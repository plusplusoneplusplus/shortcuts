/**
 * YAML Pipeline Framework
 *
 * A YAML-based configuration layer on top of the map-reduce framework.
 * Provides easy configuration for AI MapReduce workflows via YAML files.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// Configuration types (YAML schema)
export type {
    PipelineConfig,
    InputConfig,
    MapConfig,
    ReduceConfig,
    CSVParseOptions,
    CSVParseResult,
    PipelineParameter,
    CSVSource,
    GenerateInputConfig
} from './types';

// Type guards
export { isCSVSource, isGenerateConfig } from './types';

// Re-export execution types from map-reduce (canonical source)
export type {
    AIInvoker,
    AIInvokerOptions,
    AIInvokerResult,
    ProcessTracker,
    ExecutorOptions,
    JobProgress,
    MapReduceResult,
    PromptItem,
    PromptMapResult,
    PromptMapInput,
    PromptMapOutput,
    PromptMapSummary,
    PromptMapJobOptions,
    OutputFormat
} from './types';

// CSV Reader utilities
export {
    parseCSVContent,
    readCSVFile,
    readCSVFileSync,
    resolveCSVPath,
    validateCSVHeaders,
    getCSVPreview,
    CSVParseError,
    DEFAULT_CSV_OPTIONS
} from './csv-reader';

// Template Engine utilities
export {
    substituteTemplate,
    extractVariables,
    validateItemForTemplate,
    buildFullPrompt,
    buildPromptFromTemplate,
    parseAIResponse,
    extractJSON,
    escapeTemplateValue,
    previewTemplate,
    TemplateError
} from './template';

// Input Generator (AI-powered input generation)
export {
    buildGeneratePrompt,
    parseGenerateResponse,
    generateInputItems,
    toGeneratedItems,
    getSelectedItems,
    createEmptyItem,
    validateGenerateConfig,
    InputGenerationError
} from './input-generator';
export type {
    GenerateInputResult,
    GeneratedItem,
    GenerateState
} from './input-generator';

// Executor (main API)
export {
    executePipeline,
    parsePipelineYAML,
    parsePipelineYAMLSync,
    PipelineExecutionError,
    DEFAULT_PARALLEL_LIMIT
} from './executor';
export type {
    ExecutePipelineOptions,
    PipelineExecutionResult
} from './executor';

// Re-export job creation from map-reduce for advanced usage
export {
    createPromptMapJob,
    createPromptMapInput
} from '../map-reduce/jobs/prompt-map-job';

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

export type {
    PipelineInfo,
    ResourceFileInfo,
    ValidationResult,
    PipelinesViewerSettings,
    PipelineSortBy,
    TreeItemType,
    PipelineTemplateType,
    PipelineTemplate
} from './ui';

export { PIPELINE_TEMPLATES } from './ui';

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
