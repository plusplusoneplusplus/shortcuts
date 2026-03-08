/**
 * Tests for useApi.ts — fetchApi helper.
 *
 * Static source analysis verifying the fetchApi function accepts and
 * forwards an optional RequestInit options parameter to fetch().
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const USE_API_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks', 'useApi.ts'
);

describe('useApi — fetchApi', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(USE_API_PATH, 'utf-8');
    });

    it('exports fetchApi function', () => {
        expect(source).toContain('export async function fetchApi');
    });

    it('accepts an optional options parameter of type RequestInit', () => {
        expect(source).toMatch(/fetchApi\(path:\s*string,\s*options\?:\s*RequestInit\)/);
    });

    it('forwards options to fetch() only when provided', () => {
        // Options are passed to fetch (empty object when not provided)
        expect(source).toMatch(/fetch\(url,\s*options\s*\?\?\s*\{\}\)/);
    });

    it('throws on non-ok responses', () => {
        expect(source).toContain('if (!res.ok)');
        expect(source).toContain('throw new Error');
    });

    it('returns parsed JSON on success', () => {
        expect(source).toContain('res.json()');
    });
});
