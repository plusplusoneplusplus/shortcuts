/**
 * YAML Pipeline Framework
 *
 * A simple YAML-based configuration for running AI MapReduce workflows.
 * Supports CSV input, prompt templates with variable substitution, and list output.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// Types
export type {
    PipelineConfig,
    InputConfig,
    MapConfig,
    ReduceConfig,
    PipelineItem,
    PipelineMapResult,
    PipelineResult,
    PipelineStats,
    PipelineExecutorOptions,
    PipelineProgress,
    AIInvoker,
    AIInvokerOptions,
    AIInvokerResult,
    CSVParseOptions,
    CSVParseResult
} from './types';

// CSV Reader
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

// Template Engine
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

// List Reducer
export {
    formatResultsAsList,
    formatItem,
    formatOutput,
    formatValue,
    truncateValue,
    formatResultsAsTable,
    formatResultsAsJSON,
    formatResultsAsCSV,
    DEFAULT_LIST_FORMAT_OPTIONS
} from './list-reducer';
export type { ListFormatOptions } from './list-reducer';

// Executor
export {
    executePipeline,
    createPipelineExecutor,
    parsePipelineYAML,
    parsePipelineYAMLSync,
    PipelineExecutionError,
    DEFAULT_PARALLEL_LIMIT
} from './executor';
