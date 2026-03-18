/**
 * Tests for BranchCommitStrip component source structure.
 *
 * Validates exports, props, rendering patterns, and data-testid attributes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'BranchCommitStrip.tsx'
);

describe('BranchCommitStrip', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('file existence', () => {
        it('exists at expected path', () => {
            expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
        });
    });

    describe('exports', () => {
        it('exports BranchCommitStrip as a named export', () => {
            expect(source).toContain('export function BranchCommitStrip');
        });
    });

    describe('imports', () => {
        it('imports formatRelativeTime', () => {
            expect(source).toContain("formatRelativeTime");
        });

        it('imports GitCommitItem type', () => {
            expect(source).toContain("GitCommitItem");
        });

        it('imports BranchRangeInfo type', () => {
            expect(source).toContain("BranchRangeInfo");
        });
    });

    describe('component signature', () => {
        it('accepts commits prop', () => {
            expect(source).toContain('commits: GitCommitItem[]');
        });

        it('accepts branchRangeData prop', () => {
            expect(source).toContain('branchRangeData: BranchRangeInfo');
        });
    });

    describe('rendering', () => {
        it('renders header with data-testid', () => {
            expect(source).toContain('data-testid="branch-commit-strip-header"');
        });

        it('renders commit list with data-testid', () => {
            expect(source).toContain('data-testid="branch-commit-strip-list"');
        });

        it('renders empty state', () => {
            expect(source).toContain('data-testid="branch-commit-strip-empty"');
        });

        it('renders outer container with data-testid', () => {
            expect(source).toContain('data-testid="branch-commit-strip"');
        });

        it('shows additions in green', () => {
            expect(source).toContain('text-[#16825d]');
        });

        it('shows deletions in red', () => {
            expect(source).toContain('text-[#d32f2f]');
        });

        it('shows short hashes in orange (unpushed color)', () => {
            expect(source).toContain('text-[#f57c00] dark:text-[#ffb74d]');
        });

        it('uses formatRelativeTime for commit dates', () => {
            expect(source).toContain('formatRelativeTime(commit.date)');
        });
    });
});
