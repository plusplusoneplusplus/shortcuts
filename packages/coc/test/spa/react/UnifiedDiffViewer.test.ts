/**
 * Tests for UnifiedDiffViewer component source structure.
 *
 * Validates exports, props, line classification, color classes,
 * and data-testid passthrough for the unified diff rendering component.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'UnifiedDiffViewer.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('UnifiedDiffViewer', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports UnifiedDiffViewer as a named export', () => {
            expect(source).toContain('export function UnifiedDiffViewer');
        });

        it('exports UnifiedDiffViewerProps interface', () => {
            expect(source).toContain('export interface UnifiedDiffViewerProps');
        });

        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { UnifiedDiffViewer }");
            expect(indexSource).toContain("from './UnifiedDiffViewer'");
        });

        it('exports UnifiedDiffViewerProps type from index', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export type { UnifiedDiffViewerProps }");
        });
    });

    describe('component signature', () => {
        it('accepts diff: string prop', () => {
            expect(source).toContain('diff: string');
        });

        it('accepts optional data-testid prop', () => {
            expect(source).toContain("'data-testid'?: string");
        });
    });

    describe('line classification', () => {
        it('defines a classifyLine function', () => {
            expect(source).toContain('function classifyLine');
        });

        it('classifies added lines (starting with +)', () => {
            expect(source).toContain("line.startsWith('+')");
            expect(source).toContain("'added'");
        });

        it('classifies removed lines (starting with -)', () => {
            expect(source).toContain("line.startsWith('-')");
            expect(source).toContain("'removed'");
        });

        it('classifies hunk headers (starting with @@)', () => {
            expect(source).toContain("line.startsWith('@@')");
            expect(source).toContain("'hunk-header'");
        });

        it('classifies metadata lines (diff, index, ---, +++)', () => {
            expect(source).toContain("line.startsWith('diff ')");
            expect(source).toContain("line.startsWith('index ')");
            expect(source).toContain("line.startsWith('--- ')");
            expect(source).toContain("line.startsWith('+++ ')");
            expect(source).toContain("'meta'");
        });

        it('classifies context lines as default', () => {
            expect(source).toContain("'context'");
        });
    });

    describe('color classes', () => {
        it('has added-line green background', () => {
            expect(source).toContain('bg-[#e6ffed]');
            expect(source).toContain('dark:bg-[#1a3d2b]');
        });

        it('has removed-line red background', () => {
            expect(source).toContain('bg-[#ffeef0]');
            expect(source).toContain('dark:bg-[#3d1a1a]');
        });

        it('has hunk-header blue background', () => {
            expect(source).toContain('bg-[#dbedff]');
            expect(source).toContain('dark:bg-[#1d3251]');
        });

        it('has meta-line muted text color', () => {
            expect(source).toContain('text-[#6e7681]');
            expect(source).toContain('dark:text-[#8b949e]');
        });
    });

    describe('rendering', () => {
        it('splits diff by newline', () => {
            expect(source).toContain("diff.split('\\n')");
        });

        it('preserves whitespace on line rows', () => {
            expect(source).toContain('whitespace-pre');
        });

        it('uses monospace font', () => {
            expect(source).toContain('font-mono');
        });

        it('supports horizontal overflow scrolling', () => {
            expect(source).toContain('overflow-x-auto');
        });

        it('passes data-testid to container', () => {
            expect(source).toContain('data-testid={testId}');
        });

        it('uses consistent container styling', () => {
            expect(source).toContain('bg-[#f5f5f5] dark:bg-[#2d2d2d]');
            expect(source).toContain('border border-[#e0e0e0] dark:border-[#3c3c3c] rounded');
        });
    });

    describe('imports', () => {
        it('imports useMemo from react', () => {
            expect(source).toContain('useMemo');
        });

        it('imports getLanguageFromFileName from useSyntaxHighlight', () => {
            expect(source).toContain('getLanguageFromFileName');
            expect(source).toContain("from './useSyntaxHighlight'");
        });

        it('imports highlightLine from useSyntaxHighlight', () => {
            expect(source).toContain('highlightLine');
        });
    });

    describe('fileName prop and syntax highlighting', () => {
        it('accepts optional fileName prop', () => {
            expect(source).toContain('fileName?: string');
        });

        it('destructures fileName from props', () => {
            expect(source).toContain('fileName,');
        });

        it('calls highlightLine for code content with per-line language', () => {
            expect(source).toContain('highlightLine(content, languages[i])');
        });

        it('uses dangerouslySetInnerHTML for highlighted content', () => {
            expect(source).toContain('dangerouslySetInnerHTML');
        });

        it('separates prefix character from code content', () => {
            expect(source).toContain('line[0]');
            expect(source).toContain('line.slice(1)');
        });
    });

    describe('per-file language detection exports', () => {
        it('exports extractFilePathFromDiffHeader function', () => {
            expect(source).toContain('export function extractFilePathFromDiffHeader');
        });

        it('exports getLanguagesForLines function', () => {
            expect(source).toContain('export function getLanguagesForLines');
        });

        it('uses getLanguagesForLines in a useMemo', () => {
            expect(source).toContain('getLanguagesForLines(lines, fileName)');
        });
    });
});
