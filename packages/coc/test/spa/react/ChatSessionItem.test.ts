/**
 * Tests for ChatSessionItem type in dashboard types.
 *
 * Validates the type definition exists with expected fields.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TYPES_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'types', 'dashboard.ts'
);

describe('ChatSessionItem type', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(TYPES_PATH, 'utf-8');
    });

    it('exports ChatSessionItem interface', () => {
        expect(source).toContain('export interface ChatSessionItem');
    });

    it('has id field as string', () => {
        expect(source).toMatch(/id:\s*string/);
    });

    it('has optional processId field', () => {
        expect(source).toMatch(/processId\?:\s*string/);
    });

    it('has status field as string', () => {
        // Match within ChatSessionItem interface block
        const block = source.substring(source.indexOf('export interface ChatSessionItem'));
        expect(block).toMatch(/status:\s*string/);
    });

    it('has createdAt field as string', () => {
        expect(source).toMatch(/createdAt:\s*string/);
    });

    it('has optional completedAt field', () => {
        expect(source).toMatch(/completedAt\?:\s*string/);
    });

    it('has firstMessage field as string', () => {
        expect(source).toMatch(/firstMessage:\s*string/);
    });

    it('has optional turnCount field as number', () => {
        expect(source).toMatch(/turnCount\?:\s*number/);
    });
});
