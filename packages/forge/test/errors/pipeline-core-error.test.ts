/**
 * Tests for PipelineCoreError and error utilities
 */

import { describe, it, expect } from 'vitest';
import {
    ErrorCode,
    ErrorCodeType,
    mapSystemErrorCode,
    PipelineCoreError,
    ErrorMetadata,
    isPipelineCoreError,
    toPipelineCoreError,
    wrapError,
    getErrorCauseMessage,
} from '../../src/errors';

describe('ErrorCode', () => {
    it('should have all expected error codes', () => {
        expect(ErrorCode.CANCELLED).toBe('CANCELLED');
        expect(ErrorCode.TIMEOUT).toBe('TIMEOUT');
        expect(ErrorCode.RETRY_EXHAUSTED).toBe('RETRY_EXHAUSTED');
        expect(ErrorCode.AI_INVOCATION_FAILED).toBe('AI_INVOCATION_FAILED');
        expect(ErrorCode.PIPELINE_EXECUTION_FAILED).toBe('PIPELINE_EXECUTION_FAILED');
        expect(ErrorCode.CSV_PARSE_ERROR).toBe('CSV_PARSE_ERROR');
        expect(ErrorCode.TEMPLATE_ERROR).toBe('TEMPLATE_ERROR');
        expect(ErrorCode.MISSING_VARIABLE).toBe('MISSING_VARIABLE');
        expect(ErrorCode.UNKNOWN).toBe('UNKNOWN');
    });
});

describe('mapSystemErrorCode', () => {
    it('should map ENOENT to FILE_NOT_FOUND', () => {
        expect(mapSystemErrorCode('ENOENT')).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should map EACCES to PERMISSION_DENIED', () => {
        expect(mapSystemErrorCode('EACCES')).toBe(ErrorCode.PERMISSION_DENIED);
    });

    it('should map EPERM to PERMISSION_DENIED', () => {
        expect(mapSystemErrorCode('EPERM')).toBe(ErrorCode.PERMISSION_DENIED);
    });

    it('should map ETIMEDOUT to TIMEOUT', () => {
        expect(mapSystemErrorCode('ETIMEDOUT')).toBe(ErrorCode.TIMEOUT);
    });

    it('should map ECONNREFUSED to AI_INVOCATION_FAILED', () => {
        expect(mapSystemErrorCode('ECONNREFUSED')).toBe(ErrorCode.AI_INVOCATION_FAILED);
    });

    it('should map other E* codes to FILE_SYSTEM_ERROR', () => {
        expect(mapSystemErrorCode('EEXIST')).toBe(ErrorCode.FILE_SYSTEM_ERROR);
        expect(mapSystemErrorCode('EISDIR')).toBe(ErrorCode.FILE_SYSTEM_ERROR);
    });

    it('should return UNKNOWN for non-E codes', () => {
        expect(mapSystemErrorCode('SOME_OTHER')).toBe(ErrorCode.UNKNOWN);
    });
});

describe('PipelineCoreError', () => {
    it('should create error with message only', () => {
        const error = new PipelineCoreError('Test error');
        
        expect(error.message).toBe('Test error');
        expect(error.name).toBe('PipelineCoreError');
        expect(error.code).toBe(ErrorCode.UNKNOWN);
        expect(error.cause).toBeUndefined();
        expect(error.meta).toBeUndefined();
    });

    it('should create error with code', () => {
        const error = new PipelineCoreError('CSV error', {
            code: ErrorCode.CSV_PARSE_ERROR,
        });
        
        expect(error.code).toBe(ErrorCode.CSV_PARSE_ERROR);
    });

    it('should create error with cause', () => {
        const originalError = new Error('Original');
        const error = new PipelineCoreError('Wrapped error', {
            cause: originalError,
        });
        
        expect(error.cause).toBe(originalError);
    });

    it('should create error with metadata', () => {
        const meta: ErrorMetadata = {
            executionId: 'exec-123',
            phase: 'map',
            attempt: 2,
            maxAttempts: 3,
        };
        const error = new PipelineCoreError('Error with meta', { meta });
        
        expect(error.meta).toEqual(meta);
        expect(error.meta?.executionId).toBe('exec-123');
    });

    it('should be instance of Error', () => {
        const error = new PipelineCoreError('Test');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(PipelineCoreError);
    });

    it('should format detailed string correctly', () => {
        const error = new PipelineCoreError('Test error', {
            code: ErrorCode.TIMEOUT,
            meta: { timeoutMs: 5000 },
        });
        
        const detailed = error.toDetailedString();
        expect(detailed).toContain('[TIMEOUT]');
        expect(detailed).toContain('Test error');
        expect(detailed).toContain('5000');
    });

    it('should serialize to JSON correctly', () => {
        const cause = new Error('Cause');
        const error = new PipelineCoreError('Test', {
            code: ErrorCode.PIPELINE_EXECUTION_FAILED,
            cause,
            meta: { phase: 'reduce' },
        });
        
        const json = error.toJSON();
        expect(json.name).toBe('PipelineCoreError');
        expect(json.code).toBe('PIPELINE_EXECUTION_FAILED');
        expect(json.message).toBe('Test');
        expect(json.meta).toEqual({ phase: 'reduce' });
        expect((json.cause as { message: string }).message).toBe('Cause');
    });
});

