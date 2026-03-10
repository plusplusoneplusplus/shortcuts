/**
 * Tests for readOnlyPermissions utility.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import { readOnlyPermissions } from '../../src/utils/read-only-permissions';

describe('readOnlyPermissions', () => {
    it('approves read requests', () => {
        const result = readOnlyPermissions({ kind: 'read' } as any);
        expect(result).toEqual({ kind: 'approved' });
    });

    it('denies write requests', () => {
        const result = readOnlyPermissions({ kind: 'write' } as any);
        expect(result).toEqual({ kind: 'denied-by-rules' });
    });

    it('denies shell requests', () => {
        const result = readOnlyPermissions({ kind: 'shell' } as any);
        expect(result).toEqual({ kind: 'denied-by-rules' });
    });

    it('denies unknown request kinds', () => {
        const result = readOnlyPermissions({ kind: 'unknown' } as any);
        expect(result).toEqual({ kind: 'denied-by-rules' });
    });
});
