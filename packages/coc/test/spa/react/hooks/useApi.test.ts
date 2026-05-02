/**
 * Tests for useApi.ts — fetchApi helper.
 *
 * Static source analysis verifying the fetchApi function accepts an optional
 * RequestInit options parameter and delegates transport to the CoC client.
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

    it('forwards options to the shared CoC client', () => {
        expect(source).toContain('getSpaCocClient().request(path');
        expect(source).toContain('method: options?.method');
        expect(source).toContain('headers: options?.headers');
        expect(source).toContain('rawBody: options?.body');
        expect(source).toContain('signal: options?.signal');
    });

    it('preserves legacy error messages for API failures', () => {
        expect(source).toContain('error instanceof CocApiError');
        expect(source).toContain('API error: ${error.status} ${error.statusText}');
    });

    it('preserves legacy network rejection behavior', () => {
        expect(source).toContain('error instanceof CocNetworkError');
        expect(source).toContain('throw error.cause');
    });
});
