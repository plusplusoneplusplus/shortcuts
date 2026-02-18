---
status: done
---

# 003: Add Centralized Error Handling for API Routes

## Summary
Create APIError class and centralized error handler for consistent HTTP error responses across all API routes.

## Motivation
API routes currently use ad-hoc error handling patterns with direct `sendError()` calls throughout handlers. This leads to:
- **Inconsistent error responses** — Some routes return `{ error: string }`, others may format differently
- **Scattered validation logic** — Input validation errors are handled inline with business logic
- **No structured error metadata** — Missing error codes, types, or additional context for client debugging
- **Difficult to extend** — Adding new error types (e.g., authentication, rate limiting) requires changes across many routes

Centralizing error handling with an `APIError` class and `handleAPIError` function will provide a single source of truth for error response formatting, enable structured error metadata, and simplify future enhancements like error tracking or custom error pages.

## Changes

### Files to Create
- `packages/coc/src/server/errors.ts` — APIError class, error factory functions, handleAPIError function

### Files to Modify
- `packages/coc/src/server/api-handler.ts` — Replace inline `sendError()` calls with `handleAPIError()`
- `packages/coc/src/server/admin-handler.ts` — Replace inline `sendError()` calls with `handleAPIError()`
- `packages/coc/src/server/index.ts` (optional) — Export errors module for use by other handlers

## Implementation Notes

### APIError class design

```typescript
/**
 * Structured API error with HTTP status code and optional metadata.
 * Use factory functions (e.g., badRequest, notFound) for common error types.
 */
export class APIError extends Error {
    constructor(
        public statusCode: number,
        message: string,
        public code?: string,        // Machine-readable error code (e.g., 'INVALID_JSON', 'NOT_FOUND')
        public details?: unknown      // Additional context (e.g., validation errors)
    ) {
        super(message);
        this.name = 'APIError';
    }
}

/** Factory functions for common HTTP errors */
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
```

### handleAPIError function

Centralized error response handler that:
1. Accepts `http.ServerResponse` and an error (APIError or unknown)
2. Logs the error for debugging (with stack trace for non-APIError exceptions)
3. Sends a JSON response with consistent structure:
   ```json
   {
     "error": "User-facing message",
     "code": "MACHINE_READABLE_CODE",
     "details": { /* optional metadata */ }
   }
   ```