describe('isPipelineCoreError', () => {
    it('should return true for PipelineCoreError', () => {
        const error = new PipelineCoreError('Test');
        expect(isPipelineCoreError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
        const error = new Error('Test');
        expect(isPipelineCoreError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
        expect(isPipelineCoreError('string')).toBe(false);
        expect(isPipelineCoreError(null)).toBe(false);
        expect(isPipelineCoreError(undefined)).toBe(false);
        expect(isPipelineCoreError({})).toBe(false);
    });
});

describe('toPipelineCoreError', () => {
    it('should return existing PipelineCoreError unchanged', () => {
        const error = new PipelineCoreError('Test', { code: ErrorCode.TIMEOUT });
        const result = toPipelineCoreError(error);
        
        expect(result).toBe(error);
    });

    it('should merge additional meta into existing error', () => {
        const error = new PipelineCoreError('Test', {
            code: ErrorCode.TIMEOUT,
            meta: { existing: 'value' },
        });
        const result = toPipelineCoreError(error, ErrorCode.UNKNOWN, { added: 'new' });
        
        expect(result.meta?.existing).toBe('value');
        expect(result.meta?.added).toBe('new');
    });

    it('should wrap regular Error with detected code', () => {
        const nodeError = Object.assign(new Error('Not found'), { code: 'ENOENT' });
        const result = toPipelineCoreError(nodeError);
        
        expect(result).toBeInstanceOf(PipelineCoreError);
        expect(result.code).toBe(ErrorCode.FILE_NOT_FOUND);
        expect(result.cause).toBe(nodeError);
    });

    it('should use default code when no detection possible', () => {
        const error = new Error('Generic error');
        const result = toPipelineCoreError(error, ErrorCode.AI_INVOCATION_FAILED);
        
        expect(result.code).toBe(ErrorCode.AI_INVOCATION_FAILED);
    });

    it('should wrap string error', () => {
        const result = toPipelineCoreError('Something went wrong');
        
        expect(result.message).toBe('Something went wrong');
        expect(result.cause).toBe('Something went wrong');
    });

    it('should wrap other primitives', () => {
        const result = toPipelineCoreError(42);
        expect(result.message).toBe('42');
    });
});

describe('wrapError', () => {
    it('should wrap error with new message', () => {
        const original = new Error('Original');
        const wrapped = wrapError('Wrapped message', original);
        
        expect(wrapped.message).toBe('Wrapped message');
        expect(wrapped.cause).toBe(original);
    });

    it('should preserve code from PipelineCoreError cause', () => {
        const original = new PipelineCoreError('Original', { code: ErrorCode.TIMEOUT });
        const wrapped = wrapError('Wrapped', original);
        
        expect(wrapped.code).toBe(ErrorCode.TIMEOUT);
    });

    it('should allow overriding code', () => {
        const original = new PipelineCoreError('Original', { code: ErrorCode.TIMEOUT });
        const wrapped = wrapError('Wrapped', original, ErrorCode.RETRY_EXHAUSTED);
        
        expect(wrapped.code).toBe(ErrorCode.RETRY_EXHAUSTED);
    });

    it('should include metadata', () => {
        const wrapped = wrapError('Wrapped', new Error('Cause'), undefined, {
            taskId: 'task-1',
        });
        
        expect(wrapped.meta?.taskId).toBe('task-1');
    });
});

describe('getErrorCauseMessage', () => {
    it('should extract message from simple error', () => {
        const error = new Error('Simple message');
        expect(getErrorCauseMessage(error)).toBe('Simple message');
    });

    it('should chain messages from nested errors', () => {
        const inner = new PipelineCoreError('Inner error');
        const outer = new PipelineCoreError('Outer error', { cause: inner });
        
        const message = getErrorCauseMessage(outer);
        expect(message).toBe('Outer error -> Inner error');
    });

    it('should handle deeply nested errors', () => {
        const e1 = new PipelineCoreError('Level 1');
        const e2 = new PipelineCoreError('Level 2', { cause: e1 });
        const e3 = new PipelineCoreError('Level 3', { cause: e2 });
        
        const message = getErrorCauseMessage(e3);
        expect(message).toBe('Level 3 -> Level 2 -> Level 1');
    });

    it('should respect max depth', () => {
        const e1 = new PipelineCoreError('Level 1');
        const e2 = new PipelineCoreError('Level 2', { cause: e1 });
        const e3 = new PipelineCoreError('Level 3', { cause: e2 });
        const e4 = new PipelineCoreError('Level 4', { cause: e3 });
        
        const message = getErrorCauseMessage(e4, 2);
        expect(message).toBe('Level 4 -> Level 3');
    });

    it('should handle string cause', () => {
        const error = new PipelineCoreError('Main', { cause: 'String cause' });
        const message = getErrorCauseMessage(error);
        expect(message).toBe('Main -> String cause');
    });
});
