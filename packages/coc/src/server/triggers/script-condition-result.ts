import { createHash } from 'node:crypto';

/** Maximum stored result size, measured as UTF-8 canonical JSON. */
export const MAX_SCRIPT_CONDITION_RESULT_BYTES = 16 * 1024;

export interface ScriptConditionResult {
    canonicalJson: string;
    hash: string;
}

/**
 * Encode JSON values without invoking toJSON or silently dropping invalid values.
 * Object keys sort lexically at every level; array order remains significant.
 */
export function canonicalizeScriptConditionResult(value: unknown): ScriptConditionResult {
    const parts: string[] = [];
    const ancestors = new Set<object>();
    let bytes = 0;

    function append(text: string): void {
        bytes += Buffer.byteLength(text, 'utf8');
        if (bytes > MAX_SCRIPT_CONDITION_RESULT_BYTES) {
            throw new Error(`Script result exceeds ${MAX_SCRIPT_CONDITION_RESULT_BYTES} bytes of canonical JSON`);
        }
        parts.push(text);
    }

    function encode(current: unknown): void {
        if (current === null || typeof current === 'string' || typeof current === 'boolean') {
            append(JSON.stringify(current));
            return;
        }
        if (typeof current === 'number' && Number.isFinite(current)) {
            append(JSON.stringify(current));
            return;
        }
        if (typeof current !== 'object' || current === null) {
            throw new Error('Script result must contain only JSON values');
        }
        if (ancestors.has(current)) throw new Error('Script result must not contain cycles');
        const array = Array.isArray(current);
        const prototype = Object.getPrototypeOf(current);
        if (!array && prototype !== Object.prototype && prototype !== null) {
            throw new Error('Script result must contain only JSON objects and arrays');
        }
        if (Object.getOwnPropertySymbols(current).length) {
            throw new Error('Script result must not contain symbol keys');
        }
        ancestors.add(current);
        append(array ? '[' : '{');
        // Write keys directly: constructing a sorted object would let JSON.stringify
        // reorder integer-like keys numerically rather than lexically.
        const keys = array ? [] : Object.keys(current).sort();
        const length = array ? current.length : keys.length;
        for (let index = 0; index < length; index++) {
            const key = array ? String(index) : keys[index];
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (!descriptor || !('value' in descriptor)) {
                throw new Error('Script result must not contain sparse arrays or accessors');
            }
            if (index) append(',');
            if (!array) {
                append(JSON.stringify(key));
                append(':');
            }
            encode(descriptor.value);
        }
        append(array ? ']' : '}');
        ancestors.delete(current);
    }

    encode(value);
    const canonicalJson = parts.join('');
    return { canonicalJson, hash: createHash('sha256').update(canonicalJson, 'utf8').digest('hex') };
}
