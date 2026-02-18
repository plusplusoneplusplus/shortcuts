import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as http from 'http';
import {
    APIError,
    handleAPIError,
    badRequest,
    notFound,
    forbidden,
    invalidJSON,
    missingFields,
    internalError,
} from '../src/errors';

// ============================================================================
// Helper: Capture response from handleAPIError
// ============================================================================

function createMockResponse(): {
    res: http.ServerResponse;
    getStatusCode: () => number;
    getBody: () => any;
    getHeaders: () => Record<string, string>;
} {
    let statusCode = 0;
    let body = '';
    const headers: Record<string, string> = {};

    const res = {
        writeHead: vi.fn((code: number, hdrs?: Record<string, string>) => {
            statusCode = code;
            if (hdrs) {
                Object.assign(headers, hdrs);
            }
        }),
        end: vi.fn((data?: string) => {
            if (data) { body = data; }
        }),
    } as unknown as http.ServerResponse;

    return {
        res,
        getStatusCode: () => statusCode,
        getBody: () => body ? JSON.parse(body) : undefined,
        getHeaders: () => headers,
    };
}

// ============================================================================
// APIError class construction
// ============================================================================

describe('APIError', () => {
    it('should create an APIError with all fields', () => {
        const err = new APIError(422, 'Validation failed', 'VALIDATION_ERROR', { field: 'name' });
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(APIError);
        expect(err.statusCode).toBe(422);
        expect(err.message).toBe('Validation failed');
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.details).toEqual({ field: 'name' });
        expect(err.name).toBe('APIError');
    });

    it('should create an APIError with minimal fields', () => {
        const err = new APIError(500, 'Something broke');
        expect(err.statusCode).toBe(500);
        expect(err.message).toBe('Something broke');
        expect(err.code).toBeUndefined();
        expect(err.details).toBeUndefined();
    });

    it('should be catchable with try/catch', () => {
        try {
            throw new APIError(400, 'Bad input', 'BAD_INPUT');
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(APIError);
            expect((err as APIError).statusCode).toBe(400);
        }
    });

    it('should have a stack trace', () => {
        const err = new APIError(500, 'test');
        expect(err.stack).toBeDefined();
        expect(err.stack).toContain('APIError');
    });
});

// ============================================================================
// Factory functions
// ============================================================================

describe('Factory functions', () => {
    it('badRequest() creates 400 with BAD_REQUEST code', () => {
        const err = badRequest('Invalid input');
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe('Invalid input');
        expect(err.code).toBe('BAD_REQUEST');
        expect(err.details).toBeUndefined();
    });

    it('badRequest() accepts optional details', () => {
        const err = badRequest('Invalid input', { field: 'email' });
        expect(err.statusCode).toBe(400);
        expect(err.details).toEqual({ field: 'email' });
    });

    it('notFound() creates 404 with NOT_FOUND code', () => {
        const err = notFound('Workspace');
        expect(err.statusCode).toBe(404);
        expect(err.message).toBe('Workspace not found');
        expect(err.code).toBe('NOT_FOUND');
    });

    it('forbidden() creates 403 with FORBIDDEN code', () => {
        const err = forbidden('Access denied');
        expect(err.statusCode).toBe(403);
        expect(err.message).toBe('Access denied');
        expect(err.code).toBe('FORBIDDEN');
    });

    it('invalidJSON() creates 400 with INVALID_JSON code', () => {
        const err = invalidJSON();
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe('Invalid JSON body');
        expect(err.code).toBe('INVALID_JSON');
    });

    it('missingFields() creates 400 with MISSING_FIELDS code and details', () => {
        const err = missingFields(['id', 'name']);
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe('Missing required fields: id, name');
        expect(err.code).toBe('MISSING_FIELDS');
        expect(err.details).toEqual({ fields: ['id', 'name'] });
    });

    it('missingFields() handles single field', () => {
        const err = missingFields(['content']);
        expect(err.message).toBe('Missing required fields: content');
        expect(err.details).toEqual({ fields: ['content'] });
    });

    it('internalError() creates 500 with INTERNAL_ERROR code', () => {
        const err = internalError();
        expect(err.statusCode).toBe(500);
        expect(err.message).toBe('Internal server error');
        expect(err.code).toBe('INTERNAL_ERROR');
    });

    it('internalError() accepts custom message', () => {
        const err = internalError('Database connection failed');
        expect(err.statusCode).toBe(500);
        expect(err.message).toBe('Database connection failed');
        expect(err.code).toBe('INTERNAL_ERROR');
    });

    it('all factory functions return APIError instances', () => {
        expect(badRequest('x')).toBeInstanceOf(APIError);
        expect(notFound('x')).toBeInstanceOf(APIError);
        expect(forbidden('x')).toBeInstanceOf(APIError);
        expect(invalidJSON()).toBeInstanceOf(APIError);
        expect(missingFields(['x'])).toBeInstanceOf(APIError);
        expect(internalError()).toBeInstanceOf(APIError);
    });
});

