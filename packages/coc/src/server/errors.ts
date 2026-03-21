/**
 * Centralized API Error Handling
 *
 * Provides a structured APIError class, factory functions for common HTTP errors,
 * and a handleAPIError function for consistent error responses across all API routes.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import { sendJSON } from './api-handler';
import { getServerLogger } from './server-logger';

/**
 * Structured API error with HTTP status code and optional metadata.
 * Use factory functions (e.g., badRequest, notFound) for common error types.
 */
export class APIError extends Error {
    constructor(
        public statusCode: number,
        message: string,
        public code?: string,
        public details?: unknown
    ) {
        super(message);
        this.name = 'APIError';
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function badRequest(message: string, details?: unknown): APIError {
    return new APIError(400, message, 'BAD_REQUEST', details);
}

export function notFound(resource: string): APIError {
    return new APIError(404, `${resource} not found`, 'NOT_FOUND');
}

export function forbidden(message: string): APIError {
    return new APIError(403, message, 'FORBIDDEN');
}

export function invalidJSON(): APIError {
    return new APIError(400, 'Invalid JSON body', 'INVALID_JSON');
}

export function missingFields(fields: string[]): APIError {
    return new APIError(400, `Missing required fields: ${fields.join(', ')}`, 'MISSING_FIELDS', { fields });
}

export function internalError(message: string = 'Internal server error'): APIError {
    return new APIError(500, message, 'INTERNAL_ERROR');
}

export function conflict(message: string): APIError {
    return new APIError(409, message, 'CONFLICT');
}

// ============================================================================
// Centralized Error Handler
// ============================================================================

/**
 * Handle an error and send appropriate HTTP response.
 * - APIError instances use their statusCode and metadata
 * - Unknown errors are logged and sent as 500 Internal Server Error
 */
export function handleAPIError(res: http.ServerResponse, error: unknown): void {
    if (error instanceof APIError) {
        const body: Record<string, unknown> = { error: error.message };
        if (error.code) {
            body.code = error.code;
        }
        if (error.details !== undefined) {
            body.details = error.details;
        }
        if (error.statusCode >= 500) {
            getServerLogger().error({ statusCode: error.statusCode, code: error.code, err: error }, error.message);
        } else {
            getServerLogger().warn({ statusCode: error.statusCode, code: error.code }, error.message);
        }
        sendJSON(res, error.statusCode, body);
    } else {
        getServerLogger().error({ err: error }, 'Unexpected API error');
        sendJSON(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
}
