/**
 * MarkdownRenderedDiff — read-only rich diff of a markdown file.
 *
 * Renders the head document through the shared markdown pipeline, with
 * blocks added since base marked green and removed blocks marked red.
 */

import { useMemo } from 'react';
import { MarkdownView } from '../../../shared/MarkdownView';
import { renderMarkdownToHtml } from '../../../../diff/markdown-renderer';
import { diffMarkdownBlocks, type MarkdownDiffBlockType } from './markdownBlockDiff';

const BLOCK_CLASS: Record<MarkdownDiffBlockType, string> = {
    added: 'my-1 border-l-4 border-green-500 bg-green-50 pl-3 dark:bg-green-900/20',
    removed: 'my-1 border-l-4 border-red-500 bg-red-50 pl-3 line-through opacity-70 dark:bg-red-900/20',
    unchanged: 'my-1 border-l-4 border-transparent pl-3',
};

export interface MarkdownRenderedDiffProps {
    base: string;
    head: string;
}

export function MarkdownRenderedDiff({ base, head }: MarkdownRenderedDiffProps) {
    const html = useMemo(() => diffMarkdownBlocks(base, head)
        .map(block => `<div class="${BLOCK_CLASS[block.type]}" data-md-diff="${block.type}">${renderMarkdownToHtml(block.text)}</div>`)
        .join(''), [base, head]);
    return (
        <div className="px-3 py-2" data-testid="markdown-rendered-diff">
            <MarkdownView html={html} />
        </div>
    );
}