// ============================================================================
// handleAPIError
// ============================================================================

describe('handleAPIError', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should send APIError with all metadata', () => {
        const { res, getStatusCode, getBody } = createMockResponse();
        const err = new APIError(422, 'Validation failed', 'VALIDATION_ERROR', { field: 'name' });

        handleAPIError(res, err);

        expect(getStatusCode()).toBe(422);
        expect(getBody()).toEqual({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: { field: 'name' },
        });
    });

    it('should send APIError with minimal fields (no code, no details)', () => {
        const { res, getStatusCode, getBody } = createMockResponse();
        const err = new APIError(500, 'Something broke');

        handleAPIError(res, err);

        expect(getStatusCode()).toBe(500);
        const body = getBody();
        expect(body.error).toBe('Something broke');
        expect(body.code).toBeUndefined();
        expect(body.details).toBeUndefined();
    });

    it('should send APIError with code but no details', () => {
        const { res, getStatusCode, getBody } = createMockResponse();
        const err = new APIError(403, 'Forbidden', 'FORBIDDEN');

        handleAPIError(res, err);

        expect(getStatusCode()).toBe(403);
        expect(getBody()).toEqual({
            error: 'Forbidden',
            code: 'FORBIDDEN',
        });
    });

    it('should handle factory-created errors correctly', () => {
        const { res, getStatusCode, getBody } = createMockResponse();

        handleAPIError(res, missingFields(['id', 'name']));

        expect(getStatusCode()).toBe(400);
        expect(getBody()).toEqual({
            error: 'Missing required fields: id, name',
            code: 'MISSING_FIELDS',
            details: { fields: ['id', 'name'] },
        });
    });

    it('should handle unknown error as 500', () => {
        const { res, getStatusCode, getBody } = createMockResponse();
        const err = new Error('Something unexpected');

        handleAPIError(res, err);

        expect(getStatusCode()).toBe(500);
        expect(getBody()).toEqual({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR',
        });
    });

    it('should handle string error as 500', () => {
        const { res, getStatusCode, getBody } = createMockResponse();

        handleAPIError(res, 'raw string error');

        expect(getStatusCode()).toBe(500);
        expect(getBody()).toEqual({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR',
        });
    });

    it('should handle null error as 500', () => {
        const { res, getStatusCode, getBody } = createMockResponse();

        handleAPIError(res, null);

        expect(getStatusCode()).toBe(500);
        expect(getBody()).toEqual({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR',
        });
    });

    it('should log unknown errors to console.error', () => {
        const { res } = createMockResponse();
        const err = new Error('Unexpected crash');

        handleAPIError(res, err);

        expect(consoleSpy).toHaveBeenCalledWith('Unexpected API error:', err);
    });

    it('should NOT log APIError instances to console.error', () => {
        const { res } = createMockResponse();

        handleAPIError(res, badRequest('bad input'));

        expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should set Content-Type to application/json', () => {
        const { res, getHeaders } = createMockResponse();

        handleAPIError(res, notFound('Widget'));

        expect(getHeaders()['Content-Type']).toBe('application/json; charset=utf-8');
    });

    it('should preserve backward-compatible { error: message } format', () => {
        const { res, getBody } = createMockResponse();

        handleAPIError(res, badRequest('Invalid field'));

        const body = getBody();
        // The 'error' key should always be present (backward compat with sendError)
        expect(body).toHaveProperty('error');
        expect(typeof body.error).toBe('string');
    });
});
