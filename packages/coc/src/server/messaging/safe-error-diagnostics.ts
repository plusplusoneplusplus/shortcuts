/**
 * Privacy-safe error fields for messaging failure logs.
 *
 * Messages, stacks and arbitrary error properties can carry chat text, JIDs,
 * phone numbers, credentials or local paths, so only bounded classifiers are
 * kept: the error's class and name, a symbolic code, an HTTP-like status, and
 * the same fields for one level of `cause`. Never throws.
 */

export interface SafeErrorFields {
    /** Constructor name for errors, else the value's `typeof` (or `null`). */
    errorClass: string;
    /** `error.name` when it is an identifier other than the class or the default `Error`. */
    errorName?: string;
    /** Symbolic (`SQLITE_BUSY`, `ECONNRESET`) or short numeric code. */
    errorCode?: string | number;
    /** `statusCode`, `status` or Boom's `output.statusCode` in 100–599. */
    statusCode?: number;
}

export interface SafeErrorDiagnostics extends SafeErrorFields {
    cause?: SafeErrorFields;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]{0,63}$/;
/** Letter-first, so digit strings such as phone numbers never pass. */
const SYMBOLIC_CODE = /^[A-Za-z][\w-]{0,63}$/;
const MAX_NUMERIC_CODE = 99_999;

function identifier(value: unknown): string | undefined {
    return typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined;
}

function safeCode(value: unknown): string | number | undefined {
    if (typeof value === 'string') {
        return SYMBOLIC_CODE.test(value) ? value : undefined;
    }
    return Number.isInteger(value) && Math.abs(value as number) <= MAX_NUMERIC_CODE ? value as number : undefined;
}

function safeStatus(value: unknown): number | undefined {
    return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599 ? value as number : undefined;
}

function fields(error: unknown): SafeErrorFields {
    if (error === null) {
        return { errorClass: 'null' };
    }
    if (typeof error !== 'object' && typeof error !== 'function') {
        return { errorClass: typeof error };
    }
    const record = error as Record<string, unknown>;
    const errorClass = identifier((error as object).constructor?.name) ?? 'object';
    const errorName = identifier(record.name);
    const errorCode = safeCode(record.code);
    const output = record.output as Record<string, unknown> | undefined;
    const statusCode = safeStatus(record.statusCode) ?? safeStatus(record.status)
        ?? safeStatus(typeof output === 'object' && output ? output.statusCode : undefined);
    return {
        errorClass,
        ...(errorName && errorName !== errorClass && errorName !== 'Error' ? { errorName } : {}),
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(statusCode !== undefined ? { statusCode } : {}),
    };
}

/** Bounded, content-free description of `error` for server logs. */
export function safeErrorDiagnostics(error: unknown): SafeErrorDiagnostics {
    try {
        const result: SafeErrorDiagnostics = fields(error);
        const cause = error !== null && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined;
        if (cause !== undefined) {
            result.cause = fields(cause);
        }
        return result;
    } catch {
        return { errorClass: 'unknown' };
    }
}
