/**
 * parseQueryParams — Comprehensive Validation Tests (Sections 1–4)
 *
 * Tests the `parseQueryParams` utility exported from api-handler.ts.
 * Documents current behaviour: unknown/invalid values are silently
 * ignored (filter field left undefined) rather than throwing.
 *
 * Cross-platform compatible (Linux/macOS/Windows).
 */

import { describe, it, expect } from 'vitest';
import { parseQueryParams } from '../../src/server/api-handler';

// ============================================================================
// Section 1: Status Filter
// ============================================================================

describe('parseQueryParams — status filter', () => {
    it('parses ?status=running as a single-element array', () => {
        const filter = parseQueryParams('http://x/api/processes?status=running');
        expect(filter.status).toEqual(['running']);
    });

    it('parses ?status=completed correctly', () => {
        const filter = parseQueryParams('http://x/api/processes?status=completed');
        expect(filter.status).toEqual(['completed']);
    });

    it('silently ignores unknown status values (current behaviour)', () => {
        // Invalid values are filtered out; status becomes undefined when nothing valid remains.
        const filter = parseQueryParams('http://x/api/processes?status=unknown_value');
        expect(filter.status).toBeUndefined();
    });

    it('accepts comma-separated list mixing valid and invalid values — keeps valid only', () => {
        const filter = parseQueryParams('http://x/api/processes?status=running,unknown_value,completed');
        expect(filter.status).toEqual(expect.arrayContaining(['running', 'completed']));
        expect(filter.status).not.toContain('unknown_value');
    });

    it('accepts all valid status values via comma separation', () => {
        const filter = parseQueryParams('http://x/api/processes?status=running,completed,failed');
        expect(filter.status).toEqual(expect.arrayContaining(['running', 'completed', 'failed']));
    });

    it('returns undefined status when no status param is provided', () => {
        const filter = parseQueryParams('http://x/api/processes');
        expect(filter.status).toBeUndefined();
    });

    // Multi-value array behaviour (e.g. ?status=running&status=completed)
    it('ignores status when it appears multiple times as array (url.parse returns array, not string)', () => {
        // Node url.parse returns an array for repeated keys; the code checks typeof === 'string'
        // so the array is ignored and status remains undefined.
        const filter = parseQueryParams('http://x/api/processes?status=running&status=completed');
        // Both values are valid but url.parse returns array → code ignores it → undefined
        expect(filter.status).toBeUndefined();
    });
});

// ============================================================================
// Section 2: Pagination (limit / offset)
// ============================================================================

describe('parseQueryParams — pagination', () => {
    it('parses ?limit=10 as integer 10', () => {
        const filter = parseQueryParams('http://x/api/processes?limit=10');
        expect(filter.limit).toBe(10);
    });

    it('accepts ?limit=1 (minimum valid value)', () => {
        const filter = parseQueryParams('http://x/api/processes?limit=1');
        expect(filter.limit).toBe(1);
    });

    it('ignores ?limit=0 (not positive; silently dropped)', () => {
        const filter = parseQueryParams('http://x/api/processes?limit=0');
        expect(filter.limit).toBeUndefined();
    });

    it('ignores ?limit=-5 (negative; silently dropped)', () => {
        const filter = parseQueryParams('http://x/api/processes?limit=-5');
        expect(filter.limit).toBeUndefined();
    });

    it('ignores ?limit=abc (NaN; silently dropped)', () => {
        const filter = parseQueryParams('http://x/api/processes?limit=abc');
        expect(filter.limit).toBeUndefined();
    });

    it('ignores ?limit=1.5 (parseInt truncates to 1 → accepted as 1)', () => {
        // parseInt('1.5', 10) === 1 which is > 0, so it is ACCEPTED
        const filter = parseQueryParams('http://x/api/processes?limit=1.5');
        expect(filter.limit).toBe(1);
    });

    it('accepts ?offset=0 (zero offset is valid)', () => {
        const filter = parseQueryParams('http://x/api/processes?offset=0');
        expect(filter.offset).toBe(0);
    });

    it('accepts ?offset=100', () => {
        const filter = parseQueryParams('http://x/api/processes?offset=100');
        expect(filter.offset).toBe(100);
    });

    it('ignores ?offset=-1 (negative; silently dropped)', () => {
        const filter = parseQueryParams('http://x/api/processes?offset=-1');
        expect(filter.offset).toBeUndefined();
    });

    it('ignores ?offset=abc (NaN; silently dropped)', () => {
        const filter = parseQueryParams('http://x/api/processes?offset=abc');
        expect(filter.offset).toBeUndefined();
    });

    it('returns undefined limit and offset when neither param is provided (defaults)', () => {
        const filter = parseQueryParams('http://x/api/processes');
        expect(filter.limit).toBeUndefined();
        expect(filter.offset).toBeUndefined();
    });
});

// ============================================================================
// Section 3: Date Range (since)
// ============================================================================

describe('parseQueryParams — date range (since)', () => {
    it('parses a valid ISO date-time string into a Date object', () => {
        const filter = parseQueryParams('http://x/api/processes?since=2024-01-01T00:00:00Z');
        expect(filter.since).toBeInstanceOf(Date);
        expect(filter.since?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('accepts date-only string (date-only is parseable by Date constructor)', () => {
        // new Date('2024-01-01') is valid — parsed as UTC midnight
        const filter = parseQueryParams('http://x/api/processes?since=2024-01-01');
        expect(filter.since).toBeInstanceOf(Date);
    });

    it('silently ignores non-date strings (silently dropped)', () => {
        const filter = parseQueryParams('http://x/api/processes?since=not-a-date');
        expect(filter.since).toBeUndefined();
    });

    it('silently ignores empty string for since', () => {
        const filter = parseQueryParams('http://x/api/processes?since=');
        expect(filter.since).toBeUndefined();
    });

    it('silently ignores invalid calendar values like 9999-99-99', () => {
        const filter = parseQueryParams('http://x/api/processes?since=9999-99-99');
        expect(filter.since).toBeUndefined();
    });
});

// ============================================================================
// Section 4: Exclude Fields
// ============================================================================

describe('parseQueryParams — exclude fields', () => {
    it('accepts ?exclude=conversation', () => {
        const filter = parseQueryParams('http://x/api/processes?exclude=conversation');
        expect(filter.exclude).toEqual(['conversation']);
    });

    it('accepts ?exclude=toolCalls', () => {
        const filter = parseQueryParams('http://x/api/processes?exclude=toolCalls');
        expect(filter.exclude).toEqual(['toolCalls']);
    });

    it('silently ignores unknown exclude field', () => {
        const filter = parseQueryParams('http://x/api/processes?exclude=unknownField');
        expect(filter.exclude).toBeUndefined();
    });

    it('accepts multiple valid exclude fields via comma separation', () => {
        const filter = parseQueryParams('http://x/api/processes?exclude=conversation,toolCalls');
        expect(filter.exclude).toEqual(expect.arrayContaining(['conversation', 'toolCalls']));
    });

    it('returns undefined exclude when no exclude param provided', () => {
        const filter = parseQueryParams('http://x/api/processes');
        expect(filter.exclude).toBeUndefined();
    });
});
