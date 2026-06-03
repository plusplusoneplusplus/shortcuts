/**
 * Errors Module - Public API
 *
 * Exports all error types and utilities for the workflow package.
 */

// Error codes
export {
    ErrorCode,
    ErrorCodeType,
    mapSystemErrorCode,
} from './error-codes';

// Core error class and utilities
export {
    PipelineCoreError,
    ErrorMetadata,
    isPipelineCoreError,
    toPipelineCoreError,
    wrapError,
    getErrorCauseMessage,
    logError,
} from './pipeline-core-error';
