/**
 * Pipeline Phases - Public API
 *
 * Re-exports all phase modules for convenient access.
 */

// Shared types and helpers
export {
    PipelineExecutionError,
    emitPhase,
    createPhaseTrackingProgress,
    convertParametersToObject,
} from './shared';
export type {
    ExecutePipelineOptions,
    ItemProcessEvent,
    PipelineExecutionResult,
    ResolvedPrompts,
    MapReducePipelineConfig,
} from './shared';

// Validation
export {
    validatePipelineConfig,
    validatePipelineConfigForExecution,
    validateMapConfig,
    validateReduceConfig,
    validateInputConfig,
    validateJobConfig,
} from './validation';

// Input loading
export { loadInputItems, prepareItems } from './input-loader';

// Prompt resolution
export { resolvePrompts, buildPromptWithSkill, deriveWorkspaceRoot } from './prompt-resolution';

// Job dispatch (single-job mode)
export { executeSingleJob } from './job-dispatcher';

// Batch execution
export {
    executeBatchMode,
    splitIntoBatches,
    substituteModelTemplate,
    buildBatchPrompt,
    createEmptyOutput,
    createBatchTimeoutPromise,
    parseBatchResponse,
} from './batch-runner';

// Output collection and formatting
export {
    executeReducePhase,
    formatResults,
    formatValue,
    truncate,
    escapeCSV,
} from './output-collector';
