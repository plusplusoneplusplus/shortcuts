/**
 * Jobs Module
 *
 * Exports all job implementations and utilities.
 */

// Base mapper (shared scaffold for all mappers)
export { BaseMapper } from './base-mapper';

// Template job
export {
    createTemplateJob,
    createSimpleTemplateJob,
    createJsonTemplateJob,
    createListProcessingJob
} from './template-job';
export type {
    TemplateItem,
    TemplateJobInput,
    TemplateWorkItemData,
    TemplateItemResult,
    TemplateJobOptions
} from './template-job';

// Prompt map job (generic item + prompt template processing)
export {
    createPromptMapJob,
    createPromptMapInput
} from './prompt-map-job';
export type {
    PromptItem,
    PromptMapInput,
    PromptWorkItemData,
    PromptMapResult,
    PromptMapOutput,
    PromptMapSummary,
    PromptMapJobOptions,
    OutputFormat
} from './prompt-map-job';
