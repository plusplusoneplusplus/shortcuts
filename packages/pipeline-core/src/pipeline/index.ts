/**
 * Pipeline Module - Public API
 *
 * YAML-based pipeline execution framework.
 * Provides configuration types, execution, and utilities for AI pipelines.
 */

// Types
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
    // Re-exported from map-reduce
    AIInvoker,
    AIInvokerOptions,
    AIInvokerResult,
    ProcessTracker,
    SessionMetadata,
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
export { isCSVSource, isGenerateConfig } from './types';

// Executor
export {
    executePipeline,
    executePipelineWithItems,
    parsePipelineYAML,
    parsePipelineYAMLSync,
    PipelineExecutionError,
    DEFAULT_PARALLEL_LIMIT
} from './executor';
export type { ExecutePipelineOptions, PipelineExecutionResult } from './executor';

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
export type { SubstituteTemplateOptions } from './template';

// Filter Executor
export {
    executeFilter,
    executeRuleFilter,
    executeAIFilter,
    executeHybridFilter
} from './filter-executor';
export type { FilterExecuteOptions, FilterProgress } from './filter-executor';

// Prompt Resolver
export {
    resolvePromptFile,
    resolvePromptFileSync,
    resolvePromptFileWithDetails,
    resolvePromptPath,
    getSearchPaths,
    extractPromptContent,
    promptFileExists,
    validatePromptFile,
    PromptResolverError
} from './prompt-resolver';
export type { PromptResolutionResult } from './prompt-resolver';

// Skill Resolver
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
    DEFAULT_SKILLS_DIRECTORY,
    SKILL_PROMPT_FILENAME
} from './skill-resolver';
export type { SkillResolutionResult, SkillMetadata } from './skill-resolver';

// Input Generator
export {
    generateInputItems,
    buildGeneratePrompt,
    parseGenerateResponse,
    toGeneratedItems,
    getSelectedItems,
    createEmptyItem,
    validateGenerateConfig,
    InputGenerationError
} from './input-generator';
export type { GenerateInputResult, GeneratedItem, GenerateState } from './input-generator';
