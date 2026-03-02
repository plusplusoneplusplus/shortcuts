/**
 * Tests for CommitTooltip component source structure.
 *
 * Validates exports, props, rendering of commit metadata (subject, author,
 * date, hash, parents, body), Copy Hash button, positioning, and data-testids.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitTooltip.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('CommitTooltip', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { CommitTooltip }");
            expect(indexSource).toContain("from './CommitTooltip'");
        });

        it('exports CommitTooltip as a named export', () => {
            expect(source).toContain('export function CommitTooltip');
        });

        it('exports CommitTooltipProps interface', () => {
            expect(source).toContain('export interface CommitTooltipProps');
        });
    });

    describe('component signature', () => {
        it('accepts commit prop of type GitCommitItem', () => {
            expect(source).toContain('commit: GitCommitItem');
        });

        it('accepts anchorRect prop', () => {
            expect(source).toContain('anchorRect: DOMRect | null');
        });

        it('imports GitCommitItem type', () => {
            expect(source).toContain("import type { GitCommitItem } from './CommitList'");
        });
    });

    describe('metadata rendering', () => {
        it('displays full commit subject', () => {
            expect(source).toContain('commit.subject');
            expect(source).toContain('data-testid="tooltip-subject"');
        });

        it('displays author', () => {
            expect(source).toContain('commit.author');
        });

        it('displays formatted date', () => {
            expect(source).toContain('formattedDate');
        });

        it('displays short hash', () => {
            expect(source).toContain('commit.hash.substring(0, 8)');
        });

        it('displays parent hashes', () => {
            expect(source).toContain('commit.parentHashes');
        });

        it('has metadata section with data-testid', () => {
            expect(source).toContain('data-testid="tooltip-metadata"');
        });
    });

    describe('commit body', () => {
        it('renders body when present', () => {
            expect(source).toContain('commit.body');
        });

        it('only renders body section conditionally', () => {
            expect(source).toContain('commit.body &&');
        });

        it('has body section with data-testid', () => {
            expect(source).toContain('data-testid="tooltip-body"');
        });

        it('uses pre element for body with word wrap', () => {
            expect(source).toContain('whitespace-pre-wrap');
        });

        it('limits body height with scroll', () => {
            expect(source).toContain('max-h-[120px]');
            expect(source).toContain('overflow-y-auto');
        });
    });

    describe('copy hash functionality', () => {
        it('has Copy button', () => {
            expect(source).toContain('data-testid="tooltip-copy-hash-btn"');
        });

        it('imports copyToClipboard utility', () => {
            expect(source).toContain("import { copyToClipboard }");
        });

        it('shows Copied! feedback', () => {
            expect(source).toContain('Copied!');
        });

        it('tracks copied state', () => {
            expect(source).toContain('setCopied');
        });

        it('stops event propagation on copy click', () => {
            expect(source).toContain('e.stopPropagation()');
        });
    });

    describe('positioning', () => {
        it('uses fixed positioning', () => {
            expect(source).toContain('fixed');
        });

        it('calculates position from anchorRect', () => {
            expect(source).toContain('anchorRect');
        });

        it('positions tooltip to the right of the anchor (right panel overlay)', () => {
            expect(source).toContain('anchorRect.right');
        });

        it('aligns tooltip top with hovered row', () => {
            expect(source).toContain('anchorRect.top');
        });

        it('flips above if overflowing bottom viewport', () => {
            expect(source).toContain('viewportH');
            expect(source).toContain('anchorRect.top - rect.height');
        });

        it('guards against right-side viewport overflow', () => {
            expect(source).toContain('viewportW');
            expect(source).toContain('window.innerWidth');
        });

        it('uses z-50 for stacking', () => {
            expect(source).toContain('z-50');
        });
    });

    describe('root element', () => {
        it('has data-testid', () => {
            expect(source).toContain('data-testid="commit-tooltip"');
        });

        it('uses ref for DOM measurements', () => {
            expect(source).toContain('tooltipRef');
        });

        it('imports Button from shared', () => {
            expect(source).toContain("import { Button } from '../shared'");
        });
    });
});