4. Handles non-APIError exceptions as 500 Internal Server Error (don't leak stack traces to clients)

```typescript
import * as http from 'http';
import { sendJSON } from './api-handler';

/**
 * Handle an error and send appropriate HTTP response.
 * - APIError instances use their statusCode and metadata
 * - Unknown errors are logged and sent as 500 Internal Server Error
 */
export function handleAPIError(res: http.ServerResponse, error: unknown): void {
    if (error instanceof APIError) {
        const body: any = { error: error.message };
        if (error.code) {
            body.code = error.code;
        }
        if (error.details !== undefined) {
            body.details = error.details;
        }
        sendJSON(res, error.statusCode, body);
    } else {
        // Unknown exception — log full error, send generic 500
        console.error('Unexpected API error:', error);
        sendJSON(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
}
```

### Migration strategy for api-handler.ts

Replace patterns like:
```typescript
// Before
if (!body.id || !body.name || !body.rootPath) {
    return sendError(res, 400, 'Missing required fields: id, name, rootPath');
}
```

With:
```typescript
// After
if (!body.id || !body.name || !body.rootPath) {
    return handleAPIError(res, missingFields(['id', 'name', 'rootPath']));
}
```

Replace patterns like:
```typescript
// Before
const workspace = store.getWorkspace(workspaceId);
if (!workspace) {
    return sendError(res, 404, 'Workspace not found');
}
```

With:
```typescript
// After
const workspace = store.getWorkspace(workspaceId);
if (!workspace) {
    return handleAPIError(res, notFound('Workspace'));
}
```

Wrap async handler bodies with try/catch:
```typescript
// Before (implicit error propagation)
handler: async (req, res) => {
    const body = await parseBody(req);  // Can throw
    const result = await someOperation();
    sendJSON(res, 200, result);
}

// After (explicit error handling)
handler: async (req, res) => {
    try {
        const body = await parseBody(req);
        const result = await someOperation();
        sendJSON(res, 200, result);
    } catch (error) {
        return handleAPIError(res, error);
    }
}
```

### Migration strategy for admin-handler.ts

Same pattern as api-handler.ts. Key replacements:
- `sendError(res, 400, 'Invalid JSON body')` → `handleAPIError(res, invalidJSON())`
- `sendError(res, 400, 'Missing confirmation token...')` → `handleAPIError(res, badRequest('Missing confirmation token. GET /api/admin/data/wipe-token first.'))`
- `sendError(res, 403, 'Invalid or expired confirmation token')` → `handleAPIError(res, forbidden('Invalid or expired confirmation token'))`
- `sendError(res, 400, validation.error)` → `handleAPIError(res, badRequest(validation.error))`

### Backward compatibility

The existing `sendError(res, statusCode, message)` function remains available for handlers not yet migrated. The response format `{ error: message }` is preserved by `handleAPIError` when using factory functions, ensuring clients continue to work.

### Future enhancements (out of scope for this commit)

- Custom error codes for specific business logic failures (e.g., `TOKEN_EXPIRED`, `INVALID_WIKI_ID`)
- Error tracking/telemetry integration (e.g., Sentry, logs with structured metadata)
- Validation error details with field-level context (e.g., Zod integration)
- Rate limiting errors (`429 Too Many Requests`)

## Tests

Test file: `packages/coc/test/server/errors.test.ts`

### APIError class construction
- Create APIError with statusCode, message, code, details
- Factory functions create correct statusCode and code
  - `badRequest()` → 400, 'BAD_REQUEST'
  - `notFound()` → 404, 'NOT_FOUND'
  - `forbidden()` → 403, 'FORBIDDEN'
  - `invalidJSON()` → 400, 'INVALID_JSON'
  - `missingFields(['id', 'name'])` → 400, 'MISSING_FIELDS', details: { fields: ['id', 'name'] }
  - `internalError()` → 500, 'INTERNAL_ERROR'
- APIError is instance of Error (for try/catch compatibility)

### handleAPIError function
- **APIError with all metadata** → response is `{ error, code, details }` with correct statusCode
- **APIError with minimal fields** → response is `{ error }` with correct statusCode (no code/details)
- **Unknown error (non-APIError)** → response is `{ error: 'Internal server error', code: 'INTERNAL_ERROR' }`, statusCode 500
- **Stack trace logging** — Verify unknown errors log to console.error (test with spy/mock)

### Integration with existing handlers (via test or manual verification)
- `api-handler.ts` routes still return expected error formats
- `admin-handler.ts` routes still return expected error formats
- All existing API integration tests pass unchanged (regression check)

## Acceptance Criteria
- [x] `APIError` class exported from `errors.ts`
- [x] Factory functions (`badRequest`, `notFound`, etc.) create correct APIError instances
- [x] `handleAPIError` function sends correct JSON responses for APIError and unknown errors
- [x] `api-handler.ts` uses `handleAPIError` for all error cases
- [x] `admin-handler.ts` uses `handleAPIError` for all error cases
- [x] All handlers wrap async logic in try/catch with `handleAPIError`
- [x] CoC build succeeds (`npm run build` in `packages/coc/`)
- [x] All new tests pass (`npm run test:run` in `packages/coc/`)
- [x] Existing API integration tests pass (no regressions)

## Dependencies
- Depends on: 001 (Zod validation library for future validation error integration)

## Related Work
This commit lays the groundwork for structured error handling. Future commits may add:
- **004**: Zod integration for request validation with field-level error details
- **005**: Error tracking middleware for production monitoring
