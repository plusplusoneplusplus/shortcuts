/**
 * Tests for Templates module exports
 *
 * Verifies all symbols are properly exported from both the barrel
 * and the main index. Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import * as Templates from '../../src/templates';
import * as PipelineCore from '../../src/index';

describe('Templates Index Exports', () => {
    describe('barrel export (src/templates)', () => {
        it('exports Template type (compile-time only)', () => {
            // Template is a type-only export; importing it is enough
            const _check: Templates.Template | undefined = undefined;
            expect(_check).toBeUndefined();
        });

        it('exports CommitTemplate type (compile-time only)', () => {
            const _check: Templates.CommitTemplate | undefined = undefined;
            expect(_check).toBeUndefined();
        });

        it('exports ReplicateOptions type (compile-time only)', () => {
            const _check: Templates.ReplicateOptions | undefined = undefined;
            expect(_check).toBeUndefined();
        });

        it('exports FileChange type (compile-time only)', () => {
            const _check: Templates.FileChange | undefined = undefined;
            expect(_check).toBeUndefined();
        });

        it('exports ReplicateResult type (compile-time only)', () => {
            const _check: Templates.ReplicateResult | undefined = undefined;
            expect(_check).toBeUndefined();
        });

        it('exports buildReplicatePrompt', () => {
            expect(typeof Templates.buildReplicatePrompt).toBe('function');
        });

        it('exports parseReplicateResponse', () => {
            expect(typeof Templates.parseReplicateResponse).toBe('function');
        });

        it('exports replicateCommit', () => {
            expect(typeof Templates.replicateCommit).toBe('function');
        });
    });

    describe('main barrel export (src/index)', () => {
        it('exports buildReplicatePrompt', () => {
            expect(typeof PipelineCore.buildReplicatePrompt).toBe('function');
        });

        it('exports parseReplicateResponse', () => {
            expect(typeof PipelineCore.parseReplicateResponse).toBe('function');
        });

        it('exports replicateCommit', () => {
            expect(typeof PipelineCore.replicateCommit).toBe('function');
        });
    });
});
