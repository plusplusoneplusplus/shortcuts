import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildFullDocumentAskAIContext,
    extractDocumentContext,
    normalizeAskAIContextForDocument
} from '../../shortcuts/markdown-comments/ask-ai-context-utils';

suite('Markdown Review Ask AI Interactive Toolbar Tests', () => {
    function readWebviewContentSource(): string {
        const sourcePath = path.resolve(
            __dirname,
            '../../../src/shortcuts/markdown-comments/webview-content.ts'
        );
        return fs.readFileSync(sourcePath, 'utf8');
    }

    suite('AI Action Dropdown Markup', () => {
        test('includes Ask AI Interactively as a top-level menu item', () => {
            const html = readWebviewContentSource();

            assert.ok(html.includes('id="askAIInteractiveItem"'));
            assert.ok(html.includes('<span class="ai-action-icon">🤖</span>'));
            assert.ok(html.includes('<span class="ai-action-label">Ask AI Interactively</span>'));
        });

        test('keeps Ask AI Interactively between Update Document and Refresh Plan', () => {
            const html = readWebviewContentSource();

            const updateIndex = html.indexOf('id="updateDocumentItem"');
            const interactiveIndex = html.indexOf('id="askAIInteractiveItem"');
            const refreshIndex = html.indexOf('id="refreshPlanItem"');

            assert.ok(updateIndex !== -1, 'updateDocumentItem should exist');
            assert.ok(interactiveIndex !== -1, 'askAIInteractiveItem should exist');
            assert.ok(refreshIndex !== -1, 'refreshPlanItem should exist');
            assert.ok(updateIndex < interactiveIndex, 'Ask AI Interactively should be after Update Document');
            assert.ok(interactiveIndex < refreshIndex, 'Ask AI Interactively should be before Refresh Plan');
        });

        test('does not duplicate Ask AI Interactively or Refresh Plan entries', () => {
            const html = readWebviewContentSource();

            const interactiveCount = (html.match(/id="askAIInteractiveItem"/g) || []).length;
            const refreshCount = (html.match(/id="refreshPlanItem"/g) || []).length;

            assert.strictEqual(interactiveCount, 1);
            assert.strictEqual(refreshCount, 1);
        });
    });

    suite('Ask AI Context Utilities', () => {
        test('extractDocumentContext captures headings and surrounding lines', () => {
            const content = [
                '# Main Title',
                'intro line',
                '## Section A',
                'target line',
                'after target'
            ].join('\n');

            const context = extractDocumentContext(content, 4, 4, 'target line');

            assert.strictEqual(context.startLine, 4);
            assert.strictEqual(context.endLine, 4);
            assert.strictEqual(context.nearestHeading, 'Section A');
            assert.deepStrictEqual(context.allHeadings, ['Main Title', 'Section A']);
            assert.ok(context.surroundingLines.includes('intro line'));
            assert.ok(context.surroundingLines.includes('after target'));
            assert.ok(!context.surroundingLines.includes('target line'));
        });

        test('buildFullDocumentAskAIContext uses full content and normalizes line endings', () => {
            const content = '# Heading\r\nline one\r\nline two';

            const context = buildFullDocumentAskAIContext(content, 'clarify', 'interactive');

            assert.strictEqual(context.instructionType, 'clarify');
            assert.strictEqual(context.mode, 'interactive');
            assert.strictEqual(context.startLine, 1);
            assert.strictEqual(context.endLine, 3);
            assert.strictEqual(context.nearestHeading, 'Heading');
            assert.ok(!context.selectedText.includes('\r'));
            assert.strictEqual(context.selectedText, '# Heading\nline one\nline two');
        });

        test('normalizeAskAIContextForDocument falls back to full document when selection is empty', () => {
            const inputContext = {
                selectedText: '',
                startLine: 0,
                endLine: 0,
                surroundingLines: '',
                nearestHeading: null,
                allHeadings: [],
                instructionType: 'go-deeper',
                mode: 'interactive' as const
            };

            const normalized = normalizeAskAIContextForDocument(
                inputContext,
                '# Plan\n- [ ] Task'
            );

            assert.strictEqual(normalized.instructionType, 'go-deeper');
            assert.strictEqual(normalized.mode, 'interactive');
            assert.strictEqual(normalized.startLine, 1);
            assert.strictEqual(normalized.endLine, 2);
            assert.strictEqual(normalized.nearestHeading, 'Plan');
            assert.deepStrictEqual(normalized.allHeadings, ['Plan']);
            assert.strictEqual(normalized.selectedText, '# Plan\n- [ ] Task');
        });

        test('normalizeAskAIContextForDocument keeps non-empty selection unchanged', () => {
            const inputContext = {
                selectedText: 'selected segment',
                startLine: 10,
                endLine: 12,
                surroundingLines: 'before\nafter',
                nearestHeading: 'Existing Heading',
                allHeadings: ['Existing Heading'],
                instructionType: 'clarify',
                mode: 'interactive' as const
            };

            const normalized = normalizeAskAIContextForDocument(
                inputContext,
                '# Irrelevant\ncontent'
            );

            assert.deepStrictEqual(normalized, inputContext);
        });
    });
});
