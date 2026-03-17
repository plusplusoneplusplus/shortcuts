/**
 * Export/Import Schema Validation Tests
 *
 * Section 1: validateExportPayload — Schema Version checks
 * Section 2: validateExportPayload — Required Fields checks
 *
 * These are pure unit tests — no HTTP server or file system required.
 */

import { describe, it, expect } from 'vitest';
import {
    validateExportPayload,
    EXPORT_SCHEMA_VERSION,
} from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal valid payload that passes all validation checks. */
function validBase() {
    return {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        metadata: { processCount: 0, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
        processes: [],
        workspaces: [],
        wikis: [],
        queueHistory: [],
        preferences: {},
    };
}

// ============================================================================
// Section 1: Schema Version
// ============================================================================

describe('validateExportPayload — Section 1: Schema Version', () => {
    it('accepts payload with correct current schema version', () => {
        const result = validateExportPayload(validBase());
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('rejects payload with version 0 (too old)', () => {
        const result = validateExportPayload({ ...validBase(), version: 0 });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unsupported schema version');
    });

    it('rejects payload with version 99999 (future)', () => {
        const result = validateExportPayload({ ...validBase(), version: 99999 });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unsupported schema version');
    });

    it('rejects payload missing version field entirely', () => {
        const payload = validBase() as any;
        delete payload.version;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('version');
    });

    it('rejects payload with version: null', () => {
        const result = validateExportPayload({ ...validBase(), version: null } as any);
        expect(result.valid).toBe(false);
        // null is not a number — rejected before version comparison
    });

    it('rejects payload with version as string "1" (wrong type)', () => {
        const result = validateExportPayload({ ...validBase(), version: '1' } as any);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('"version" must be a number');
    });

    it('rejects payload with version: 1.5 (float — not equal to integer version)', () => {
        // 1.5 !== EXPORT_SCHEMA_VERSION (1) → version mismatch
        const result = validateExportPayload({ ...validBase(), version: 1.5 } as any);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unsupported schema version');
    });
});

// ============================================================================
// Section 2: Required Fields
// ============================================================================

describe('validateExportPayload — Section 2: Required Fields', () => {
    it('accepts valid payload with all required fields', () => {
        const result = validateExportPayload(validBase());
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('rejects missing "processes" field', () => {
        const payload = validBase() as any;
        delete payload.processes;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('processes');
    });

    it('rejects processes: null (null is not acceptable; empty array is)', () => {
        const result = validateExportPayload({ ...validBase(), processes: null } as any);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('processes');
    });

    it('accepts processes: [] (empty array is valid)', () => {
        const result = validateExportPayload({ ...validBase(), processes: [] });
        expect(result.valid).toBe(true);
    });

    it('rejects missing "queueHistory" field', () => {
        // The actual field name is queueHistory (not "queue")
        const payload = validBase() as any;
        delete payload.queueHistory;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('queueHistory');
    });

    it('rejects missing "preferences" field', () => {
        const payload = validBase() as any;
        delete payload.preferences;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('preferences');
    });

    it('rejects preferences: null', () => {
        const result = validateExportPayload({ ...validBase(), preferences: null } as any);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('preferences');
    });

    it('accepts extra unknown top-level fields (forward compatibility)', () => {
        const payload = {
            ...validBase(),
            unknownField: 'extra-data',
            anotherField: 42,
            yetAnother: { nested: true },
        };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(true);
    });

    it('accepts processes[0] missing nested "id" — nested process fields are not validated', () => {
        // validateExportPayload only checks top-level structure, not process contents
        const payload = {
            ...validBase(),
            processes: [{ type: 'clarification', status: 'completed' }],
        };
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(true);
    });

    it('rejects null root payload', () => {
        const result = validateExportPayload(null);
        expect(result.valid).toBe(false);
    });

    it('rejects array root payload', () => {
        const result = validateExportPayload([]);
        expect(result.valid).toBe(false);
    });

    it('rejects string root payload', () => {
        const result = validateExportPayload('a string' as any);
        expect(result.valid).toBe(false);
    });

    it('rejects missing "exportedAt" field', () => {
        const payload = validBase() as any;
        delete payload.exportedAt;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('exportedAt');
    });

    it('rejects missing "metadata" field', () => {
        const payload = validBase() as any;
        delete payload.metadata;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('metadata');
    });

    it('rejects imageBlobs: {} (must be an array when present)', () => {
        const result = validateExportPayload({ ...validBase(), imageBlobs: {} } as any);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('imageBlobs');
    });

    it('accepts imageBlobs: [] (empty array)', () => {
        const result = validateExportPayload({ ...validBase(), imageBlobs: [] });
        expect(result.valid).toBe(true);
    });

    it('accepts imageBlobs: undefined (optional field)', () => {
        const result = validateExportPayload(validBase());
        expect(result.valid).toBe(true);
    });

    it('rejects missing "workspaces" field', () => {
        const payload = validBase() as any;
        delete payload.workspaces;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('workspaces');
    });

    it('rejects missing "wikis" field', () => {
        const payload = validBase() as any;
        delete payload.wikis;
        const result = validateExportPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('wikis');
    });
});
