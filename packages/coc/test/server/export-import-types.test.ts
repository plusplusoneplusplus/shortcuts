/**
 * Export/Import Types Tests
 *
 * Validates the export payload schema validation logic:
 * - Valid payload passes
 * - Missing / wrong version fails
 * - Malformed structure (null, missing arrays, bad metadata) fails
 * - Extra unknown fields are allowed (forward compatibility)
 */

import { describe, it, expect } from 'vitest';
import {
    validateExportPayload,
    EXPORT_SCHEMA_VERSION,
    type CoCExportPayload,
    type ImportMode,
} from '../../src/server/export-import-types';

// ============================================================================
// Helpers
// ============================================================================

/** Returns a structurally valid minimal payload for mutation in tests. */
function validPayload(): CoCExportPayload {
    return {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        metadata: {
            processCount: 0,
            workspaceCount: 0,
            wikiCount: 0,
            queueFileCount: 0,
        },
        processes: [],
        workspaces: [],
        wikis: [],
        queueHistory: [],
        preferences: {},
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('validateExportPayload', () => {
    // ---- happy path ---------------------------------------------------

    it('accepts a valid minimal payload', () => {
        const result = validateExportPayload(validPayload());
        expect(result).toEqual({ valid: true });
    });

    it('accepts a payload with optional serverVersion and serverConfig', () => {
        const payload = {
            ...validPayload(),
            serverVersion: '1.2.3',
            serverConfig: { model: 'gpt-4' },
        };
        const result = validateExportPayload(payload);
        expect(result).toEqual({ valid: true });
    });

    // ---- version checks -----------------------------------------------

    it('rejects when version is missing', () => {
        const payload = validPayload() as Record<string, unknown>;
        delete payload.version;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/version/i);
    });

    it('rejects when version is wrong number', () => {
        const payload = { ...validPayload(), version: 999 };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/999/);
    });

    it('rejects when version is not a number', () => {
        const payload = { ...validPayload(), version: '1' as unknown as number };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/number/);
    });

    // ---- null / non-object --------------------------------------------

    it('rejects null', () => {
        const result = validateExportPayload(null);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/non-null object/);
    });

    it('rejects undefined', () => {
        const result = validateExportPayload(undefined);
        expect(result.valid).toBe(false);
    });

    it('rejects a string', () => {
        const result = validateExportPayload('not an object');
        expect(result.valid).toBe(false);
    });

    // ---- missing / malformed fields -----------------------------------

    it('rejects missing exportedAt', () => {
        const payload = validPayload() as Record<string, unknown>;
        delete payload.exportedAt;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/exportedAt/);
    });

    it('rejects missing metadata', () => {
        const payload = validPayload() as Record<string, unknown>;
        delete payload.metadata;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/metadata/);
    });

    it('rejects null metadata', () => {
        const payload = { ...validPayload(), metadata: null as unknown as CoCExportPayload['metadata'] };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/metadata/);
    });

    it('rejects metadata with missing numeric fields', () => {
        const payload = validPayload();
        (payload.metadata as Record<string, unknown>).processCount = 'zero';
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/processCount/);
    });

    it('rejects when processes is not an array', () => {
        const payload = { ...validPayload(), processes: 'bad' as unknown as [] };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/processes/);
    });

    it('rejects when workspaces is not an array', () => {
        const payload = { ...validPayload(), workspaces: {} as unknown as [] };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/workspaces/);
    });

    it('rejects when wikis is missing', () => {
        const payload = validPayload() as Record<string, unknown>;
        delete payload.wikis;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/wikis/);
    });

    it('rejects when queueHistory is not an array', () => {
        const payload = { ...validPayload(), queueHistory: null as unknown as [] };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/queueHistory/);
    });

    it('rejects missing preferences', () => {
        const payload = validPayload() as Record<string, unknown>;
        delete payload.preferences;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/preferences/);
    });

    it('rejects null preferences', () => {
        const payload = { ...validPayload(), preferences: null as unknown as Record<string, unknown> };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/preferences/);
    });

    // ---- forward compatibility ----------------------------------------

    it('allows extra unknown top-level fields', () => {
        const payload = { ...validPayload(), futureField: 'hello', anotherNew: [1, 2] };
        const result = validateExportPayload(payload);
        expect(result).toEqual({ valid: true });
    });

    it('allows extra unknown metadata fields', () => {
        const payload = validPayload();
        (payload.metadata as Record<string, unknown>).futureCount = 42;
        const result = validateExportPayload(payload);
        expect(result).toEqual({ valid: true });
    });
});

// ============================================================================
// Type-level checks (compile-time only)
// ============================================================================

describe('type exports', () => {
    it('ImportMode accepts valid values', () => {
        const replace: ImportMode = 'replace';
        const merge: ImportMode = 'merge';
        expect(replace).toBe('replace');
        expect(merge).toBe('merge');
    });

    it('EXPORT_SCHEMA_VERSION is 1', () => {
        expect(EXPORT_SCHEMA_VERSION).toBe(1);
    });
});
