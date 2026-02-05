/**
 * Error Codes for Pipeline Core
 *
 * Well-known error codes used across the pipeline-core package.
 * These codes provide structured error identification without relying on message parsing.
 *
 * Categories:
 * - Control flow: CANCELLED, TIMEOUT, RETRY_EXHAUSTED
 * - AI operations: AI_INVOCATION_FAILED
 * - Pipeline phases: PIPELINE_*, MAP_REDUCE_*
 * - Queue operations: QUEUE_*
 * - Data operations: CSV_*, TEMPLATE_*, MISSING_VARIABLE
 */

/**
 * Error codes as a const object for type safety and autocompletion
 */
export const ErrorCode = {
    // =========================================================================
    // Control Flow
    // =========================================================================
    /** Operation was cancelled by user or system */
    CANCELLED: 'CANCELLED',
    /** Operation exceeded its timeout limit */
    TIMEOUT: 'TIMEOUT',
    /** All retry attempts have been exhausted */
    RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',

    // =========================================================================
    // AI Operations
    // =========================================================================
    /** AI invocation failed (SDK, CLI, or other backend) */
    AI_INVOCATION_FAILED: 'AI_INVOCATION_FAILED',
    /** AI response could not be parsed */
    AI_RESPONSE_PARSE_FAILED: 'AI_RESPONSE_PARSE_FAILED',
    /** AI session pool exhausted */
    AI_POOL_EXHAUSTED: 'AI_POOL_EXHAUSTED',

    // =========================================================================
    // Pipeline Execution
    // =========================================================================
    /** Generic pipeline execution failure */
    PIPELINE_EXECUTION_FAILED: 'PIPELINE_EXECUTION_FAILED',
    /** Pipeline filter phase failed */
    PIPELINE_FILTER_FAILED: 'PIPELINE_FILTER_FAILED',
    /** Pipeline input validation failed */
    PIPELINE_INPUT_INVALID: 'PIPELINE_INPUT_INVALID',
    /** Pipeline configuration is invalid */
    PIPELINE_CONFIG_INVALID: 'PIPELINE_CONFIG_INVALID',

    // =========================================================================
    // Map-Reduce
    // =========================================================================
    /** Split phase failed */
    MAP_REDUCE_SPLIT_FAILED: 'MAP_REDUCE_SPLIT_FAILED',
    /** Map phase failed for one or more items */
    MAP_REDUCE_MAP_FAILED: 'MAP_REDUCE_MAP_FAILED',
    /** Reduce phase failed */
    MAP_REDUCE_REDUCE_FAILED: 'MAP_REDUCE_REDUCE_FAILED',

    // =========================================================================
    // Queue Operations
    // =========================================================================
    /** Task exceeded its timeout */
    QUEUE_TASK_TIMEOUT: 'QUEUE_TASK_TIMEOUT',
    /** Task execution failed */
    QUEUE_TASK_FAILED: 'QUEUE_TASK_FAILED',
    /** Queue is not running */
    QUEUE_NOT_RUNNING: 'QUEUE_NOT_RUNNING',

    // =========================================================================
    // Data Operations
    // =========================================================================
    /** CSV parsing failed */
    CSV_PARSE_ERROR: 'CSV_PARSE_ERROR',
    /** Template rendering failed */
    TEMPLATE_ERROR: 'TEMPLATE_ERROR',
    /** Required template variable is missing */
    MISSING_VARIABLE: 'MISSING_VARIABLE',
    /** Prompt file resolution failed */
    PROMPT_RESOLUTION_FAILED: 'PROMPT_RESOLUTION_FAILED',
    /** Skill resolution failed */
    SKILL_RESOLUTION_FAILED: 'SKILL_RESOLUTION_FAILED',
    /** Input generation failed */
    INPUT_GENERATION_FAILED: 'INPUT_GENERATION_FAILED',

    // =========================================================================
    // File System
    // =========================================================================
    /** File not found (wrapper for ENOENT) */
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',
    /** Permission denied (wrapper for EACCES) */
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    /** Generic file system error */
    FILE_SYSTEM_ERROR: 'FILE_SYSTEM_ERROR',

    // =========================================================================
    // Unknown / Fallback
    // =========================================================================
    /** Error code could not be determined */
    UNKNOWN: 'UNKNOWN',
} as const;

/**
 * Type representing valid error codes
 */
export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Map Node.js system error codes to our error codes
 */
export function mapSystemErrorCode(nodeCode: string): ErrorCodeType {
    switch (nodeCode) {
        case 'ENOENT':
            return ErrorCode.FILE_NOT_FOUND;
        case 'EACCES':
        case 'EPERM':
            return ErrorCode.PERMISSION_DENIED;
        case 'ETIMEDOUT':
        case 'ESOCKETTIMEDOUT':
            return ErrorCode.TIMEOUT;
        case 'ECONNREFUSED':
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return ErrorCode.AI_INVOCATION_FAILED;
        default:
            if (nodeCode.startsWith('E')) {
                return ErrorCode.FILE_SYSTEM_ERROR;
            }
            return ErrorCode.UNKNOWN;
    }
}
