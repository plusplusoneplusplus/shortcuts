/**
 * Parity test: verifies that the ALLOWED_PARENT_TYPES and ALLOWED_CHILD_TYPES
 * exported by coc-client exactly match the authoritative definitions in the
 * server-side types module. This guards against the two copies drifting apart
 * when new work item types are added.
 */

import { describe, it, expect } from 'vitest';
import {
    ALLOWED_PARENT_TYPES as SERVER_ALLOWED_PARENT_TYPES,
    ALLOWED_CHILD_TYPES as SERVER_ALLOWED_CHILD_TYPES,
} from '../../../src/server/work-items/types';
import {
    ALLOWED_PARENT_TYPES,
    ALLOWED_CHILD_TYPES,
} from '@plusplusoneplusplus/coc-client';

describe('work item type constants parity (coc-client vs server)', () => {
    it('ALLOWED_PARENT_TYPES in coc-client matches the server definition', () => {
        // Convert readonly arrays to plain arrays for deep equality comparison
        const clientParent = Object.fromEntries(
            Object.entries(ALLOWED_PARENT_TYPES).map(([k, v]) => [k, [...v]])
        );
        const serverParent = Object.fromEntries(
            Object.entries(SERVER_ALLOWED_PARENT_TYPES).map(([k, v]) => [k, [...v]])
        );
        expect(clientParent).toEqual(serverParent);
    });

    it('ALLOWED_CHILD_TYPES in coc-client matches the server definition', () => {
        const clientChild = Object.fromEntries(
            Object.entries(ALLOWED_CHILD_TYPES).map(([k, v]) => [k, [...v]])
        );
        const serverChild = Object.fromEntries(
            Object.entries(SERVER_ALLOWED_CHILD_TYPES).map(([k, v]) => [k, [...v]])
        );
        expect(clientChild).toEqual(serverChild);
    });
});
